import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { EnvService } from '../../../config/env.service';

export interface SendEmailInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  ok: true;
  providerMessageId: string | null;
}

export interface SendEmailFailure {
  ok: false;
  code: string;
  message: string;
}

@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);
  private readonly client: Resend | null;
  private readonly devMode: boolean;
  /** Non-empty when every message is diverted to one inbox. */
  private readonly redirectTo: string;

  constructor(private readonly env: EnvService) {
    this.devMode = !this.env.hasResendApiKey;
    this.client = this.devMode ? null : new Resend(this.env.resendApiKey);
    this.redirectTo = this.env.mailRedirectTo;
    if (this.devMode && !this.env.isTest) {
      this.logger.warn(
        'RESEND_API_KEY is empty — emails will be logged to stdout instead of sent.',
      );
    }
    // Loud on purpose. Diverting all mail is right for staging and
    // catastrophic in production — every seller and customer would
    // silently stop hearing from us, and nothing would look broken.
    if (this.redirectTo !== '' && !this.env.isTest) {
      this.logger.warn(
        `MAIL_REDIRECT_TO is set — EVERY outbound email will be sent to ${this.redirectTo} ` +
          `instead of its real recipient. Correct for staging; never set this in production.`,
      );
    }
  }

  async send(input: SendEmailInput): Promise<SendEmailResult | SendEmailFailure> {
    // Divert BEFORE the dev-mode branch, so the log line also shows the
    // redirect — otherwise a misconfigured environment looks identical
    // to a correct one until someone checks an inbox.
    const original = input.to;
    const redirected = this.redirectTo !== '' && this.redirectTo !== original;
    const message: SendEmailInput = redirected
      ? {
          ...input,
          to: this.redirectTo,
          // The real recipient goes in the subject because that is what
          // you read in a list of forty test emails, and in a header
          // because that is what survives being forwarded.
          subject: `[→ ${original}] ${input.subject}`,
          headers: { ...(input.headers ?? {}), 'X-Skydrop-Original-To': original },
        }
      : input;

    if (this.devMode || !this.client) {
      this.logger.log(
        `[DEV] Would send email: subject="${message.subject}", to="${message.to}", from="${message.from}", body="${truncate(message.text, 240)}"`,
      );
      return { ok: true, providerMessageId: null };
    }

    if (redirected) {
      this.logger.log(`Email for ${original} redirected to ${this.redirectTo}`);
    }

    try {
      const res = await this.client.emails.send({
        from: message.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        replyTo: message.replyTo,
        ...(message.headers ? { headers: message.headers } : {}),
      });

      if (res.error) {
        return {
          ok: false,
          code: res.error.name ?? 'RESEND_ERROR',
          message: res.error.message ?? 'Resend API returned an error',
        };
      }

      return { ok: true, providerMessageId: res.data?.id ?? null };
    } catch (err) {
      return {
        ok: false,
        code: 'RESEND_EXCEPTION',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
