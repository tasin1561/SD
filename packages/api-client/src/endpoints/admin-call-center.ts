/**
 * Admin call-center endpoint types — agent pull-next / record-attempt
 * surface + supervisor queue stats.
 */
import type { CallOutcome, OrderStatus } from '@skydrop/db';

export interface PulledAssignment {
  readonly assignmentId: string;
  readonly orderId: string;
  readonly assignedAt: string;
  readonly scheduledAttempts: number;
  readonly order: unknown;
}

export interface RecordAttemptRequest {
  readonly outcome: CallOutcome;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly outcomeNotes?: string;
  readonly customerSaidName?: string;
  readonly customerSaidAddress?: string;
  readonly customerVerifiedItems?: boolean;
  readonly scheduledFor?: string;
  readonly rescheduledReason?: string;
  readonly flaggedAsSuspicious?: boolean;
  readonly suspicionReason?: string;
}

export interface RecordAttemptResult {
  readonly attemptId: string;
  readonly queueEntryId: string;
  readonly outcome: CallOutcome;
  readonly targetStatus: OrderStatus | null;
  readonly finalOrderStatus: OrderStatus | null;
  readonly hitCap: boolean;
  readonly requeued: boolean;
  readonly requeuedAvailableAt: string | null;
}

export interface CallQueueStats {
  readonly pending: number;
  readonly assigned: number;
  readonly completed: number;
  readonly expired: number;
  readonly avgWaitSeconds: number | null;
}
