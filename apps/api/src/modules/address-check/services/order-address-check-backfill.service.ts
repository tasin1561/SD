import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  BATCH_MAX_ITEMS,
  SolustationHttpService,
  type ValidateInput,
} from './solustation-http.service';
import { retryOnceOnTransient } from './solustation-retry';
import { isSolustationError, type SolustationJudgement } from '../types/solustation.types';

/**
 * How many waiting orders are checked one at a time before it is worth
 * opening a batch job instead.
 *
 * A seller placing one order through the API is the common case and a
 * single call answers it in about a second. A CSV import of four hundred
 * is the other case, and four hundred single calls would hold a worker
 * open for the better part of ten minutes. The threshold is where the
 * round trips start to cost more than the job's own latency.
 */
const BATCH_THRESHOLD = 10;

/** Orders per sweep, so one enormous import cannot monopolise a tick. */
const MAX_PER_SWEEP = BATCH_MAX_ITEMS;

/**
 * How far back the sweep will look.
 *
 * An unchecked order from three months ago is history, not a backlog:
 * its parcel has already been delivered or returned, so a verdict on it
 * teaches nothing and spends a billable unit to do it. New work only.
 */
const LOOKBACK_DAYS = 7;

/** India only — the service is an Indian address service. */
const INDIA = 'IN';

/**
 * Every India order gets an address check, whichever door it came in by.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────
 * The address check was built for the v2 order page and lives in the
 * operator's typing: the page mints a `draft-<uuid>` reference, checks
 * as the address is entered, and `OrderService.linkAddressCheckAsync`
 * CLAIMS that draft when the order saves. Which means an order created
 * any other way has no check at all, because there was no draft to
 * claim — and there are five creation paths:
 *
 *   1. the seller form / API      → `OrderService.create`
 *   2. a member store placing     → `ResellerOrderService.create`
 *   3. a seller CSV import        → `OrderCsvImportProcessorService`
 *   4. a store CSV import         → the same, via (2)
 *   5. the staged-row queue       → `StagedOrderRowService.importRow`
 *
 * Only (1) via the v2 page was covered. The other four were silently
 * unchecked, which in shadow mode looks exactly like an address nobody
 * had any concerns about.
 *
 * ── WHY A SWEEP AND NOT A HOOK IN EACH PATH ──────────────────────────
 * All five funnel into ONE writer — there is exactly one `order.create`
 * in the repository — so a post-commit hook there would be one edit.
 * But it would make the order module depend on this one, and
 * `OrderService` is the most load-bearing class in the estate; an
 * address check is advice about a delivery and has no business being
 * wired into the thing that books deliveries.
 *
 * A sweep keys off the DATA instead of the code path: "an India order
 * with no check". That is true of all five paths without naming any of
 * them, and stays true of a sixth nobody has written yet — which is the
 * property that matters, because the reason this gap existed at all is
 * that four paths were added after the check was built.
 *
 * The cost is latency: up to one sweep interval before a verdict exists.
 * Shadow mode acts on nothing, so that is free today. When enforce
 * arrives the verdict is still in place long before it is needed — the
 * gate is at courier booking, which happens after the call centre has
 * confirmed the order, minutes to hours later.
 *
 * ── SAME REFERENCE ID EVERYWHERE ─────────────────────────────────────
 * `reference_id` is the ORDER ID for everything this service creates.
 * Solustation bills one unit per reference per month and returns the
 * stored answer for a repeat, so a re-check is free and idempotent, a
 * crashed sweep can simply run again, and the id in their console is one
 * anybody here can paste into ours.
 */
@Injectable()
export class OrderAddressCheckBackfillService {
  private readonly logger = new Logger(OrderAddressCheckBackfillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: SolustationHttpService,
  ) {}

  /**
   * One tick: find India orders with no check and get them one.
   *
   * Returns counts rather than throwing on a per-order failure — one bad
   * address must not strand the rest of the tick, and a failure is
   * already durable as an `unavailable` row the retry sweep will pick up.
   */
  async sweep(): Promise<SweepResult> {
    const idle: SweepResult = {
      found: 0,
      checked: 0,
      batched: 0,
      failed: 0,
      batchJobId: null,
    };
    if (!(await this.http.isLive())) {
      // Stub mode is a supported state, not a fault. Say nothing loudly
      // and leave every order saveable.
      return idle;
    }

    const waiting = await this.unchecked();
    if (waiting.length === 0) return idle;

    if (waiting.length >= BATCH_THRESHOLD) {
      const opened = await this.openBatch(waiting);
      return {
        found: waiting.length,
        checked: 0,
        batched: opened.count,
        failed: 0,
        // The caller needs this to go back for the answers — it is the
        // only state a batch keeps.
        batchJobId: opened.jobId,
      };
    }

    let checked = 0;
    let failed = 0;
    for (const order of waiting) {
      try {
        await this.checkOne(order);
        checked += 1;
      } catch (e) {
        failed += 1;
        await this.persistUnavailable(order, e);
      }
    }
    return { found: waiting.length, checked, batched: 0, failed, batchJobId: null };
  }

  /**
   * India orders, recent, with no `address_checks` row.
   *
   * `addressCheck: null` on the relation is the whole gate, and it is
   * the reason this is robust: a draft the v2 page already claimed IS a
   * row, so a covered order is skipped without this service needing to
   * know that the v2 page exists.
   */
  private async unchecked(): Promise<OrderToCheck[]> {
    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1_000);
    return this.prisma.client.order.findMany({
      where: {
        deletedAt: null,
        recipientCountryCode: INDIA,
        createdAt: { gte: since },
        addressCheck: null,
      },
      select: {
        id: true,
        sellerId: true,
        storeId: true,
        recipientAddressLine1: true,
        recipientAddressLine2: true,
        recipientLandmark: true,
        recipientPostalCode: true,
        codAmountInr: true,
      },
      // Oldest first: a backlog drains in the order it arrived, so one
      // order never waits behind a newer one for ever.
      orderBy: { createdAt: 'asc' },
      take: MAX_PER_SWEEP,
    });
  }

  /**
   * The request for one order.
   *
   * ── WHAT IS SENT, AND WHAT IS DELIBERATELY NOT ───────────────────────
   * The two address lines joined, the pincode, the landmark, and whether
   * it is COD. NOT the recipient's name, phone, alternate phone or
   * email, which the order also holds and which Solustation refuses with
   * `422 unknown_field` — built field by field from named scalars for
   * the same reason `buildValidateBody` is: there is no object in scope
   * here that could carry a name, so a later edit cannot widen it by
   * forwarding a row.
   */
  private toValidateInput(order: OrderToCheck): ValidateInput {
    const address = [order.recipientAddressLine1, order.recipientAddressLine2]
      .map((part) => (part ?? '').trim())
      .filter((part) => part !== '')
      .join(', ');
    const landmark = (order.recipientLandmark ?? '').trim();
    return {
      referenceId: order.id,
      address,
      pincode: order.recipientPostalCode,
      ...(landmark === '' ? {} : { landmark }),
      // COD is the default in this market and the one that changes the
      // serviceability answer, so it is read from the order rather than
      // assumed.
      paymentType: order.codAmountInr !== null && !order.codAmountInr.isZero() ? 'cod' : 'prepaid',
    };
  }

  private async checkOne(order: OrderToCheck): Promise<void> {
    const input = this.toValidateInput(order);
    if (input.address.length < 3) {
      // Their floor is 3 characters, and an order cannot be saved
      // without line 1 — so this is unreachable in practice and still
      // worth refusing here rather than spending a round trip to be
      // told so.
      throw new Error(`order ${order.id} has no address text to check`);
    }
    const judgement = await retryOnceOnTransient(() => this.http.validate(input), {
      onRetry: (delayMs, failure) =>
        this.logger.warn({ orderId: order.id, delayMs, failure }, 'backfill check retrying once'),
    });
    await this.persist(order, judgement);
  }

  /**
   * Hand a backlog to `POST /v1/validate/batch` and let the poll job
   * collect it.
   *
   * The job id is the only state that has to survive, and it travels in
   * the BullMQ job's own payload rather than a table of ours: a lost job
   * costs nothing because the next sweep sees the same unchecked orders
   * and opens a new batch, and a repeat carries the same reference ids,
   * so it is free.
   */
  private async openBatch(
    orders: readonly OrderToCheck[],
  ): Promise<{ jobId: string | null; count: number }> {
    const items = orders.map((o) => this.toValidateInput(o)).filter((i) => i.address.length >= 3);
    if (items.length === 0) return { jobId: null, count: 0 };

    const { job_id } = await retryOnceOnTransient(() => this.http.validateBatch(items), {
      onRetry: (delayMs, failure) =>
        this.logger.warn({ count: items.length, delayMs, failure }, 'batch open retrying once'),
    });
    this.logger.log({ jobId: job_id, count: items.length }, 'Solustation batch opened');
    return { jobId: job_id, count: items.length };
  }

  /**
   * Collect a finished batch and store each result against its order.
   *
   * Returns `done: false` while the job is still running, so the caller
   * can re-enqueue rather than hold a worker open. A `failed` job is
   * logged and dropped: the orders stay unchecked, so the next sweep
   * picks them up, which is the same recovery as a lost job.
   */
  async collectBatch(jobId: string): Promise<{ done: boolean; stored: number }> {
    const head = await this.http.batchJob(jobId);
    if (head.status === 'failed') {
      this.logger.warn({ jobId }, 'Solustation batch failed — the orders stay unchecked');
      return { done: true, stored: 0 };
    }
    if (head.status !== 'done') return { done: false, stored: 0 };

    let stored = 0;
    const pages = head.pages ?? 1;
    for (let page = 1; page <= pages; page += 1) {
      // Page 1 is already in hand when the job answered with results.
      const body =
        page === 1 && head.results !== undefined ? head : await this.http.batchResults(jobId, page);
      for (const entry of body.results ?? []) {
        const order = await this.prisma.client.order.findFirst({
          where: { id: entry.reference_id, deletedAt: null },
          select: { id: true, sellerId: true, storeId: true },
        });
        // A reference that is not one of our orders is not an error
        // worth failing the page for — it is an order deleted between
        // the batch opening and its results arriving.
        if (order === null) continue;
        await this.persist(order, entry as SolustationJudgement);
        stored += 1;
      }
    }
    this.logger.log({ jobId, stored }, 'Solustation batch collected');
    return { done: true, stored };
  }

  // ---------- persistence ----------

  /*
    ── WHY THIS DOES NOT REUSE `AddressCheckService.persist` ────────────
    That one is keyed on a draft and its actor: it upserts by the page's
    `draft-<uuid>` reference and stamps the operator who was at the
    screen, because owning the draft is what entitles somebody to go on
    checking it. A backfilled check has neither — the reference IS the
    order id and nobody was at a screen — so it writes `SYSTEM` with a
    null actor id (see the schema comment on `created_by_actor_id`) and
    sets `orderId` immediately rather than waiting to be claimed.
  */

  private async persist(order: PersistTarget, j: SolustationJudgement): Promise<void> {
    const row = {
      status: j.status ?? 'needs_review',
      action: j.recommended_action ?? null,
      score: typeof j.validity_score === 'number' ? j.validity_score : null,
      poConfidence: j.post_office_confidence ?? null,
      validationId: j.validation_id ?? null,
      result: (j as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      checkedAt: new Date(),
      // A result arrived, so nothing is owed: clear the retry worklist
      // in case an earlier tick left this row unavailable.
      nextRetryAt: null,
      lastError: null,
    };
    await this.upsert(order, row);
  }

  /**
   * A check that could not be made.
   *
   * `unavailable` with a null action, never `approve` — the brief is
   * explicit that a failure is treated as `confirm_with_customer` and
   * never as approval, and the way that is guaranteed is by there being
   * no code path here that can write an approving action.
   */
  private async persistUnavailable(order: PersistTarget, err: unknown): Promise<void> {
    const retryable = isSolustationError(err) ? err.retryable : false;
    const requestId = isSolustationError(err) ? err.requestId : null;
    this.logger.warn(
      {
        orderId: order.id,
        retryable,
        // Their id for the call, so one question can be asked in their
        // logs by its own name. Never the address, never the key.
        requestId,
        err: err instanceof Error ? err.message : String(err),
      },
      'backfill check unavailable',
    );
    await this.upsert(order, {
      status: 'unavailable',
      action: null,
      score: null,
      poConfidence: null,
      validationId: null,
      result: Prisma.JsonNull,
      checkedAt: new Date(),
      lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      ...(requestId === null || requestId === undefined ? {} : { lastRequestId: requestId }),
      // The 60-second sweep is the backstop the brief asks for; the 2
      // second retry has already been spent by `retryOnceOnTransient`.
      nextRetryAt: retryable ? new Date(Date.now() + 60_000) : null,
    });
  }

  /** Keyed on the ORDER ID as the reference — see the class note. */
  private async upsert(order: PersistTarget, row: Record<string, unknown>): Promise<void> {
    const identity = {
      sellerId: order.sellerId,
      storeId: order.storeId ?? null,
      createdByActorType: ActorType.SYSTEM,
      createdByActorId: null,
      orderId: order.id,
    };
    await this.prisma.client.addressCheck.upsert({
      where: { referenceId: order.id },
      create: { referenceId: order.id, ...identity, ...row } as never,
      update: row as never,
    });
  }
}

export interface SweepResult {
  readonly found: number;
  readonly checked: number;
  readonly batched: number;
  readonly failed: number;
  /** Set only when a batch was opened; the caller must collect it. */
  readonly batchJobId: string | null;
}

interface PersistTarget {
  readonly id: string;
  readonly sellerId: string;
  readonly storeId: string | null;
}

interface OrderToCheck extends PersistTarget {
  readonly recipientAddressLine1: string;
  readonly recipientAddressLine2: string | null;
  readonly recipientLandmark: string | null;
  readonly recipientPostalCode: string;
  readonly codAmountInr: Prisma.Decimal | null;
}
