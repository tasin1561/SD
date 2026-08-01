import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationStatus, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TemplateRenderService } from './template-render.service';
import { ResendService } from './resend.service';
import { resolveSender } from '../sender-resolver';
import type { EmailDispatchInput, EmailSendResult } from '../email.types';

/**
 * End-to-end pipeline: lookup template → render → resolve sender → send →
 * persist a notification_logs row capturing the rendered body and final
 * status. Always returns; the caller is a queue worker which decides whether
 * to retry based on the returned status.
 *
 * ── WHY A LEDGER FAILURE AFTER A SUCCESSFUL SEND IS SWALLOWED ────────
 * The send is IRREVERSIBLE and happens first; the notification_logs row is
 * the reflection of it. If the row write throws — a connection blip, a
 * lock timeout, a row someone removed — letting that propagate marks the
 * BullMQ job failed, and the retry re-enters this method and CALLS RESEND
 * AGAIN. With `attempts: 5` that is up to five copies of "your order has
 * been dispatched" in a customer's inbox, caused by a database hiccup that
 * had nothing to do with the email.
 *
 * So once the provider has accepted the message, a ledger failure is
 * logged at ERROR and reported as SENT. Losing an audit row is bad; mailing
 * a customer five times is worse, and unlike the row it cannot be repaired
 * afterwards. This is the same visible-vs-silent ordering rule the sagas
 * follow — the durable act first, and the reflection must never be able to
 * repeat it.
 *
 * When the SEND itself failed, nothing irreversible happened, so a ledger
 * error still propagates and the retry is correct.
 */
@Injectable()
export class EmailDispatchService {
  private readonly logger = new Logger(EmailDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly render: TemplateRenderService,
    private readonly resend: ResendService,
  ) {}

  async send(input: EmailDispatchInput): Promise<EmailSendResult> {
    const rendered = await this.render.render(
      input.templateCode,
      input.variables ?? {},
      input.language ?? 'en',
    );

    const sender = input.fromOverride
      ? { from: input.fromOverride, replyTo: 'Skydrop Support <support@skydrop.online>' }
      : resolveSender(input.templateCode);

    const subject = rendered.subject ?? '(no subject)';

    const sendResult = await this.resend.send({
      from: sender.from,
      to: input.recipient.email,
      subject,
      text: rendered.body,
      ...(rendered.htmlBody ? { html: rendered.htmlBody } : {}),
      replyTo: sender.replyTo,
    });

    const status: NotificationStatus = sendResult.ok
      ? NotificationStatus.SENT
      : NotificationStatus.FAILED;

    // Module 11 (NOTIF-2 store-then-send): when the M11 fan-out path
    // pre-created the ledger row, UPDATE that row instead of creating
    // a fresh one. Keeps the row stable from intent (QUEUED) →
    // outcome (SENT/FAILED); the row id stays the dedup gate's anchor.
    // Legacy fire-once callers (the existing sites — auth,
    // seller-mgmt, inventory) leave
    // existingNotificationLogId unset and get the original create
    // path unchanged.
    const log = await this.persistLog(input, rendered, sender, subject, sendResult, status);

    if (!sendResult.ok) {
      this.logger.warn(
        { templateCode: input.templateCode, to: input.recipient.email, code: sendResult.code },
        'Email send failed',
      );
    }

    return {
      notificationLogId: log?.id ?? null,
      status: sendResult.ok ? 'SENT' : 'FAILED',
      providerMessageId: sendResult.ok ? sendResult.providerMessageId : null,
      failureCode: sendResult.ok ? null : sendResult.code,
      failureMessage: sendResult.ok ? null : sendResult.message,
    };
  }

  /**
   * Writes the ledger row. Returns null when the write failed AFTER the
   * provider had already accepted the message — see the class doc.
   */
  private async persistLog(
    input: EmailDispatchInput,
    rendered: Awaited<ReturnType<TemplateRenderService['render']>>,
    sender: { from: string; replyTo: string },
    subject: string,
    sendResult: Awaited<ReturnType<ResendService['send']>>,
    status: NotificationStatus,
  ): Promise<{ id: string } | null> {
    try {
      return await this.writeLog(input, rendered, sender, subject, sendResult, status);
    } catch (err) {
      if (!sendResult.ok) {
        // Nothing left the building — a retry is safe and correct.
        throw err;
      }
      this.logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          templateCode: input.templateCode,
          to: input.recipient.email,
          providerMessageId: sendResult.providerMessageId,
          existingNotificationLogId: input.existingNotificationLogId ?? null,
        },
        'Email WAS SENT but the notification_logs row could not be written. ' +
          'Reporting SENT deliberately: retrying would re-send to the recipient. ' +
          'The provider message id above is the only remaining record.',
      );
      return null;
    }
  }

  private async writeLog(
    input: EmailDispatchInput,
    rendered: Awaited<ReturnType<TemplateRenderService['render']>>,
    _sender: { from: string; replyTo: string },
    subject: string,
    sendResult: Awaited<ReturnType<ResendService['send']>>,
    status: NotificationStatus,
  ): Promise<{ id: string }> {
    return input.existingNotificationLogId
      ? await this.prisma.client.notificationLog.update({
          where: { id: input.existingNotificationLogId },
          data: {
            templateId: rendered.templateId,
            templateCode: rendered.templateCode,
            templateVersion: rendered.templateVersion,
            subject,
            body: rendered.body,
            htmlBody: rendered.htmlBody,
            provider: 'resend',
            providerMessageId: sendResult.ok ? sendResult.providerMessageId : null,
            status,
            sentAt: sendResult.ok ? new Date() : null,
            failedAt: sendResult.ok ? null : new Date(),
            failureCode: sendResult.ok ? null : sendResult.code,
            failureMessage: sendResult.ok ? null : sendResult.message,
          },
          select: { id: true },
        })
      : await this.prisma.client.notificationLog.create({
          data: {
            templateId: rendered.templateId,
            templateCode: rendered.templateCode,
            templateVersion: rendered.templateVersion,
            channel: NotificationChannel.EMAIL,
            recipientType: input.recipient.type,
            recipientId: input.recipient.id ?? null,
            toEmail: input.recipient.email,
            subject,
            body: rendered.body,
            htmlBody: rendered.htmlBody,
            variables: (input.variables ?? Prisma.DbNull) as Prisma.InputJsonValue,
            orderId: input.orderId ?? null,
            shipmentId: input.shipmentId ?? null,
            callAttemptId: input.callAttemptId ?? null,
            triggerEvent: input.triggerEvent ?? null,
            provider: 'resend',
            providerMessageId: sendResult.ok ? sendResult.providerMessageId : null,
            status,
            sentAt: sendResult.ok ? new Date() : null,
            failedAt: sendResult.ok ? null : new Date(),
            failureCode: sendResult.ok ? null : sendResult.code,
            failureMessage: sendResult.ok ? null : sendResult.message,
          },
          select: { id: true },
        });
  }
}
