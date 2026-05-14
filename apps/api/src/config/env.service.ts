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

  get sellerAppUrl(): string {
    return this.env.SELLER_APP_URL;
  }

  get adminAppUrl(): string {
    return this.env.ADMIN_APP_URL;
  }

  get supportEmail(): string {
    return this.env.SUPPORT_EMAIL;
  }

  get cookieDomain(): string | undefined {
    return this.env.COOKIE_DOMAIN;
  }

  get corsOrigins(): string[] {
    return [this.env.SELLER_APP_URL, this.env.ADMIN_APP_URL];
  }
}
