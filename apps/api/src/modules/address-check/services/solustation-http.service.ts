import { Injectable, Logger } from '@nestjs/common';
import { EnvService } from '../../../config/env.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  SOLUSTATION_ERROR_NAME,
  type SolustationError,
  type SolustationErrorFields,
  type SolustationErrorBody,
  type SolustationFailure,
  type SolustationJudgement,
  type SolustationPincode,
} from '../types/solustation.types';

/** Where their API lives. Host-allow-listed in `URL_VALUED_STRING_KEYS`
 *  because every request to it carries our Bearer key. */
const BASE_URL_SETTING = 'address_check.base_url';

/**
 * 3 seconds, from the brief.
 *
 * It is also the only number here with a human waiting behind it: this
 * runs while an operator sits on an order form, and a check that takes
 * longer than they take to reach the next field is one they learn to
 * ignore. A timeout is not a failure of the order — it writes
 * `unavailable` and the order saves exactly as it always did.
 */
const TIMEOUT_MS = 3_000;

/** Their documented limit; `address` outside it is refused 422, so we
 *  never spend a billable unit finding that out. */
const ADDRESS_MIN = 3;
const ADDRESS_MAX = 500;

/** Enough of a body to diagnose, never enough to be a copy of it. */
const LOG_BODY_CHARS = 400;

export interface ValidateInput {
  readonly referenceId: string;
  readonly address: string;
  readonly pincode: string;
  readonly landmark?: string | undefined;
  readonly paymentType: 'cod' | 'prepaid';
}

export interface CorrectionInput {
  readonly validationId: string;
  readonly source: 'operator_fixed' | 'customer_confirmed';
  readonly address: string;
  readonly pincode: string;
  readonly landmark?: string | undefined;
}

export interface FeedbackInput {
  readonly validationId: string;
  readonly courier: string;
  readonly awb: string;
  readonly status: 'delivered' | 'ndr' | 'rto' | 'in_transit' | 'cancelled' | 'lost';
  readonly ndrReasons?: readonly string[] | undefined;
  /** MUST carry a timezone offset (brief §5). */
  readonly eventTime: string;
}

/*
  ── THE ONLY PLACE A REQUEST BODY IS BUILT ───────────────────────────

  Every body below is assembled FIELD BY FIELD from named scalars. None
  of them spreads an object, and that is the structural guarantee behind
  "never send the customer's name, phone or email": there is no object
  in scope here that could carry one, so a future edit cannot widen the
  payload by forwarding a form state that grew a field.

  Their API refuses an unknown key with `422 unknown_field: <name>` and
  NAMES it (verified live, 2026-10-25) — so a leak would announce itself
  loudly rather than being quietly accepted. That is the backstop. These
  functions are the guard, and `solustation-http.service.spec.ts` asserts
  the exact key set of each.
*/

export const VALIDATE_BODY_KEYS = [
  'reference_id',
  'address',
  'pincode',
  'landmark',
  'payment_type',
] as const;

export function buildValidateBody(input: ValidateInput): Record<string, string> {
  const body: Record<string, string> = {
    reference_id: input.referenceId,
    address: input.address,
    pincode: input.pincode,
    payment_type: input.paymentType,
  };
  // Omitted rather than sent empty: the brief says "landmark if entered
  // separately; omit otherwise", and an empty string is a value.
  const landmark = (input.landmark ?? '').trim();
  if (landmark !== '') body['landmark'] = landmark;
  return body;
}

export const CORRECTION_BODY_KEYS = [
  'validation_id',
  'source',
  'address',
  'pincode',
  'landmark',
] as const;

export function buildCorrectionBody(input: CorrectionInput): Record<string, string> {
  const body: Record<string, string> = {
    validation_id: input.validationId,
    source: input.source,
    address: input.address,
    pincode: input.pincode,
  };
  const landmark = (input.landmark ?? '').trim();
  if (landmark !== '') body['landmark'] = landmark;
  return body;
}

export const FEEDBACK_BODY_KEYS = [
  'validation_id',
  'courier',
  'awb',
  'status',
  'ndr_reasons',
  'event_time',
] as const;

export function buildFeedbackBody(input: FeedbackInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    validation_id: input.validationId,
    courier: input.courier,
    awb: input.awb,
    status: input.status,
    event_time: input.eventTime,
  };
  const reasons = (input.ndrReasons ?? []).map((r) => r.trim()).filter((r) => r !== '');
  if (reasons.length > 0) body['ndr_reasons'] = reasons;
  return body;
}

/**
 * Solustation Address over HTTPS, and nothing else.
 *
 * Same shape as `DelhiveryHttpService` and `ShiprocketHttpService`: a
 * thin per-vendor client owning base URL, auth, timeout and the mapping
 * from a status code to a classified failure. It performs no
 * persistence and makes no decisions — `AddressCheckService` does both.
 *
 * ── IT IS ALWAYS ALLOWED TO FAIL ─────────────────────────────────────
 * Every method here can throw, and every caller is required to carry on
 * when it does. An address check is advice about a delivery; a delivery
 * that was going to be attempted is still attempted. The one thing that
 * must never happen is an error being read as approval — which is why
 * the failure classification is explicit rather than a boolean.
 *
 * ── IT IS A SEPARATE PRODUCT ─────────────────────────────────────────
 * Same company, same server even — reached only over its public HTTPS
 * URL. Never import its code, read its database or touch its files.
 */
@Injectable()
export class SolustationHttpService {
  private readonly logger = new Logger(SolustationHttpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  /**
   * Whether a call can be made at all.
   *
   * False is a SUPPORTED state, not a misconfiguration to crash on: a
   * dev machine with no key, or production before the key is set, shows
   * "Address check unavailable" and saves every order.
   */
  async isLive(): Promise<boolean> {
    return this.env.hasSoladdrApiKey && (await this.baseUrl()) !== '';
  }

  /** `GET /v1/pincode/{pincode}` — free, and the autofill behind it. */
  async pincode(pincode: string): Promise<SolustationPincode> {
    return this.request<SolustationPincode>('GET', `/v1/pincode/${encodeURIComponent(pincode)}`);
  }

  /**
   * `POST /v1/validate` — the ONE billable call per order.
   *
   * Billing is a unit per `reference_id` per month, so re-sending this
   * for the same reference costs nothing extra — but it also returns the
   * STORED answer, which is why an edited address goes to `correction`
   * instead and not back through here.
   */
  async validate(input: ValidateInput): Promise<SolustationJudgement> {
    this.assertAddressLength(input.address);
    return this.request<SolustationJudgement>('POST', '/v1/validate', buildValidateBody(input));
  }

  /** `POST /v1/corrections` — free, and the only way to re-check an edit. */
  async correction(input: CorrectionInput): Promise<SolustationJudgement> {
    this.assertAddressLength(input.address);
    return this.request<SolustationJudgement>(
      'POST',
      '/v1/corrections',
      buildCorrectionBody(input),
    );
  }

  /** `POST /v1/feedback` — 202, duplicates ignored, never blocks anything. */
  async feedback(input: FeedbackInput): Promise<void> {
    await this.request<unknown>('POST', '/v1/feedback', buildFeedbackBody(input));
  }

  // ---------- internal ----------

  private assertAddressLength(address: string): void {
    const n = address.trim().length;
    if (n >= ADDRESS_MIN && n <= ADDRESS_MAX) return;
    // Refused here rather than by them: a 422 for a length we can
    // measure ourselves spends a round trip, and on `validate` it would
    // be spent inside the operator's wait.
    throw this.fail(`address must be ${ADDRESS_MIN}-${ADDRESS_MAX} characters, got ${n}`, {
      classification: 'BAD_REQUEST',
      retryable: false,
    });
  }

  private async baseUrl(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: BASE_URL_SETTING },
      select: { valueString: true },
    });
    return (row?.valueString ?? '').trim().replace(/\/+$/, '');
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const key = this.env.soladdrApiKey.trim();
    const base = await this.baseUrl();
    if (key === '' || base === '') {
      throw this.fail(`Solustation is not configured (${key === '' ? 'no key' : 'no base URL'})`, {
        classification: 'STUB',
        // Nothing to retry: a key does not appear on its own. The check
        // stays `unavailable` until somebody sets one.
        retryable: false,
      });
    }

    /*
      AbortController + clearTimeout, not `AbortSignal.timeout`.

      Both abort at the same moment; only this one stops the timer when
      the request comes back FIRST. The other leaves a 3-second timer
      pending per call, and this fires on a debounced keystroke while an
      operator types an address — so the untidiness is per character,
      not per order. It also showed up as a leaked handle in the unit
      suite, which is the same fact arriving through a different door.
      Same spelling as `ShiprocketHttpService`.
    */
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          // NEVER logged, here or anywhere downstream.
          authorization: `Bearer ${key}`,
          accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
        // A service of ours that answers with a redirect is not a
        // service we follow — same rule as the courier clients.
        redirect: 'error',
      });
    } catch (e) {
      const aborted = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw this.fail(
        aborted
          ? `Solustation ${method} ${path} timed out after ${TIMEOUT_MS}ms`
          : `Solustation ${method} ${path} failed: ${e instanceof Error ? e.message : String(e)}`,
        { classification: aborted ? 'TIMEOUT' : 'NETWORK', retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    const requestId = res.headers.get('x-request-id');
    const parsed = await this.parseBody(res);

    if (!res.ok) throw this.fromStatus(method, path, res, parsed, requestId);
    return parsed as T;
  }

  /** Text first, then JSON — a gateway's HTML 502 must not become a
   *  parse crash that hides the status that explains it. */
  private async parseBody(res: Response): Promise<unknown> {
    const text = await res.text().catch(() => '');
    if (text === '') return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  private fromStatus(
    method: string,
    path: string,
    res: Response,
    parsed: unknown,
    requestId: string | null,
  ): SolustationError {
    const envelope = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as
      | SolustationErrorBody
      | Record<string, never>;
    const vendorCode = envelope.error?.code;
    const vendorMessage = envelope.error?.message;
    const id = requestId ?? envelope.error?.request_id ?? null;

    const classification: SolustationFailure =
      res.status === 429
        ? 'RATE_LIMITED'
        : res.status === 401 || res.status === 403
          ? 'AUTH'
          : res.status >= 500
            ? 'SERVER'
            : 'BAD_REQUEST';

    // 5xx and 429 are worth asking again. A 422 is OUR request being
    // wrong, and re-sending a wrong request produces the same answer; a
    // 401/403 is the key being wrong, and a retry loop against an auth
    // failure is how an account gets locked out.
    const retryable = classification === 'SERVER' || classification === 'RATE_LIMITED';

    this.logger.warn(
      {
        status: res.status,
        method,
        path,
        vendorCode,
        requestId: id,
        body:
          typeof parsed === 'string'
            ? parsed.slice(0, LOG_BODY_CHARS)
            : JSON.stringify(parsed).slice(0, LOG_BODY_CHARS),
      },
      'Solustation non-2xx response',
    );

    return this.fail(
      `Solustation ${method} ${path} → HTTP ${res.status}` +
        (vendorCode === undefined ? '' : ` (${vendorCode})`) +
        (vendorMessage === undefined ? '' : `: ${vendorMessage.slice(0, 200)}`),
      {
        classification,
        retryable,
        status: res.status,
        ...(vendorCode === undefined ? {} : { vendorCode }),
        requestId: id,
        ...this.retryAfter(res),
      },
    );
  }

  /** `Retry-After` in seconds, when they send one with a 429. */
  private retryAfter(res: Response): { retryAfterSeconds?: number } {
    const raw = res.headers.get('retry-after');
    if (raw === null) return {};
    const seconds = Number(raw.trim());
    return Number.isFinite(seconds) && seconds >= 0 ? { retryAfterSeconds: seconds } : {};
  }

  /** A plain Error with fields stamped on — see the note on
   *  `SolustationErrorFields` for why it is not a subclass. */
  private fail(message: string, fields: SolustationErrorFields): SolustationError {
    const e = new Error(message) as SolustationError;
    e.name = SOLUSTATION_ERROR_NAME;
    Object.assign(e, fields);
    return e;
  }
}
