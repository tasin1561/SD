/**
 * Admin call-center endpoint types — agent pull-next / record-attempt
 * surface + supervisor queue stats.
 */
import type { CallOutcome, OrderStatus } from '@skydrop/db';

/**
 * The order snapshot handed to an agent, as `OrderReadService.resolve`
 * shapes it. The recipient block is NESTED — the fields are `name` /
 * `phoneE164` / `addressLine1`, not the flat `recipientName` the
 * database column is called.
 *
 * This was `unknown`, and the station cast it to a flat shape the server
 * has never sent, so every recipient field rendered "—": an agent was
 * asked to phone a customer whose number the screen would not show. A
 * cast from `unknown` compiles against any shape at all, which is
 * exactly the check that would have caught it. Declared here so it
 * cannot silently drift again.
 */
export interface CallOrderSnapshot {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly recipient: {
    readonly name: string;
    readonly phoneE164: string;
    readonly altPhoneE164: string | null;
    readonly addressLine1: string;
    readonly addressLine2: string | null;
    readonly landmark: string | null;
    /** '' for orders whose seller never supplied it (ORD-5). */
    readonly city: string;
    readonly stateProvince: string;
    readonly postalCode: string;
  };
  readonly paymentMode: string;
  readonly codAmountInr: string | null;
  readonly items: ReadonlyArray<{
    /** Keys into `PulledAssignment.itemDisplay` for the live picture
     *  and description. */
    readonly variantId: string;
    readonly skuCode: string;
    readonly productName: string;
    readonly variantLabel: string | null;
    readonly quantity: number;
  }>;
}

export interface PulledAssignment {
  readonly assignmentId: string;
  /**
   * WHY this call is happening. Derived server-side (one place decides),
   * because it is what the agent's opening line depends on.
   */
  readonly callPurpose: {
    readonly kind: 'CONFIRMATION' | 'SELLER_REQUESTED' | 'DELIVERY_FOLLOW_UP';
    readonly headline: string;
    /** The seller's own words when they asked for this call. */
    readonly sellerAsked: string | null;
  };
  /** What is open on this order and still unanswered. */
  readonly openTickets: ReadonlyArray<{
    readonly ticketId: string;
    readonly subject: string;
    readonly detail: string | null;
    readonly raisedAt: string;
  }>;
  readonly orderId: string;
  readonly assignedAt: string;
  readonly scheduledAttempts: number;
  /** Null when the order vanished under the entry (logged server-side). */
  readonly order: CallOrderSnapshot | null;
  /** The company the customer bought from — the agent's opening line.
   *  Live rather than snapshotted: it names a business that still exists
   *  and can still be phoned. */
  readonly seller: {
    readonly id: string;
    readonly companyName: string;
    readonly contactPersonName: string;
    readonly phone: string;
  } | null;
  /**
   * Picture and description per variant, keyed by variantId.
   *
   * Beside the order rather than inside its items, because these are
   * LIVE catalogue reads while the item snapshot is ORD-6 immutable —
   * folding them in would make a live value look snapshotted. The agent
   * is asked "what is it, exactly?" mid-call and a SKU does not answer.
   */
  readonly itemDisplay: Record<
    string,
    { readonly thumbnailUrl: string | null; readonly description: string | null }
  >;
  /**
   * What happened the last times THIS ORDER was called, newest first.
   *
   * The notes are the point: the outcome enum says NO_ANSWER, the note
   * says "husband answered, she is at work until 7". An agent opening
   * attempt two as though it were attempt one is how a customer decides
   * we are not paying attention.
   */
  readonly priorAttempts: ReadonlyArray<{
    readonly attemptId: string;
    readonly outcome: CallOutcome;
    readonly notes: string | null;
    readonly startedAt: string;
    readonly agentEmail: string | null;
    readonly rescheduledFor: string | null;
    readonly orderNumber: string;
    /** False when it was a DIFFERENT order by the same customer. */
    readonly isThisOrder: boolean;
  }>;
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
