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
 * How many dev-mode messages the stub keeps, for the e2e suite to read
 * back (see `devSentMessages`). Bounded because this is a long-lived
 * singleton and an unbounded list of rendered email bodies is a leak.
 */
const DEV_OUTBOX_MAX = 50;

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
  /**
   * What the DEV STUB "sent", newest last. Populated ONLY in dev mode —
   * the live branch never touches it, so a production process holds no
   * message bodies in memory.
   *
   * This exists because the e2e suite has to play the RECIPIENT. A
   * password-reset or email-verification round trip needs the plaintext
   * token, and since the token tables store only its SHA-256 the sole
   * place the plaintext ever appears is the message itself. The specs
   * used to read it out of `notification_logs.body` — which is exactly
   * the copy that is now redacted, because a live credential link must
   * not outlive its token in a table with no expiry. The recipient's
   * copy is unredacted by construction (the redaction runs after the
   * provider has been handed the message), so reading it HERE is the
   * test playing the recipient rather than reading our ledger.
   *
   * NOTIF-6 already makes this stub the sanctioned e2e seam; keeping the
   * message instead of only logging it is what makes the seam usable
   * (the log line truncates at 240 characters, which cuts the token).
   */
  private readonly devOutbox: SendEmailInput[] = [];

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

  /**
   * TEST SEAM. The dev stub's outbox, newest last; always empty when
   * live. See `devOutbox` for why the e2e suite needs it.
   */
  devSentMessages(): readonly SendEmailInput[] {
    return this.devOutbox;
  }

  /** TEST SEAM. Drop what the stub has kept, between e2e tests. */
  clearDevSentMessages(): void {
    this.devOutbox.length = 0;
  }

  async send(input: SendEmailInput): Promise<SendEmailOutcome> {
    // The staging redirect is applied by the router, above every
    // provider — see `mail-redirect.ts` for why it is not here.
    if (this.devMode || !this.client) {
      this.logger.log(
        `[DEV] Would send email: subject="${input.subject}", to="${input.to}", from="${input.from}", body="${truncate(input.text, 240)}"`,
      );
      // Keyed on `devMode`, not on `!this.client`: a live provider that
      // somehow reached here without a client must still retain nothing.
      if (this.devMode) {
        this.devOutbox.push(input);
        if (this.devOutbox.length > DEV_OUTBOX_MAX) this.devOutbox.shift();
      }
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
