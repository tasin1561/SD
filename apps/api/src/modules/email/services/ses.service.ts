import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '../../../config/env.service';
import { signRequest } from './aws-sigv4';
import type {
  EmailFailureKind,
  EmailProvider,
  SendEmailInput,
  SendEmailOutcome,
} from '../email-provider';

/**
 * Amazon SES v2, reached over its REST endpoint.
 *
 * INERT BY ABSENCE. With no `AWS_SES_*` credentials this service is
 * constructed, registered and never chosen — `isLive()` is false and
 * `EmailProviderRouter` routes everything to Resend exactly as it did
 * before SES existed. That is the whole shipping posture: the code is
 * present and the behaviour does not change until somebody sets three
 * environment variables.
 *
 * Deliberately NOT a dev stub. Resend has one (an empty key logs
 * `[DEV] Would send email` and returns ok) because it is the provider
 * every developer and every CI run goes through, and a stub there is
 * what makes the pipeline runnable offline. A stub HERE would be the
 * CUR-15 trap: a fabricated success answering for a live provider. So
 * an unconfigured SES does not answer at all.
 */

/**
 * SES's documented starting send rate for a new production account is
 * 14 messages/second. Budgeted AT the limit rather than under it because
 * the router's pacer is exact, not statistical. Raise it when AWS raises
 * the account's quota — it is the throttle, not the concurrency, that
 * governs provider load.
 */
const SES_MAX_PER_SECOND = 14;

/** SES answers in well under this; past it the pipe is the problem. */
const SES_TIMEOUT_MS = 15_000;

const SES_PATH = '/v2/email/outbound-emails';

/**
 * Error types that say something about OUR ACCOUNT or THEIR SERVICE
 * rather than about the message — see `EmailFailureKind`. Every one of
 * these leaves the message itself perfectly sendable by the other
 * provider, which is why they fail over.
 */
const TRANSPORT_ERROR_TYPES = new Set([
  'TooManyRequestsException', // 429 — pacing
  'LimitExceededException', // daily quota spent
  'SendingPausedException', // AWS paused the account
  'AccountSuspendedException', // AWS suspended the account
  'MailFromDomainNotVerifiedException', // our SES identity, not the recipient
  'NotFoundException', // a configuration set SES cannot find
  'InternalServiceErrorException',
]);

@Injectable()
export class SesService implements EmailProvider {
  readonly name = 'ses';
  readonly maxPerSecond = SES_MAX_PER_SECOND;

  private readonly logger = new Logger(SesService.name);
  private readonly region: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly live: boolean;

  constructor(private readonly env: EnvService) {
    this.region = this.env.awsSesRegion;
    this.accessKeyId = this.env.awsSesAccessKeyId;
    this.secretAccessKey = this.env.awsSesSecretAccessKey;
    // All three or none. A half-configured provider is the shape that
    // boots clean and then 403s on the first real message, which is the
    // worst possible moment to find out.
    this.live = this.region !== '' && this.accessKeyId !== '' && this.secretAccessKey !== '';

    if (!this.live && !this.env.isTest) {
      this.logger.log('Amazon SES is not configured — every message routes to Resend.');
    }
  }

  isLive(): boolean {
    return this.live;
  }

  private get host(): string {
    return `email.${this.region}.amazonaws.com`;
  }

  async send(input: SendEmailInput): Promise<SendEmailOutcome> {
    if (!this.live) {
      // Unreachable through the router, which never picks a provider
      // that is not live. Present so a future direct caller gets a
      // refusal rather than a fabricated success.
      return {
        ok: false,
        code: 'SES_NOT_CONFIGURED',
        message: 'Amazon SES has no credentials; nothing was sent.',
        kind: 'TRANSPORT',
      };
    }

    const body = JSON.stringify(buildSesPayload(input));
    const headers = signRequest({
      method: 'POST',
      path: SES_PATH,
      host: this.host,
      region: this.region,
      service: 'ses',
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      body,
      contentType: 'application/json',
    });

    let res: Response;
    try {
      res = await fetch(`https://${this.host}${SES_PATH}`, {
        method: 'POST',
        // `Host` is set by the runtime and refused as a manual header;
        // it is signed, not sent by us.
        headers: {
          Authorization: headers.Authorization,
          'X-Amz-Date': headers['X-Amz-Date'],
          'Content-Type': headers['Content-Type'],
        },
        body,
        signal: AbortSignal.timeout(SES_TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout or a refused connection decided nothing about the
      // message. TRANSPORT, and the other provider is the right answer.
      return {
        ok: false,
        code: 'SES_UNREACHABLE',
        message: err instanceof Error ? err.message : String(err),
        kind: 'TRANSPORT',
      };
    }

    const text = await res.text().catch(() => '');

    if (res.ok) {
      return { ok: true, providerMessageId: readMessageId(text) };
    }

    const { errorType, detail } = readSesError(res, text);
    return {
      ok: false,
      code: errorType,
      message: detail,
      kind: classifySesFailure(res.status, errorType, detail),
    };
  }
}

/**
 * The SESv2 `SendEmail` request body. `Simple` content rather than
 * `Raw`: we hand SES a subject and two bodies, and building MIME by
 * hand to gain nothing is a second encoder that can disagree with the
 * first (the LBL-3 argument, in a different costume).
 */
export function buildSesPayload(input: SendEmailInput): Record<string, unknown> {
  const headerEntries = Object.entries(input.headers ?? {});
  return {
    FromEmailAddress: input.from,
    Destination: { ToAddresses: [input.to] },
    ReplyToAddresses: [input.replyTo],
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: input.text, Charset: 'UTF-8' },
          ...(input.html ? { Html: { Data: input.html, Charset: 'UTF-8' } } : {}),
        },
        // SES caps this at 15; the only header we ever set is the
        // staging redirect's, so the cap is documentation rather than
        // a constraint. Omitted entirely when empty — an empty list is
        // a field SES has no reason to parse.
        ...(headerEntries.length > 0
          ? { Headers: headerEntries.map(([Name, Value]) => ({ Name, Value })) }
          : {}),
      },
    },
  };
}

/**
 * THE SANDBOX IS AN ACCOUNT FACT WEARING A MESSAGE'S CLOTHES.
 *
 * A new SES account can only send to verified addresses, and it refuses
 * everything else as `MessageRejected: Email address is not verified`.
 * Read literally that is an opinion about the recipient — which would
 * make it a MESSAGE failure, no failover, and every customer email
 * silently lost for as long as the account sits in the sandbox.
 *
 * It is nothing of the kind. SES has not looked at the address and
 * formed a view; it has declined to look, because of a restriction on
 * OUR account. Resend will deliver the identical message without
 * complaint. So it is TRANSPORT, and the reserve provider carries the
 * mail until AWS grants production access — at which point the same
 * code stops seeing the error and nothing needs changing.
 *
 * Matched on the wording rather than on a "are we in the sandbox"
 * setting, because a setting is a second source of truth about a state
 * only AWS knows, and it would be wrong from the moment access is
 * granted until somebody remembered to flip it.
 */
const SANDBOX_REJECTION = /not verified/i;

export function classifySesFailure(
  status: number,
  errorType: string,
  detail: string,
): EmailFailureKind {
  if (status === 429 || status >= 500) return 'TRANSPORT';
  if (TRANSPORT_ERROR_TYPES.has(errorType)) return 'TRANSPORT';
  if (SANDBOX_REJECTION.test(detail)) return 'TRANSPORT';
  // Everything left is SES having read this message and refused it:
  // MessageRejected on a genuinely bad address, BadRequestException on
  // a malformed payload, a signature the credentials cannot produce.
  // The other provider would reach the same verdict on the first and
  // cannot help with the rest.
  return 'MESSAGE';
}

/** `x-amzn-errortype` wins; the body's `__type` is the fallback. */
function readSesError(res: Response, text: string): { errorType: string; detail: string } {
  const headerType = res.headers.get('x-amzn-errortype') ?? '';
  const parsed = safeJson(text);
  const bodyType = typeof parsed?.['__type'] === 'string' ? (parsed['__type'] as string) : '';
  const raw = headerType !== '' ? headerType : bodyType;
  // Both forms arrive decorated: `MessageRejected:` from the header,
  // `com.amazonaws...#MessageRejected` from the body.
  const errorType = raw.split('#').pop()?.split(':')[0]?.trim() ?? '';

  const message = parsed?.['message'] ?? parsed?.['Message'];
  const detail = typeof message === 'string' && message !== '' ? message : text.slice(0, 500);

  return {
    errorType: errorType !== '' ? errorType : `SES_HTTP_${res.status}`,
    detail: detail !== '' ? detail : `SES returned HTTP ${res.status}`,
  };
}

function readMessageId(text: string): string | null {
  const parsed = safeJson(text);
  const id = parsed?.['MessageId'];
  return typeof id === 'string' ? id : null;
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
