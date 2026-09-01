import { Injectable } from '@nestjs/common';
import { CallOutcome, OrderStatus } from '@skydrop/db';

/**
 * How the new queue entry's `availableAt` is computed when an outcome
 * re-queues the order.
 *  - NONE          : no re-queue
 *  - IMMEDIATE     : availableAt = now (pick again ASAP)
 *  - BUSY_DELAY    : availableAt = now + ops.call_busy_retry_delay_hours
 *  - AGENT_PROVIDED: availableAt = agent-supplied scheduledFor (bounds-checked)
 */
/**
 * When a re-queued order becomes callable again.
 *
 * `NO_RESPONSE_DELAY` exists because IMMEDIATE was wrong for the two
 * outcomes that mean the CUSTOMER did not pick up: it made the order
 * callable the instant the agent logged it, so a quiet queue redialled
 * somebody seconds after they ignored the phone, and three attempts —
 * the whole NDR cap — could be burned inside a minute. IMMEDIATE remains
 * correct for the outcomes that are about US (a technical failure, an
 * agent who does not speak the language): there the customer was never
 * disturbed, and neither of those counts toward the cap.
 */
export type RescheduleKind =
  | 'NONE'
  | 'IMMEDIATE'
  | 'NO_RESPONSE_DELAY'
  | 'BUSY_DELAY'
  | 'AGENT_PROVIDED';

interface OutcomeRule {
  /** Order status to transition to. `null` = leave order status
   *  unchanged (still PENDING_CONFIRMATION). */
  readonly targetStatus: OrderStatus | null;
  /** One of the 6/9 outcomes that count toward the NDR attempt cap. */
  readonly countsTowardCap: boolean;
  /** Whether a fresh queue entry is created for another attempt. */
  readonly requeue: boolean;
  readonly reschedule: RescheduleKind;
}

export interface ResolvedOutcome extends OutcomeRule {
  readonly outcome: CallOutcome;
  /** True when THIS attempt tripped the NDR cap (targetStatus was
   *  overridden to the at-cap target and requeue forced off). */
  readonly hitCap: boolean;
}

/**
 * R5b — what the cap MEANS for this seller. The policy itself is resolved
 * by the caller (it is a settings read, and this service stays
 * Prisma-free); the mapping still owns the resulting transition, so CC-2
 * is intact — there is exactly one place that turns "at cap" into a
 * status.
 *
 *  - REJECT       : terminal REJECTED_NDR (the default, pre-R5b behaviour)
 *  - AWAIT_SELLER : pause in AWAITING_SELLER_DECISION and ask the seller
 *                   whether to keep trying
 */
export type AtCapPolicy = 'REJECT' | 'AWAIT_SELLER';

/**
 * CC-2 — the SINGLE SOURCE OF TRUTH for CallOutcome → order transition.
 * Pure logic, no Prisma, no DI on Order (mirrors OrderStateMachine
 * Service). Never duplicate this mapping in controllers/other services.
 *
 * Base table (9 outcomes). The at-cap override is applied in resolve():
 * when the running attempt count reaches the seller's effective max, a
 * CALL_NO_RESPONSE-bound attempt-counting outcome (NO_ANSWER / BUSY /
 * VOICEMAIL_LEFT) is rerouted to terminal REJECTED_NDR with no re-queue.
 * CONFIRMED at the threshold still goes to CONFIRMED (the M5 saga may
 * then route it to OUT_OF_STOCK — that's M5's call); CUSTOMER_DECLINED /
 * WRONG_NUMBER are already terminal REJECTED_BY_CUSTOMER so the cap is
 * moot for them. Non-counting outcomes (CALLBACK_REQUESTED /
 * TECHNICAL_FAILURE / LANGUAGE_BARRIER) are never cap-affected.
 */
@Injectable()
export class CallOutcomeMappingService {
  private static readonly RULES: Readonly<Record<CallOutcome, OutcomeRule>> = {
    [CallOutcome.CONFIRMED]: {
      targetStatus: OrderStatus.CONFIRMED,
      countsTowardCap: true,
      requeue: false,
      reschedule: 'NONE',
    },
    [CallOutcome.CUSTOMER_DECLINED]: {
      targetStatus: OrderStatus.REJECTED_BY_CUSTOMER,
      countsTowardCap: true,
      requeue: false,
      reschedule: 'NONE',
    },
    [CallOutcome.WRONG_NUMBER]: {
      targetStatus: OrderStatus.REJECTED_BY_CUSTOMER,
      countsTowardCap: true,
      requeue: false,
      reschedule: 'NONE',
    },
    [CallOutcome.NO_ANSWER]: {
      targetStatus: OrderStatus.CALL_NO_RESPONSE,
      countsTowardCap: true,
      requeue: true,
      reschedule: 'NO_RESPONSE_DELAY',
    },
    [CallOutcome.BUSY]: {
      targetStatus: OrderStatus.CALL_NO_RESPONSE,
      countsTowardCap: true,
      requeue: true,
      reschedule: 'BUSY_DELAY',
    },
    [CallOutcome.VOICEMAIL_LEFT]: {
      targetStatus: OrderStatus.CALL_NO_RESPONSE,
      countsTowardCap: true,
      requeue: true,
      reschedule: 'NO_RESPONSE_DELAY',
    },
    [CallOutcome.CALLBACK_REQUESTED]: {
      targetStatus: OrderStatus.CALL_RESCHEDULED,
      countsTowardCap: false,
      requeue: true,
      reschedule: 'AGENT_PROVIDED',
    },
    [CallOutcome.TECHNICAL_FAILURE]: {
      targetStatus: null, // order stays PENDING_CONFIRMATION
      countsTowardCap: false,
      requeue: true,
      reschedule: 'IMMEDIATE',
    },
    [CallOutcome.LANGUAGE_BARRIER]: {
      targetStatus: null,
      countsTowardCap: false,
      requeue: true,
      reschedule: 'IMMEDIATE',
    },
    // Reached them, and there was nothing to confirm.
    //
    // No transition: on a pending order the customer has not agreed to
    // anything yet, so it stays where it is and can be rung again; on a
    // shipped one there is nothing for a call to change anyway (CUR-11 —
    // the courier's scans decide where a parcel is, not us).
    //
    // Counts toward NO cap: the cap exists to stop us ringing forever
    // without reaching anybody, and this is the outcome where we DID.
    //
    // No requeue: the seller asked a question and it has been answered.
    // Re-queueing would put the order back in the confirmation line for
    // a call nobody asked for.
    [CallOutcome.SPOKE_TO_CUSTOMER]: {
      targetStatus: null,
      countsTowardCap: false,
      requeue: false,
      reschedule: 'NONE',
    },
  };

  /** The 6/9 outcomes that count toward the NDR cap (CC-5). */
  countsTowardCap(outcome: CallOutcome): boolean {
    return CallOutcomeMappingService.RULES[outcome].countsTowardCap;
  }

  /**
   * Resolve an outcome to its effective transition.
   *
   * @param priorAttemptCount  count of PRIOR attempt-counting attempts
   *                           on this order (before this one).
   * @param maxAttempts        effective NDR cap (seller override ??
   *                           ops.call_max_attempts_before_ndr).
   */
  resolve(
    outcome: CallOutcome,
    args: {
      priorAttemptCount: number;
      maxAttempts: number;
      /** R5b — defaults to REJECT, i.e. the pre-R5b behaviour. */
      atCapPolicy?: AtCapPolicy;
    },
  ): ResolvedOutcome {
    const base = CallOutcomeMappingService.RULES[outcome];
    const effectiveCount = args.priorAttemptCount + (base.countsTowardCap ? 1 : 0);
    const atCap = base.countsTowardCap && effectiveCount >= args.maxAttempts;

    // Only CALL_NO_RESPONSE-bound counting outcomes are cap-rerouted.
    if (atCap && base.targetStatus === OrderStatus.CALL_NO_RESPONSE) {
      return {
        outcome,
        targetStatus:
          args.atCapPolicy === 'AWAIT_SELLER'
            ? OrderStatus.AWAITING_SELLER_DECISION
            : OrderStatus.REJECTED_NDR,
        countsTowardCap: true,
        // Either way this attempt does not re-queue: the order is out of
        // the calling loop until something else moves it (the seller's
        // answer, or nothing at all).
        requeue: false,
        reschedule: 'NONE',
        hitCap: true,
      };
    }
    return { outcome, ...base, hitCap: false };
  }
}
