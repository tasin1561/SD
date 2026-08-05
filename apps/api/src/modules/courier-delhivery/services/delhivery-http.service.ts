import { Injectable, Logger } from '@nestjs/common';
import { CredentialEnvironment } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { CourierCredentialService } from '../../courier-shared/services/courier-credential.service';
import { DelhiveryRateLimitService, type DelhiveryEndpoint } from './delhivery-rate-limit.service';

const BASE_URL_SETTING = 'courier.delhivery_api_base_url';
const ORIGIN_PIN_SETTING = 'courier.delhivery_origin_pincode';
const COURIER_CODE = 'delhivery';

/** The credential field holding the API token. The encrypted payload
 *  shape is OURS to choose; `apiToken` is the agreed key. Delhivery's
 *  token is static and never expires, and is DIFFERENT per environment
 *  (docs §1) — which is why it lives per (courier, environment) in
 *  courier_credentials rather than in env. */
const TOKEN_FIELD = 'apiToken';

export interface DelhiveryRequestOptions {
  method: 'GET' | 'POST' | 'PUT';
  /** Which documented rate budget this call draws from (docs §2). The
   *  WAF counts our whole egress IP, so an untagged call would be a hole
   *  in the budget — every caller must declare one. */
  endpoint: DelhiveryEndpoint;
  /** Path appended to the resolved base URL (must start with `/`). */
  path: string;
  body?: unknown;
  /** Override environment; defaults to PRODUCTION outside NODE_ENV!=production. */
  environment?: CredentialEnvironment;
  /** Per-endpoint body encoding for POST.
   *   - 'json'           : JSON.stringify body, content-type application/json
   *   - 'form-data-key'  : application/x-www-form-urlencoded;
   *                        body sent as `format=json&data=<json>`
   *                        (Delhivery legacy endpoints). */
  encoding?: 'json' | 'form-data-key';
  /** Per-request timeout in ms (default 25 000). */
  timeoutMs?: number;
}

/**
 * Module 9 — shared Delhivery wire infrastructure (commit 4). The
 * capability services (DelhiveryAwbService / DelhiveryLabelService /
 * DelhiveryServiceabilityService, commits 5-6) inject this for
 * base-URL resolution, auth, stub-mode gating and the raw request
 * helper.
 *
 * ── STUB MODE ──────────────────────────────────────────────────────
 * When `courier.delhivery_api_base_url` is EMPTY the adapter runs in
 * STUB MODE: no network, deterministic mock responses. This is the
 * default for local dev + e2e + CI. `isStubMode()` is the gate every
 * capability method checks first. Real mode (base URL set) is reached
 * only with provisioned credentials + a validated wire contract.
 *
 * ── CONTRACT STATUS (2026-07-27) ───────────────────────────────────
 * Endpoints, auth and the response shapes are VERIFIED against the
 * production API, not inferred: see docs/delhivery-integration.md, and
 * the specs whose fixtures are verbatim production responses. Auth is
 * `Authorization: Token <token>`, static per environment.
 *
 * Two house styles to keep in mind when adding a capability here:
 *   1. Failure often arrives as HTTP **200** with the error in the body
 *      (`{"Success": false, ...}`). `res.ok` is not the answer.
 *   2. HTTP **403** is the AWS WAF rate block, not an auth failure, and
 *      it applies to our whole egress IP — hence
 *      DelhiveryRateLimitService, and the distinct error thrown below.
 *
 * This account has NO sandbox, so anything with a physical or billable
 * effect additionally passes DelhiveryWriteGuardService.
 */
@Injectable()
export class DelhiveryHttpService {
  private readonly logger = new Logger(DelhiveryHttpService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly credentials: CourierCredentialService,
    private readonly rateLimit: DelhiveryRateLimitService,
  ) {}

  /** STUB MODE when `courier.delhivery_api_base_url` is unset/empty. */
  async isStubMode(): Promise<boolean> {
    return (await this.rawBaseUrl()) === '';
  }

  /** The configured base URL. Throws if called in stub mode — callers
   *  must branch on `isStubMode()` first. */
  async getBaseUrl(): Promise<string> {
    const url = await this.rawBaseUrl();
    if (url === '') {
      throw new Error(
        'DelhiveryHttpService.getBaseUrl called in STUB MODE (courier.delhivery_api_base_url is empty)',
      );
    }
    return url;
  }

  /** The credential environment for the current runtime. */
  environment(): CredentialEnvironment {
    return this.env.isProduction ? CredentialEnvironment.PRODUCTION : CredentialEnvironment.SANDBOX;
  }

  /**
   * Auth headers for a real Delhivery call. Resolves the API token via
   * CourierCredentialService (CUR-1 — decrypt-with-audit, never logged).
   *
   * CONFIRMED against the developer portal (2026-07-27): every B2C
   * endpoint takes `Authorization: Token <token>`, and no other header
   * is required. The token is static and never expires. See
   * docs/delhivery-integration.md §1.
   */
  async authHeaders(
    environment: CredentialEnvironment = this.environment(),
  ): Promise<Record<string, string>> {
    const creds = await this.credentials.getCredential(COURIER_CODE, environment);
    const token = creds[TOKEN_FIELD];
    if (token === undefined || token === '') {
      throw new Error(`Delhivery credential is missing the '${TOKEN_FIELD}' field`);
    }
    return {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Raw request helper for real mode.
   *
   * Built against the public Delhivery API documentation
   * (https://track.delhivery.com/api/ — last reviewed at the time of
   * commit). Endpoint paths + request envelopes are encoded in each
   * capability service; this helper handles the transport: base URL
   * resolution, auth headers, body encoding, status mapping.
   *
   * Delhivery's older "Create / Edit" endpoints take a peculiar
   * `format=json&data=<urlencoded-json>` body via
   * `application/x-www-form-urlencoded` (NOT a JSON POST). The capability
   * services choose the encoding per endpoint via `opts.encoding`.
   * GET endpoints are vanilla query-string.
   *
   * Until the sandbox round-trips a real request, this code is
   * "documented best-effort" — flip a single setting
   * (`courier.delhivery_api_base_url`) to enable, then validate with a
   * smoke. Any wire mismatch surfaces as a normal HTTP error with the
   * raw body in the log.
   */
  async request<T>(opts: DelhiveryRequestOptions): Promise<T> {
    // Client-side budget FIRST: cheaper than earning a WAF 403, which
    // blocks our whole egress IP and would take live traffic with it.
    await this.rateLimit.consume(opts.endpoint);
    const baseUrl = await this.getBaseUrl();
    const headers = await this.authHeaders(opts.environment ?? this.environment());
    const url = `${baseUrl.replace(/\/$/, '')}${opts.path}`;

    let body: string | undefined;
    let finalHeaders: Record<string, string> = { ...headers };

    if (opts.method === 'POST' || opts.method === 'PUT') {
      if (opts.encoding === 'form-data-key') {
        // Delhivery legacy: POST with content-type
        // application/x-www-form-urlencoded and a single `data=` key
        // whose value is JSON.stringify(...) of the payload. Some
        // endpoints additionally want `format=json`.
        const payloadJson = JSON.stringify(opts.body ?? {});
        const params = new URLSearchParams();
        params.set('format', 'json');
        params.set('data', payloadJson);
        body = params.toString();
        finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        body = JSON.stringify(opts.body ?? {});
        finalHeaders['Content-Type'] = 'application/json';
      }
    }

    const res = await fetch(url, {
      method: opts.method,
      headers: finalHeaders,
      ...(body !== undefined ? { body } : {}),
      // Caller can override; default 25s matches the saga's budget.
      signal: AbortSignal.timeout(opts.timeoutMs ?? 25_000),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text === '' ? null : JSON.parse(text);
    } catch {
      parsed = text;
    }

    if (!res.ok) {
      // Strip the auth header from the log; never log token plaintext.
      this.logger.warn(
        {
          status: res.status,
          path: opts.path,
          method: opts.method,
          body: typeof parsed === 'string' ? parsed.slice(0, 500) : parsed,
        },
        'Delhivery non-2xx response',
      );
      // 403 from Delhivery is the AWS WAF rate block, NOT an auth
      // failure (auth failures come back as 401 / "Unauthorized
      // client"). It blocks our entire egress IP, so it must be
      // recognisable to callers as "back off", not "this shipment is
      // broken" — the docs say wait ~30s for the WAF to re-evaluate.
      if (res.status === 403) {
        const waf = new Error(
          `Delhivery ${opts.method} ${opts.path} → 403 (WAF rate block); back off ~30s`,
        );
        waf.name = 'DelhiveryWafBlockError';
        (waf as Error & { status?: number; retryAfterSeconds?: number }).status = 403;
        (waf as Error & { status?: number; retryAfterSeconds?: number }).retryAfterSeconds = 30;
        throw waf;
      }
      const e = new Error(`Delhivery ${opts.method} ${opts.path} → HTTP ${res.status}`);
      (e as Error & { status?: number; body?: unknown }).status = res.status;
      (e as Error & { status?: number; body?: unknown }).body = parsed;
      throw e;
    }

    return parsed as T;
  }

  private async rawBaseUrl(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: BASE_URL_SETTING },
      select: { valueString: true },
    });
    return (row?.valueString ?? '').trim();
  }

  /**
   * The configured dispatch-origin pincode, or `''` when unset.
   *
   * Lives here rather than in a caller because it is Delhivery account
   * configuration, sitting beside the base URL it is always read with.
   * `courier-ops` resolves the same key for a shipment's lane; this is
   * the account-level default for callers that have no shipment.
   */
  async originPincode(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: ORIGIN_PIN_SETTING },
      select: { valueString: true },
    });
    return (row?.valueString ?? '').trim();
  }
}
