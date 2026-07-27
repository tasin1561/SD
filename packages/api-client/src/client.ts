/**
 * The typed Skydrop API client. Same-origin /api/* fetch wrapper with
 * single-flight refresh-on-401. Identity-parameterized (FE-5):
 * `identityKind` tells the client which auth endpoints to hit; the
 * client itself doesn't know about admin/seller specifics.
 *
 * Crash-by-design points:
 *   - access token lives ONLY in the AccessTokenStore (in-memory, FE-1)
 *   - the client adds Authorization: Bearer when the store has a token;
 *     omits it otherwise (the SSR boot path doesn't have a token yet)
 *   - 401 response → single-flight refresh → retry the failed request
 *     EXACTLY ONCE; if the retry 401s again, surface the 401
 *   - the refresh call itself doesn't get the auth interceptor (would
 *     loop); it's a dedicated raw fetch
 *   - cookies (the __Host- refresh) are always sent (credentials:
 *     'include' → relative paths) so the proxy can forward them
 */
import { AccessTokenStore } from './auth/token-store';
import { SingleFlightRefresh, type RefreshOutcome } from './refresh/single-flight';
import type { AccessTokenResponse, LoginRequest, StaffMe, SellerMe } from './endpoints/auth';

export type IdentityKind = 'staff' | 'seller';

export interface ApiClientOptions {
  /** Same-origin base — usually empty string so all requests are
   *  relative `/api/...`. Override in tests / non-browser contexts. */
  readonly baseUrl?: string;
  readonly identityKind: IdentityKind;
  readonly tokenStore: AccessTokenStore;
  /** Override `fetch` for tests. Defaults to globalThis.fetch. */
  readonly fetchImpl?: typeof fetch;
}

export interface ApiRequestInit extends Omit<RequestInit, 'body' | 'method'> {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown; // serialized as JSON if present
  /** If true, suppress the on-401 silent-refresh-and-retry (used by
   *  the refresh call itself, and by /me when the caller wants to
   *  treat a 401 as "not logged in" rather than "try to refresh"). */
  readonly suppressRefresh?: boolean;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    public readonly body: unknown,
  ) {
    super(
      `API ${status}${code ? ` (${code})` : ''}: ${
        typeof body === 'object' && body !== null && 'message' in body
          ? String((body as { message: unknown }).message)
          : ''
      }`,
    );
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly identityKind: IdentityKind;
  private readonly tokenStore: AccessTokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly refresher: SingleFlightRefresh;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl ?? '';
    this.identityKind = opts.identityKind;
    this.tokenStore = opts.tokenStore;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.refresher = new SingleFlightRefresh(() => this.doRefresh());
  }

  // ───────── Auth endpoints ─────────

  async login(req: LoginRequest): Promise<AccessTokenResponse> {
    const res = await this.request<AccessTokenResponse>(`/api/auth/${this.identityKind}/login`, {
      method: 'POST',
      body: req,
      suppressRefresh: true,
    });
    this.tokenStore.set(res.accessToken, this.toEpoch(res.expiresAt));
    return res;
  }

  async logout(): Promise<void> {
    try {
      await this.request<void>(`/api/auth/${this.identityKind}/logout`, {
        method: 'POST',
        suppressRefresh: true,
      });
    } finally {
      this.tokenStore.clear();
    }
  }

  /**
   * `/me` for the current identity. Caller decides whether to suppress
   * the on-401 refresh: server components pass `suppressRefresh: true`
   * (the only auth they have is the cookie, no token to refresh from);
   * client components leave it default so an expired access token gets
   * silently refreshed.
   */
  async meStaff(opts: { suppressRefresh?: boolean } = {}): Promise<StaffMe> {
    return this.request<StaffMe>('/api/auth/staff/me', {
      method: 'GET',
      ...(opts.suppressRefresh !== undefined ? { suppressRefresh: opts.suppressRefresh } : {}),
    });
  }

  async meSeller(opts: { suppressRefresh?: boolean } = {}): Promise<SellerMe> {
    return this.request<SellerMe>('/api/auth/seller/me', {
      method: 'GET',
      ...(opts.suppressRefresh !== undefined ? { suppressRefresh: opts.suppressRefresh } : {}),
    });
  }

  // ───────── Core fetch w/ interceptor ─────────

  /**
   * Typed request. JSON in, JSON out. Throws `ApiError` on non-2xx.
   * On 401 (unless `suppressRefresh`), runs single-flight refresh and
   * retries ONCE.
   */
  async request<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
    const first = await this.doFetch(path, init);
    if (first.status === 401 && !init.suppressRefresh) {
      const outcome = await this.refresher.run();
      if (outcome === 'OK') {
        const second = await this.doFetch(path, init);
        return this.handleResponse<T>(second);
      }
      // Refresh failed → surface the original 401 to the caller. The
      // app's React layer reacts (redirect to /login).
    }
    return this.handleResponse<T>(first);
  }

  private async doFetch(path: string, init: ApiRequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');

    const token = this.tokenStore.get().token;
    if (token !== null) headers.set('Authorization', `Bearer ${token}`);

    return this.fetchImpl(this.baseUrl + path, {
      method: init.method ?? 'GET',
      headers,
      credentials: 'include',
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      cache: 'no-store',
    });
  }

  private async handleResponse<T>(res: Response): Promise<T> {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const body: unknown = text.length > 0 ? safeParse(text) : null;
    if (!res.ok) {
      const code =
        typeof body === 'object' && body !== null && 'code' in body
          ? String((body as { code: unknown }).code)
          : undefined;
      throw new ApiError(res.status, code, body);
    }
    return body as T;
  }

  /**
   * The raw refresh call — does NOT go through `request()` (no
   * interceptor; the refresh response shouldn't trigger another
   * refresh on its own 401). Updates the token store on success;
   * clears it on failure.
   */
  private async doRefresh(): Promise<RefreshOutcome> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/api/auth/${this.identityKind}/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) {
        this.tokenStore.clear();
        return 'FAILED';
      }
      const body = (await res.json()) as AccessTokenResponse;
      this.tokenStore.set(body.accessToken, this.toEpoch(body.expiresAt));
      return 'OK';
    } catch {
      // Network error / abort → treat as failure; clear store so the
      // next request doesn't try to use a possibly-stale token.
      this.tokenStore.clear();
      return 'FAILED';
    }
  }

  private toEpoch(iso: string): number {
    return Date.parse(iso);
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
