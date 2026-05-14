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
}

export interface ResolvedSender {
  from: string;
  replyTo: string;
}

export interface EmailSendResult {
  notificationLogId: string;
  status: 'SENT' | 'FAILED';
  providerMessageId: string | null;
  failureCode: string | null;
  failureMessage: string | null;
}
