import { Injectable, Logger } from '@nestjs/common';
import { ActorType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SolustationHttpService } from './solustation-http.service';
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

    // The draft belongs to whoever opened it. A reference id is not a
    // secret, and without this one console could read another's check
    // by guessing — so ownership is checked, and a miss is treated as a
    // fresh draft rather than refused, because the only thing a wrong
    // reference can do is start a new one.
    const ours = existing !== null && existing.createdByActorId === actor.actorId;
    const validationId = ours ? existing.validationId : null;

    try {
      const judgement =
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
            });

      await this.persist(actor, input.referenceId, judgement);
      return this.view(input.referenceId, judgement, validationId !== null);
    } catch (e) {
      await this.persistUnavailable(actor, input.referenceId, e, input);
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
    };
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
