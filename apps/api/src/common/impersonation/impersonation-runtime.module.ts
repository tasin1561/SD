import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ImpersonationModule } from '../../modules/impersonation/impersonation.module';
import { ImpersonationAlsMiddleware } from './impersonation-als.middleware';
import { ImpersonationGuard } from './impersonation.guard';
import { ImpersonationBannerService } from './impersonation-banner';
import { ImpersonationSessionLoader } from './impersonation-session-loader.service';

/**
 * The per-request half of support impersonation: the ambient context and
 * the deny list.
 *
 * Named RUNTIME to keep it apart from `ImpersonationModule`, which is the
 * session LIFECYCLE — opening one, the OTP, reviewing and ending one.
 * This is what happens on every request afterwards, which is why it sits
 * in `common/` beside the guards it extends rather than next to the
 * endpoints that create a session.
 *
 * It imports that module rather than reimplementing any of it: the
 * session service owns `loadUsableSession`, `redeemHandoff` and
 * `noteRequest`, and those are the only doors. Nothing here decides
 * whether a session is alive, only what a live one may do.
 *
 * `ImpersonationAlsMiddleware` is NOT applied here. Middleware is applied
 * by whichever module owns the routes it wraps, and this one has to wrap
 * ALL of them — so `AppModule.configure` applies it, next to the
 * request-id middleware, where somebody reading the application's entry
 * point can see that it is there.
 */
@Module({
  imports: [ImpersonationModule],
  providers: [
    ImpersonationSessionLoader,
    ImpersonationAlsMiddleware,
    ImpersonationBannerService,
    { provide: APP_GUARD, useClass: ImpersonationGuard },
  ],
  exports: [
    ImpersonationAlsMiddleware,
    ImpersonationSessionLoader,
    // `/auth/{seller,store}/me` asks this on every authed page, which is
    // what puts the bar on every page rather than only on arrival.
    ImpersonationBannerService,
    ImpersonationModule,
  ],
})
export class ImpersonationRuntimeModule {}
