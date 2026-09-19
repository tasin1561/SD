import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  Currency,
  Prisma,
  ResellerMoneyParty,
  type RtoItemCondition,
  SellerStoreKind,
  StoreDisputeKind,
  TicketHandling,
  TicketStatus,
  TicketType,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { ResellerOrderMoneyService } from '../../reseller-order-money/services/reseller-order-money.service';
import { ResellerOrderMoneyReadService } from '../../reseller-order-money-view/services/reseller-order-money-read.service';
import { TicketStateMachineService } from './ticket-state-machine.service';
import { allocateTicketNumber } from './ticket-numbering';
import { TicketNotifier } from './ticket-notifier.service';

export interface TicketActor {
  readonly type: ActorType;
  readonly staffId?: string | null;
  readonly sellerUserId?: string | null;
  /** RS-7 — a reseller store user on its own dispute. */
  readonly storeUserId?: string | null;
}

/** The id a ticket event records for whoever acted. */
function actorIdOf(actor: TicketActor): string | null {
  return actor.staffId ?? actor.sellerUserId ?? actor.storeUserId ?? null;
}

/**
 * The companion "Ticket opened" event `open()` writes — the one row that
 * records the opener's ACTOR TYPE. Read from there rather than from the
 * `opened_by_*` columns alone, because a seller acting without a user id
 * (an API key, the delivery-action path) sets neither column and would
 * otherwise read as the system speaking.
 */
const OPENING_EVENT = {
  where: { fromStatus: null },
  orderBy: { createdAt: 'asc' },
  take: 1,
  select: { actorType: true },
} as const;

/**
 * The two names a person can actually read, pulled with every ticket.
 *
 * Declared once so a new read cannot forget them and silently render a
 * uuid — which is what every ticket screen did until now: an order
 * shown as `01a043c6-7fbf-…` cannot be repeated down a phone, matched
 * against the order list, or recognised at all.
 */
/**
 * The ticket kinds a reseller store may READ on its own portal.
 *
 * A dispute WITH its seller (RS-7) and, since 2026-09-16, an issue it
 * raised with US. One set, because every store-facing read and reply
 * must admit both — filtered to STORE_DISPUTE alone, a store would raise
 * a STORE_ISSUE and then be unable to see or reply to it.
 *
 * Deliberately NOT used by the two settlement guards: money between a
 * store and its seller settles a DISPUTE only, and a STORE_ISSUE is ours
 * to answer.
 */
const STORE_READABLE_TICKET_TYPES = [TicketType.STORE_DISPUTE, TicketType.STORE_ISSUE] as const;

const TICKET_NAMES = {
  order: { select: { orderNumber: true } },
  shipment: { select: { shipmentNumber: true } },
  // RECEIPT_SHORTFALL (TKT-3): the count it is about, by number.
  goodsReceipt: {
    select: { receiptNumber: true, consignment: { select: { consignmentNumber: true } } },
  },
  events: OPENING_EVENT,
  // RS-7 — the reseller store a STORE_DISPUTE is raised by, by name.
  store: { select: { name: true, displayName: true } },
} as const;

/**
 * Who opened a ticket, as the conversations need it: our side or the
 * seller's. The opening bubble is the ticket's `description`, and it
 * used to be drawn as the SELLER's on every ticket — so the message we
 * write when an RTO inspection opens a scrap ticket read as "You" to the
 * seller who had never said it.
 */
export type TicketOpener = 'STAFF' | 'SELLER' | 'SYSTEM' | 'STORE';

function openedByOf(row: {
  openedByStaffId: string | null;
  openedBySellerUserId: string | null;
  openedByStoreUserId?: string | null;
  events?: readonly { actorType: ActorType }[];
}): TicketOpener {
  switch (row.events?.[0]?.actorType) {
    case ActorType.SELLER:
    case ActorType.API:
      return 'SELLER';
    case ActorType.STORE:
      // RS-7 — a reseller store raising a dispute WITH its seller: neither
      // the seller's words nor ours, so it is named for what it is.
      return 'STORE';
    case ActorType.STAFF:
      return 'STAFF';
    case ActorType.SYSTEM:
      return 'SYSTEM';
    case undefined:
      // `typeof` rather than `!== null`: a caller that did not select the
      // column hands over undefined, which a null check reads as set.
      if (typeof row.openedBySellerUserId === 'string') return 'SELLER';
      if (typeof row.openedByStoreUserId === 'string') return 'STORE';
      if (typeof row.openedByStaffId === 'string') return 'STAFF';
      return 'SYSTEM';
  }
}

/** Search: the ticket number, its subject, the order and the parcel. */
function ticketSearchWhere(search: string | undefined): Prisma.TicketWhereInput {
  const q = search?.trim().slice(0, 100) ?? '';
  if (q === '') return {};
  const c = { contains: q, mode: 'insensitive' as const };
  return {
    OR: [
      { ticketNumber: c },
      { subject: c },
      { order: { orderNumber: c } },
      { shipment: { shipmentNumber: c } },
      { shipment: { awbNumber: c } },
      { goodsReceipt: { receiptNumber: c } },
      { goodsReceipt: { consignment: { consignmentNumber: c } } },
    ],
  };
}

/**
 * The three stages a ticket travels, and the statuses behind each.
 *
 * The screens ask "open, reviewing or closed" because that is the
 * question somebody has. The database keeps four CLOSED statuses apart
 * because they are different outcomes and one of them moved money
 * (TKT-1) — so the grouping lives here, once, rather than as a list of
 * four values pasted into every filter that wants "finished".
 */
export type TicketStage = 'OPEN' | 'REVIEWING' | 'CLOSED';

/** The screens' word for it: is a person carrying this, or is software? */
export type TicketHandlingFilter = 'AUTO' | 'MANUAL';

export const STAGE_STATUSES: Readonly<Record<TicketStage, readonly TicketStatus[]>> = {
  OPEN: [TicketStatus.OPEN],
  REVIEWING: [TicketStatus.NEGOTIATING],
  CLOSED: [
    TicketStatus.RESOLVED_REFUND,
    TicketStatus.RESOLVED_RETURNED,
    TicketStatus.RESOLVED_WRITE_OFF_ACCEPTED,
    TicketStatus.REJECTED,
  ],
};

export interface OpenTicketInput {
  readonly ticketType: TicketType;
  readonly sellerId: string;
  readonly subject: string;
  readonly description?: string | null;
  /**
   * The description, written once the ticket number is known — so an
   * opening message WE write can name the ticket it opens. Wins over
   * `description` when given. Called inside the opening transaction and
   * must not do I/O.
   */
  readonly descriptionFor?: (ticketNumber: string) => string;
  readonly orderId?: string | null;
  readonly shipmentId?: string | null;
  readonly shipmentItemId?: string | null;
  readonly courierCode?: string | null;
  readonly rtoCondition?: RtoItemCondition | null;
  /**
   * RECEIPT_SHORTFALL: the goods receipt it is about. With the type it is
   * the open-idempotency key, exactly as `shipmentItemId` is for scrap.
   */
  readonly goodsReceiptId?: string | null;
  /** The courier's own category, chosen by the seller. */
  readonly issueCategoryExternalId?: string | null;
  readonly issueSubcategoryExternalId?: string | null;
  /** RS-7 — STORE_DISPUTE: the reseller store raising it, and who there. */
  readonly storeId?: string | null;
  readonly openedByStoreUserId?: string | null;
  /**
   * RS-7 (2026-09-19) — a STORE_DISPUTE's kind, and, on a
   * FIGURE_CORRECTION, the raiser's claim plus the money as both sides
   * saw it. Set ONLY by `openStoreDispute`, which checks the combination
   * (a claim without the kind, or the kind without a claim, is refused
   * there rather than written half-formed).
   */
  readonly disputeKind?: StoreDisputeKind | null;
  readonly disputeClaimAmountInr?: Prisma.Decimal | null;
  readonly disputeClaimPayer?: ResellerMoneyParty | null;
  readonly disputedFigures?: DisputedFiguresSnapshot;
}

interface OpenResult {
  readonly ticket: TicketView;
  readonly created: boolean;
  /** The "Ticket opened" event, when this call opened the ticket. */
  readonly openingEventId: string | null;
}

export interface ResolveTicketInput {
  readonly to: TicketStatus;
  readonly notes?: string | null;
  /** Required (and only permitted) when `to` is RESOLVED_REFUND. */
  readonly refundAmountInr?: string | null;
}

export interface TicketView {
  readonly id: string;
  /** `TK-2026-000003` — what a person reads out. The id stays for links. */
  readonly ticketNumber: string;
  /** Whose opening message `description` is — see TicketOpener. */
  readonly openedBy: TicketOpener;
  readonly ticketType: TicketType;
  readonly status: TicketStatus;
  readonly sellerId: string;
  readonly orderId: string | null;
  /**
   * What a person calls the order — `SD-2026-26-000004`.
   *
   * The id is a uuid, and a uuid on a screen is something nobody can
   * read, repeat down a phone, or match against the order list. The id
   * stays for links; this is what gets shown.
   */
  readonly orderNumber: string | null;
  readonly shipmentId: string | null;
  /** Likewise `SH-2026-09-000017` for the parcel. */
  readonly shipmentNumber: string | null;
  readonly shipmentItemId: string | null;
  readonly courierCode: string | null;
  /** RECEIPT_SHORTFALL: the goods receipt, its number and its consignment's. */
  readonly goodsReceiptId: string | null;
  readonly receiptNumber: string | null;
  readonly consignmentNumber: string | null;
  readonly issueCategoryExternalId: string | null;
  readonly issueSubcategoryExternalId: string | null;
  /**
   * The courier's own WORDS for what the seller picked — "Delivery
   * delay", "Not attempted". Resolved on read, never stored: the
   * taxonomy is re-fetched from the courier and its rows replaced, so a
   * label copied at create time would drift from what they call it
   * today. Recording their `externalId` rather than a FK is exactly
   * what makes the natural key survive that refetch.
   *
   * Null on a ticket raised before there was a taxonomy, and on one
   * whose category the courier has since retired — the id stays, so
   * nothing is lost; there is just no current word for it.
   */
  readonly issueCategoryLabel: string | null;
  readonly issueSubcategoryLabel: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly resolutionAmountInr: string | null;
  readonly resolutionWalletEntryId: string | null;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
  /**
   * RS-7 — the reseller store on a STORE_DISPUTE (null on every other
   * ticket), and its name as its customers see it (display name ?? name).
   */
  readonly storeId: string | null;
  readonly storeName: string | null;
  /** RS-7 — on a settled STORE_DISPUTE, who paid the other. */
  readonly disputePayer: ResellerMoneyParty | null;
  /** RS-7 (2026-09-19) — what KIND of dispute; null on every other type. */
  readonly disputeKind: StoreDisputeKind | null;
  /** A FIGURE_CORRECTION's claim: what the raiser says is owed, by whom. */
  readonly disputeClaimAmountInr: string | null;
  readonly disputeClaimPayer: ResellerMoneyParty | null;
  /** The order's money as both sides saw it when the correction was raised. */
  readonly disputedFigures: DisputedFiguresSnapshot | null;
}

/**
 * RS-7 (2026-09-19) — the ORDER'S MONEY AS IT STOOD when a figure
 * correction was raised, stamped onto the ticket.
 *
 * A REDUCED copy of `ResellerOrderMoneyReadService`'s view, not the whole
 * thing: the per-party plan and the fee split are the figures the two
 * sides are arguing about, while the individual wallet lines are readable
 * live and would only bloat the row. Stored so that "what were we looking
 * at" is answerable a month later, when the live ledger has moved.
 */
export interface DisputedFiguresSnapshot {
  readonly capturedAt: string;
  readonly orderNumber: string;
  readonly paymentMode: string;
  readonly codInr: string | null;
  readonly transferTotalInr: string;
  readonly retailTotalInr: string;
  readonly parties: ReadonlyArray<{
    readonly party: ResellerMoneyParty;
    readonly status: string;
    readonly grossInr: string;
    readonly transferInr: string;
    readonly taxShareInr: string;
    readonly codFeeShareInr: string;
    readonly instantFeeShareInr: string;
    readonly netInr: string;
  }>;
  readonly fees: ReadonlyArray<{
    readonly fee: string;
    readonly storeInr: string;
    readonly sellerInr: string;
    readonly totalInr: string;
  }>;
}

/**
 * RS-7 — what a reseller store is shown of its OWN dispute.
 *
 * Narrower than `TicketView` on purpose: no wallet entry ids (the seller
 * half is the seller's ledger), no courier or receipt fields (a dispute
 * has none), no seller-side taxonomy. Tickets carry no customer PII, and
 * this adds none.
 */
export interface StoreTicketView {
  readonly id: string;
  readonly ticketNumber: string;
  readonly openedBy: TicketOpener;
  readonly ticketType: TicketType;
  readonly status: TicketStatus;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly resolutionAmountInr: string | null;
  readonly disputePayer: ResellerMoneyParty | null;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
  /**
   * RS-7 (2026-09-19) — the store sees the correction's own fields. Both
   * sides are shown the SAME claim and the SAME snapshot: the whole point
   * of recording them is that the argument is about figures both parties
   * can see, and a store shown less than the seller cannot check ours.
   */
  readonly disputeKind: StoreDisputeKind | null;
  readonly disputeClaimAmountInr: string | null;
  readonly disputeClaimPayer: ResellerMoneyParty | null;
  readonly disputedFigures: DisputedFiguresSnapshot | null;
}

export interface SettleStoreDisputeInput {
  /** Decimal string, > 0, up to 2 dp. */
  readonly amountInr: string;
  readonly payer: ResellerMoneyParty;
  readonly notes?: string | null;
}

const MONEY_2DP = /^\d+(\.\d{1,2})?$/;

/**
 * R7 — sole writer of `tickets` + `ticket_events`.
 *
 * Every status change appends a TicketEvent in the SAME transaction as
 * the status write, so the negotiation history can never disagree with
 * the current status. `ticket_events` is append-only (no update/delete
 * path exists here by construction), matching order_events /
 * stock_movements / audit_logs.
 *
 * RESOLVED_REFUND is the only status that moves money: it writes a
 * SCRAP_REFUND wallet credit through `WalletService.applyEntry` (the
 * INV-1-style sole ledger writer) inside the same transaction and stores
 * the resulting entry id on the ticket, so a settlement can always be
 * traced to its ledger row and vice versa.
 */
@Injectable()
export class TicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly wallet: WalletService,
    private readonly stateMachine: TicketStateMachineService,
    // TKT-3: every event this service writes is handed over for telling
    // the other side. Fire-and-forget and post-commit — see the notifier.
    private readonly notifier: TicketNotifier,
    // RS-7 — the reseller-order money: the transfer-price cap on a
    // compensation, and the store ↔ seller settlement pair.
    private readonly resellerMoney: ResellerOrderMoneyService,
    // RS-7 (2026-09-19) — READ-ONLY: the figures both sides see, stamped
    // onto a figure-correction dispute so the settlement is argued from
    // what was on the table rather than from today's ledger.
    private readonly money: ResellerOrderMoneyReadService,
  ) {}

  /**
   * Opens a ticket. Idempotent for auto-raised SCRAP_DAMAGE: a second
   * call for the same `shipmentItemId` + type returns the existing
   * ticket instead of creating a duplicate (the operator may re-inspect
   * a line and correct their judgement). Accepts an optional caller
   * transaction so RTO inspection can create the ticket atomically with
   * the inspection write.
   */
  /**
   * Say something on a ticket without moving it.
   *
   * "We rang the customer, they will be in on Saturday" is the whole
   * point of a RECALL ticket and it is not a status change — the ticket
   * is still OPEN. `ticket_events.toStatus` is NOT NULL, so this writes
   * a SELF-LOOP at the current status rather than inventing a state to
   * carry a sentence. The table stays append-only and the timeline reads
   * in order, which is what the seller actually needs to see.
   *
   * The status is read INSIDE the write, guarded, so a note cannot
   * record a state the ticket had already left.
   */
  /**
   * The courier's ticket taxonomy, as a two-level tree.
   *
   * Served to the seller's raise-a-ticket form so they pick the courier's
   * own words rather than describing a problem into a blank box. An ops
   * queue full of untyped free text cannot be triaged, and a category
   * chosen by the person who has the facts beats one guessed later by
   * somebody reading their sentence.
   *
   * Categories that have no children are returned with an empty list
   * rather than omitted — several of Delhivery's genuinely go straight
   * to the description, and the form has to be able to tell "no
   * subcategory exists" from "not loaded yet".
   */
  async issueTaxonomy(courierCode = 'delhivery'): Promise<
    ReadonlyArray<{
      externalId: string;
      label: string;
      subcategories: ReadonlyArray<{ externalId: string; label: string }>;
    }>
  > {
    const rows = await this.prisma.client.courierIssueCategory.findMany({
      where: { courierCode },
      orderBy: { externalId: 'asc' },
      select: { externalId: true, label: true, parentExternalId: true },
    });
    const parents = rows.filter((r) => r.parentExternalId === null);
    return parents.map((p) => ({
      externalId: p.externalId,
      label: p.label,
      subcategories: rows
        .filter((r) => r.parentExternalId === p.externalId)
        .map((r) => ({ externalId: r.externalId, label: r.label })),
    }));
  }

  async addNote(
    ticketId: string,
    note: string,
    actor: TicketActor,
    /**
     * Scope + guard for the SELLER path.
     *
     * `sellerId` makes another company's ticket indistinguishable from
     * one that does not exist. `openOnly` refuses a closed one: a reply
     * onto a resolved ticket is a message nobody is coming back to
     * read, and letting it land silently is worse than saying no —
     * the seller thinks they have asked, and nobody has been asked.
     */
    scope?: { sellerId?: string; storeId?: string; openOnly?: boolean },
    /**
     * The caller's transaction — the RTO inspection says a corrected
     * finding in the same transaction as the correction, so the seller is
     * never shown a finding the ticket does not also carry.
     */
    tx?: Prisma.TransactionClient,
  ): Promise<{ ticketId: string; at: Date }> {
    const client = tx ?? this.prisma.client;
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      throw new BadRequestException({
        code: 'TICKET_NOTE_EMPTY',
        message: 'Write something the seller can act on.',
      });
    }
    const ticket = await client.ticket.findFirst({
      where: {
        id: ticketId,
        ...(scope?.sellerId === undefined ? {} : { sellerId: scope.sellerId }),
        // RS-7 — a store's reply: only on a dispute it raised.
        ...(scope?.storeId === undefined
          ? {}
          : { storeId: scope.storeId, ticketType: { in: [...STORE_READABLE_TICKET_TYPES] } }),
      },
      select: { id: true, status: true, resolvedAt: true },
    });
    if (ticket === null) {
      throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'No such ticket' });
    }
    if (scope?.openOnly === true && ticket.resolvedAt !== null) {
      throw new ConflictException({
        code: 'TICKET_CLOSED',
        message:
          'This one is closed, so a reply here would not reach anybody. Raise a new issue and we will pick it up.',
      });
    }
    const row = await client.ticketEvent.create({
      data: {
        ticketId,
        fromStatus: ticket.status,
        toStatus: ticket.status,
        note: trimmed,
        actorType: actor.type,
        actorId: actorIdOf(actor),
      },
      select: { id: true, createdAt: true },
    });
    // Handed over now even inside a caller's transaction: the notifier
    // reads the event back and sends nothing until it is committed.
    this.notifier.afterEvent(row.id);
    return { ticketId, at: row.createdAt };
  }

  /** The timeline, oldest first — what a seller is shown on their ticket. */
  async events(
    ticketId: string,
    sellerId?: string,
  ): Promise<
    ReadonlyArray<{
      id: string;
      note: string | null;
      toStatus: TicketStatus;
      actorType: ActorType;
      at: Date;
      relayedAt: Date | null;
    }>
  > {
    const ticket = await this.prisma.client.ticket.findFirst({
      where: { id: ticketId, ...(sellerId === undefined ? {} : { sellerId }) },
      select: { id: true },
    });
    if (ticket === null) {
      // Scoped, so another seller's ticket is indistinguishable from one
      // that does not exist.
      throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'No such ticket' });
    }
    const rows = await this.prisma.client.ticketEvent.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        note: true,
        toStatus: true,
        actorType: true,
        createdAt: true,
        // TKT-2. The seller is shown where their own message has got
        // to, so they read this for the same reason we do.
        relay: { select: { relayedAt: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      note: r.note,
      toStatus: r.toStatus,
      actorType: r.actorType,
      at: r.createdAt,
      relayedAt: r.relay?.relayedAt ?? null,
    }));
  }

  async open(
    input: OpenTicketInput,
    actor: TicketActor,
    tx?: Prisma.TransactionClient,
  ): Promise<TicketView> {
    return (await this.openOrFind(input, actor, tx)).ticket;
  }

  /** The auto-raised ticket for one shipment line, if there is one. */
  async findByShipmentItem(
    shipmentItemId: string,
    ticketType: TicketType,
    tx?: Prisma.TransactionClient,
  ): Promise<TicketView | null> {
    const row = await (tx ?? this.prisma.client).ticket.findUnique({
      where: { shipmentItemId_ticketType: { shipmentItemId, ticketType } },
      include: { events: OPENING_EVENT },
    });
    return row === null ? null : this.toView(row);
  }

  /**
   * `open`, saying whether it opened anything. The RTO inspection needs
   * to know: a re-inspection that finds the existing ticket may have a
   * corrected finding to say on it, and a fresh ticket already says it.
   *
   * The ticket NUMBER is allocated inside the same transaction as the
   * insert (the caller's, or one of our own), so a rolled-back open gives
   * its number back to nobody and two opens can never share one. The
   * idempotent path returns the existing ticket before anything is
   * allocated, so a retried inspection never burns a second number.
   */
  async openOrFind(
    input: OpenTicketInput,
    actor: TicketActor,
    tx?: Prisma.TransactionClient,
  ): Promise<{ ticket: TicketView; created: boolean }> {
    const run = (client: Prisma.TransactionClient): Promise<OpenResult> =>
      this.openIn(client, input, actor);
    const result = tx === undefined ? await this.prisma.client.$transaction(run) : await run(tx);
    // After our own transaction has committed; or, inside a caller's, as
    // soon as it is written — the notifier waits for it to be visible.
    if (result.openingEventId !== null) this.notifier.afterEvent(result.openingEventId);
    return { ticket: result.ticket, created: result.created };
  }

  private async openIn(
    client: Prisma.TransactionClient,
    input: OpenTicketInput,
    actor: TicketActor,
  ): Promise<OpenResult> {
    if (input.shipmentItemId) {
      const existing = await client.ticket.findUnique({
        where: {
          shipmentItemId_ticketType: {
            shipmentItemId: input.shipmentItemId,
            ticketType: input.ticketType,
          },
        },
        include: { events: OPENING_EVENT },
      });
      if (existing) return { ticket: this.toView(existing), created: false, openingEventId: null };
    }
    if (input.goodsReceiptId) {
      const existing = await client.ticket.findUnique({
        where: {
          goodsReceiptId_ticketType: {
            goodsReceiptId: input.goodsReceiptId,
            ticketType: input.ticketType,
          },
        },
        include: { events: OPENING_EVENT },
      });
      if (existing) return { ticket: this.toView(existing), created: false, openingEventId: null };
    }

    const ticketNumber = await allocateTicketNumber(client);
    const description =
      input.descriptionFor === undefined
        ? (input.description ?? null)
        : input.descriptionFor(ticketNumber);

    const created = await client.ticket.create({
      data: {
        ticketNumber,
        ticketType: input.ticketType,
        status: TicketStatus.OPEN,
        sellerId: input.sellerId,
        subject: input.subject,
        description,
        orderId: input.orderId ?? null,
        shipmentId: input.shipmentId ?? null,
        shipmentItemId: input.shipmentItemId ?? null,
        courierCode: input.courierCode ?? null,
        rtoCondition: input.rtoCondition ?? null,
        goodsReceiptId: input.goodsReceiptId ?? null,
        issueCategoryExternalId: input.issueCategoryExternalId ?? null,
        issueSubcategoryExternalId: input.issueSubcategoryExternalId ?? null,
        openedByStaffId: actor.staffId ?? null,
        openedBySellerUserId: actor.sellerUserId ?? null,
        storeId: input.storeId ?? null,
        openedByStoreUserId: input.openedByStoreUserId ?? null,
        // RS-7 (2026-09-19): the dispute's kind and, on a figure
        // correction, the raiser's claim and the figures both sides were
        // looking at. Every one is null on every other ticket type; the
        // callers that set them are the two store-dispute openers, which
        // validate the combination before reaching here.
        disputeKind: input.disputeKind ?? null,
        disputeClaimAmountInr: input.disputeClaimAmountInr ?? null,
        disputeClaimPayer: input.disputeClaimPayer ?? null,
        ...(input.disputedFigures === undefined
          ? {}
          : {
              // A plain readonly object with no index signature, which is
              // what Prisma's InputJsonValue wants; `unknown` is the only
              // way to say "this IS json" to a structural check that
              // cannot see it.
              disputedFigures: input.disputedFigures as unknown as Prisma.InputJsonValue,
            }),
      },
    });

    const opening = await client.ticketEvent.create({
      data: {
        ticketId: created.id,
        fromStatus: null,
        toStatus: TicketStatus.OPEN,
        note: 'Ticket opened',
        actorType: actor.type,
        actorId: actorIdOf(actor),
      },
      select: { id: true },
    });

    await this.audit.log(
      {
        actorType: actor.type,
        staffUserId: actor.staffId ?? null,
        sellerId: input.sellerId,
        action: 'ticket.opened',
        entityType: 'ticket',
        entityId: created.id,
        severity: 'MEDIUM',
        metadata: {
          ticketType: input.ticketType,
          ticketNumber,
          shipmentItemId: input.shipmentItemId ?? null,
          goodsReceiptId: input.goodsReceiptId ?? null,
          rtoCondition: input.rtoCondition ?? null,
          storeId: input.storeId ?? null,
        },
      },
      client,
    );

    // The opening event was just written with this actor, so the view can
    // say who opened it without reading it back.
    return {
      ticket: this.toView({ ...created, events: [{ actorType: actor.type }] }),
      created: true,
      openingEventId: opening.id,
    };
  }

  /**
   * Moves a ticket along the matrix. RESOLVED_REFUND additionally
   * credits the seller (SCRAP_REFUND) in the same transaction.
   */
  async transition(
    ticketId: string,
    input: ResolveTicketInput,
    actor: TicketActor,
  ): Promise<TicketView> {
    const existing = await this.prisma.client.ticket.findUnique({ where: { id: ticketId } });
    if (!existing) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }
    if (
      existing.ticketType === TicketType.STORE_DISPUTE &&
      input.to === TicketStatus.RESOLVED_REFUND
    ) {
      // RS-7 — a store ↔ seller dispute is settled BETWEEN them. A
      // SCRAP_REFUND would pay the seller out of OUR money for a
      // disagreement we only referee.
      throw new ConflictException({
        code: 'STORE_DISPUTE_USE_SETTLEMENT',
        message:
          'A store dispute is not refunded by Skydrop. Settle it between the store and the seller instead — the money moves between their two wallets.',
      });
    }
    if (!this.stateMachine.canTransition(existing.status, input.to)) {
      throw new ConflictException({
        code: 'INVALID_TICKET_TRANSITION',
        message:
          `Cannot move ticket from ${existing.status} to ${input.to}. ` +
          `Allowed: ${this.stateMachine.allowedFrom(existing.status).join(', ') || '(terminal)'}`,
      });
    }

    const isRefund = input.to === TicketStatus.RESOLVED_REFUND;
    let refundAmount: Prisma.Decimal | null = null;
    if (isRefund) {
      if (!input.refundAmountInr) {
        throw new BadRequestException({
          code: 'REFUND_AMOUNT_REQUIRED',
          message: 'refundAmountInr is required when resolving as RESOLVED_REFUND',
        });
      }
      refundAmount = new Prisma.Decimal(input.refundAmountInr);
      if (refundAmount.lte(0)) {
        throw new BadRequestException({
          code: 'REFUND_AMOUNT_INVALID',
          message: 'refundAmountInr must be > 0',
        });
      }
      // RS-7 — goods lost or damaged in our hands on a RESELLER order are
      // the seller's at the TRANSFER price, never the retail the store
      // charged. Null for a channel order: no cap.
      const cap = await this.resellerMoney.transferCompensationCap(this.prisma.client, {
        orderId: existing.orderId,
        shipmentItemId: existing.shipmentItemId,
      });
      if (cap !== null && refundAmount.gt(cap)) {
        throw new BadRequestException({
          code: 'REFUND_ABOVE_TRANSFER_PRICE',
          message:
            `This is a reseller store's order: the seller is compensated at the transfer price, ` +
            `at most ₹${cap.toFixed(2)} here — not the retail price the store charged.`,
        });
      }
    } else if (input.refundAmountInr) {
      // Guard against a caller passing an amount with the wrong target
      // status and assuming money moved.
      throw new BadRequestException({
        code: 'REFUND_AMOUNT_NOT_APPLICABLE',
        message: `refundAmountInr is only valid with RESOLVED_REFUND, not ${input.to}`,
      });
    }

    const terminal = this.stateMachine.isTerminal(input.to);

    const { row: updated, eventId: transitionEventId } = await this.prisma.client.$transaction(
      async (tx) => {
        // CLAIM THE TRANSITION FIRST, guarded on the status we validated
        // against above. Without this the check is a read outside the
        // transaction and the write is unconditional, so two concurrent
        // RESOLVED_REFUND requests — an impatient double-click on the admin
        // refund button is enough — both pass the state-machine check and
        // both credit the wallet. The seller is paid twice and the ticket
        // records only ONE resolutionWalletEntryId, so the duplicate is
        // invisible in the ticket itself.
        //
        // The guarded UPDATE takes the row lock: the second transaction
        // blocks, then re-evaluates its WHERE against the committed status,
        // matches nothing, and rolls back before any money moves. Claiming
        // BEFORE the credit is what makes that ordering work — a rollback
        // then takes the credit with it.
        const claimed = await tx.ticket.updateMany({
          where: { id: ticketId, status: existing.status },
          data: {
            status: input.to,
            resolutionNotes: input.notes ?? existing.resolutionNotes,
            ...(terminal
              ? { resolvedAt: new Date(), resolvedByStaffId: actor.staffId ?? null }
              : {}),
          },
        });
        if (claimed.count === 0) {
          throw new ConflictException({
            code: 'TICKET_ALREADY_MOVED',
            message:
              `Ticket ${ticketId} is no longer in ${existing.status} — someone else resolved it first. ` +
              'Reload to see where it landed; no money moved for this request.',
          });
        }

        let walletEntryId: string | null = null;
        if (refundAmount) {
          const entry = await this.wallet.applyEntry(tx, {
            sellerId: existing.sellerId,
            currency: Currency.INR,
            direction: WalletEntryDirection.SCRAP_REFUND,
            amount: refundAmount,
            linkedOrderId: existing.orderId,
            note: `Ticket ${ticketId} settled`,
            actorType: actor.type,
            actorId: actor.staffId ?? null,
          });
          walletEntryId = entry.id;
        }

        // Second write carries only what the wallet entry produced; the
        // status transition itself was already claimed above.
        const row = await tx.ticket.update({
          where: { id: ticketId },
          data: {
            ...(refundAmount ? { resolutionAmountInr: refundAmount } : {}),
            ...(walletEntryId ? { resolutionWalletEntryId: walletEntryId } : {}),
          },
        });

        const event = await tx.ticketEvent.create({
          data: {
            ticketId,
            fromStatus: existing.status,
            toStatus: input.to,
            note: input.notes ?? null,
            actorType: actor.type,
            actorId: actorIdOf(actor),
          },
          select: { id: true },
        });

        return { row, eventId: event.id };
      },
    );

    // Post-commit (TKT-3): a resolution — and any refund on it — is told
    // to the seller only once it is true.
    this.notifier.afterEvent(transitionEventId);

    if (refundAmount) {
      // Post-commit, best-effort (mirrors the accrual listener).
      await this.wallet.recomputeCacheAfterCommit(
        existing.sellerId,
        Currency.INR,
        'post-ticket-refund',
      );
    }

    await this.audit.log({
      actorType: actor.type,
      staffUserId: actor.staffId ?? null,
      sellerId: existing.sellerId,
      action: 'ticket.transitioned',
      entityType: 'ticket',
      entityId: ticketId,
      severity: 'MEDIUM',
      changes: { from: existing.status, to: input.to },
      metadata: {
        refundAmountInr: refundAmount?.toFixed(2) ?? null,
        resolutionWalletEntryId: updated.resolutionWalletEntryId,
      },
    });

    return this.toView(updated);
  }

  /**
   * externalId → the courier's own word for it, for a whole page in ONE
   * query.
   *
   * Batched rather than resolved per row: the id lives on the ticket
   * and the word lives in a table the courier owns, and a join per
   * ticket is how a fifty-row list becomes fifty-one queries.
   *
   * Looked up by `externalId` alone. The natural key is
   * `(courierCode, externalId)`, but the taxonomy the seller picked
   * from is NOT the same thing as the courier carrying the parcel — a
   * ticket may name Delhivery's category and have no courier at all
   * yet, which is the ordinary case for an issue raised before
   * dispatch. Today exactly one courier publishes a taxonomy, so there
   * is nothing to be ambiguous about; the day a second one does, the
   * ticket has to record WHICH taxonomy it chose from, and that is a
   * column, not a cleverer query here.
   */
  private async issueLabels(
    rows: readonly {
      issueCategoryExternalId: string | null;
      issueSubcategoryExternalId: string | null;
    }[],
  ): Promise<ReadonlyMap<string, string>> {
    const ids = new Set<string>();
    for (const r of rows) {
      // `typeof id === 'string'`, not `!== null`. The declared type says
      // one or the other, but this is fed by whatever a caller selected,
      // and a row that simply did not ask for the column arrives as
      // undefined — which a null check waves through and then puts
      // straight into the `in` list.
      for (const id of [r.issueCategoryExternalId, r.issueSubcategoryExternalId]) {
        if (typeof id === 'string' && id !== '') ids.add(id);
      }
    }
    if (ids.size === 0) return new Map();
    const found = await this.prisma.client.courierIssueCategory.findMany({
      where: { externalId: { in: [...ids] } },
      select: { externalId: true, label: true },
    });
    return new Map(found.map((f) => [f.externalId, f.label]));
  }

  async listForSeller(
    sellerId: string,
    status?: TicketStatus,
    orderId?: string,
    stage?: TicketStage,
    /** Ticket number, subject, order number, parcel number or waybill. */
    search?: string,
  ): Promise<readonly TicketView[]> {
    const rows = await this.prisma.client.ticket.findMany({
      // An order may carry SEVERAL tickets — a re-attempt, then a
      // recall, then "it arrived broken" — so this filters rather than
      // finding one. They are different conversations about the same
      // parcel and collapsing them would lose which answer belonged to
      // which question.
      where: {
        sellerId,
        // Same rule as the admin list: an explicit status wins, and
        // `stage` expands to the statuses behind it (STAGE_STATUSES).
        ...(status !== undefined
          ? { status }
          : stage === undefined
            ? {}
            : { status: { in: [...STAGE_STATUSES[stage]] } }),
        ...(orderId === undefined ? {} : { orderId }),
        ...ticketSearchWhere(search),
      },
      orderBy: { createdAt: 'desc' },
      include: TICKET_NAMES,
    });
    const labels = await this.issueLabels(rows);
    return rows.map((r) => this.toView(r, labels));
  }

  /** Seller-scoped detail read — never leaks another seller's ticket. */
  /** Unscoped read for staff — an operator sees every ticket. */
  async getById(ticketId: string): Promise<TicketView> {
    const row = await this.prisma.client.ticket.findUnique({
      where: { id: ticketId },
      include: TICKET_NAMES,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }
    return this.toView(row, await this.issueLabels([row]));
  }

  async getForSeller(sellerId: string, ticketId: string): Promise<TicketView> {
    const row = await this.prisma.client.ticket.findFirst({
      where: { id: ticketId, sellerId },
      include: TICKET_NAMES,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }
    return this.toView(row, await this.issueLabels([row]));
  }

  async listForAdmin(filters: {
    sellerId?: string;
    status?: TicketStatus;
    /** The three stages the ticket screens speak in. See STAGE_STATUSES. */
    stage?: TicketStage;
    ticketType?: TicketType;
    /** AUTO = software is carrying it; MANUAL = a person must. */
    handling?: TicketHandlingFilter;
    /** Ticket number, subject, order number, parcel number or waybill. */
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: readonly TicketView[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));
    const where = {
      ...(filters.sellerId === undefined ? {} : { sellerId: filters.sellerId }),
      // `stage` and `status` are both accepted; the narrower one wins,
      // so an explicit status still works for anything that wants a
      // single outcome (a report, a saved link).
      ...(filters.status !== undefined
        ? { status: filters.status }
        : filters.stage === undefined
          ? {}
          : { status: { in: [...STAGE_STATUSES[filters.stage]] } }),
      ...(filters.ticketType === undefined ? {} : { ticketType: filters.ticketType }),
      // A queue of work is only legible if you can ask "what must a
      // person pick up". NONE is deliberately not offered as a filter:
      // a scrap ticket has no courier to carry it to, so it belongs in
      // neither answer.
      ...(filters.handling === undefined ? {} : { handling: filters.handling }),
      ...ticketSearchWhere(filters.search),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: TICKET_NAMES,
      }),
      this.prisma.client.ticket.count({ where }),
    ]);
    const labels = await this.issueLabels(rows);
    return { items: rows.map((r) => this.toView(r, labels)), total, page, pageSize };
  }

  async listEvents(ticketId: string): Promise<
    readonly {
      id: string;
      fromStatus: TicketStatus | null;
      toStatus: TicketStatus;
      note: string | null;
      actorType: ActorType;
      createdAt: Date;
      relayedAt: Date | null;
    }[]
  > {
    const rows = await this.prisma.client.ticketEvent.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fromStatus: true,
        toStatus: true,
        note: true,
        actorType: true,
        createdAt: true,
        relay: { select: { relayedAt: true } },
      },
    });
    return rows.map(({ relay, ...r }) => ({ ...r, relayedAt: relay?.relayedAt ?? null }));
  }

  /**
   * TKT-2 — record that a seller's message has been passed to the
   * courier.
   *
   * Only a SELLER's words can be relayed. Ours already reached the
   * seller the moment they were written, and the courier's came FROM
   * the courier; marking either would be stating something that never
   * needed doing.
   *
   * IDEMPOTENT rather than a 409 on the second call: two operators
   * working the same queue is the ordinary case, and an error there
   * teaches people to ignore errors (the CUR-4 repeat-scan argument).
   * The UNIQUE on `ticket_event_id` is the guard — never a read-then-
   * write, which under READ COMMITTED lets both callers through and
   * records the relay twice.
   */
  async markRelayed(
    ticketId: string,
    ticketEventId: string,
    staffId: string,
  ): Promise<{ ticketEventId: string; relayedAt: Date; alreadyRelayed: boolean }> {
    const event = await this.prisma.client.ticketEvent.findFirst({
      where: { id: ticketEventId, ticketId },
      select: { id: true, actorType: true, relay: { select: { relayedAt: true } } },
    });
    if (event === null) {
      throw new NotFoundException({
        code: 'TICKET_EVENT_NOT_FOUND',
        message: 'No such message on this ticket',
      });
    }
    if (event.actorType !== ActorType.SELLER) {
      throw new BadRequestException({
        code: 'NOT_A_SELLER_MESSAGE',
        message: 'Only what the seller wrote gets passed to the courier.',
      });
    }
    if (event.relay !== null) {
      return { ticketEventId, relayedAt: event.relay.relayedAt, alreadyRelayed: true };
    }
    try {
      const row = await this.prisma.client.ticketMessageRelay.create({
        data: { ticketEventId, relayedByStaffId: staffId },
        select: { relayedAt: true },
      });
      await this.audit.log({
        action: 'ticket.message_relayed',
        severity: 'LOW',
        actorType: ActorType.STAFF,
        staffUserId: staffId,
        entityType: 'ticket',
        entityId: ticketId,
        metadata: { ticketEventId },
      });
      return { ticketEventId, relayedAt: row.relayedAt, alreadyRelayed: false };
    } catch (err) {
      // Somebody else got there between the read and the insert. That
      // is the same outcome, not a failure.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await this.prisma.client.ticketMessageRelay.findUnique({
          where: { ticketEventId },
          select: { relayedAt: true },
        });
        if (existing !== null) {
          return { ticketEventId, relayedAt: existing.relayedAt, alreadyRelayed: true };
        }
      }
      throw err;
    }
  }

  // ── RS-7 — reseller store ↔ seller disputes ─────────────────────────

  /**
   * A reseller store raises a dispute with its seller about ONE OF ITS
   * OWN orders. The order must be the store's (and a reseller order):
   * anything else — another store's, the seller's own channel order, an
   * order that does not exist — is the same 404, so a store cannot probe
   * for orders it does not own.
   *
   * The ticket is the SELLER's (`sellerId` = the order's seller) and the
   * store's (`storeId`), refereed by us. No one-per-order unique: a second
   * disagreement about the same order is a second conversation.
   */
  async openForStore(input: {
    storeId: string;
    storeUserId: string;
    orderId: string;
    subject: string;
    description?: string | null;
    disputeKind?: StoreDisputeKind;
    claimAmountInr?: string;
    claimPayer?: ResellerMoneyParty;
  }): Promise<StoreTicketView> {
    const { storeId, storeUserId, ...rest } = input;
    const opened = await this.openStoreDispute({
      ...rest,
      raiser: { kind: 'STORE', storeId, storeUserId },
    });
    return this.getForStore(storeId, opened.id);
  }

  /**
   * RS-7 (2026-09-19) — SELLER STAFF raise a dispute with one of their
   * own reseller stores.
   *
   * The store could already argue with the seller; the seller had no way
   * back, which made "we disagree about this order" a one-directional
   * right. Both sides see the same figures on their own screens, so both
   * can be wrong about them and both need somewhere to say so.
   *
   * The STORE is read off the ORDER, never taken from the request: a
   * seller may only dispute an order that is already one of their
   * stores', so there is no way to file a complaint against a store that
   * had nothing to do with it. Everything else — the settlement, the
   * conversation, the notifications — is the existing dispute machinery
   * unchanged.
   */
  async openForSellerAgainstStore(input: {
    sellerId: string;
    sellerUserId: string;
    orderId: string;
    subject: string;
    description?: string | null;
    disputeKind?: StoreDisputeKind;
    claimAmountInr?: string;
    claimPayer?: ResellerMoneyParty;
  }): Promise<TicketView> {
    const { sellerId, sellerUserId, ...rest } = input;
    const opened = await this.openStoreDispute({
      ...rest,
      raiser: { kind: 'SELLER', sellerId, sellerUserId },
    });
    return this.getForSeller(sellerId, opened.id);
  }

  /**
   * The ONE place a store ↔ seller dispute is opened, whichever side
   * raises it.
   *
   * ── THE CORRECTION CASE ──────────────────────────────────────────────
   * `FIGURE_CORRECTION` is the answer to "the money on this order is
   * wrong and it has already been paid" (RS-6 phase 3c's
   * `RESELLER_CREDIT_ALREADY_PAID`). It is a KIND of dispute rather than
   * a new ticket type or a second money path, and that is the whole
   * point: the once-per-order wallet unique
   * (`seller_wallet_entries_once_per_order_uq`) means a credit cannot be
   * reversed and rewritten — it is the guard against paying an order
   * twice and must not be weakened — so the correction is settled
   * BETWEEN the two wallets through `settleStoreDispute`, which already
   * exists, already claims the ticket before any money moves, and is
   * already the only place a store dispute pays anybody.
   *
   * A correction must SAY WHAT IT IS ASKING FOR (`claimAmountInr` +
   * `claimPayer`). That is a claim, never money: staff settle with their
   * own figures, and this is what stops the settlement form being typed
   * from nothing. And it carries a SNAPSHOT of the order's money as both
   * sides could see it at the moment it was raised — taken from the same
   * read service their own screens use, so nobody can be shown a
   * different set of numbers from the ones being argued over, and so the
   * argument is still legible after the live ledger has moved on.
   */
  private async openStoreDispute(input: {
    raiser:
      | { kind: 'STORE'; storeId: string; storeUserId: string }
      | { kind: 'SELLER'; sellerId: string; sellerUserId: string };
    orderId: string;
    subject: string;
    description?: string | null;
    disputeKind?: StoreDisputeKind;
    claimAmountInr?: string;
    claimPayer?: ResellerMoneyParty;
  }): Promise<TicketView> {
    const raiser = input.raiser;
    const order = await this.prisma.client.order.findFirst({
      where: {
        id: input.orderId,
        storeKind: SellerStoreKind.RESELLER,
        deletedAt: null,
        ...(raiser.kind === 'STORE' ? { storeId: raiser.storeId } : { sellerId: raiser.sellerId }),
      },
      select: { id: true, sellerId: true, storeId: true },
    });
    // Scoped in the WHERE clause, so another store's order — or another
    // seller's — is indistinguishable from one that does not exist.
    if (order === null || order.storeId === null) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message:
          raiser.kind === 'STORE'
            ? 'No such order in your store.'
            : 'No such reseller-store order of yours.',
      });
    }

    const kind = input.disputeKind ?? StoreDisputeKind.GENERAL;
    const wantsClaim = input.claimAmountInr !== undefined || input.claimPayer !== undefined;
    if (kind !== StoreDisputeKind.FIGURE_CORRECTION && wantsClaim) {
      throw new BadRequestException({
        code: 'DISPUTE_CLAIM_NOT_FOR_KIND',
        message:
          'A figure to correct belongs on a “correct the figures” dispute. Raise it as one, or leave the amount off.',
      });
    }
    let claimAmount: Prisma.Decimal | null = null;
    let figures: DisputedFiguresSnapshot | undefined;
    if (kind === StoreDisputeKind.FIGURE_CORRECTION) {
      if (input.claimAmountInr === undefined || input.claimPayer === undefined) {
        throw new BadRequestException({
          code: 'DISPUTE_CLAIM_REQUIRED',
          message:
            'Say what you think is owed and who owes it. “The figures are wrong” with no figure in it is not something anybody can settle.',
        });
      }
      if (
        !MONEY_2DP.test(input.claimAmountInr) ||
        new Prisma.Decimal(input.claimAmountInr).lte(0)
      ) {
        throw new BadRequestException({
          code: 'DISPUTE_CLAIM_AMOUNT_INVALID',
          message: 'The amount must be more than ₹0, with at most two decimal places.',
        });
      }
      claimAmount = new Prisma.Decimal(input.claimAmountInr);
      figures = await this.captureDisputedFigures(order.id);
    }

    return this.open(
      {
        ticketType: TicketType.STORE_DISPUTE,
        sellerId: order.sellerId,
        storeId: order.storeId,
        ...(raiser.kind === 'STORE' ? { openedByStoreUserId: raiser.storeUserId } : {}),
        subject: input.subject.trim(),
        description: input.description?.trim() || null,
        orderId: order.id,
        disputeKind: kind,
        disputeClaimAmountInr: claimAmount,
        disputeClaimPayer: input.claimPayer ?? null,
        ...(figures === undefined ? {} : { disputedFigures: figures }),
      },
      raiser.kind === 'STORE'
        ? { type: ActorType.STORE, storeUserId: raiser.storeUserId }
        : { type: ActorType.SELLER, sellerUserId: raiser.sellerUserId },
    );
  }

  /**
   * The order's money as both parties can see it, reduced to what a
   * settlement is argued from.
   *
   * Read through `ResellerOrderMoneyReadService` — the same computation
   * behind the store's, the seller's and staff's own money panels —
   * rather than re-derived here, so the snapshot cannot disagree with
   * what either side was looking at when they raised the dispute. Only
   * the per-party plan and the fee split are kept: the individual wallet
   * lines are readable live and would bloat every ticket row.
   */
  private async captureDisputedFigures(orderId: string): Promise<DisputedFiguresSnapshot> {
    const view = await this.money.forOrder(orderId, { audience: 'STAFF' });
    return {
      capturedAt: new Date().toISOString(),
      orderNumber: view.orderNumber,
      paymentMode: view.paymentMode,
      codInr: view.codInr,
      transferTotalInr: view.transferTotalInr,
      retailTotalInr: view.retailTotalInr,
      parties: view.parties.map((p) => ({
        party: p.party,
        status: p.status,
        grossInr: p.grossInr,
        transferInr: p.transferInr,
        taxShareInr: p.taxShareInr,
        codFeeShareInr: p.codFeeShareInr,
        instantFeeShareInr: p.instantFeeShareInr,
        netInr: p.netInr,
      })),
      fees: view.fees.map((f) => ({
        fee: f.fee,
        storeInr: f.storeInr,
        sellerInr: f.sellerInr,
        totalInr: f.totalInr,
      })),
    };
  }

  /**
   * 2026-09-16 — a store raising something with SKYDROP about one of its
   * orders: damaged in our hands, lost, or sitting in our warehouse.
   *
   * The same store-scoped order check as a dispute, and the same queue
   * ops already works — but a different TYPE, because who is being asked
   * differs. The seller is not party to it (`planTicketNotification`
   * sends them nothing) and it can never be settled through the
   * store-dispute money path, which refuses anything not a dispute.
   *
   * `sellerId` is still the order's seller: the column is the ticket's
   * home in the ops queue and every ticket has one. It is not a claim
   * that the seller is involved.
   */
  async openStoreIssue(input: {
    storeId: string;
    storeUserId: string;
    orderId: string;
    subject: string;
    description?: string | null;
  }): Promise<StoreTicketView> {
    const order = await this.prisma.client.order.findFirst({
      where: {
        id: input.orderId,
        storeId: input.storeId,
        storeKind: SellerStoreKind.RESELLER,
        deletedAt: null,
      },
      select: { id: true, sellerId: true },
    });
    if (order === null) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'No such order in your store.',
      });
    }
    const opened = await this.open(
      {
        ticketType: TicketType.STORE_ISSUE,
        sellerId: order.sellerId,
        storeId: input.storeId,
        openedByStoreUserId: input.storeUserId,
        subject: input.subject.trim(),
        description: input.description?.trim() || null,
        orderId: order.id,
      },
      { type: ActorType.STORE, storeUserId: input.storeUserId },
    );
    return this.getForStore(input.storeId, opened.id);
  }

  /** The store's own disputes, newest first. Scoped by the TOKEN's store. */
  async listForStore(
    storeId: string,
    filters: { status?: TicketStatus; stage?: TicketStage; page?: number; pageSize?: number },
  ): Promise<{ items: StoreTicketView[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const where: Prisma.TicketWhereInput = {
      storeId,
      ticketType: { in: [...STORE_READABLE_TICKET_TYPES] },
      ...(filters.status !== undefined
        ? { status: filters.status }
        : filters.stage === undefined
          ? {}
          : { status: { in: [...STAGE_STATUSES[filters.stage]] } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: TICKET_NAMES,
      }),
      this.prisma.client.ticket.count({ where }),
    ]);
    return { items: rows.map((r) => this.toStoreView(r)), total, page, pageSize };
  }

  /** One of the store's own disputes — another store's is a 404. */
  async getForStore(storeId: string, ticketId: string): Promise<StoreTicketView> {
    const row = await this.prisma.client.ticket.findFirst({
      where: { id: ticketId, storeId, ticketType: { in: [...STORE_READABLE_TICKET_TYPES] } },
      include: TICKET_NAMES,
    });
    if (row === null) {
      throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'No such ticket' });
    }
    return this.toStoreView(row);
  }

  /** The dispute's timeline, oldest first, for the store that raised it. */
  async eventsForStore(
    storeId: string,
    ticketId: string,
  ): Promise<
    ReadonlyArray<{
      id: string;
      note: string | null;
      toStatus: TicketStatus;
      actorType: ActorType;
      at: Date;
    }>
  > {
    const ticket = await this.prisma.client.ticket.findFirst({
      where: { id: ticketId, storeId, ticketType: { in: [...STORE_READABLE_TICKET_TYPES] } },
      select: { id: true },
    });
    if (ticket === null) {
      throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'No such ticket' });
    }
    const rows = await this.prisma.client.ticketEvent.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, note: true, toStatus: true, actorType: true, createdAt: true },
    });
    return rows.map((r) => ({
      id: r.id,
      note: r.note,
      toStatus: r.toStatus,
      actorType: r.actorType,
      at: r.createdAt,
    }));
  }

  /** A store replies on its own dispute while it is still open. */
  addNoteForStore(
    storeId: string,
    storeUserId: string,
    ticketId: string,
    note: string,
  ): Promise<{ ticketId: string; at: Date }> {
    return this.addNote(
      ticketId,
      note,
      { type: ActorType.STORE, storeUserId },
      { storeId, openOnly: true },
    );
  }

  /**
   * RS-7 — staff settle a store dispute by moving money BETWEEN the store
   * and the seller, as a pair in one transaction, no bank entry
   * (`ResellerOrderMoneyService.settleStoreDispute`, under the seller's
   * WALLET lock). Never our money: the ordinary RESOLVED_REFUND is
   * refused on this type (`transition`).
   *
   * The status move is CLAIMED first with the guarded `updateMany`, so a
   * second concurrent settlement matches nothing and rolls back before
   * any money moves — the TKT-1 double-refund lesson.
   */
  async settleStoreDispute(
    ticketId: string,
    input: SettleStoreDisputeInput,
    staffId: string,
  ): Promise<TicketView> {
    const existing = await this.prisma.client.ticket.findUnique({ where: { id: ticketId } });
    if (existing === null) {
      throw new NotFoundException({
        code: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticketId} not found`,
      });
    }
    if (existing.ticketType !== TicketType.STORE_DISPUTE || existing.storeId === null) {
      throw new ConflictException({
        code: 'TICKET_NOT_A_STORE_DISPUTE',
        message:
          'Only a dispute a reseller store raised with its seller is settled between them. Resolve this ticket the ordinary way.',
      });
    }
    const storeId = existing.storeId;
    if (!MONEY_2DP.test(input.amountInr) || new Prisma.Decimal(input.amountInr).lte(0)) {
      throw new BadRequestException({
        code: 'SETTLEMENT_AMOUNT_INVALID',
        message: 'The amount must be more than ₹0, with at most two decimal places.',
      });
    }
    const amount = new Prisma.Decimal(input.amountInr);
    const to = TicketStatus.RESOLVED_REFUND;
    if (!this.stateMachine.canTransition(existing.status, to)) {
      throw new ConflictException({
        code: 'INVALID_TICKET_TRANSITION',
        message: `Cannot settle a ticket that is already ${existing.status}.`,
      });
    }
    const notes = input.notes?.trim() ?? '';

    const { row, eventId, sellerEntryId, storeEntryId } = await this.prisma.client.$transaction(
      async (tx) => {
        const claimed = await tx.ticket.updateMany({
          where: { id: ticketId, status: existing.status },
          data: {
            status: to,
            resolutionNotes: notes === '' ? existing.resolutionNotes : notes,
            resolvedAt: new Date(),
            resolvedByStaffId: staffId,
          },
        });
        if (claimed.count === 0) {
          throw new ConflictException({
            code: 'TICKET_ALREADY_MOVED',
            message:
              `Ticket ${existing.ticketNumber} is no longer ${existing.status} — someone else settled or closed it first. ` +
              'Reload to see where it landed; no money moved for this request.',
          });
        }

        const money = await this.resellerMoney.settleStoreDispute(tx, {
          storeId,
          sellerId: existing.sellerId,
          orderId: existing.orderId,
          payer: input.payer,
          amount,
          ticketNumber: existing.ticketNumber,
          staffId,
        });

        const updated = await tx.ticket.update({
          where: { id: ticketId },
          data: {
            resolutionAmountInr: amount,
            resolutionWalletEntryId: money.sellerEntryId,
            resolutionStoreEntryId: money.storeEntryId,
            disputePayer: input.payer,
          },
          include: TICKET_NAMES,
        });

        const event = await tx.ticketEvent.create({
          data: {
            ticketId,
            fromStatus: existing.status,
            toStatus: to,
            note: notes === '' ? null : notes,
            actorType: ActorType.STAFF,
            actorId: staffId,
          },
          select: { id: true },
        });

        // In the transaction: the money and the record of it commit together.
        await this.audit.log(
          {
            actorType: ActorType.STAFF,
            staffUserId: staffId,
            sellerId: existing.sellerId,
            action: 'ticket.store_dispute_settled',
            entityType: 'ticket',
            entityId: ticketId,
            severity: 'HIGH',
            changes: { from: existing.status, to },
            metadata: {
              ticketNumber: existing.ticketNumber,
              storeId,
              orderId: existing.orderId,
              amountInr: amount.toFixed(2),
              payer: input.payer,
              sellerEntryId: money.sellerEntryId,
              storeEntryId: money.storeEntryId,
            },
          },
          tx,
        );

        return {
          row: updated,
          eventId: event.id,
          sellerEntryId: money.sellerEntryId,
          storeEntryId: money.storeEntryId,
        };
      },
    );

    this.notifier.afterEvent(eventId);
    await this.wallet.recomputeCacheAfterCommit(
      existing.sellerId,
      Currency.INR,
      'post-store-dispute-settlement',
    );
    void sellerEntryId;
    void storeEntryId;
    return this.toView(row);
  }

  private toStoreView(row: Parameters<TicketService['toView']>[0]): StoreTicketView {
    const v = this.toView(row);
    return {
      id: v.id,
      ticketNumber: v.ticketNumber,
      openedBy: v.openedBy,
      ticketType: v.ticketType,
      status: v.status,
      orderId: v.orderId,
      orderNumber: v.orderNumber,
      subject: v.subject,
      description: v.description,
      resolutionAmountInr: v.resolutionAmountInr,
      disputePayer: v.disputePayer,
      resolutionNotes: v.resolutionNotes,
      resolvedAt: v.resolvedAt,
      createdAt: v.createdAt,
      disputeKind: v.disputeKind,
      disputeClaimAmountInr: v.disputeClaimAmountInr,
      disputeClaimPayer: v.disputeClaimPayer,
      disputedFigures: v.disputedFigures,
    };
  }

  private toView(
    row: {
      id: string;
      ticketNumber: string;
      openedByStaffId: string | null;
      openedBySellerUserId: string | null;
      openedByStoreUserId?: string | null;
      /** The opening event (OPENING_EVENT), when the read carried it. */
      events?: readonly { actorType: ActorType }[];
      ticketType: TicketType;
      status: TicketStatus;
      sellerId: string;
      orderId: string | null;
      shipmentId: string | null;
      shipmentItemId: string | null;
      courierCode: string | null;
      subject: string;
      description: string | null;
      resolutionAmountInr: Prisma.Decimal | null;
      resolutionWalletEntryId: string | null;
      resolutionNotes: string | null;
      resolvedAt: Date | null;
      createdAt: Date;
      issueCategoryExternalId: string | null;
      issueSubcategoryExternalId: string | null;
      handling: TicketHandling;
      order?: { orderNumber: string } | null;
      shipment?: { shipmentNumber: string } | null;
      goodsReceiptId?: string | null;
      goodsReceipt?: {
        receiptNumber: string;
        consignment: { consignmentNumber: string } | null;
      } | null;
      storeId?: string | null;
      store?: { name: string; displayName: string | null } | null;
      disputePayer?: ResellerMoneyParty | null;
      disputeKind?: StoreDisputeKind | null;
      disputeClaimAmountInr?: Prisma.Decimal | null;
      disputeClaimPayer?: ResellerMoneyParty | null;
      disputedFigures?: Prisma.JsonValue | null;
    },
    /**
     * externalId → the courier's word for it. Absent on the WRITE paths
     * (`open` / `transition`), which is deliberate: both are followed by
     * a refetch of the read path, and `open` can be handed a transaction
     * from the RTO inspection — a taxonomy lookup does not belong inside
     * somebody else's stock transaction.
     */
    labels?: ReadonlyMap<string, string>,
  ): TicketView {
    return {
      id: row.id,
      ticketNumber: row.ticketNumber,
      openedBy: openedByOf(row),
      issueCategoryExternalId: row.issueCategoryExternalId,
      issueSubcategoryExternalId: row.issueSubcategoryExternalId,
      issueCategoryLabel:
        row.issueCategoryExternalId === null
          ? null
          : (labels?.get(row.issueCategoryExternalId) ?? null),
      issueSubcategoryLabel:
        row.issueSubcategoryExternalId === null
          ? null
          : (labels?.get(row.issueSubcategoryExternalId) ?? null),
      ticketType: row.ticketType,
      status: row.status,
      sellerId: row.sellerId,
      orderId: row.orderId,
      orderNumber: row.order?.orderNumber ?? null,
      shipmentId: row.shipmentId,
      shipmentNumber: row.shipment?.shipmentNumber ?? null,
      shipmentItemId: row.shipmentItemId,
      courierCode: row.courierCode,
      goodsReceiptId: row.goodsReceiptId ?? null,
      receiptNumber: row.goodsReceipt?.receiptNumber ?? null,
      consignmentNumber: row.goodsReceipt?.consignment?.consignmentNumber ?? null,
      subject: row.subject,
      description: row.description,
      resolutionAmountInr: row.resolutionAmountInr?.toFixed(2) ?? null,
      resolutionWalletEntryId: row.resolutionWalletEntryId,
      resolutionNotes: row.resolutionNotes,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
      storeId: row.storeId ?? null,
      storeName: row.store == null ? null : (row.store.displayName ?? row.store.name),
      disputePayer: row.disputePayer ?? null,
      disputeKind: row.disputeKind ?? null,
      disputeClaimAmountInr: row.disputeClaimAmountInr?.toFixed(2) ?? null,
      disputeClaimPayer: row.disputeClaimPayer ?? null,
      // Stored as JSON, read back as the shape the service stamped. It is
      // OUR own snapshot, never anything a caller sent, so there is
      // nothing here a cast is papering over.
      disputedFigures:
        row.disputedFigures == null
          ? null
          : // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- our own stamped JSON, written by `captureDisputedFigures` alone
            (row.disputedFigures as unknown as DisputedFiguresSnapshot),
    };
  }
}
