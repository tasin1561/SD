import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ActorType, Prisma } from '@skydrop/db';
import { isUniqueViolation } from '../../../common/db/unique-violation';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SolustationHttpService } from './solustation-http.service';
import { retryOnceOnTransient } from './solustation-retry';
import {
  isSolustationError,
  type SolustationJudgement,
  type SolustationPincode,
} from '../types/solustation.types';

/** First retry roughly a minute out; the worker owns the schedule from
 *  there. Set here so a row is always on somebody's list. */
const FIRST_RETRY_MS = 60_000;

export interface CheckActor {
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly sellerId: string;
  readonly storeId?: string | undefined;
}

/** The order a re-check is about — named scalars only (see `recheckOrder`). */
interface RecheckTarget {
  readonly id: string;
  readonly sellerId: string;
  /**
   * ── TWO CONVENTIONS LIVE ON `address_checks.store_id`, KNOWINGLY ─────
   * A row BORN FROM AN ORDER (here and in the backfill sweep) carries
   * `orders.store_id`, which is NOT NULL — the seller's own default
   * CHANNEL shop for a direct client-console order. A row born as a
   * DRAFT (`AddressCheckService.check`) carries the console's member
   * store, and null in the client console.
   *
   * They agree for every member-store order and differ only for a direct
   * one (a shop id here, null there). The draft side is PINNED and must
   * not be "unified" away: `OrderService.linkAddressCheckAsync` claims a
   * draft with `where: { referenceId, sellerId, storeId, orderId: null }`
   * (RS-1), so a draft stamped with the channel shop would stop matching
   * its own order. Making this side match instead would mean reading
   * `seller_stores.kind` to tell a member store from a shop, and writing
   * null over a true value, for a column nothing filters on yet.
   *
   * So the rule to apply to any FUTURE filter is: `store_id` names the
   * member store when there is one, and is otherwise unreliable for
   * "direct orders" — scope by `seller_id` (always the owner) and join
   * `orders.store_id` when the shop matters.
   */
  readonly storeId: string | null;
}

/** The one `address_checks` row that order already has, if any. */
interface RecheckRow {
  readonly id: string;
  readonly referenceId: string;
  readonly validationId: string | null;
}

export interface CheckAddressInput {
  readonly referenceId: string;
  readonly address: string;
  readonly pincode: string;
  readonly landmark?: string | undefined;
  readonly paymentType: 'cod' | 'prepaid';
}

/**
 * What the page is told. Deliberately NOT the vendor's response shape:
 * the browser gets a decided view, not a payload to interpret.
 */
export interface AddressCheckView {
  readonly referenceId: string;
  /** False when the check could not be made at all. */
  readonly available: boolean;
  readonly status: string;
  /** What the OPERATOR should do — see `actionFor` for why this is not
   *  simply the vendor's `recommended_action`. */
  readonly action: 'approve' | 'confirm_with_customer' | 'reject';
  readonly score: number | null;
  readonly poConfidence: string | null;
  readonly completedAddress: string | null;
  readonly issues: ReadonlyArray<{ code: string; message: string }>;
  readonly suggestions: ReadonlyArray<{
    field: string;
    candidates: readonly string[];
    reason?: string;
  }>;
  readonly extracted: Readonly<Record<string, string | null>>;
  readonly fieldSource: Readonly<Record<string, string>>;
  /** Only ever a real figure when their model says `shown`. */
  readonly rtoRisk: number | null;
  readonly rtoRiskStatus: string | null;
  /** True when this answer came from /v1/corrections rather than a
   *  first check — the page says "re-checked" rather than "checked". */
  readonly rechecked: boolean;
  /** What to ask the customer, in order. Verbatim from the vendor. */
  readonly questions: ReadonlyArray<{ field: string; text: string; options?: readonly string[] }>;
  /** Which data providers produced the answer (`ola` needs attribution). */
  readonly providersUsed: readonly string[];
}

/**
 * The address check, from the page's point of view.
 *
 * Owns the two things the HTTP client deliberately does not: which
 * endpoint an address goes to, and what happens when the answer never
 * comes.
 *
 * ── VALIDATE ONCE, THEN CORRECT ──────────────────────────────────────
 * Their billing is one unit per `reference_id` per month, and a repeat
 * `/v1/validate` on the same reference returns the STORED answer. So a
 * re-check after an edit must go to `/v1/corrections` — otherwise the
 * operator is shown the verdict on text they have already changed, and
 * the failure is silent: it looks exactly like the edit did nothing.
 * The page never has to know this; having a `validation_id` on the row
 * is what decides it.
 *
 * ── A FAILED CHECK IS CAUTION, NEVER APPROVAL ────────────────────────
 * On a timeout or a 5xx the page is shown `confirm_with_customer`
 * (owner, 2026-10-26), not `approve` and not a blank. We could not
 * check this address, so the honest instruction to an operator is to
 * ring the customer.
 *
 * But the STORED status is `unavailable`, and that distinction is
 * load-bearing: `unavailable` must never block a save, even in enforce
 * mode (brief §3d — "never block saving because of the API"). An outage
 * at their end that stopped every order at ours would be a far worse
 * failure than an unchecked address. So the displayed caution and the
 * enforcement gate are two different fields on purpose, and anything
 * reading this later should keep them apart.
 */
@Injectable()
export class AddressCheckService {
  private readonly logger = new Logger(AddressCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly http: SolustationHttpService,
  ) {}

  /** Free, not billed, and the autofill behind the pincode field. */
  async pincode(pincode: string): Promise<SolustationPincode | null> {
    try {
      return await this.http.pincode(pincode);
    } catch (e) {
      // A pincode lookup that fails costs the autofill and nothing
      // else. The operator types the address as they always have.
      this.logger.debug(
        { pincode, err: e instanceof Error ? e.message : String(e) },
        'pincode lookup unavailable',
      );
      return null;
    }
  }

  async check(actor: CheckActor, input: CheckAddressInput): Promise<AddressCheckView> {
    const existing = await this.prisma.client.addressCheck.findUnique({
      where: { referenceId: input.referenceId },
      select: { id: true, validationId: true, createdByActorId: true },
    });

    /*
      ── A REFERENCE SOMEBODY ELSE OWNS IS REFUSED ────────────────────────
      The draft belongs to whoever opened it: `created_by_actor_id` is the
      ownership rule, as the schema comment on that column says, and a
      reference id is not a secret.

      This used to force `validationId` to null and carry on, on the
      grounds that "the only thing a wrong reference can do is start a new
      one". That was FALSE and it was a cross-tenant leak: a repeat
      /v1/validate on the same reference returns their STORED answer (the
      class note above says so), so the other tenant's
      `completed_address` and `extracted` fields came straight back in
      `view()` to whoever guessed the reference — and `persist`'s upsert
      on that same reference then overwrote the owner's verdict.

      So nothing is sent and nothing is written. A row with no actor
      (`SYSTEM`, from the backfill sweep or a re-check) is owned by
      nobody and is refused the same way: there is no draft to resume.

      NOT FOUND rather than forbidden, the shape `OrderPageV2GateService`
      already refuses with — a 403 would confirm that the reference
      exists, which is the fact being protected.
    */
    if (existing !== null && existing.createdByActorId !== actor.actorId) {
      this.logger.warn(
        { referenceId: input.referenceId, actorType: actor.actorType, actorId: actor.actorId },
        'address check refused: that reference belongs to another actor',
      );
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    }
    const validationId = existing?.validationId ?? null;

    try {
      /*
        ONE immediate second attempt on a transient failure, from the
        brief. Free and idempotent: the reference id is the same, so
        Solustation bills nothing and returns the stored answer if the
        first attempt in fact got through.

        Still inside the operator's wait, which is why it is capped at
        one and why a long `Retry-After` declines to wait at all — the
        60-second sweep is the patient path. A throw from here lands
        `unavailable`, which never approves anything.
      */
      const judgement = await retryOnceOnTransient(
        async () =>
          validationId === null
            ? await this.http.validate({
                referenceId: input.referenceId,
                address: input.address,
                pincode: input.pincode,
                landmark: input.landmark,
                paymentType: input.paymentType,
              })
            : await this.http.correction({
                validationId,
                source: 'operator_fixed',
                address: input.address,
                pincode: input.pincode,
                landmark: input.landmark,
              }),
        {
          onRetry: (delayMs, failure) =>
            this.logger.warn(
              { referenceId: input.referenceId, delayMs, failure },
              'Solustation check failed transiently — retrying once',
            ),
        },
      );

      await this.persist(actor, input.referenceId, judgement);
      return this.view(input.referenceId, judgement, validationId !== null);
    } catch (e) {
      await this.persistUnavailable(actor, input.referenceId, e, input);
      return this.unavailableView(input.referenceId);
    }
  }

  /**
   * Re-check a SAVED order's address because somebody edited it.
   *
   * The call-bench case: an agent has the customer on the line, is told
   * the flat number is wrong, fixes it, and the verdict on screen is now
   * about words the customer has just corrected. Showing the old score
   * next to the new address is the one failure worth avoiding here — it
   * reads as "we checked this", so the whole stored verdict is replaced,
   * including by `unavailable` when the answer never came.
   *
   * ── IT CANNOT UNDO THE EDIT ──────────────────────────────────────────
   * The edit is already committed by the time this runs: it is a
   * separate call, after the correction's own transaction, and every
   * failure path here ends in a stored `unavailable` and a view that
   * says so. Nothing in this method can refuse, reverse or delay the
   * operator's edit, and nothing in it throws.
   *
   * ── ONE ROW, NEVER A SECOND ──────────────────────────────────────────
   * `address_checks.order_id` is unique: one check per order. So this
   * UPDATES the row the order already has (by its id, whatever its
   * reference is — a claimed `draft-<uuid>` as much as an order id) and
   * only ever creates one when the order has none. An upsert keyed on
   * the order id as the reference would have created a SECOND row for
   * every order whose check came from the v2 page, and the unique index
   * is what would have found out.
   *
   * Returns null when there is nothing to check: no such order, or not
   * an India one.
   */
  async recheckOrder(orderId: string): Promise<AddressCheckView | null> {
    const order = await this.prisma.client.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        storeId: true,
        recipientCountryCode: true,
        recipientAddressLine1: true,
        recipientAddressLine2: true,
        recipientLandmark: true,
        recipientPostalCode: true,
        codAmountInr: true,
      },
    });
    // India only — it is an Indian address service.
    if (order === null || order.recipientCountryCode !== 'IN') return null;

    const row = await this.prisma.client.addressCheck.findUnique({
      where: { orderId },
      select: { id: true, referenceId: true, validationId: true },
    });

    /*
      Built field by field from named scalars, like every other request
      body in this module: the recipient's name, phone and email are on
      the row in scope and Solustation refuses them with
      `422 unknown_field`, so there must be no object here that could
      carry one by being forwarded.
    */
    const address = [order.recipientAddressLine1, order.recipientAddressLine2]
      .map((part) => (part ?? '').trim())
      .filter((part) => part !== '')
      .join(', ');
    const landmark = (order.recipientLandmark ?? '').trim();
    const input: CheckAddressInput = {
      // The reference the order's check already answers under. Their
      // billing is one unit per reference per month, so re-using it is
      // free; minting a new one would be charged and would orphan the
      // validation chain.
      referenceId: row?.referenceId ?? order.id,
      address,
      pincode: order.recipientPostalCode,
      ...(landmark === '' ? {} : { landmark }),
      paymentType: order.codAmountInr !== null && !order.codAmountInr.isZero() ? 'cod' : 'prepaid',
    };
    // Their floor is 3 characters, and an order cannot be saved without
    // line 1 — unreachable in practice, and still better than spending a
    // round trip to be told so.
    if (address.length < 3) return null;

    /*
      ── THE VINTAGE OF THIS REQUEST ──────────────────────────────────────
      Taken BEFORE anything is asked, and carried into every write below.

      Two edits in a row are two re-checks in flight and the vendor may
      answer them out of order; `AddressCheckRetryService` is a third
      writer on the same row. Nothing used to tie a write to the edit
      that produced it, so a slow answer about the OLD address could land
      on top of a newer verdict — silently, because it looks exactly like
      a re-check that worked.

      `checkedAt` is stamped with this instant rather than with the
      moment the row is written, because that is what makes the
      comparison honest: the WRITE time of the request that asked first
      can be later than the START of the request that asked second, and a
      write-time comparison would then reject the newer answer. Stored
      this way, `checkedAt` is "when we asked", which is the vintage of
      the address the verdict is about.
    */
    const askedAt = new Date();

    /*
      Stub mode is a supported state, and nothing is ASKED in it. But the
      row still holds the verdict for the address BEFORE the edit, and
      `storedViewForOrder` would go on serving it — the one failure this
      method exists to prevent. So the stored state is moved to
      `unavailable`, which is exactly what the panel is being told.
    */
    if (!(await this.http.isLive())) {
      await this.writeRecheckUnavailable(order, row, input, {
        err: new Error('address check is in stub mode — nothing was asked'),
        askedAt,
        // Nothing was attempted, so the attempt counter does not move:
        // it counts tries against the vendor, and the retry worker's
        // give-up threshold reads it.
        counted: false,
        /*
          ON SOMEBODY'S LIST, which is why this is not left at the
          derived `false`. The backfill sweep's whole gate is
          `addressCheck: null`, so the row written here would otherwise
          hide the order from it for ever while no retry was scheduled
          either — unchecked, and nothing saying so. `AddressCheckRetry`
          sweeps nothing while stub mode is on and picks this up on the
          first sweep after the credentials arrive, with the `_asked`
          address the operator actually typed.
        */
        retryable: true,
      });
      return this.unavailableView(input.referenceId);
    }

    const validationId = row?.validationId ?? null;
    try {
      const judgement = await retryOnceOnTransient(
        async () =>
          validationId === null
            ? // No validation id means the first check never landed, so
              // there is no stored answer to be handed back and
              // /v1/validate is the honest call.
              await this.http.validate({
                referenceId: input.referenceId,
                address: input.address,
                pincode: input.pincode,
                landmark: input.landmark,
                paymentType: input.paymentType,
              })
            : await this.http.correction({
                validationId,
                source: 'operator_fixed',
                address: input.address,
                pincode: input.pincode,
                landmark: input.landmark,
              }),
        {
          onRetry: (delayMs, failure) =>
            this.logger.warn(
              { orderId, delayMs, failure },
              'Solustation re-check failed transiently — retrying once',
            ),
        },
      );
      await this.writeRecheck(order, row, judgement, askedAt);
      return this.view(input.referenceId, judgement, validationId !== null);
    } catch (e) {
      await this.writeRecheckUnavailable(order, row, input, { err: e, askedAt });
      return this.unavailableView(input.referenceId);
    }
  }

  // ---------- internal ----------

  /**
   * What the operator is told to do.
   *
   * Their `recommended_action` when we have one; `confirm_with_customer`
   * when we do not. An unrecognised action is also treated as
   * confirm-with-customer rather than passed through — a value we do not
   * understand must not become a green badge.
   */
  private actionFor(j: SolustationJudgement): AddressCheckView['action'] {
    const a = j.recommended_action;
    return a === 'approve' || a === 'reject' || a === 'confirm_with_customer'
      ? a
      : 'confirm_with_customer';
  }

  private view(referenceId: string, j: SolustationJudgement, rechecked: boolean): AddressCheckView {
    return {
      referenceId,
      available: true,
      status: j.status ?? 'needs_review',
      action: this.actionFor(j),
      score: typeof j.validity_score === 'number' ? j.validity_score : null,
      poConfidence: j.post_office_confidence ?? null,
      // Only `high` may reach a courier label (brief §3e); the page is
      // given the confidence beside it so it can say so rather than
      // offering a label address it must not use.
      completedAddress: j.completed_address ?? null,
      issues: j.issues ?? [],
      suggestions: j.suggestions ?? [],
      extracted: j.extracted ?? {},
      fieldSource: j.field_source ?? {},
      // NEVER a number unless their model says it is ready. Today it
      // never is, and a figure invented here would be acted on.
      rtoRisk: j.rto_risk_status === 'shown' && typeof j.rto_risk === 'number' ? j.rto_risk : null,
      rtoRiskStatus: j.rto_risk_status ?? null,
      rechecked,
      questions: j.questions ?? [],
      providersUsed: j.providers_used ?? [],
    };
  }

  /**
   * READ-ONLY: the stored check for a saved order, projected like a
   * live answer. Null when the order has none (normal, not an error).
   * Never calls the vendor.
   */
  async storedViewForOrder(orderId: string): Promise<AddressCheckView | null> {
    const row = await this.prisma.client.addressCheck.findUnique({ where: { orderId } });
    if (row === null) return null;
    if (row.result === null || row.status === 'unavailable') {
      return this.unavailableView(row.referenceId);
    }
    return this.view(row.referenceId, row.result as unknown as SolustationJudgement, false);
  }

  private unavailableView(referenceId: string): AddressCheckView {
    return {
      referenceId,
      available: false,
      status: 'unavailable',
      action: 'confirm_with_customer',
      score: null,
      poConfidence: null,
      completedAddress: null,
      issues: [],
      suggestions: [],
      extracted: {},
      fieldSource: {},
      rtoRisk: null,
      rtoRiskStatus: null,
      rechecked: false,
      questions: [],
      providersUsed: [],
    };
  }

  private async persist(
    actor: CheckActor,
    referenceId: string,
    j: SolustationJudgement,
  ): Promise<void> {
    const data = {
      status: j.status ?? 'needs_review',
      action: j.recommended_action ?? null,
      score: typeof j.validity_score === 'number' ? j.validity_score : null,
      poConfidence: j.post_office_confidence ?? null,
      result: j as unknown as Prisma.InputJsonValue,
      checkedAt: new Date(),
      // Cleared on success: a row that answered is not waiting for a
      // retry, and leaving a stale `nextRetryAt` would have the worker
      // asking again for an answer we already have.
      nextRetryAt: null,
      lastError: null,
    };
    await this.safeWrite(() =>
      this.prisma.client.addressCheck.upsert({
        where: { referenceId },
        create: {
          referenceId,
          sellerId: actor.sellerId,
          storeId: actor.storeId ?? null,
          createdByActorType: actor.actorType,
          createdByActorId: actor.actorId,
          validationId: j.validation_id ?? null,
          ...data,
        },
        // `validationId` is deliberately absent from the update: the
        // FIRST check's id is the one every later correction carries,
        // so replacing it with a correction's own id would orphan the
        // chain and send the next edit back to /v1/validate.
        update: data,
      }),
    );
  }

  private async persistUnavailable(
    actor: CheckActor,
    referenceId: string,
    err: unknown,
    asked?: CheckAddressInput,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const retryable = isSolustationError(err) ? err.retryable : false;
    const data = {
      status: 'unavailable',
      lastError: message.slice(0, 1_000),
      /*
        The request, kept so a retry can repeat it VERBATIM.

        Their response echoes the reference and not the address, so the
        only recoverable copy is the one we store. It cannot be
        reconstructed from the order either: an order saved with an
        unavailable check may since have been edited, and re-checking
        the edited text would store a verdict about words the customer
        was never quoted.
      */
      ...(asked === undefined
        ? {}
        : {
            result: {
              _asked: {
                referenceId: asked.referenceId,
                address: asked.address,
                pincode: asked.pincode,
                ...(asked.landmark === undefined ? {} : { landmark: asked.landmark }),
                paymentType: asked.paymentType,
              },
            } as unknown as Prisma.InputJsonValue,
          }),
      lastRequestId: isSolustationError(err) ? (err.requestId ?? null) : null,
      // Only a failure worth asking again about gets a retry time. A
      // 422 is our own bug and a 401 is the key — both would retry
      // forever against an answer that cannot change.
      nextRetryAt: retryable ? new Date(Date.now() + FIRST_RETRY_MS) : null,
    };
    await this.safeWrite(() =>
      this.prisma.client.addressCheck.upsert({
        where: { referenceId },
        create: {
          referenceId,
          sellerId: actor.sellerId,
          storeId: actor.storeId ?? null,
          createdByActorType: actor.actorType,
          createdByActorId: actor.actorId,
          attempts: 1,
          ...data,
        },
        update: { attempts: { increment: 1 }, ...data },
      }),
    );
  }

  /**
   * The re-checked verdict, in place of the old one.
   *
   * Every judgement field is written, none is merged: a score from the
   * address before the edit sitting beside a status from after it would
   * be read as one verdict. `validationId` is filled only when the row
   * had none — the FIRST check's id is what every later correction
   * carries, so replacing it would send the next edit back to
   * /v1/validate and show the operator a stored answer.
   *
   * ── THE CUSTOMER CONFIRMATION GOES WITH IT (owner's call, 2026-11-09)
   * `confirmedWithCustomerAt` records that somebody read the address
   * back to the customer and the customer said yes. Once the address is
   * edited, that yes was about words the customer never heard, and a
   * stored timestamp saying otherwise is a claim nobody made. So it is
   * cleared and the tick has to be earned again — the same rule the v2
   * order page already follows, where every re-check unticks the box.
   *
   * On the call bench this costs an agent one extra tick while they are
   * still on the phone, which is the cheapest possible place to pay it.
   */
  private async writeRecheck(
    order: RecheckTarget,
    row: RecheckRow | null,
    j: SolustationJudgement,
    askedAt: Date,
  ): Promise<void> {
    const data = {
      status: j.status ?? 'needs_review',
      action: j.recommended_action ?? null,
      score: typeof j.validity_score === 'number' ? j.validity_score : null,
      poConfidence: j.post_office_confidence ?? null,
      result: j as unknown as Prisma.InputJsonValue,
      // When we ASKED, not when we are writing — see `askedAt`.
      checkedAt: askedAt,
      nextRetryAt: null,
      lastError: null,
      confirmedWithCustomerAt: null,
    };
    await this.applyRecheck(
      order,
      row,
      askedAt,
      row !== null && row.validationId === null && j.validation_id != null
        ? { ...data, validationId: j.validation_id }
        : data,
      () =>
        this.prisma.client.addressCheck.create({
          data: {
            referenceId: order.id,
            orderId: order.id,
            sellerId: order.sellerId,
            // The ORDER's store — see `RecheckTarget.storeId`.
            storeId: order.storeId,
            // Nobody owns this draft — there was none. Same shape the
            // backfill sweep writes (see the schema comment on
            // `created_by_actor_id`).
            createdByActorType: ActorType.SYSTEM,
            createdByActorId: null,
            validationId: j.validation_id ?? null,
            ...data,
          },
        }),
    );
  }

  /**
   * A re-check that could not be made.
   *
   * The verdict is cleared rather than left standing, because the
   * address it described no longer exists — `unavailable` is the true
   * answer and the panel says so. The EDITED request is stored as
   * `_asked`, which is what lets `AddressCheckRetryService` finish the
   * job later with the text the customer actually gave, and
   * `nextRetryAt` is what puts it on that worklist.
   */
  private async writeRecheckUnavailable(
    order: RecheckTarget,
    row: RecheckRow | null,
    asked: CheckAddressInput,
    how: {
      readonly err: unknown;
      readonly askedAt: Date;
      readonly counted?: boolean;
      readonly retryable?: boolean;
    },
  ): Promise<void> {
    const { err, askedAt } = how;
    const counted = how.counted ?? true;
    const retryable = how.retryable ?? (isSolustationError(err) ? err.retryable : false);
    const message = err instanceof Error ? err.message : String(err);
    const data = {
      status: 'unavailable',
      action: null,
      score: null,
      poConfidence: null,
      result: {
        _asked: {
          referenceId: asked.referenceId,
          address: asked.address,
          pincode: asked.pincode,
          ...(asked.landmark === undefined ? {} : { landmark: asked.landmark }),
          paymentType: asked.paymentType,
        },
      } as unknown as Prisma.InputJsonValue,
      // When we ASKED, not when we are writing — see `askedAt`.
      checkedAt: askedAt,
      lastError: message.slice(0, 1_000),
      lastRequestId: isSolustationError(err) ? (err.requestId ?? null) : null,
      nextRetryAt: retryable ? new Date(Date.now() + FIRST_RETRY_MS) : null,
      // Cleared here too, for the reason it is cleared on a successful
      // re-check: the address changed, so a confirmation about the old
      // one is a claim nobody made. A vendor outage is not a reason to
      // keep asserting it.
      confirmedWithCustomerAt: null,
    };
    await this.applyRecheck(
      order,
      row,
      askedAt,
      counted ? { attempts: { increment: 1 }, ...data } : data,
      () =>
        this.prisma.client.addressCheck.create({
          data: {
            referenceId: order.id,
            orderId: order.id,
            sellerId: order.sellerId,
            // The ORDER's store — see `RecheckTarget.storeId`.
            storeId: order.storeId,
            createdByActorType: ActorType.SYSTEM,
            createdByActorId: null,
            attempts: counted ? 1 : 0,
            ...data,
          },
        }),
    );
  }

  /**
   * One re-check write, guarded by its own vintage.
   *
   * ── THE GUARD IS PART OF THE WRITE ───────────────────────────────────
   * `updateMany` with the vintage in its WHERE is a single statement, so
   * a slower answer about the address BEFORE an edit cannot land on top
   * of a newer verdict: the row it would overwrite no longer matches.
   * A `findUnique` then `update` is the read-then-write shape this
   * repository has been bitten by, and the two other writers it would
   * race with are real — a second re-check from the next edit, and
   * `AddressCheckRetryService` finishing an older one.
   *
   * Zero rows updated is NOT an error. It means somebody else has
   * already stored a fresher verdict about a later address, and theirs is
   * the one to keep; this request's answer is the stale one.
   *
   * ── THE LOSER OF TWO CREATES CONVERGES, IT IS NOT DROPPED ────────────
   * `address_checks.order_id` is unique, so two concurrent first-ever
   * re-checks are one winner and one P2002. The loser used to be
   * swallowed by `safeWrite`, which is how the OLDER verdict could end up
   * being the stored one; it now re-enters through the same guarded
   * update and keeps whichever vintage is newer.
   */
  private async applyRecheck(
    order: RecheckTarget,
    row: RecheckRow | null,
    askedAt: Date,
    data: Prisma.AddressCheckUpdateManyMutationInput,
    create: () => Promise<unknown>,
  ): Promise<void> {
    // Null is a row that has never been checked — older than anything.
    const older: Prisma.AddressCheckWhereInput = {
      OR: [{ checkedAt: null }, { checkedAt: { lt: askedAt } }],
    };
    await this.safeWrite(async () => {
      if (row !== null) {
        const { count } = await this.prisma.client.addressCheck.updateMany({
          where: { id: row.id, ...older },
          data,
        });
        if (count === 0) this.logSuperseded(order.id);
        return;
      }
      try {
        await create();
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const { count } = await this.prisma.client.addressCheck.updateMany({
          where: { orderId: order.id, ...older },
          data,
        });
        if (count === 0) this.logSuperseded(order.id);
      }
    });
  }

  private logSuperseded(orderId: string): void {
    this.logger.debug(
      { orderId },
      'address re-check not stored: the row already holds a verdict about a later address',
    );
  }

  /**
   * A write here must never be the reason an operator cannot carry on.
   *
   * The check is advice; recording the advice failing is not more
   * important than the order. Logged, swallowed, and the page still
   * gets its answer.
   */
  private async safeWrite(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'could not record the address check — the order is unaffected',
      );
    }
  }
}
