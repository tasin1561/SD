import { Injectable } from '@nestjs/common';
import type { Env } from './env.schema';

/**
 * The console hostnames in use before the 2026-10-13 rename, which STILL
 * SERVE rather than redirect.
 *
 * A `__Host-` cookie is bound to the exact origin that set it, so
 * redirecting `app.` to `client.` would carry no session and log out
 * every signed-in seller at the cutover. Both answer instead; the new
 * names are what the system generates links to.
 *
 * This list only ever shrinks. When a name stops seeing traffic it
 * becomes a redirect in Caddy and its entry comes out of here.
 */
const LEGACY_CONSOLE_ORIGINS = [
  'https://app.skydrop.global', // → client.skydrop.global
  'https://reseller.skydrop.global', // → member.skydrop.global
  'https://portal.skydrop.global', // → associate.skydrop.global
] as const;

@Injectable()
export class EnvService {
  constructor(private readonly env: Env) {}

  get nodeEnv(): Env['NODE_ENV'] {
    return this.env.NODE_ENV;
  }

  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  get isTest(): boolean {
    return this.env.NODE_ENV === 'test';
  }

  get port(): number {
    return this.env.PORT;
  }

  get bindHost(): string {
    return this.env.BIND_HOST;
  }

  /** Where all outbound mail is diverted, or '' for normal delivery. */
  get mailRedirectTo(): string {
    return this.env.MAIL_REDIRECT_TO;
  }

  /** True when this process owns the BullMQ workers + crons. */
  get workersEnabled(): boolean {
    return this.env.WORKERS_ENABLED;
  }

  get logLevel(): Env['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }

  get databaseUrl(): string {
    return this.env.DATABASE_URL;
  }

  get redisUrl(): string {
    return this.env.REDIS_URL;
  }

  get jwtSigningKey(): string {
    return this.env.JWT_SIGNING_KEY;
  }

  get resendApiKey(): string {
    return this.env.RESEND_API_KEY;
  }

  get hasResendApiKey(): boolean {
    return this.env.RESEND_API_KEY.length > 0;
  }

  // Amazon SES — the second email provider. Empty is a valid
  // configuration: SesService is inert and every message routes to
  // Resend. Read only by SesService, which decides liveness from all
  // three together.
  get awsSesRegion(): string {
    return this.env.AWS_SES_REGION;
  }
  get awsSesAccessKeyId(): string {
    return this.env.AWS_SES_ACCESS_KEY_ID;
  }
  get awsSesSecretAccessKey(): string {
    return this.env.AWS_SES_SECRET_ACCESS_KEY;
  }

  // Module 18 — ChatWoot live chat. Stub mode when token is empty OR
  // the chat.chatwoot_base_url system setting is empty.
  get chatwootApiToken(): string {
    return this.env.CHATWOOT_API_TOKEN;
  }
  get chatwootHmacSecret(): string {
    return this.env.CHATWOOT_HMAC_SECRET;
  }

  /*
    ── SOLUSTATION ADDRESS: NEW NAMES WIN, OLD NAMES STILL WORK ────────
    `SOLUSTATION_ADDRESS_KEY` / `_URL` are the source of truth as of
    2026-11-03. `SOLADDR_API_KEY` (and, for the URL, the
    `address_check.base_url` system setting read by the HTTP client)
    remain as a fallback for ONE release so that a droplet whose env has
    not been updated keeps checking addresses instead of silently going
    to stub mode — which looks exactly like a working deploy.

    `soladdrKeySource` exists so the boot log can say WHICH it used.
    Without that, a fallback is indistinguishable from a correct
    configuration until the fallback is removed and checks stop.
  */
  get soladdrApiKey(): string {
    const preferred = this.env.SOLUSTATION_ADDRESS_KEY.trim();
    return preferred !== '' ? preferred : this.env.SOLADDR_API_KEY;
  }
  get hasSoladdrApiKey(): boolean {
    return this.soladdrApiKey.trim() !== '';
  }
  /** Which variable supplied the key, or null when neither did. */
  get soladdrKeySource(): 'SOLUSTATION_ADDRESS_KEY' | 'SOLADDR_API_KEY' | null {
    if (this.env.SOLUSTATION_ADDRESS_KEY.trim() !== '') return 'SOLUSTATION_ADDRESS_KEY';
    if (this.env.SOLADDR_API_KEY.trim() !== '') return 'SOLADDR_API_KEY';
    return null;
  }
  /** Empty when env carries no URL — the client then falls back to the
   *  `address_check.base_url` setting. */
  get soladdrBaseUrl(): string {
    return this.env.SOLUSTATION_ADDRESS_URL.trim().replace(/\/+$/, '');
  }
  /**
   * The ONLY part of the key that may ever be printed.
   *
   * Eight characters is what Solustation itself stores beside the hash,
   * so it is the agreed-safe identifier for "which key is this" — and it
   * is enough to tell `sa_live_` from `sa_test_`, which is the mistake
   * worth catching.
   */
  get soladdrKeyPrefix(): string {
    return this.soladdrApiKey.trim().slice(0, 8);
  }
  /** A test key in production means every answer came from fake map
   *  providers while looking entirely normal. */
  get soladdrKeyIsTestInProduction(): boolean {
    return this.isProduction && this.soladdrKeyPrefix.startsWith('sa_test_');
  }

  get sellerAppUrl(): string {
    return this.env.SELLER_APP_URL;
  }

  get adminAppUrl(): string {
    return this.env.ADMIN_APP_URL;
  }

  /** RS-2 — the reseller store console (member.skydrop.global). */
  get resellerAppUrl(): string {
    return this.env.RESELLER_APP_URL;
  }

  /** ASSOC-1 — the associate console (associate.skydrop.global). */
  get associateAppUrl(): string {
    return this.env.ASSOCIATE_APP_URL;
  }

  get publicTrackingUrl(): string {
    return this.env.PUBLIC_TRACKING_URL;
  }

  get supportEmail(): string {
    return this.env.SUPPORT_EMAIL;
  }

  get cookieDomain(): string | undefined {
    return this.env.COOKIE_DOMAIN;
  }

  get devMockSpaces(): boolean {
    return this.env.DEV_MOCK_SPACES;
  }

  get spacesEndpoint(): string {
    return this.env.SPACES_ENDPOINT;
  }

  get spacesRegion(): string {
    return this.env.SPACES_REGION;
  }

  get spacesBucket(): string {
    return this.env.SPACES_BUCKET;
  }

  get spacesAccessKeyId(): string {
    return this.env.SPACES_ACCESS_KEY_ID;
  }

  get spacesSecretAccessKey(): string {
    return this.env.SPACES_SECRET_ACCESS_KEY;
  }

  get spacesCdnUrl(): string {
    return this.env.SPACES_CDN_URL;
  }

  get imageMaxSizeBytes(): number {
    return this.env.IMAGE_MAX_SIZE_BYTES;
  }

  get csvMaxRows(): number {
    return this.env.CSV_MAX_ROWS;
  }

  get csvMaxBytes(): number {
    return this.env.CSV_MAX_BYTES;
  }

  get csvPresignTtlSeconds(): number {
    return this.env.CSV_PRESIGN_TTL_SECONDS;
  }

  /**
   * Browser origins the API will answer directly.
   *
   * FE-3 means this is a backstop rather than the main path: a browser
   * talks only to its own origin and each console proxies `/api/*`
   * server-to-server, so an ordinary request arrives with no `Origin`
   * header at all. This list matters for anything that does reach the
   * API cross-origin, and for being able to say what is permitted.
   *
   * THE ASSOCIATE PORTAL WAS MISSING. It has been its own origin since
   * ASSOC-1 and was never added here — harmless so far precisely because
   * of the proxy, but a list that omits a live console is one that
   * answers the wrong question the first time somebody relies on it.
   *
   * BOTH THE OLD AND THE NEW HOSTNAMES ARE LISTED (2026-10-13). The
   * consoles moved to client. / member. / associate., and the old
   * app. / reseller. / portal. still serve the same apps rather than
   * redirecting — a `__Host-` cookie is bound to the exact origin that
   * set it, so a redirect would carry no session and would log out every
   * signed-in user at the cutover. Two live origins per console is the
   * price of that, until the old names go quiet and become redirects.
   *
   * The old ones are hard-coded rather than configured because they are
   * a fixed, finite, closing set — a legacy list that should shrink to
   * nothing, not a knob somebody can point anywhere.
   */
  get corsOrigins(): string[] {
    const current = [
      this.env.SELLER_APP_URL,
      this.env.ADMIN_APP_URL,
      this.env.RESELLER_APP_URL,
      this.env.ASSOCIATE_APP_URL,
    ];
    return [...new Set([...current, ...LEGACY_CONSOLE_ORIGINS])];
  }

  /**
   * Courier-credential AES-256-GCM key (hex) for a given key version
   * (CUR-1). The `courier_credentials` row records `encryptionKeyVersion`;
   * the decrypter passes it here. Returns `''` when the version's key is
   * not configured — the caller treats an empty key as "credentials
   * unavailable" (stub mode). The key is NEVER persisted to the DB.
   */
  courierCredentialsKey(version: number): string {
    switch (version) {
      case 1:
        return this.env.COURIER_CREDENTIALS_KEY_V1;
      default:
        return '';
    }
  }

  /**
   * Module 10 — tracking webhook HMAC secret resolved by env-var name
   * (CUR-1 discipline). The `tracking.webhook_secret_ref` system setting
   * stores the env-var NAME for a given courier; the secret value lives
   * here. Returns `''` for any unknown / unconfigured name — the
   * WebhookAuthService treats an empty secret as fail-closed (401) so
   * unauthenticated webhooks are NEVER stored (TRK-1).
   *
   * Phase 1A maps one courier — Delhivery. Add another case as each new
   * integrated courier lands; the dispatch table is intentionally
   * explicit (no `process.env` indirection) so env wiring stays auditable.
   */
  /**
   * Phase 1B #2 — AES-256-GCM key (hex) for `sellers.bank_account_number`
   * by version. Mirrors `courierCredentialsKey`. Returns '' when the
   * version's key is unconfigured — callers treat that as "encryption
   * disabled, store plaintext".
   */
  bankAccountsKey(version: number): string {
    switch (version) {
      case 1:
        return this.env.BANK_ACCOUNTS_KEY_V1;
      default:
        return '';
    }
  }

  trackingWebhookSecretByRef(envVarName: string): string {
    switch (envVarName) {
      case 'TRACKING_WEBHOOK_SECRET_DELHIVERY':
        return this.env.TRACKING_WEBHOOK_SECRET_DELHIVERY;
      case 'TRACKING_WEBHOOK_SECRET_SHIPROCKET':
        return this.env.TRACKING_WEBHOOK_SECRET_SHIPROCKET;
      default:
        return '';
    }
  }
}
