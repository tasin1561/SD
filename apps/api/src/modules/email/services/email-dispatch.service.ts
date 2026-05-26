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
    // Legacy fire-once callers (the 8+ existing sites — auth,
    // seller-mgmt, inventory, category-proposal) leave
    // existingNotificationLogId unset and get the original create
    // path unchanged.
    const log = input.existingNotificationLogId
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

    if (!sendResult.ok) {
      this.logger.warn(
        { templateCode: input.templateCode, to: input.recipient.email, code: sendResult.code },
        'Email send failed',
      );
    }

    return {
      notificationLogId: log.id,
      status: sendResult.ok ? 'SENT' : 'FAILED',
      providerMessageId: sendResult.ok ? sendResult.providerMessageId : null,
      failureCode: sendResult.ok ? null : sendResult.code,
      failureMessage: sendResult.ok ? null : sendResult.message,
    };
  }
}
