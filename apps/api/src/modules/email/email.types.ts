import type { NotificationRecipientType } from '@skydrop/db';

export type EmailVariables = Record<string, string | number | boolean | null | undefined>;

export interface EmailRecipient {
  /** Maps to NotificationRecipientType. */
  type: NotificationRecipientType;
  /** Recipient row id (staff/seller/customer uuid). Optional for ad-hoc sends. */
  id?: string | null;
  /** Required: the email address the message goes to. */
  email: string;
}

/**
 * Payload submitted to the queue producer. The same shape is consumed by the
 * worker and passed to EmailDispatchService.send().
 */
export interface EmailDispatchInput {
  templateCode: string;
  language?: string; // default 'en'
  recipient: EmailRecipient;
  variables?: EmailVariables;
  // Optional relations for richer audit trails on the notification_logs row.
  orderId?: string | null;
  shipmentId?: string | null;
  callAttemptId?: string | null;
  triggerEvent?: string | null;
  /** Optional override for the "from" address (mostly for tests). */
  fromOverride?: string;
  /**
   * Module 11 (NOTIF-2 store-then-send): when set, EmailDispatchService
   * UPDATES the existing notification_logs row (created in PENDING/
   * QUEUED state by NotificationLedgerService.enqueue) instead of
   * INSERTING a new row. This is the M11 fan-out path's pre-flight
   * gate model — the row IS the dedup gate, created BEFORE the BullMQ
   * enqueue so a retry hits the partial-unique on (event_id, …)
   * before Resend is called a second time. Legacy fire-once call
   * sites (auth, seller-mgmt, inventory alerts/receipt/adjustments)
   * omit this field and keep the create-on-send
   * model unchanged.
   */
  existingNotificationLogId?: string;
}

export interface ResolvedSender {
  from: string;
  replyTo: string;
}

export interface EmailSendResult {
  /** Null only when the send SUCCEEDED but the ledger write did not — see
   *  EmailDispatchService for why that is not a retry. */
  notificationLogId: string | null;
  status: 'SENT' | 'FAILED';
  providerMessageId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}
