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

  constructor(private readonly env: EnvService) {
    this.devMode = !this.env.hasResendApiKey;
    this.client = this.devMode ? null : new Resend(this.env.resendApiKey);
    if (this.devMode && !this.env.isTest) {
      this.logger.warn(
        'RESEND_API_KEY is empty — emails will be logged to stdout instead of sent.',
      );
    }
  }

  async send(input: SendEmailInput): Promise<SendEmailResult | SendEmailFailure> {
    if (this.devMode || !this.client) {
      this.logger.log(
        `[DEV] Would send email: subject="${input.subject}", to="${input.to}", from="${input.from}", body="${truncate(input.text, 240)}"`,
      );
      return { ok: true, providerMessageId: null };
    }

    try {
      const res = await this.client.emails.send({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        replyTo: input.replyTo,
        ...(input.headers ? { headers: input.headers } : {}),
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
