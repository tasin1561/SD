import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  OrderStatus,
  Prisma,
  ResellerStoreEventKind,
  ResellerStoreStatus,
  SellerStoreKind,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AuthenticatedSeller } from '../../../common/types/request';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { ResellerStoreService } from '../../reseller-store/services/reseller-store.service';
import { orderFate } from '../../treasury/services/pnl.service';
import { loadOrderFacts } from './reseller-order-facts';
import { ResellerReportsNotifier } from './reseller-reports-notifier.service';
import type { AutoPauseRuleView } from './seller-reseller-analysis.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const RATE = /^\d{1,3}(\.\d{1,2})?$/;

const RETURNED: readonly OrderStatus[] = [
  OrderStatus.RTO_RECEIVED,
  OrderStatus.RTO_RESTOCKED,
  OrderStatus.RTO_DAMAGED,
];

export interface AutoPauseRuleInput {
  readonly enabled: boolean;
  readonly returnRatePercent: string;
  readonly minDecidedOrders: number;
  readonly windowDays: number;
}

/**
 * The verdict, with no database in it: pause when at least `minDecided`
 * parcels reached a fate and MORE than `limitPct` of them came back.
 */
export function autoPauseVerdict(input: {
  readonly delivered: number;
  readonly returned: number;
  readonly limitPct: Prisma.Decimal;
  readonly minDecided: number;
}): { decided: number; ratePct: string | null; over: boolean } {
  const decided = input.delivered + input.returned;
  if (decided === 0) return { decided, ratePct: null, over: false };
  const rate = new Prisma.Decimal(input.returned).div(decided).mul(100);
  return {
    decided,
    ratePct: rate.toFixed(1),
    over: decided >= input.minDecided && rate.gt(input.limitPct),
  };
}

function view(r: {
  storeId: string;
  enabled: boolean;
  returnRatePercent: Prisma.Decimal;
  minDecidedOrders: number;
  windowDays: number;
  lastEvaluatedAt: Date | null;
  lastPausedAt: Date | null;
}): AutoPauseRuleView {
  return {
    storeId: r.storeId,
    enabled: r.enabled,
    returnRatePercent: r.returnRatePercent.toFixed(2),
    minDecidedOrders: r.minDecidedOrders,
    windowDays: r.windowDays,
    lastEvaluatedAt: r.lastEvaluatedAt?.toISOString() ?? null,
    lastPausedAt: r.lastPausedAt?.toISOString() ?? null,
  };
}

/**
 * RS-9 — pause a reseller store automatically when too many of its
 * parcels come back, on the rule the SELLER set for it.
 *
 * The pause is `ResellerStoreService.autoPause` — the ONE writer of a
 * store's status, the same guarded PAUSE a person makes, recorded as
 * SYSTEM and audited. Pause blocks NEW orders only. The seller is told
 * in-app.
 *
 * A seller who resumes an auto-paused store has decided to carry on: the
 * next evaluation counts only parcels that reached their fate AFTER the
 * resume, so it is not re-paused an hour later on the same evidence.
 */
@Injectable()
export class ResellerAutoPauseService {
  private readonly logger = new Logger(ResellerAutoPauseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: ResellerStoreService,
    private readonly notifier: ResellerReportsNotifier,
    private readonly audit: AuditLogService,
  ) {}

  async setRule(
    seller: AuthenticatedSeller,
    storeId: string,
    input: AutoPauseRuleInput,
  ): Promise<AutoPauseRuleView> {
    if (!RATE.test(input.returnRatePercent)) {
      throw new BadRequestException({
        code: 'INVALID_RATE',
        message: 'Give the return rate as a percentage, e.g. 35 or 35.5.',
      });
    }
    const rate = new Prisma.Decimal(input.returnRatePercent);
    if (rate.lte(0) || rate.gte(100)) {
      throw new BadRequestException({
        code: 'INVALID_RATE',
        message: 'The return rate limit must be above 0% and below 100%.',
      });
    }
    const store = await this.prisma.client.sellerStore.findFirst({
      where: { id: storeId, sellerId: seller.id, kind: SellerStoreKind.RESELLER, deletedAt: null },
      select: { id: true, name: true },
    });
    if (store === null) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'No such reseller store' });
    }
    const before = await this.prisma.client.resellerStoreAutoPause.findUnique({
      where: { storeId },
    });
    const data = {
      enabled: input.enabled,
      returnRatePercent: rate,
      minDecidedOrders: input.minDecidedOrders,
      windowDays: input.windowDays,
      updatedBySellerUserId: seller.userId,
    };
    const saved = await this.prisma.client.resellerStoreAutoPause.upsert({
      where: { storeId },
      create: { storeId, ...data },
      update: data,
    });
    await this.audit.log({
      actorType: ActorType.SELLER,
      actorId: seller.userId,
      sellerId: seller.id,
      action: 'reseller_store.auto_pause_rule_set',
      entityType: 'seller_store',
      entityId: storeId,
      severity: 'MEDIUM',
      changes: {
        before: before === null ? null : view(before),
        after: view(saved),
      } as unknown as Prisma.InputJsonValue,
      metadata: { name: store.name },
    });
    return view(saved);
  }

  /** The hourly sweep. One store's failure never stops the others. */
  async sweep(
    now: Date = new Date(),
  ): Promise<{ evaluated: number; paused: number; failures: number }> {
    const db = this.prisma.client;
    const rules = await db.resellerStoreAutoPause.findMany({ where: { enabled: true } });
    if (rules.length === 0) return { evaluated: 0, paused: 0, failures: 0 };
    const stores = await db.sellerStore.findMany({
      where: {
        id: { in: rules.map((r) => r.storeId) },
        kind: SellerStoreKind.RESELLER,
        status: ResellerStoreStatus.ACTIVE,
        deletedAt: null,
      },
      select: { id: true, sellerId: true, name: true, displayName: true },
    });
    const storeBy = new Map(stores.map((s) => [s.id, s]));
    let evaluated = 0;
    let paused = 0;
    let failures = 0;
    for (const rule of rules) {
      const store = storeBy.get(rule.storeId);
      if (store === undefined) continue; // not ACTIVE: nothing to pause
      try {
        let start = new Date(now.getTime() - rule.windowDays * DAY_MS);
        if (rule.lastPausedAt !== null) {
          const resumed = await db.resellerStoreEvent.findFirst({
            where: {
              storeId: store.id,
              kind: ResellerStoreEventKind.RESUMED,
              createdAt: { gt: rule.lastPausedAt },
            },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          });
          if (resumed !== null && resumed.createdAt > start) start = resumed.createdAt;
        }
        const facts = await loadOrderFacts(db, {
          storeId: store.id,
          storeKind: SellerStoreKind.RESELLER,
          OR: [
            { events: { some: { toStatus: OrderStatus.DELIVERED, createdAt: { gte: start } } } },
            { events: { some: { toStatus: { in: [...RETURNED] }, createdAt: { gte: start } } } },
          ],
        });
        // An order is counted in the fate it is in NOW, dated by when it got there.
        const delivered = facts.filter(
          (f) =>
            f.status === OrderStatus.DELIVERED && f.deliveredAt !== null && f.deliveredAt >= start,
        ).length;
        const returned = facts.filter(
          (f) =>
            orderFate(f.status) === 'returned' && f.returnedAt !== null && f.returnedAt >= start,
        ).length;
        const verdict = autoPauseVerdict({
          delivered,
          returned,
          limitPct: rule.returnRatePercent,
          minDecided: rule.minDecidedOrders,
        });
        evaluated += 1;
        await db.resellerStoreAutoPause.updateMany({
          where: { storeId: store.id },
          data: { lastEvaluatedAt: now },
        });
        if (!verdict.over) continue;
        const name = store.displayName ?? store.name;
        await this.stores.autoPause(
          store.sellerId,
          store.id,
          `Paused automatically: ${returned} of ${verdict.decided} parcels with a known outcome came back ` +
            `(${verdict.ratePct}%), over the ${rule.returnRatePercent.toFixed(2)}% limit the seller set.`,
          ResellerAutoPauseService.name,
        );
        await db.resellerStoreAutoPause.updateMany({
          where: { storeId: store.id },
          data: { lastPausedAt: now },
        });
        paused += 1;
        await this.notifier.storeAutoPaused({
          sellerId: store.sellerId,
          storeName: name,
          returned,
          decided: verdict.decided,
          returnRatePct: verdict.ratePct ?? '0',
          limitPct: rule.returnRatePercent.toFixed(2),
          windowDays: rule.windowDays,
          eventKey: `${store.id}:${now.getTime()}`,
        });
      } catch (err) {
        failures += 1;
        this.logger.warn(
          { storeId: rule.storeId, err: err instanceof Error ? err.message : String(err) },
          'Auto-pause evaluation failed for a store; the next run tries again',
        );
      }
    }
    return { evaluated, paused, failures };
  }
}
