import { Injectable, Logger } from '@nestjs/common';
import {
  ActorType,
  ConsignmentLeg,
  GoodsReceiptStatus,
  NotificationCategory,
  NotificationChannel,
  SellerNotificationCategory,
  TicketType,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { NotificationDispatchService } from '../../notification-audience/services/notification-dispatch.service';
import { SellerNotificationPreferenceResolver } from '../../seller-notification-preference/services/seller-notification-preference-resolver.service';
import { TicketService, type TicketActor } from '../../ticket/services/ticket.service';
import {
  affectedLines,
  receiptShortfallOpeningMessage,
  receiptShortfallSubject,
  receiptSurplusNotice,
  shortOf,
  surplusOf,
  type ReceiptShortfallFacts,
  type ShortfallLeg,
  type SurplusNotice,
} from './receipt-shortfall-ticket-message';

/** The in-app topic for "more arrived than declared" (NOTIF-17). */
export const RECEIPT_SURPLUS_TOPIC = 'inventory.receipt_surplus';
/** Who at the seller hears about a surplus: the people who see inbound stock. */
const SURPLUS_AUDIENCE_PERMISSION = 'inbound.view';

export type TicketOutcome = 'NONE' | 'EXISTS' | 'WOULD_OPEN' | 'OPENED' | 'FAILED';
export type SurplusOutcome =
  | 'NONE'
  | 'ALREADY_TOLD'
  | 'WOULD_TELL'
  | 'TOLD'
  | 'SILENCED'
  | 'FAILED';

export interface ReceiptShortfallRow {
  readonly receiptId: string;
  readonly receiptNumber: string;
  readonly consignmentNumber: string | null;
  readonly sellerId: string;
  readonly leg: ShortfallLeg;
  readonly shortUnits: number;
  readonly damagedUnits: number;
  readonly surplusUnits: number;
  readonly ticket: TicketOutcome;
  readonly ticketId: string | null;
  readonly ticketNumber: string | null;
  readonly surplus: SurplusOutcome;
  /** Dry run only: exactly what would be written and sent. */
  readonly preview: {
    readonly ticketSubject: string | null;
    readonly ticketMessage: string | null;
    readonly surplusTitle: string | null;
    readonly surplusBody: string | null;
  } | null;
  readonly error: string | null;
}

export interface ReceiptShortfallBackfillReport {
  readonly dryRun: boolean;
  /** Completed, counted receipts looked at. */
  readonly considered: number;
  /** Those with any variance — the rows below. */
  readonly receipts: readonly ReceiptShortfallRow[];
  readonly ticketsOpened: number;
  readonly surplusNoticesSent: number;
}

interface Loaded {
  readonly receiptId: string;
  readonly sellerId: string;
  readonly facts: ReceiptShortfallFacts;
}

/**
 * TKT-3 — a goods receipt that comes up short opens a ticket; one that
 * comes up OVER tells the seller.
 *
 * A variance stays a NUMBER on the receipt (CNS-3): nothing here blocks a
 * count, holds stock, or moves money. What was missing is that a short
 * count was recorded and then asked of nobody — the seller got one email
 * saying so and no place to answer it, and a loss in transit (ours) was
 * indistinguishable from a seller's over-declaration (theirs). A ticket
 * names the leg, asks the right side, and gives staff the existing refund
 * path when the units were in our hands.
 *
 * Runs AFTER the completion commits, best-effort (visible-vs-silent): the
 * count and the stock are the durable facts and go first; the ticket is
 * the reflection. A failure here is logged and audited HIGH and never
 * reaches the operator completing the receipt — and a completed receipt
 * with a short line and no ticket is exactly what `backfill` finds, so
 * the gap announces itself on the next dry run instead of staying silent.
 *
 * Idempotent twice over: `TicketService.openOrFind` keys a
 * RECEIPT_SHORTFALL on the goods receipt (a unique index), and the
 * surplus notice carries `receipt_surplus:<receiptId>` (NOTIF-2).
 */
@Injectable()
export class ReceiptShortfallTicketService {
  private readonly logger = new Logger(ReceiptShortfallTicketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketService,
    private readonly dispatch: NotificationDispatchService,
    private readonly preferences: SellerNotificationPreferenceResolver,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * Called by `GoodsReceiptService` once a completion has committed.
   * NEVER throws — completion must not fail because a ticket could not
   * be opened.
   */
  async afterCompletion(receiptId: string): Promise<void> {
    try {
      const loaded = await this.load(receiptId);
      if (loaded === null) return;
      await this.raise(loaded, { type: ActorType.SYSTEM });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { receiptId, err: message },
        'Receipt shortfall ticket / surplus notice not raised — the backfill will find it',
      );
      await this.audit.log({
        actorType: ActorType.SYSTEM,
        action: 'inventory.receipt_shortfall.not_raised',
        entityType: 'goods_receipt',
        entityId: receiptId,
        severity: 'HIGH',
        metadata: { error: message },
      });
    }
  }

  /**
   * Operator-run catch-up for receipts completed before this existed (or
   * whose post-completion step failed). DRY RUN by default: reports what
   * it would open and send, with the exact words, and writes nothing.
   */
  async backfill(input: {
    readonly dryRun: boolean;
    readonly staffId: string;
  }): Promise<ReceiptShortfallBackfillReport> {
    const candidates = await this.prisma.client.goodsReceipt.findMany({
      where: {
        status: GoodsReceiptStatus.COMPLETED,
        deletedAt: null,
        forwardedWithoutCount: false,
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });

    const rows: ReceiptShortfallRow[] = [];
    let ticketsOpened = 0;
    let surplusNoticesSent = 0;
    for (const c of candidates) {
      // Per-receipt isolation: one receipt that cannot be read or
      // ticketed must not cost the others theirs.
      let loaded: Loaded | null = null;
      try {
        loaded = await this.load(c.id);
        if (loaded === null) continue;
        const row = input.dryRun
          ? await this.preview(loaded)
          : await this.raise(loaded, { type: ActorType.STAFF, staffId: input.staffId });
        if (row === null) continue;
        if (row.ticket === 'OPENED') ticketsOpened += 1;
        if (row.surplus === 'TOLD') surplusNoticesSent += 1;
        rows.push(row);
      } catch (err) {
        if (loaded === null) continue;
        rows.push({
          ...this.summary(loaded),
          ticket: 'FAILED',
          ticketId: null,
          ticketNumber: null,
          surplus: 'NONE',
          preview: null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffId,
      action: 'inventory.receipt_shortfall.backfill',
      entityType: 'goods_receipt',
      // A run over many receipts is not one row (CLAUDE.md "General" #6).
      entityId: null,
      // A real run opens tickets and messages sellers; a dry run reads.
      severity: input.dryRun ? 'LOW' : 'HIGH',
      metadata: {
        dryRun: input.dryRun,
        considered: candidates.length,
        withVariance: rows.length,
        ticketsOpened,
        surplusNoticesSent,
        receipts: rows.map((r) => ({
          receiptNumber: r.receiptNumber,
          ticket: r.ticket,
          ticketNumber: r.ticketNumber,
          surplus: r.surplus,
        })),
      },
    });

    return {
      dryRun: input.dryRun,
      considered: candidates.length,
      receipts: rows,
      ticketsOpened,
      surplusNoticesSent,
    };
  }

  /** Open (or find) the ticket, then tell about any surplus. */
  private async raise(loaded: Loaded, actor: TicketActor): Promise<ReceiptShortfallRow | null> {
    const { facts } = loaded;
    const affected = affectedLines(facts.lines);
    const notice = receiptSurplusNotice(facts);
    if (affected.length === 0 && notice === null) return null;

    let ticket: TicketOutcome = 'NONE';
    let ticketId: string | null = null;
    let ticketNumber: string | null = null;
    if (affected.length > 0) {
      const opened = await this.tickets.openOrFind(
        {
          ticketType: TicketType.RECEIPT_SHORTFALL,
          sellerId: loaded.sellerId,
          subject: receiptShortfallSubject(facts),
          descriptionFor: (n) => receiptShortfallOpeningMessage({ ...facts, ticketNumber: n }),
          goodsReceiptId: loaded.receiptId,
        },
        actor,
      );
      ticket = opened.created ? 'OPENED' : 'EXISTS';
      ticketId = opened.ticket.id;
      ticketNumber = opened.ticket.ticketNumber;
    }

    const surplus: SurplusOutcome =
      notice === null
        ? 'NONE'
        : (await this.surplusAlreadyTold(loaded.receiptId))
          ? 'ALREADY_TOLD'
          : await this.tellSurplus(loaded, notice);

    return {
      ...this.summary(loaded),
      ticket,
      ticketId,
      ticketNumber,
      surplus,
      preview: null,
      error: null,
    };
  }

  private async preview(loaded: Loaded): Promise<ReceiptShortfallRow | null> {
    const { facts } = loaded;
    const affected = affectedLines(facts.lines);
    const notice = receiptSurplusNotice(facts);
    if (affected.length === 0 && notice === null) return null;

    const existing =
      affected.length === 0
        ? null
        : await this.prisma.client.ticket.findUnique({
            where: {
              goodsReceiptId_ticketType: {
                goodsReceiptId: loaded.receiptId,
                ticketType: TicketType.RECEIPT_SHORTFALL,
              },
            },
            select: { id: true, ticketNumber: true },
          });
    const wouldOpen = affected.length > 0 && existing === null;
    const told = notice === null ? false : await this.surplusAlreadyTold(loaded.receiptId);

    return {
      ...this.summary(loaded),
      ticket: affected.length === 0 ? 'NONE' : wouldOpen ? 'WOULD_OPEN' : 'EXISTS',
      ticketId: existing?.id ?? null,
      ticketNumber: existing?.ticketNumber ?? null,
      surplus: notice === null ? 'NONE' : told ? 'ALREADY_TOLD' : 'WOULD_TELL',
      preview: {
        ticketSubject: wouldOpen ? receiptShortfallSubject(facts) : null,
        // The number is allocated when the ticket is opened, so the
        // preview is the no-number wording of the same message.
        ticketMessage: wouldOpen
          ? receiptShortfallOpeningMessage({ ...facts, ticketNumber: null })
          : null,
        surplusTitle: notice !== null && !told ? notice.title : null,
        surplusBody: notice !== null && !told ? notice.body : null,
      },
      error: null,
    };
  }

  private summary(
    loaded: Loaded,
  ): Pick<
    ReceiptShortfallRow,
    | 'receiptId'
    | 'receiptNumber'
    | 'consignmentNumber'
    | 'sellerId'
    | 'leg'
    | 'shortUnits'
    | 'damagedUnits'
    | 'surplusUnits'
  > {
    const { facts } = loaded;
    return {
      receiptId: loaded.receiptId,
      receiptNumber: facts.receiptNumber,
      consignmentNumber: facts.consignmentNumber,
      sellerId: loaded.sellerId,
      leg: facts.leg,
      shortUnits: facts.lines.reduce((n, l) => n + shortOf(l), 0),
      damagedUnits: facts.lines.reduce((n, l) => n + l.damagedQty, 0),
      surplusUnits: facts.lines.reduce((n, l) => n + surplusOf(l), 0),
    };
  }

  private async surplusAlreadyTold(receiptId: string): Promise<boolean> {
    const n = await this.prisma.client.notificationLog.count({
      where: { eventId: `receipt_surplus:${receiptId}` },
    });
    return n > 0;
  }

  /**
   * In-app, to the people at the seller who see inbound stock. INFORMATIONAL:
   * worth knowing, nothing to do. The company's STOCK_ALERTS preference
   * can silence it (NOTIF-15); the receipt email already names the surplus.
   */
  private async tellSurplus(loaded: Loaded, notice: SurplusNotice): Promise<SurplusOutcome> {
    try {
      const pref = await this.preferences.resolve({
        sellerId: loaded.sellerId,
        category: SellerNotificationCategory.STOCK_ALERTS,
        notificationCategory: NotificationCategory.INFORMATIONAL,
      });
      if (!pref.inApp) return 'SILENCED';
      const result = await this.dispatch.dispatch({
        topic: RECEIPT_SURPLUS_TOPIC,
        category: NotificationCategory.INFORMATIONAL,
        title: notice.title,
        body: notice.body,
        channels: [NotificationChannel.IN_APP],
        audience: [
          {
            kind: 'SELLER_PERMISSION',
            sellerId: loaded.sellerId,
            permission: SURPLUS_AUDIENCE_PERMISSION,
          },
        ],
        triggerEvent: RECEIPT_SURPLUS_TOPIC,
        eventId: `receipt_surplus:${loaded.receiptId}`,
      });
      return result.delivered > 0 ? 'TOLD' : 'SILENCED';
    } catch (err) {
      this.logger.warn(
        { receiptId: loaded.receiptId, err: err instanceof Error ? err.message : String(err) },
        'Receipt surplus notice failed',
      );
      return 'FAILED';
    }
  }

  /**
   * The facts, or null when the receipt is not a completed count: not
   * COMPLETED, retired, or a Dhaka stop that forwarded without opening
   * the cartons (nobody counted, so there is no number to be short of).
   */
  private async load(receiptId: string): Promise<Loaded | null> {
    const r = await this.prisma.client.goodsReceipt.findUnique({
      where: { id: receiptId },
      select: {
        id: true,
        sellerId: true,
        receiptNumber: true,
        status: true,
        deletedAt: true,
        forwardedWithoutCount: true,
        receivedAt: true,
        dispatchedAt: true,
        warehouse: { select: { code: true, name: true, timezone: true } },
        consignment: {
          select: {
            consignmentNumber: true,
            // The Dhaka leg, for the India leg's story: where the goods
            // left from, and whether anybody counted them there.
            receipts: {
              where: { leg: ConsignmentLeg.BD_INTAKE, deletedAt: null },
              take: 1,
              select: {
                forwardedWithoutCount: true,
                warehouse: { select: { code: true, name: true, timezone: true } },
              },
            },
          },
        },
        lines: {
          orderBy: { createdAt: 'asc' },
          select: {
            expectedQty: true,
            receivedQty: true,
            damagedQty: true,
            variant: {
              select: { skuCode: true, variantLabel: true, product: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (
      r === null ||
      r.status !== GoodsReceiptStatus.COMPLETED ||
      r.deletedAt !== null ||
      r.forwardedWithoutCount
    ) {
      return null;
    }

    const bd = r.consignment?.receipts[0] ?? null;
    // In transit only when BANGLADESH COUNTED what left. A Dhaka stop that
    // forwarded unopened makes India the first count, so a gap there is
    // between the seller's declaration and us — leg (a), not (c).
    const inTransit = r.dispatchedAt !== null && bd !== null && !bd.forwardedWithoutCount;

    return {
      receiptId: r.id,
      sellerId: r.sellerId,
      facts: {
        consignmentNumber: r.consignment?.consignmentNumber ?? null,
        receiptNumber: r.receiptNumber,
        warehouse: r.warehouse,
        originWarehouse: inTransit ? bd.warehouse : null,
        receivedAt: r.receivedAt,
        leg: inTransit ? 'IN_TRANSIT' : 'SELLER_TO_FIRST_WAREHOUSE',
        lines: r.lines.map((l) => ({
          productName: l.variant.product.name,
          variantLabel: l.variant.variantLabel,
          skuCode: l.variant.skuCode,
          expectedQty: l.expectedQty,
          receivedQty: l.receivedQty,
          damagedQty: l.damagedQty,
        })),
      },
    };
  }
}
