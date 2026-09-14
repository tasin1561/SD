import { Module } from '@nestjs/common';
import { StoreJwtGuard } from '../../common/guards/store-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { EmailModule } from '../email/email.module';
import { StoreAuthController } from './store-auth.controller';
import { StoreAuthService } from './store-auth.service';

/**
 * RS-2 — the reseller store identity: sign-in, sessions, password reset,
 * email verification and invitation acceptance.
 *
 * A LEAF: nothing imports it. Inviting somebody (as opposed to accepting)
 * lives in `reseller-store`, which writes the invitation row this module
 * later spends — the two meet only at the table, so neither imports the
 * other.
 */
@Module({
  imports: [AuthCommonModule, EmailModule],
  controllers: [StoreAuthController],
  providers: [StoreAuthService, StoreJwtGuard],
})
export class StoreAuthModule {}
