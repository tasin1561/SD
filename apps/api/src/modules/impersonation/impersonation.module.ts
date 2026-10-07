import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { AdminImpersonationController } from './controllers/admin-impersonation.controller';
import { ImpersonationOtpService } from './services/impersonation-otp.service';
import { ImpersonationService } from './services/impersonation.service';

/**
 * The support-session lifecycle, and nothing else.
 *
 * ── WHY `ImpersonationService` IS EXPORTED ──────────────────────────
 * The guards need it. A request arriving at the seller or reseller app
 * inside a support session has to be checked against the live session
 * row on every call, and `redeemHandoff` is the only door through which
 * such a session can be created at all. Exporting the service is what
 * keeps that single door: the alternative is a second place that knows
 * how to mint one.
 *
 * The OTP service is NOT exported. Nothing outside this module has any
 * business issuing or checking a staff member's second factor, and an
 * export would be an invitation to work around `verify`.
 *
 * ── WHY `EmailModule` IS THE ONLY IMPORT ────────────────────────────
 * Prisma, Redis and the audit log are global. The mail queue is not, and
 * the code has to be mailed — to the staff member, which is the one
 * detail of this feature most worth getting right.
 */
@Module({
  imports: [EmailModule],
  controllers: [AdminImpersonationController],
  providers: [ImpersonationService, ImpersonationOtpService],
  exports: [ImpersonationService],
})
export class ImpersonationModule {}
