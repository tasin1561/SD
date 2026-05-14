import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { EnvService } from './config/env.service';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { HealthModule } from './modules/health/health.module';
import { AuthCommonModule } from './modules/auth-common/auth-common.module';
import { EmailModule } from './modules/email/email.module';
import { StaffAuthModule } from './modules/staff-auth/staff-auth.module';
import { SellerAuthModule } from './modules/seller-auth/seller-auth.module';
import { SellerInvitationModule } from './modules/seller-invitation/seller-invitation.module';
import { SellerApiKeyModule } from './modules/seller-api-key/seller-api-key.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { pinoConfig } from './common/pino/logger-config';
import { envSchema } from './config/env.schema';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) =>
        pinoConfig(
          envSchema.parse({
            NODE_ENV: env.nodeEnv,
            PORT: env.port,
            LOG_LEVEL: env.logLevel,
            DATABASE_URL: env.databaseUrl,
            REDIS_URL: env.redisUrl,
            JWT_SIGNING_KEY: env.jwtSigningKey,
            RESEND_API_KEY: env.resendApiKey,
            SELLER_APP_URL: env.sellerAppUrl,
            ADMIN_APP_URL: env.adminAppUrl,
            COOKIE_DOMAIN: env.cookieDomain,
          }),
        ),
    }),
    PrismaModule,
    RedisModule,
    AuthCommonModule,
    EmailModule,
    StaffAuthModule,
    SellerAuthModule,
    SellerInvitationModule,
    SellerApiKeyModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
