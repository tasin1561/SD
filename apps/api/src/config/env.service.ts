import { Injectable } from '@nestjs/common';
import type { Env } from './env.schema';

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

  // Module 18 — ChatWoot live chat. Stub mode when token is empty OR
  // the chat.chatwoot_base_url system setting is empty.
  get chatwootApiToken(): string {
    return this.env.CHATWOOT_API_TOKEN;
  }
  get chatwootHmacSecret(): string {
    return this.env.CHATWOOT_HMAC_SECRET;
  }

  get sellerAppUrl(): string {
    return this.env.SELLER_APP_URL;
  }

  get adminAppUrl(): string {
    return this.env.ADMIN_APP_URL;
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

  get csvPresignTtlSeconds(): number {
    return this.env.CSV_PRESIGN_TTL_SECONDS;
  }

  get corsOrigins(): string[] {
    return [this.env.SELLER_APP_URL, this.env.ADMIN_APP_URL];
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
      default:
        return '';
    }
  }
}
