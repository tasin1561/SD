import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  CallHoldOutcome,
  CallOutcome,
  CallQueueStatus,
  TicketStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { CallHoldService } from './call-hold.service';
import { CatalogReadService } from '../../catalog-read/services/catalog-read.service';
import { OrderReadService, type ResolvedOrder } from '../../order/services/order-read.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import { AssignmentExpirationService } from './assignment-expiration.service';

/** Effective concurrent-assignment cap when an agent has no settings
 *  row — mirrors agent_call_settings.maxActiveCalls @default(1). */
const DEFAULT_MAX_ACTIVE = 1;

/** Context is the last few conversations, not a transcript of forty. */
const PRIOR_ATTEMPT_LIMIT = 8;

export interface PulledAssignment {
  assignmentId: string;
  orderId: string;
  assignedAt: Date;
  scheduledAttempts: number;
  /** Order snapshot for the agent's call (recipient + items). null only
   *  if the referenced order vanished (data anomaly — logged). */
  order: ResolvedOrder | null;
  /**
   * WHO the customer bought from. The agent's opening line is "calling
   * about your order from <store>" — a customer who ordered from a shop
   * they recognise and is phoned by a company they have never heard of
   * hangs up, and in a COD market that hang-up is a refused parcel.
   *
   * Live, not snapshotted: it identifies a company that still exists and
   * can still be phoned, so the current name is the correct one — unlike
   * the recipient block, which must stay as it was at order time.
   */
  seller: { id: string; companyName: string; contactPersonName: string; phone: string } | null;
  /**
   * Picture and description per variant on the order, keyed by
   * variantId.
   *
   * Kept BESIDE the order rather than merged into its items, because
   * these are LIVE catalogue reads and the item snapshot is ORD-6
   * immutable — folding them in would make a live value look
   * snapshotted to every future reader. `order_items.imageUrl` holds a
   * canonical object URL that has resolved for nobody since the bucket
   * went private, so a presigned one is minted per request.
   *
   * An agent is asked "what is it, exactly?" mid-call, and a SKU code
   * does not answer that.
   */
  itemDisplay: Record<string, { thumbnailUrl: string | null; description: string | null }>;
  /**
   * What happened the LAST times this order was called, newest first.
   *
   * An agent on attempt two opening with "hello, calling about your
   * order" — when attempt one already agreed to ring back after six —
   * is how a customer decides we are not paying attention. The notes an
   * agent typed are the whole point: the outcome enum says NO_ANSWER,
   * the note says "husband answered, said she is at work until 7".
   *
   * Per ORDER, not per queue entry: a re-queue creates a new entry
   * (locked decision #2), so an entry-scoped history would be empty on
   * exactly the attempt that needs it most.
   */
  priorAttempts: ReadonlyArray<{
    attemptId: string;
    outcome: CallOutcome;
    notes: string | null;
    startedAt: Date;
    agentEmail: string | null;
    rescheduledFor: Date | null;
    /** Which order this call was about. */
    orderNumber: string;
    /** False when it was a DIFFERENT order by the same customer — still
     *  context ("she always asks for evening delivery"), but not about
     *  the parcel being discussed. */
    isThisOrder: boolean;
  }>;

  /**
   * WHY this call is happening, when somebody asked for it.
   *
   * An agent who does not know the seller rang in saying "the customer
   * told me they will be home Saturday" opens with "we tried to deliver
   * your parcel" — to a customer who has already explained themselves
   * once. The queue entry carries an order id and nothing else, so
   * without this the reason a call was requested is visible on the
   * seller's screen and nowhere on the agent's.
   *
   * Open tickets only: a resolved one is history, and the point here is
   * the question that is still outstanding.
   */
  openTickets: ReadonlyArray<{
    ticketId: string;
    subject: string;
    /** The seller's own words, verbatim. */
    detail: string | null;
    raisedAt: Date;
  }>;
}

/**
 * Module 7 — pull-model assignment (locked decisions #1 strict FIFO,
 * #4 pull). Lives in `call-center` (NOT the queue primitive) because it
 * enriches the assignment via OrderReadService — the first call-center →
 * Order DI consumption.
 *
 * Concurrency (locked decision): the pickable row is selected with
 * `FOR UPDATE SKIP LOCKED LIMIT 1` inside the same tx that flips it to
 * ASSIGNED, so two agents clicking "next" simultaneously can never get
 * the same entry (one gets the next row, or QUEUE_EMPTY). Postgres-
 * native — no advisory locks.
 *
 * FIFO = `ORDER BY available_at ASC, created_at ASC`; future-scheduled
 * entries (`available_at > now()`) are not yet pickable (reschedule /
 * busy-delay honoring). The agent's concurrent cap (10a) is enforced
 * BEFORE locking a row.
 */
@Injectable()
export class CallAssignmentService {
  private readonly logger = new Logger(CallAssignmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrderReadService,
    private readonly expiration: AssignmentExpirationService,
    private readonly holds: CallHoldService,
    private readonly catalog: CatalogReadService,
    private readonly audit: AuditLogService,
  ) {}

  /** Returns the assigned entry (+ order snapshot), or `null` when no
   *  entry is currently pickable (QUEUE_EMPTY). Throws 409
   *  AGENT_AT_CAPACITY when the agent is already at their cap. */
  async pullNext(agentId: string, _ctx?: ClientContext): Promise<PulledAssignment | null> {
    const [activeCount, roster] = await Promise.all([
      this.prisma.client.callQueueEntry.count({
        where: { assignedAgentId: agentId, status: CallQueueStatus.ASSIGNED },
      }),
      this.rosterState(agentId),
    ]);

    // The SERVER decides who may take work (FE-2). "Stop taking calls"
    // used to be cosmetic: the station gated its own auto-advance on the
    // flag, but the endpoint handed a customer's order to anyone who
    // asked — including an agent the presence sweep had just stood down
    // for being absent, which is precisely the case the sweep exists to
    // stop. Checked BEFORE the cap so an unavailable agent gets the
    // reason that applies to them.
    if (!roster.available) {
      throw new ConflictException({
        code: 'AGENT_NOT_AVAILABLE',
        message: 'You are marked as not taking calls. Start taking calls to be handed work.',
      });
    }

    const maxActive = roster.maxActive;
    if (activeCount >= maxActive) {
      throw new ConflictException({
        code: 'AGENT_AT_CAPACITY',
        message: `Agent already holds ${activeCount}/${maxActive} active call(s); complete or release one first`,
      });
    }

    const now = new Date();
    const picked = await this.prisma.client.$transaction(async (tx) => {
      // FIFO, only currently-pickable PENDING rows; SKIP LOCKED so
      // concurrent pulls never collide. status literal is not user input.
      // A RETURNED entry goes to the front.
      //
      // `scheduled_attempts > 0` on a PENDING row means it was pulled by
      // an agent and came back without a call being logged — expired,
      // released, or its agent stood down as absent. That customer has
      // already waited through an agent claiming their order and doing
      // nothing with it, so queueing them again behind fresh orders
      // makes them pay twice for our failure.
      //
      // This CANNOT cause redial loops, and the reason is structural: a
      // re-queue after a real attempt creates a BRAND NEW entry (locked
      // decision #2 — the completed row is the attempt history), so it
      // starts at scheduled_attempts = 0 and sorts as the fresh entry it
      // is. Only never-called holds jump the queue.
      //
      // Within each group it is still strict FIFO, so "the oldest
      // returned call first" holds.
      const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM call_queue_entries
           WHERE status = 'pending' AND available_at <= now()
           ORDER BY (scheduled_attempts > 0) DESC, available_at ASC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
      );
      const id = rows[0]?.id;
      if (id === undefined) return null;
      const entry = await tx.callQueueEntry.update({
        where: { id },
        data: {
          status: CallQueueStatus.ASSIGNED,
          assignedAgentId: agentId,
          assignedAt: now,
          scheduledAttempts: { increment: 1 },
        },
        select: { id: true, orderId: true, assignedAt: true, scheduledAttempts: true },
      });
      // Open the hold in the SAME tx as the claim, so a hold can never
      // exist for a claim that did not happen, nor a claim go unrecorded.
      await tx.callAssignmentHold.create({
        data: {
          queueEntryId: entry.id,
          orderId: entry.orderId,
          agentId,
          startedAt: entry.assignedAt ?? now,
        },
      });
      return entry;
    });

    if (!picked) return null; // QUEUE_EMPTY

    // CC-7: arm the timeout sweep immediately (before enrichment) so a
    // slow/failing OrderReadService can't leave the entry un-expirable.
    await this.expiration.scheduleExpiration(picked.id, picked.assignedAt ?? now);

    const order = await this.orders.getById(picked.orderId);
    if (!order) {
      this.logger.error(
        { assignmentId: picked.id, orderId: picked.orderId },
        'Pulled queue entry references a missing/soft-deleted order',
      );
    }
    return {
      assignmentId: picked.id,
      orderId: picked.orderId,
      assignedAt: picked.assignedAt ?? now,
      scheduledAttempts: picked.scheduledAttempts,
      order,
      seller: order ? await this.loadSeller(order.sellerId) : null,
      itemDisplay: await this.loadItemDisplay(order),
      priorAttempts: await this.loadPriorAttempts(order),
      openTickets: await this.loadOpenTickets(picked.orderId),
    };
  }

  /** This customer's logged calls, newest first — this order first. */
  /**
   * What somebody has asked us about this order and not yet had answered.
   *
   * Read here rather than joined into the assigning tx on purpose: that
   * transaction holds `FOR UPDATE SKIP LOCKED` on the queue row and is
   * the one place two agents contend, so it stays as short as it can be.
   * Enrichment is a plain read afterwards.
   */
  private async loadOpenTickets(orderId: string): Promise<PulledAssignment['openTickets']> {
    const rows = await this.prisma.client.ticket.findMany({
      where: {
        orderId,
        status: { in: [TicketStatus.OPEN, TicketStatus.NEGOTIATING] },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, subject: true, description: true, createdAt: true },
    });
    return rows.map((r) => ({
      ticketId: r.id,
      subject: r.subject,
      detail: r.description,
      raisedAt: r.createdAt,
    }));
  }

  private async loadPriorAttempts(
    order: ResolvedOrder | null,
  ): Promise<PulledAssignment['priorAttempts']> {
    if (order === null) return [];
    return (await this.loadPriorAttemptsForOrders([order])).get(order.orderId) ?? [];
  }

  /**
   * The CUSTOMER's call history, not just this order's.
   *
   * Asked for as "the history and notes of the customer's previous
   * calls": someone who asked last month to be rung after seven is
   * telling us something about this month's parcel too, and an agent who
   * cannot see that opens every call as though it were the first.
   *
   * Scoped by customerId when the order has one, falling back to the
   * order alone — a CSV row that never matched a customer record still
   * deserves its own history. Capped, because context is the last few
   * conversations; a customer with forty attempts does not need all
   * forty read before dialling.
   */
  private async loadPriorAttemptsForOrders(
    orders: ResolvedOrder[],
  ): Promise<ReadonlyMap<string, PulledAssignment['priorAttempts']>> {
    const out = new Map<string, PulledAssignment['priorAttempts']>();
    if (orders.length === 0) return out;

    for (const order of orders) {
      const where =
        order.customerId === null
          ? { orderId: order.orderId }
          : { order: { customerId: order.customerId } };
      const rows = await this.prisma.client.callAttempt.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        take: PRIOR_ATTEMPT_LIMIT,
        select: {
          id: true,
          orderId: true,
          outcome: true,
          outcomeNotes: true,
          startedAt: true,
          rescheduledFor: true,
          // Staff carry no name; emailDisplay IS the human identity.
          agent: { select: { emailDisplay: true } },
          order: { select: { orderNumber: true } },
        },
      });
      out.set(
        order.orderId,
        rows.map((r) => ({
          attemptId: r.id,
          outcome: r.outcome,
          notes: r.outcomeNotes,
          startedAt: r.startedAt,
          agentEmail: r.agent?.emailDisplay ?? null,
          rescheduledFor: r.rescheduledFor,
          orderNumber: r.order.orderNumber,
          isThisOrder: r.orderId === order.orderId,
        })),
      );
    }
    return out;
  }

  /**
   * Picture + description per variant on this order. Live catalogue
   * reads (see the field's own note on why they stay beside the ORD-6
   * snapshot rather than inside it).
   */
  private async loadItemDisplay(
    order: ResolvedOrder | null,
  ): Promise<Record<string, { thumbnailUrl: string | null; description: string | null }>> {
    if (order === null) return {};
    const map = await this.catalog.displayInfoByVariant(order.items.map((i) => i.variantId));
    const out: Record<string, { thumbnailUrl: string | null; description: string | null }> = {};
    for (const [variantId, d] of map) out[variantId] = d;
    return out;
  }

  /**
   * The seller behind an order, for the agent's opening line.
   *
   * Read here rather than through a catalog/order boundary because it is
   * about the COMPANY, not the order — `call-attempt.service` already
   * reads sellers the same way for the same reason.
   */
  private async loadSeller(
    sellerId: string,
  ): Promise<{ id: string; companyName: string; contactPersonName: string; phone: string } | null> {
    return (await this.loadSellers([sellerId])).get(sellerId) ?? null;
  }

  /** Batch form — one query however many assignments are in flight. */
  /** The same open-ticket context, batched for a list view. */
  private async loadOpenTicketsForOrders(
    orderIds: readonly string[],
  ): Promise<ReadonlyMap<string, PulledAssignment['openTickets']>> {
    const out = new Map<string, PulledAssignment['openTickets']>();
    const ids = [...new Set(orderIds)];
    if (ids.length === 0) return out;
    const rows = await this.prisma.client.ticket.findMany({
      where: {
        orderId: { in: ids },
        status: { in: [TicketStatus.OPEN, TicketStatus.NEGOTIATING] },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, orderId: true, subject: true, description: true, createdAt: true },
    });
    for (const r of rows) {
      if (r.orderId === null) continue;
      const list = [...(out.get(r.orderId) ?? [])];
      list.push({
        ticketId: r.id,
        subject: r.subject,
        detail: r.description,
        raisedAt: r.createdAt,
      });
      out.set(r.orderId, list);
    }
    return out;
  }

  private async loadSellers(
    sellerIds: string[],
  ): Promise<
    ReadonlyMap<
      string,
      { id: string; companyName: string; contactPersonName: string; phone: string }
    >
  > {
    const ids = [...new Set(sellerIds)];
    const out = new Map<
      string,
      { id: string; companyName: string; contactPersonName: string; phone: string }
    >();
    if (ids.length === 0) return out;
    const rows = await this.prisma.client.seller.findMany({
      where: { id: { in: ids } },
      select: { id: true, companyName: true, contactPersonName: true, phone: true },
    });
    for (const r of rows) out.set(r.id, r);
    return out;
  }

  /** The agent's in-flight ASSIGNED entries (+ order snapshots).
   *  Typically 0–1 at the Phase-1A default cap; FIFO-ordered by when
   *  they were pulled. */
  async listCurrent(agentId: string): Promise<PulledAssignment[]> {
    const rows = await this.prisma.client.callQueueEntry.findMany({
      where: { assignedAgentId: agentId, status: CallQueueStatus.ASSIGNED },
      orderBy: { assignedAt: 'asc' },
      select: {
        id: true,
        orderId: true,
        assignedAt: true,
        scheduledAttempts: true,
      },
    });
    if (rows.length === 0) return [];
    const orders = await this.orders.getManyByIds(rows.map((r) => r.orderId));
    const sellers = await this.loadSellers([...orders.values()].map((o) => o.sellerId));
    // One catalogue read for every in-flight assignment, not one each.
    const allVariantIds = [...orders.values()].flatMap((o) => o.items.map((i) => i.variantId));
    const displayByVariant = await this.catalog.displayInfoByVariant(allVariantIds);
    const displayByOrder = new Map<
      string,
      Record<string, { thumbnailUrl: string | null; description: string | null }>
    >();
    for (const o of orders.values()) {
      const forOrder: Record<string, { thumbnailUrl: string | null; description: string | null }> =
        {};
      for (const i of o.items) {
        const d = displayByVariant.get(i.variantId);
        if (d) forOrder[i.variantId] = d;
      }
      displayByOrder.set(o.orderId, forOrder);
    }
    const attemptsByOrder = await this.loadPriorAttemptsForOrders([...orders.values()]);
    // One query for the whole page rather than one per row: this is the
    // supervisor's list view, so the N+1 would be N of them.
    const ticketsByOrder = await this.loadOpenTicketsForOrders(rows.map((r) => r.orderId));
    return rows.map((r) => {
      const order = orders.get(r.orderId) ?? null;
      return {
        assignmentId: r.id,
        orderId: r.orderId,
        assignedAt: r.assignedAt ?? new Date(),
        scheduledAttempts: r.scheduledAttempts,
        order,
        seller: order ? (sellers.get(order.sellerId) ?? null) : null,
        itemDisplay: displayByOrder.get(r.orderId) ?? {},
        priorAttempts: attemptsByOrder.get(r.orderId) ?? [],
        openTickets: ticketsByOrder.get(r.orderId) ?? [],
      };
    });
  }

  /**
   * Agent abandons an assignment WITHOUT recording an attempt — the
   * entry returns to PENDING for FIFO re-pick (availableAt untouched →
   * original queue position preserved). Guarded conditional updateMany
   * on (ASSIGNED, owned by this agent) so it can't race a concurrent
   * expiry / completion. 404 / 409 ASSIGNMENT_NOT_ACTIVE / 403
   * ASSIGNMENT_NOT_OWNED.
   */
  async release(
    assignmentId: string,
    agentId: string,
    ctx?: ClientContext,
  ): Promise<{ released: boolean }> {
    const entry = await this.prisma.client.callQueueEntry.findUnique({
      where: { id: assignmentId },
      select: { id: true, orderId: true, status: true, assignedAgentId: true },
    });
    if (!entry) {
      throw new NotFoundException(`Assignment ${assignmentId} not found`);
    }
    if (entry.status !== CallQueueStatus.ASSIGNED) {
      throw new ConflictException({
        code: 'ASSIGNMENT_NOT_ACTIVE',
        message: `Assignment is ${entry.status}, not ASSIGNED`,
      });
    }
    if (entry.assignedAgentId !== agentId) {
      throw new ForbiddenException({
        code: 'ASSIGNMENT_NOT_OWNED',
        message: 'Assignment is held by another agent',
      });
    }

    const { count } = await this.prisma.client.callQueueEntry.updateMany({
      where: {
        id: assignmentId,
        status: CallQueueStatus.ASSIGNED,
        assignedAgentId: agentId,
      },
      data: {
        status: CallQueueStatus.PENDING,
        assignedAgentId: null,
        assignedAt: null,
      },
    });
    if (count === 0) return { released: false }; // lost a race — no-op

    // The agent handed it back without calling. Recorded before the
    // audit so the evaluation trail cannot be the thing that is missing.
    await this.holds.close(assignmentId, CallHoldOutcome.RELEASED);

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: agentId,
      action: 'call_queue.assignment_released',
      entityType: 'call_queue_entry',
      entityId: assignmentId,
      severity: 'LOW',
      metadata: {
        orderId: entry.orderId,
        ipAddress: ctx?.ipAddress ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
      },
    });
    return { released: true };
  }

  /** agent_call_settings.maxActiveCalls (locked decision 10a cap),
   *  defaulting to 1 when the agent has no settings row. */
  /**
   * The agent's cap AND whether they are on the roster at all.
   *
   * Read together because pullNext needs both and they live in one row.
   *
   * A MISSING settings row means an agent who has never opened the
   * station. `isAvailable` defaults to FALSE for a reason — being logged
   * in is not being at the desk — so the absent-row case must agree with
   * the column default rather than fall open, or "no row" would become a
   * way to take work without ever claiming to be present.
   */
  private async rosterState(agentId: string): Promise<{ maxActive: number; available: boolean }> {
    const settings = await this.prisma.client.agentCallSettings.findUnique({
      where: { agentId },
      select: { maxActiveCalls: true, isAvailable: true },
    });
    return {
      maxActive: settings?.maxActiveCalls ?? DEFAULT_MAX_ACTIVE,
      available: settings?.isAvailable ?? false,
    };
  }
}
