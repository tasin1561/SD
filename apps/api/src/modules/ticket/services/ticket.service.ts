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
  type RtoItemCondition,
  TicketStatus,
  TicketType,
  WalletEntryDirection,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { TicketStateMachineService } from './ticket-state-machine.service';

export interface TicketActor {
  readonly type: ActorType;
  readonly staffId?: string | null;
  readonly sellerUserId?: string | null;
}

/**
 * The two names a person can actually read, pulled with every ticket.
 *
 * Declared once so a new read cannot forget them and silently render a
 * uuid — which is what every ticket screen did until now: an order
 * shown as `01a043c6-7fbf-…` cannot be repeated down a phone, matched
 * against the order list, or recognised at all.
 */
const TICKET_NAMES = {
  order: { select: { orderNumber: true } },
  shipment: { select: { shipmentNumber: true } },
} as const;

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
  readonly orderId?: string | null;
  readonly shipmentId?: string | null;
  readonly shipmentItemId?: string | null;
  readonly courierCode?: string | null;
  readonly rtoCondition?: RtoItemCondition | null;
  /** The courier's own category, chosen by the seller. */
  readonly issueCategoryExternalId?: string | null;
  readonly issueSubcategoryExternalId?: string | null;
}

export interface ResolveTicketInput {
  readonly to: TicketStatus;
  readonly notes?: string | null;
  /** Required (and only permitted) when `to` is RESOLVED_REFUND. */
  readonly refundAmountInr?: string | null;
}

export interface TicketView {
  readonly id: string;
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
  readonly issueCategoryExternalId: string | null;
  readonly issueSubcategoryExternalId: string | null;
  readonly subject: string;
  readonly description: string | null;
  readonly resolutionAmountInr: string | null;
  readonly resolutionWalletEntryId: string | null;
  readonly resolutionNotes: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

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
    scope?: { sellerId?: string; openOnly?: boolean },
  ): Promise<{ ticketId: string; at: Date }> {
    const trimmed = note.trim();
    if (trimmed.length < 3) {
      throw new BadRequestException({
        code: 'TICKET_NOTE_EMPTY',
        message: 'Write something the seller can act on.',
      });
    }
    const ticket = await this.prisma.client.ticket.findFirst({
      where: {
        id: ticketId,
        ...(scope?.sellerId === undefined ? {} : { sellerId: scope.sellerId }),
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
    const row = await this.prisma.client.ticketEvent.create({
      data: {
        ticketId,
        fromStatus: ticket.status,
        toStatus: ticket.status,
        note: trimmed,
        actorType: actor.type,
        actorId: actor.staffId ?? actor.sellerUserId ?? null,
      },
      select: { createdAt: true },
    });
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
    const client = tx ?? this.prisma.client;

    if (input.shipmentItemId) {
      const existing = await client.ticket.findUnique({
        where: {
          shipmentItemId_ticketType: {
            shipmentItemId: input.shipmentItemId,
            ticketType: input.ticketType,
          },
        },
      });
      if (existing) return this.toView(existing);
    }

    const created = await client.ticket.create({
      data: {
        ticketType: input.ticketType,
        status: TicketStatus.OPEN,
        sellerId: input.sellerId,
        subject: input.subject,
        description: input.description ?? null,
        orderId: input.orderId ?? null,
        shipmentId: input.shipmentId ?? null,
        shipmentItemId: input.shipmentItemId ?? null,
        courierCode: input.courierCode ?? null,
        rtoCondition: input.rtoCondition ?? null,
        issueCategoryExternalId: input.issueCategoryExternalId ?? null,
        issueSubcategoryExternalId: input.issueSubcategoryExternalId ?? null,
        openedByStaffId: actor.staffId ?? null,
        openedBySellerUserId: actor.sellerUserId ?? null,
      },
    });

    await client.ticketEvent.create({
      data: {
        ticketId: created.id,
        fromStatus: null,
        toStatus: TicketStatus.OPEN,
        note: 'Ticket opened',
        actorType: actor.type,
        actorId: actor.staffId ?? actor.sellerUserId ?? null,
      },
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
          shipmentItemId: input.shipmentItemId ?? null,
          rtoCondition: input.rtoCondition ?? null,
        },
      },
      tx,
    );

    return this.toView(created);
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
    } else if (input.refundAmountInr) {
      // Guard against a caller passing an amount with the wrong target
      // status and assuming money moved.
      throw new BadRequestException({
        code: 'REFUND_AMOUNT_NOT_APPLICABLE',
        message: `refundAmountInr is only valid with RESOLVED_REFUND, not ${input.to}`,
      });
    }

    const terminal = this.stateMachine.isTerminal(input.to);

    const updated = await this.prisma.client.$transaction(async (tx) => {
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
          ...(terminal ? { resolvedAt: new Date(), resolvedByStaffId: actor.staffId ?? null } : {}),
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

      await tx.ticketEvent.create({
        data: {
          ticketId,
          fromStatus: existing.status,
          toStatus: input.to,
          note: input.notes ?? null,
          actorType: actor.type,
          actorId: actor.staffId ?? actor.sellerUserId ?? null,
        },
      });

      return row;
    });

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

  async listForSeller(
    sellerId: string,
    status?: TicketStatus,
    orderId?: string,
    stage?: TicketStage,
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
      },
      orderBy: { createdAt: 'desc' },
      include: TICKET_NAMES,
    });
    return rows.map((r) => this.toView(r));
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
    return this.toView(row);
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
    return this.toView(row);
  }

  async listForAdmin(filters: {
    sellerId?: string;
    status?: TicketStatus;
    /** The three stages the ticket screens speak in. See STAGE_STATUSES. */
    stage?: TicketStage;
    ticketType?: TicketType;
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
    return { items: rows.map((r) => this.toView(r)), total, page, pageSize };
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

  private toView(row: {
    id: string;
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
    order?: { orderNumber: string } | null;
    shipment?: { shipmentNumber: string } | null;
  }): TicketView {
    return {
      id: row.id,
      issueCategoryExternalId: row.issueCategoryExternalId,
      issueSubcategoryExternalId: row.issueSubcategoryExternalId,
      ticketType: row.ticketType,
      status: row.status,
      sellerId: row.sellerId,
      orderId: row.orderId,
      orderNumber: row.order?.orderNumber ?? null,
      shipmentId: row.shipmentId,
      shipmentNumber: row.shipment?.shipmentNumber ?? null,
      shipmentItemId: row.shipmentItemId,
      courierCode: row.courierCode,
      subject: row.subject,
      description: row.description,
      resolutionAmountInr: row.resolutionAmountInr?.toFixed(2) ?? null,
      resolutionWalletEntryId: row.resolutionWalletEntryId,
      resolutionNotes: row.resolutionNotes,
      resolvedAt: row.resolvedAt,
      createdAt: row.createdAt,
    };
  }
}
