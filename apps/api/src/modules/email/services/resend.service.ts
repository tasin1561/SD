import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { EnvService } from '../../../config/env.service';
import type {
  EmailFailureKind,
  EmailProvider,
  SendEmailInput,
  SendEmailOutcome,
} from '../email-provider';

// Re-exported so the pre-SES import sites keep working; the types
// themselves now live on the provider boundary, because two providers
// share them.
export type {
  SendEmailInput,
  SendEmailResult,
  SendEmailFailure,
  SendEmailOutcome,
} from '../email-provider';

/**
 * Resend's default account limit is 2 requests/second. Sending faster
 * earns a 429, which this pipeline would record as a FAILED
 * notification rather than the pacing hiccup it actually is. Budgeted
 * AT the documented limit rather than under it because the pacer is
 * exact, not statistical.
 *
 * If the account is moved to a higher tier, raise this — it is the
 * throttle, not the concurrency, that governs provider load.
 */
const RESEND_MAX_PER_SECOND = 2;

/**
 * Resend error names that decided nothing about the message — see
 * `EmailFailureKind`. Rate limits and outages are obvious; the
 * credential ones belong here too, because a key that has been revoked
 * or restricted is a fact about OUR Resend account and leaves the
 * message perfectly sendable through SES.
 */
const TRANSPORT_ERROR_NAMES = new Set([
  'rate_limit_exceeded',
  'daily_quota_exceeded',
  'internal_server_error',
  'application_error',
  'invalid_access',
  'restricted_api_key',
  'not_found',
  'method_not_allowed',
  'concurrent_idempotent_requests',
]);

@Injectable()
export class ResendService implements EmailProvider {
  readonly name = 'resend';
  readonly maxPerSecond = RESEND_MAX_PER_SECOND;

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

  /**
   * False in dev, CI and e2e, where `send` is a stub that logs and
   * reports success. `EmailProviderRouter` reads this to refuse a
   * failover from a LIVE provider into this stub (CUR-15) — a
   * fabricated "sent" for a message nobody sent is worse than a
   * recorded failure.
   */
  isLive(): boolean {
    return !this.devMode;
  }

  async send(input: SendEmailInput): Promise<SendEmailOutcome> {
    // The staging redirect is applied by the router, above every
    // provider — see `mail-redirect.ts` for why it is not here.
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
        const code = res.error.name ?? 'RESEND_ERROR';
        return {
          ok: false,
          code,
          message: res.error.message ?? 'Resend API returned an error',
          kind: classifyResendFailure(code),
        };
      }

      return { ok: true, providerMessageId: res.data?.id ?? null };
    } catch (err) {
      // Threw rather than answered: a socket, a DNS failure, a timeout.
      // Nothing was decided about the message.
      return {
        ok: false,
        code: 'RESEND_EXCEPTION',
        message: err instanceof Error ? err.message : String(err),
        kind: 'TRANSPORT',
      };
    }
  }
}

/**
 * CUR-13's rule: classify on whether Resend FORMED AN OPINION about
 * this message, never on which words it used. `validation_error`,
 * `invalid_to_address` and their relatives are opinions about the
 * message and SES would reach the same one; everything in
 * `TRANSPORT_ERROR_NAMES` is about the pipe or the account.
 *
 * Anything unrecognised falls to MESSAGE, which is the conservative
 * side: it costs one email that BullMQ retries anyway, where guessing
 * the other way sends a known-bad address to the provider that carries
 * password resets.
 */
export function classifyResendFailure(code: string): EmailFailureKind {
  return TRANSPORT_ERROR_NAMES.has(code) ? 'TRANSPORT' : 'MESSAGE';
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
