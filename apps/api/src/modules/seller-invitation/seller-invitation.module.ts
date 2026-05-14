import { Module } from '@nestjs/common';
import { SellerInvitationAdminController } from './seller-invitation.controller';
import { SellerInvitationService } from './seller-invitation.service';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [EmailModule],
  controllers: [SellerInvitationAdminController],
  providers: [SellerInvitationService, StaffJwtGuard],
})
export class SellerInvitationModule {}
