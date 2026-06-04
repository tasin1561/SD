import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { EmailModule } from '../email/email.module';
import { SellerAuthModule } from '../seller-auth/seller-auth.module';
import { SellerTeamController } from './seller-team.controller';
import { SellerTeamPublicController } from './seller-team-public.controller';
import { SellerTeamService } from './services/seller-team.service';

@Module({
  imports: [AuthCommonModule, EmailModule, SellerAuthModule],
  controllers: [SellerTeamController, SellerTeamPublicController],
  providers: [SellerTeamService, SellerJwtGuard],
})
export class SellerTeamModule {}
