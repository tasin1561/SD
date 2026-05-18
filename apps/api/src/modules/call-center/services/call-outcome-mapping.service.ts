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
export type RescheduleKind = 'NONE' | 'IMMEDIATE' | 'BUSY_DELAY' | 'AGENT_PROVIDED';

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
   *  overridden to REJECTED_NDR and requeue forced off). */
  readonly hitCap: boolean;
}

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
      reschedule: 'IMMEDIATE',
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
      reschedule: 'IMMEDIATE',
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
    args: { priorAttemptCount: number; maxAttempts: number },
  ): ResolvedOutcome {
    const base = CallOutcomeMappingService.RULES[outcome];
    const effectiveCount = args.priorAttemptCount + (base.countsTowardCap ? 1 : 0);
    const atCap = base.countsTowardCap && effectiveCount >= args.maxAttempts;

    // Only CALL_NO_RESPONSE-bound counting outcomes are NDR-rerouted.
    if (atCap && base.targetStatus === OrderStatus.CALL_NO_RESPONSE) {
      return {
        outcome,
        targetStatus: OrderStatus.REJECTED_NDR,
        countsTowardCap: true,
        requeue: false,
        reschedule: 'NONE',
        hitCap: true,
      };
    }
    return { outcome, ...base, hitCap: false };
  }
}
