import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
  Prisma,
  SystemIssueKind,
  SystemIssueSeverity,
} from '@skydrop/db';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TemplateRenderService } from './template-render.service';
import { EmailProviderRouter } from './email-provider-router.service';
import type { EmailRouteResult } from './email-provider-router.service';
import { resolveSender } from '../sender-resolver';
import type { EmailDispatchInput, EmailSendResult } from '../email.types';
import { redactTokens, redactTokensInVariables, redactTokensOrNull } from '../redact-tokens';

/** Recorded on a still-QUEUED row whose template could not be found. */
export const EMAIL_TEMPLATE_NOT_FOUND = 'TEMPLATE_NOT_FOUND';
/** Recorded on a still-QUEUED row whose template threw while rendering. */
export const EMAIL_RENDER_FAILED = 'RENDER_FAILED';

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
    // The ONE send call in this service, and the only one anywhere: the
    // router decides which provider carries the message (CUR-12). This
    // service does not know Resend or SES exist.
    private readonly router: EmailProviderRouter,
    // Reached through the @Global SystemIssuesModule, the same way
    // EmailWorker already does — no import, so no cycle.
    private readonly issues: SystemIssueService,
  ) {}

  async send(input: EmailDispatchInput): Promise<EmailSendResult> {
    let rendered: Awaited<ReturnType<TemplateRenderService['render']>>;
    try {
      rendered = await this.render.render(
        input.templateCode,
        input.variables ?? {},
        input.language ?? 'en',
      );
    } catch (err) {
      await this.recordRenderFailure(input, err);
      throw err;
    }

    const sender = input.fromOverride
      ? { from: input.fromOverride, replyTo: 'Skydrop Support <support@skydrop.global>' }
      : resolveSender(input.templateCode);

    const subject = rendered.subject ?? '(no subject)';

    const route = await this.router.send(
      {
        from: sender.from,
        to: input.recipient.email,
        subject,
        text: rendered.body,
        ...(rendered.htmlBody ? { html: rendered.htmlBody } : {}),
        replyTo: sender.replyTo,
      },
      rendered.category,
    );
    const sendResult = route.outcome;

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
    const log = await this.persistLog(input, rendered, sender, subject, route, status);

    if (!sendResult.ok) {
      this.logger.warn(
        {
          templateCode: input.templateCode,
          to: input.recipient.email,
          code: sendResult.code,
          provider: route.provider,
          failedOverFrom: route.failedOverFrom,
        },
        'Email send failed',
      );
    }

    await this.announceFailover(route, rendered.category);

    return {
      notificationLogId: log?.id ?? null,
      status: sendResult.ok ? 'SENT' : 'FAILED',
      providerMessageId: sendResult.ok ? sendResult.providerMessageId : null,
      failureCode: sendResult.ok ? null : sendResult.code,
      failureMessage: sendResult.ok ? null : sendResult.message,
    };
  }

  /**
   * NOTIF-25 — A FAILOVER THAT WORKS IS STILL NEWS, AND IT USED TO BE
   * SILENT.
   *
   * The router falls back to the other provider on a TRANSPORT failure
   * and the message goes out, so nothing is lost and nothing looks
   * broken. That is the design working. But it means the estate can run
   * for weeks on its RESERVE provider with the only trace a `warn` line
   * nobody reads — and the two directions each hide something worth
   * acting on:
   *
   *  - **Resend → SES** is almost always the free tier's 100/day cap.
   *    Credential mail is the one category pinned to Resend (NOTIF-24)
   *    precisely because it has no in-app copy (NOTIF-9), so hitting
   *    that cap is the signal that we have outgrown the plan. Delivery
   *    survives; knowing is what lets somebody upgrade before the day
   *    SES is also unavailable.
   *
   *  - **SES → Resend** is worse and reads milder. SES carries the bulk,
   *    so a sustained outage pushes all of it onto Resend's 100/day,
   *    which it will exhaust in hours — and THEN credential mail has
   *    nowhere left to go.
   *
   * ── WHY HIGH AND NEVER CRITICAL ──────────────────────────────────
   * NOTIF-16 makes CRITICAL additionally send an EMAIL. Raising a
   * CRITICAL from inside the email pipeline would ask the degraded
   * system to report on itself, through the very provider that just
   * failed. HIGH is in-app only, reaches the same people, and cannot
   * feed back into the thing it is describing.
   *
   * ── ONE ISSUE PER DIRECTION, NOT PER MESSAGE ─────────────────────
   * A quota is exhausted once and then every message that hour fails
   * over. One row per email is a list people stop reading (TRK-11's
   * rule); the dedupe key carries the direction and the recurrence
   * count does the counting.
   *
   * AWAITED inside a try/catch rather than fired and forgotten. A
   * failover is rare, so the latency is nil, and awaiting keeps this
   * from becoming a tenth fire-and-forget DB writer needing its own
   * drain hook (NOTIF-19). It can never throw: the message has already
   * been sent, and an alerting layer that fails the operation it is
   * describing is worse than no alerting at all.
   */
  private async announceFailover(
    route: EmailRouteResult,
    category: NotificationCategory,
  ): Promise<void> {
    if (route.failedOverFrom === null) return;

    const from = route.failedOverFrom;
    const to = route.provider;
    const credential = category === NotificationCategory.CREDENTIAL;

    try {
      await this.issues.raise({
        kind: SystemIssueKind.INTEGRATION,
        severity: SystemIssueSeverity.HIGH,
        title: `Email is failing over from ${from} to ${to}`,
        detail:
          `An email could not be sent through ${from} and was carried by ${to} instead. ` +
          `It WAS delivered — this is the failover working, not a lost message.\n\n` +
          (from === 'resend'
            ? `Resend's free tier stops at 100 messages a day. Credential mail — password ` +
              `resets, invitations, email verification — is pinned to Resend because it is ` +
              `the one kind with no in-app copy to fall back on, so this is the signal that ` +
              `the plan needs upgrading. SES has the headroom to carry it meanwhile.`
            : `SES carries the bulk of our email, so if this persists all of it lands on ` +
              `Resend's 100/day free cap and will exhaust it within hours — and credential ` +
              `mail would then have nowhere left to go. Check the SES account dashboard ` +
              `(sending quota, account health) before that happens.`) +
          (credential
            ? `\n\nThis one was CREDENTIAL mail, which is the category that cannot be read ` +
              `any other way.`
            : ''),
        source: 'EmailDispatchService',
        // Per DIRECTION, not per message or per template.
        dedupeKey: `email-failover:${from}:${to}`,
        metadata: { from, to, category, credential },
      });
    } catch (err) {
      this.logger.error(
        { from, to, err: err instanceof Error ? err.message : String(err) },
        'Could not raise the email-failover issue (the email itself was sent)',
      );
    }
  }

  /**
   * A render that throws (no template for the code, a broken template)
   * used to leave the pre-created row exactly as the ledger wrote it:
   * QUEUED, no error, forever. BullMQ retried five times, gave up, and
   * the only trace was a MEDIUM "EmailWorker gave up on a job" that
   * notified nobody — which is how three CRITICAL system-issue emails
   * sat QUEUED on production from 7 Sep with nothing saying why.
   *
   * The reason is now written ONTO the row. The status stays QUEUED on
   * purpose: BullMQ still owns the retries (a render can fail on a
   * database blip and succeed thirty seconds later), and the
   * `EmailDeliveryWatchdogService` is the one place that decides a row
   * is never going out — it carries this reason into what it reports.
   * Guarded on QUEUED so a row an earlier attempt already sent is left
   * alone. Best-effort: the render error is the one worth throwing.
   *
   * The legacy create path has no row yet and still writes none.
   */
  private async recordRenderFailure(input: EmailDispatchInput, err: unknown): Promise<void> {
    if (!input.existingNotificationLogId) return;
    const failureCode =
      err instanceof NotFoundException ? EMAIL_TEMPLATE_NOT_FOUND : EMAIL_RENDER_FAILED;
    try {
      await this.prisma.client.notificationLog.updateMany({
        where: { id: input.existingNotificationLogId, status: NotificationStatus.QUEUED },
        data: {
          failureCode,
          failureMessage: err instanceof Error ? err.message : String(err),
          failedAt: new Date(),
        },
      });
    } catch (writeErr) {
      this.logger.warn(
        {
          existingNotificationLogId: input.existingNotificationLogId,
          err: writeErr instanceof Error ? writeErr.message : String(writeErr),
        },
        'Could not record the render failure on the notification row',
      );
    }
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
    route: EmailRouteResult,
    status: NotificationStatus,
  ): Promise<{ id: string } | null> {
    const sendResult = route.outcome;
    try {
      return await this.writeLog(input, rendered, sender, subject, route, status);
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
    route: EmailRouteResult,
    status: NotificationStatus,
  ): Promise<{ id: string }> {
    const sendResult = route.outcome;
    return input.existingNotificationLogId
      ? await this.prisma.client.notificationLog.update({
          where: { id: input.existingNotificationLogId },
          data: {
            templateId: rendered.templateId,
            templateCode: rendered.templateCode,
            templateVersion: rendered.templateVersion,
            subject,
            // The STORED copy is redacted; the recipient's message went
            // out above with its link intact (see ../redact-tokens).
            body: redactTokens(rendered.body),
            htmlBody: redactTokensOrNull(rendered.htmlBody),
            provider: route.provider,
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
            body: redactTokens(rendered.body),
            htmlBody: redactTokensOrNull(rendered.htmlBody),
            variables: (input.variables
              ? redactTokensInVariables(input.variables)
              : Prisma.DbNull) as Prisma.InputJsonValue,
            orderId: input.orderId ?? null,
            shipmentId: input.shipmentId ?? null,
            callAttemptId: input.callAttemptId ?? null,
            triggerEvent: input.triggerEvent ?? null,
            provider: route.provider,
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
