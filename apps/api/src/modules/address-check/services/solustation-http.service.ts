import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
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
  type SolustationBatchJob,
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

/** Their documented ceiling for `POST /v1/validate/batch`. */
export const BATCH_MAX_ITEMS = 1_000;

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
  const landmark = landmarkForWire(input.landmark);
  if (landmark !== '') body['landmark'] = landmark;
  return body;
}

/**
 * The landmark as THEY want it — without the word they add themselves.
 *
 * Verified live on 2026-11-09: they compose `completed_address` by
 * writing "near " in front of whatever arrives in the `landmark` field.
 * Send "near Hanuman Mandir" and the completed address reads
 * "...Vill Raydighi, near near Hanuman Mandir, South 24 Parganas...".
 *
 * A seller typing "near X" into a landmark box is the normal case, not
 * the odd one, so this reaches a parcel: the member-store and associate
 * consoles both send the field, and so does the backfill sweep from
 * `order.recipientLandmark`.
 *
 * ONLY the leading word is removed, and only when WHITESPACE follows
 * it — which is what separates the preposition from a name that merely
 * begins with those letters. "Nearby Traders" is a shop, and an earlier
 * version of this regex turned it into "Traders"; the test below is
 * what found that.
 *
 * A landmark that is the word on its own ("Near", whatever that meant
 * to the person who typed it) keeps its value rather than being
 * emptied — dropping a field over a prefix rule would be a worse bug
 * than the one being fixed.
 */
export function landmarkForWire(raw: string | undefined): string {
  const landmark = (raw ?? '').trim();
  const withoutNear = landmark.replace(/^near\s+(?:to\s+)?/i, '').trim();
  return withoutNear === '' ? landmark : withoutNear;
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
  const landmark = landmarkForWire(input.landmark);
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
  /*
    `undefined` and `[]` mean DIFFERENT things here, and collapsing them
    was a bug.

    `undefined` is "this is not a failed attempt, the field does not
    apply". `[]` is "this IS a failed attempt and the courier gave no
    reason" — which is a fact about the delivery, not an absence of one,
    and their model is entitled to hear it. An earlier version dropped
    any empty array, so a silent NDR arrived looking identical to a
    delivery scan that simply has no reasons field.
  */
  if (input.ndrReasons !== undefined) {
    body['ndr_reasons'] = input.ndrReasons.map((r) => r.trim()).filter((r) => r !== '');
  }
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
export class SolustationHttpService implements OnModuleInit {
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

  /**
   * `POST /v1/validate/batch` — up to 1,000 addresses, one job.
   *
   * For a backlog: a CSV import of 400 orders is 400 checks, and 400
   * single calls is 400 round trips inside one sweep tick. The batch is
   * billed identically per item, so this is purely about not holding a
   * worker open for ten minutes.
   *
   * Answers `202 { job_id }` — the results are collected later by
   * `batchJob` / `batchResults`.
   */
  async validateBatch(items: readonly ValidateInput[]): Promise<{ job_id: string }> {
    if (items.length === 0 || items.length > BATCH_MAX_ITEMS) {
      throw this.fail(`batch must hold 1-${BATCH_MAX_ITEMS} items, got ${items.length}`, {
        classification: 'BAD_REQUEST',
        retryable: false,
      });
    }
    for (const item of items) this.assertAddressLength(item.address);
    return this.request<{ job_id: string }>('POST', '/v1/validate/batch', {
      items: items.map(buildValidateBody),
    });
  }

  /** `GET /v1/jobs/{id}` — `status` reaches `done` and then stays. */
  async batchJob(jobId: string): Promise<SolustationBatchJob> {
    return this.request<SolustationBatchJob>('GET', `/v1/jobs/${encodeURIComponent(jobId)}`);
  }

  /**
   * One page of a finished batch, 100 per page, 1-indexed.
   *
   * Paged rather than whole because a 1,000-item job answered in one
   * body is a megabyte of JSON held in a worker's memory for no reason.
   */
  async batchResults(jobId: string, page: number): Promise<SolustationBatchJob> {
    return this.request<SolustationBatchJob>(
      'GET',
      `/v1/jobs/${encodeURIComponent(jobId)}?page=${String(page)}`,
    );
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

  /**
   * Env first, the system setting as a one-release fallback.
   *
   * `SOLUSTATION_ADDRESS_URL` is the source of truth from 2026-11-03.
   * The setting is still read when env is empty so an un-updated droplet
   * keeps working through the deploy; when the fallback goes, so does
   * this branch and the `systemSetting` read with it.
   */
  private async baseUrl(): Promise<string> {
    const fromEnv = this.env.soladdrBaseUrl;
    if (fromEnv !== '') return fromEnv;
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: BASE_URL_SETTING },
      select: { valueString: true },
    });
    return (row?.valueString ?? '').trim().replace(/\/+$/, '');
  }

  /**
   * Say out loud, once, which configuration is actually in force.
   *
   * A fallback that works is invisible, and that is the danger: the day
   * the old names are removed, a droplet still relying on them stops
   * checking addresses and the only symptom is every order quietly
   * reporting `unavailable`. One line at boot makes the difference
   * between "configured" and "configured the old way" legible before
   * then. Logs the key's first 8 characters — never more, and never the
   * key itself.
   */
  async onModuleInit(): Promise<void> {
    const keySource = this.env.soladdrKeySource;
    if (keySource === null) {
      this.logger.warn(
        'Solustation Address is in STUB mode: neither SOLUSTATION_ADDRESS_KEY nor ' +
          'SOLADDR_API_KEY is set. Address checks will report `unavailable`; orders still save.',
      );
      return;
    }

    const urlSource = this.env.soladdrBaseUrl !== '' ? 'SOLUSTATION_ADDRESS_URL' : BASE_URL_SETTING;
    this.logger.log(
      {
        keySource,
        keyPrefix: this.env.soladdrKeyPrefix,
        urlSource,
        baseUrl: await this.baseUrl(),
      },
      'Solustation Address configured',
    );

    if (keySource === 'SOLADDR_API_KEY') {
      this.logger.warn(
        'Solustation key came from the DEPRECATED SOLADDR_API_KEY. Set ' +
          'SOLUSTATION_ADDRESS_KEY; the fallback is removed next release.',
      );
    }
    if (urlSource === BASE_URL_SETTING) {
      this.logger.warn(
        `Solustation base URL came from the DEPRECATED \`${BASE_URL_SETTING}\` setting. ` +
          'Set SOLUSTATION_ADDRESS_URL; the fallback is removed next release.',
      );
    }
    /*
      A test key in production is the quietest possible wrong answer:
      every call returns 200 with a plausible verdict derived from FAKE
      map providers, nothing is billed, and no error is ever raised. It
      has already happened once on a dev machine, where `.env.local`
      shadowed `.env` — hence an error-level line rather than a warning.
    */
    if (this.env.soladdrKeyIsTestInProduction) {
      this.logger.error(
        `Solustation key ${this.env.soladdrKeyPrefix} is a TEST key and NODE_ENV=production. ` +
          'Every verdict is coming from fake map providers. Replace it with an sa_live_ key.',
      );
    }
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
