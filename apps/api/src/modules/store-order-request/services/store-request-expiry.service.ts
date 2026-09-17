import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  DeliveryActionKind,
  DeliveryActionStatus,
  StoreAddressChangeStatus,
  StoreOrderRequestStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { StoreRequestNotifier } from './store-request-notifier.service';
import { storeOrderRequestLabel } from './store-order-request.service';

export const REMIND_HOURS_KEY = 'reseller.store_request_remind_hours';
export const EXPIRE_HOURS_KEY = 'reseller.store_request_expire_hours';
export const DEFAULT_REMIND_HOURS = 24;
export const DEFAULT_EXPIRE_HOURS = 72;

/** How many rows of each queue one run looks at. The next run takes the rest. */
const BATCH = 200;

export interface StoreRequestSweepResult {
  readonly reminded: number;
  readonly expired: number;
  readonly failures: number;
}

/** What a delivery ask was, in words — the store's and the seller's. */
const DELIVERY_ACTION_LABEL: Readonly<Record<DeliveryActionKind, string>> = {
  [DeliveryActionKind.RECALL]: 'call the customer again',
  [DeliveryActionKind.REATTEMPT]: 'try delivering it again',
  [DeliveryActionKind.RTO]: 'send the parcel back',
};

const ADDRESS_LABEL = 'correct the delivery details';

/** The order facts a notice needs, whichever queue the request is in. */
const ORDER_FACTS = {
  select: {
    orderNumber: true,
    storeNameSnapshot: true,
    seller: { select: { companyName: true } },
  },
} as const;

/**
 * A reseller store's request that seller staff never answer does not
 * wait forever (2026-09-17, owner: "remind Seller staff after 24 hours;
 * after 72 hours close it as EXPIRED and email the store so they know to
 * follow up").
 *
 * Covers EVERY held queue — delivery actions, address corrections and
 * the pre-parcel requests — so the rule is one rule, not three that
 * drift. Each queue is still owned by its module; this only moves a row
 * that is PENDING to EXPIRED, which carries no side-effect to run.
 *
 * ── AGE IS `created_at`, NEVER `updated_at` (rule 4b) ────────────────
 * Stamping the reminder writes the row and resets `updatedAt`; aged from
 * that, a request would never expire.
 *
 * ── A CONCURRENT ANSWER WINS ─────────────────────────────────────────
 * Every move is a guarded `updateMany` on PENDING (and, for the reminder,
 * on `seller_reminded_at IS NULL`). Seller staff approving at the same
 * moment claims the row first and this finds count 0 — no expiry, no
 * email. The reminder stamp is claimed BEFORE it is sent, so a retry or a
 * second instance cannot send it twice.
 *
 * Per-row isolation: one row that fails never stops the rest.
 */
@Injectable()
export class StoreRequestExpiryService {
  private readonly logger = new Logger(StoreRequestExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly notifier: StoreRequestNotifier,
  ) {}

  async sweep(now: Date = new Date()): Promise<StoreRequestSweepResult> {
    const { remindHours, expireHours } = await this.thresholds();
    const expireBefore = new Date(now.getTime() - expireHours * 3_600_000);
    const remindBefore = new Date(now.getTime() - remindHours * 3_600_000);
    const tally = { reminded: 0, expired: 0, failures: 0 };

    // Expire FIRST: a request old enough to close is not also reminded.
    await this.expireDeliveryActions(expireBefore, expireHours, tally);
    await this.expireAddressChanges(expireBefore, expireHours, tally);
    await this.expireOrderRequests(expireBefore, expireHours, tally);

    if (remindHours < expireHours) {
      const left = expireHours - remindHours;
      await this.remindDeliveryActions(remindBefore, expireBefore, left, tally);
      await this.remindAddressChanges(remindBefore, expireBefore, left, tally);
      await this.remindOrderRequests(remindBefore, expireBefore, left, tally);
    }
    return tally;
  }

  /** The two global thresholds; a missing or unreadable one falls back. */
  async thresholds(): Promise<{ remindHours: number; expireHours: number }> {
    const rows = await this.prisma.client.systemSetting.findMany({
      where: { key: { in: [REMIND_HOURS_KEY, EXPIRE_HOURS_KEY] } },
      select: { key: true, valueInt: true },
    });
    const read = (key: string, fallback: number): number => {
      const v = rows.find((r) => r.key === key)?.valueInt;
      return typeof v === 'number' && v > 0 ? v : fallback;
    };
    return {
      remindHours: read(REMIND_HOURS_KEY, DEFAULT_REMIND_HOURS),
      expireHours: read(EXPIRE_HOURS_KEY, DEFAULT_EXPIRE_HOURS),
    };
  }

  // ── delivery actions (only the ones held for the seller) ───────────────

  private async expireDeliveryActions(
    before: Date,
    expireHours: number,
    tally: Tally,
  ): Promise<void> {
    const rows = await this.prisma.client.orderDeliveryActionRequest.findMany({
      where: {
        status: DeliveryActionStatus.PENDING,
        needsSellerApproval: true,
        resellerStoreId: { not: null },
        createdAt: { lt: before },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: {
        id: true,
        action: true,
        orderId: true,
        sellerId: true,
        resellerStoreId: true,
        order: ORDER_FACTS,
      },
    });
    for (const r of rows) {
      await this.isolated(tally, r.id, async () => {
        const claimed = await this.prisma.client.orderDeliveryActionRequest.updateMany({
          where: { id: r.id, status: DeliveryActionStatus.PENDING },
          data: { status: DeliveryActionStatus.EXPIRED, expiredAt: new Date() },
        });
        if (claimed.count === 0 || r.resellerStoreId === null) return;
        tally.expired += 1;
        await this.expiredSideEffects({
          table: 'order_delivery_action_request',
          id: r.id,
          storeId: r.resellerStoreId,
          sellerId: r.sellerId,
          orderId: r.orderId,
          order: r.order,
          label: DELIVERY_ACTION_LABEL[r.action],
          expireHours,
        });
      });
    }
  }

  private async remindDeliveryActions(
    before: Date,
    notBefore: Date,
    left: number,
    tally: Tally,
  ): Promise<void> {
    const rows = await this.prisma.client.orderDeliveryActionRequest.findMany({
      where: {
        status: DeliveryActionStatus.PENDING,
        needsSellerApproval: true,
        resellerStoreId: { not: null },
        sellerRemindedAt: null,
        createdAt: { lt: before, gte: notBefore },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true, action: true, orderId: true, sellerId: true, order: ORDER_FACTS },
    });
    for (const r of rows) {
      await this.isolated(tally, r.id, async () => {
        const claimed = await this.prisma.client.orderDeliveryActionRequest.updateMany({
          where: { id: r.id, status: DeliveryActionStatus.PENDING, sellerRemindedAt: null },
          data: { sellerRemindedAt: new Date() },
        });
        if (claimed.count === 0) return;
        tally.reminded += 1;
        await this.notifier.remindSeller({
          sellerId: r.sellerId,
          requestId: r.id,
          storeName: r.order.storeNameSnapshot ?? 'A reseller store',
          orderId: r.orderId,
          orderNumber: r.order.orderNumber,
          label: DELIVERY_ACTION_LABEL[r.action],
          expiresInHours: left,
        });
      });
    }
  }

  // ── address corrections ────────────────────────────────────────────────

  private async expireAddressChanges(
    before: Date,
    expireHours: number,
    tally: Tally,
  ): Promise<void> {
    const rows = await this.prisma.client.storeAddressChangeRequest.findMany({
      where: { status: StoreAddressChangeStatus.PENDING, createdAt: { lt: before } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true, orderId: true, sellerId: true, storeId: true, order: ORDER_FACTS },
    });
    for (const r of rows) {
      await this.isolated(tally, r.id, async () => {
        const claimed = await this.prisma.client.storeAddressChangeRequest.updateMany({
          where: { id: r.id, status: StoreAddressChangeStatus.PENDING },
          data: { status: StoreAddressChangeStatus.EXPIRED, expiredAt: new Date() },
        });
        if (claimed.count === 0) return;
        tally.expired += 1;
        await this.expiredSideEffects({
          table: 'store_address_change_request',
          id: r.id,
          storeId: r.storeId,
          sellerId: r.sellerId,
          orderId: r.orderId,
          order: r.order,
          label: ADDRESS_LABEL,
          expireHours,
        });
      });
    }
  }

  private async remindAddressChanges(
    before: Date,
    notBefore: Date,
    left: number,
    tally: Tally,
  ): Promise<void> {
    const rows = await this.prisma.client.storeAddressChangeRequest.findMany({
      where: {
        status: StoreAddressChangeStatus.PENDING,
        sellerRemindedAt: null,
        createdAt: { lt: before, gte: notBefore },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true, orderId: true, sellerId: true, order: ORDER_FACTS },
    });
    for (const r of rows) {
      await this.isolated(tally, r.id, async () => {
        const claimed = await this.prisma.client.storeAddressChangeRequest.updateMany({
          where: { id: r.id, status: StoreAddressChangeStatus.PENDING, sellerRemindedAt: null },
          data: { sellerRemindedAt: new Date() },
        });
        if (claimed.count === 0) return;
        tally.reminded += 1;
        await this.notifier.remindSeller({
          sellerId: r.sellerId,
          requestId: r.id,
          storeName: r.order.storeNameSnapshot ?? 'A reseller store',
          orderId: r.orderId,
          orderNumber: r.order.orderNumber,
          label: ADDRESS_LABEL,
          expiresInHours: left,
        });
      });
    }
  }

  // ── cancel / call-cap answer / issue with Skydrop ──────────────────────

  private async expireOrderRequests(
    before: Date,
    expireHours: number,
    tally: Tally,
  ): Promise<void> {
    const rows = await this.prisma.client.storeOrderRequest.findMany({
      where: { status: StoreOrderRequestStatus.PENDING, createdAt: { lt: before } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      include: { order: ORDER_FACTS },
    });
    for (const r of rows) {
      await this.isolated(tally, r.id, async () => {
        const claimed = await this.prisma.client.storeOrderRequest.updateMany({
          where: { id: r.id, status: StoreOrderRequestStatus.PENDING },
          data: { status: StoreOrderRequestStatus.EXPIRED, expiredAt: new Date() },
        });
        if (claimed.count === 0) return;
        tally.expired += 1;
        await this.expiredSideEffects({
          table: 'store_order_request',
          id: r.id,
          storeId: r.storeId,
          sellerId: r.sellerId,
          orderId: r.orderId,
          order: r.order,
          label: storeOrderRequestLabel(r),
          expireHours,
        });
      });
    }
  }

  private async remindOrderRequests(
    before: Date,
    notBefore: Date,
    left: number,
    tally: Tally,
  ): Promise<void> {
    const rows = await this.prisma.client.storeOrderRequest.findMany({
      where: {
        status: StoreOrderRequestStatus.PENDING,
        sellerRemindedAt: null,
        createdAt: { lt: before, gte: notBefore },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      include: { order: ORDER_FACTS },
    });
    for (const r of rows) {
      await this.isolated(tally, r.id, async () => {
        const claimed = await this.prisma.client.storeOrderRequest.updateMany({
          where: { id: r.id, status: StoreOrderRequestStatus.PENDING, sellerRemindedAt: null },
          data: { sellerRemindedAt: new Date() },
        });
        if (claimed.count === 0) return;
        tally.reminded += 1;
        await this.notifier.remindSeller({
          sellerId: r.sellerId,
          requestId: r.id,
          storeName: r.order.storeNameSnapshot ?? 'A reseller store',
          orderId: r.orderId,
          orderNumber: r.order.orderNumber,
          label: storeOrderRequestLabel(r),
          expiresInHours: left,
        });
      });
    }
  }

  private async expiredSideEffects(input: {
    table: string;
    id: string;
    storeId: string;
    sellerId: string;
    orderId: string;
    order: {
      orderNumber: string;
      storeNameSnapshot: string | null;
      seller: { companyName: string };
    };
    label: string;
    expireHours: number;
  }): Promise<void> {
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      actorId: null,
      sellerId: input.sellerId,
      action: 'store.request.expired',
      entityType: input.table,
      entityId: input.id,
      severity: 'LOW',
      metadata: { orderId: input.orderId, storeId: input.storeId, expireHours: input.expireHours },
    });
    await this.notifier.expired({
      storeId: input.storeId,
      requestId: input.id,
      orderId: input.orderId,
      orderNumber: input.order.orderNumber,
      sellerName: input.order.seller.companyName,
      label: input.label,
      expireHours: input.expireHours,
    });
  }

  private async isolated(tally: Tally, id: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      tally.failures += 1;
      this.logger.warn(
        { requestId: id, err: err instanceof Error ? err.message : err },
        'A store request could not be reminded or expired',
      );
    }
  }
}

interface Tally {
  reminded: number;
  expired: number;
  failures: number;
}
