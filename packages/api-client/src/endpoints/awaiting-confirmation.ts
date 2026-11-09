/**
 * "Skip the confirmation call" worklist.
 *
 *   GET   /admin/orders/awaiting-confirmation   (?sellerId&page&pageSize)  perm: orders.view
 *   GET   /seller/orders/awaiting-confirmation  (?page&pageSize)           perm: orders.view
 *   POST  /admin/orders/confirmation-calls      perm: callcenter.queue.manage
 *   POST  /seller/orders/confirmation-calls     perm: orders.create
 *   GET|PATCH /seller/order-defaults/confirmation-calls  (seller's own switch + TTL)
 *
 * Admin sets the same switch for a client through the existing generic
 * seller-settings override on keys `ops.call_confirmation_required` (BOOLEAN)
 * and `ops.call_auto_confirm_ttl_hours` (INT, 1-168). One override row,
 * last writer wins.
 */
export interface AwaitingConfirmationQuery {
  /** Admin only. */
  readonly sellerId?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface AwaitingConfirmationRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly recipientName: string;
  readonly recipientCity: string;
  /** Decimal string. */
  readonly codAmountInr: string;
  readonly itemCount: number;
  /** ISO instant. */
  readonly createdAt: string;
  /** ISO instant; null when no TTL clock is running. */
  readonly confirmationDeadlineAt: string | null;
  /** The client's resolved `ops.call_confirmation_required`. */
  readonly callsRequired: boolean;
}

export interface AwaitingConfirmationResponse {
  readonly items: readonly AwaitingConfirmationRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** 1..100 ids. */
export interface SendConfirmationCallsRequest {
  readonly orderIds: readonly string[];
}

export type SendConfirmationCallOutcome =
  | 'QUEUED'
  | 'ALREADY_QUEUED'
  | 'NOT_FOUND'
  | 'NOT_PENDING_CONFIRMATION'
  | 'FAILED';

export interface SendConfirmationCallResult {
  readonly orderId: string;
  readonly outcome: SendConfirmationCallOutcome;
  readonly message?: string;
}

export interface SendConfirmationCallsResponse {
  readonly results: readonly SendConfirmationCallResult[];
}

/**
 * "Confirm now, no call" — same 1..100 selection as a send.
 *
 *   POST /admin/orders/confirm-without-call   perm: callcenter.queue.manage
 *   POST /seller/orders/confirm-without-call  perm: orders.create
 */
export interface ConfirmWithoutCallRequest {
  readonly orderIds: readonly string[];
}

export type ConfirmWithoutCallOutcome =
  | 'CONFIRMED'
  | 'OUT_OF_STOCK'
  | 'NOT_FOUND'
  | 'NOT_PENDING_CONFIRMATION'
  | 'REFUSED'
  | 'FAILED';

export interface ConfirmWithoutCallResult {
  readonly orderId: string;
  readonly outcome: ConfirmWithoutCallOutcome;
  /** The status actually persisted. */
  readonly landedStatus?: string;
  /** A guardrail's own code and words — show them verbatim (FE-2). */
  readonly code?: string;
  readonly message?: string;
}

export interface ConfirmWithoutCallResponse {
  readonly results: readonly ConfirmWithoutCallResult[];
}

export interface ConfirmationCallsSetting {
  readonly callsRequired: boolean;
  /** 1..168. */
  readonly ttlHours: number;
  readonly isOwnValue: boolean;
}

export interface SetConfirmationCallsRequest {
  readonly callsRequired: boolean;
  readonly ttlHours?: number;
}
