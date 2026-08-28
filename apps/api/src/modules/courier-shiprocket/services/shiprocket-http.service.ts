import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { CourierCredentialService } from '../../courier-shared/services/courier-credential.service';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';
import { SHIPROCKET_BASE_URL, type ShiprocketLoginResponse } from '../types/shiprocket.types';

/**
 * What we actually pass to `fetch`.
 *
 * Spelled out rather than reaching for the DOM's `RequestInit`, which is
 * not in this app's lib — `fetch` and `Response` come from Node's own
 * types and that one does not. Naming the four fields we use is clearer
 * than a global that happens to be missing anyway.
 */
interface FetchInit {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly signal?: AbortSignal;
  readonly redirect?: 'error';
}

export interface ShiprocketRequestOptions {
  readonly method: 'GET' | 'POST' | 'PATCH';
  readonly path: string;
  readonly query?: Record<string, string | number | boolean | undefined>;
  readonly body?: unknown;
  readonly actor: CourierCredentialActor;
  readonly courierAccountId: string;
}

/**
 * Talking to Shiprocket.
 *
 * ── STUB MODE IS THE DEFAULT, AND WILL BE UNTIL AN ACCOUNT EXISTS ────
 * Driven by `courier.shiprocket_api_base_url` being empty, exactly as
 * Delhivery's is. Every capability checks it first. No account is
 * provisioned, so today this is the only mode that runs — and that is
 * the honest state to ship in rather than pointing real code at
 * credentials nobody has.
 *
 * ── THE TOKEN EXPIRES, WHICH DELHIVERY'S DOES NOT ───────────────────
 * Delhivery's is static per environment and lives in an env var.
 * Shiprocket's is minted from an email and password and lasts about ten
 * days, so it has to be acquired, cached and renewed. Logging in per
 * request would be slow and a reliable way to get rate-limited on the
 * auth endpoint specifically.
 *
 * Cached in Redis, keyed PER COURIER ACCOUNT — multiple Shiprocket
 * accounts is the stated plan (R1/CACC-1), and one shared token would
 * quietly ship every seller's parcel on whichever account logged in
 * last. Cached for nine days against a ten-day life: renewing a day
 * early costs one extra login, and being wrong the other way costs
 * every request until somebody notices.
 *
 * A 401 clears the cached token and retries ONCE. Their token can be
 * invalidated server-side (a password change, an explicit logout), and
 * a cache that cannot recover from that would need a deploy to fix.
 */
@Injectable()
export class ShiprocketHttpService {
  private readonly logger = new Logger(ShiprocketHttpService.name);

  /** Nine days against their ten. */
  private static readonly TOKEN_TTL_SECONDS = 9 * 24 * 60 * 60;
  private static readonly TIMEOUT_MS = 20_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly credentials: CourierCredentialService,
  ) {}

  async isStubMode(): Promise<boolean> {
    return (await this.rawBaseUrl()) === '';
  }

  private async rawBaseUrl(): Promise<string> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: 'courier.shiprocket_api_base_url' },
      select: { valueString: true },
    });
    return (row?.valueString ?? '').trim();
  }

  private tokenKey(courierAccountId: string): string {
    return `skydrop:shiprocket:token:${courierAccountId}`;
  }

  /**
   * A bearer token for this account, from cache or by logging in.
   *
   * The credentials are decrypted through `CourierCredentialService`,
   * which writes an audit row before handing back plaintext (CUR-1) —
   * so a login is attributable to whatever triggered it, and the
   * password never reaches a log or a response.
   */
  private async token(courierAccountId: string, actor: CourierCredentialActor): Promise<string> {
    const key = this.tokenKey(courierAccountId);
    try {
      const cached = await this.redis.client.get(key);
      if (cached !== null && cached !== '') return cached;
    } catch (err) {
      // A cache that will not read means logging in again, not failing.
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Shiprocket token cache unreadable; logging in',
      );
    }

    const creds = await this.credentials.getCredentialForAccount(courierAccountId, actor);
    const email = creds['email'];
    const password = creds['password'];
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw new Error(
        'Shiprocket credentials must carry `email` and `password`; this account has neither',
      );
    }

    const base = await this.rawBaseUrl();
    const res = await this.fetchJson<ShiprocketLoginResponse>(
      `${base || SHIPROCKET_BASE_URL}/v1/external/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      },
    );
    if (typeof res.token !== 'string' || res.token === '') {
      throw new Error('Shiprocket accepted the login but returned no token');
    }

    try {
      await this.redis.client.set(key, res.token, 'EX', ShiprocketHttpService.TOKEN_TTL_SECONDS);
    } catch {
      // Not caching it costs a login next time. Not worth failing over.
    }
    return res.token;
  }

  /** Drop the cached token so the next call logs in again. */
  private async forgetToken(courierAccountId: string): Promise<void> {
    try {
      await this.redis.client.del(this.tokenKey(courierAccountId));
    } catch {
      // Nothing to do; the TTL will see to it.
    }
  }

  async request<T>(opts: ShiprocketRequestOptions): Promise<T> {
    const base = await this.rawBaseUrl();
    if (base === '') {
      throw new Error(
        'Shiprocket is in stub mode — set courier.shiprocket_api_base_url once an account exists',
      );
    }

    const url = new URL(`${base}${opts.path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const send = async (token: string): Promise<Response> =>
      this.fetchRaw(url.toString(), {
        method: opts.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
      });

    let token = await this.token(opts.courierAccountId, opts.actor);
    let res = await send(token);

    if (res.status === 401) {
      // Their token can be invalidated server-side — a password change,
      // an explicit logout. Retried ONCE with a fresh one; a cache that
      // could not recover from that would need a deploy to fix.
      this.logger.warn(
        { courierAccountId: opts.courierAccountId },
        'Shiprocket rejected the token; logging in again',
      );
      await this.forgetToken(opts.courierAccountId);
      token = await this.token(opts.courierAccountId, opts.actor);
      res = await send(token);
    }

    const text = await res.text();
    if (!res.ok) {
      // Their message, verbatim. Paraphrasing a courier's refusal is how
      // an operator ends up debugging our wording instead of their rule.
      throw new Error(
        `Shiprocket ${opts.method} ${opts.path} failed (${res.status}): ${text.slice(0, 400)}`,
      );
    }
    return (text === '' ? {} : JSON.parse(text)) as T;
  }

  private async fetchJson<T>(url: string, init: FetchInit): Promise<T> {
    const res = await this.fetchRaw(url, init);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Shiprocket login failed (${res.status}): ${text.slice(0, 300)}`);
    }
    return (text === '' ? {} : JSON.parse(text)) as T;
  }

  private async fetchRaw(url: string, init: FetchInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ShiprocketHttpService.TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
        // A courier that answers with a redirect is not a courier we
        // follow — the same discipline the SSRF guard applies to
        // seller-supplied URLs.
        redirect: 'error',
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
