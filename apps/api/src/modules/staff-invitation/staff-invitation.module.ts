import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { EmailModule } from '../email/email.module';
import { StaffAuthModule } from '../staff-auth/staff-auth.module';
import { AdminStaffController } from './admin-staff.controller';
import { StaffInvitationPublicController } from './staff-invitation-public.controller';
import { StaffInvitationService } from './services/staff-invitation.service';

/**
 * Phase 1B — admin staff invitations.
 *   /admin/staff/invitations  — SUPER_ADMIN list/create/resend/revoke
 *   /admin/staff/users        — SUPER_ADMIN list / role-change / deactivate
 *   /auth/staff/accept-invitation — public, used by the invitee page
 */
@Module({
  imports: [AuthCommonModule, StaffAuthModule, EmailModule],
  controllers: [AdminStaffController, StaffInvitationPublicController],
  providers: [StaffInvitationService, StaffJwtGuard],
})
export class StaffInvitationModule {}
