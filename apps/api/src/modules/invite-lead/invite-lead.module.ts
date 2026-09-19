import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { EmailModule } from '../email/email.module';
import { NotificationAudienceModule } from '../notification-audience/notification-audience.module';
import { AdminInviteLeadController } from './controllers/admin-invite-lead.controller';
import { PublicInviteLeadController } from './controllers/public-invite-lead.controller';
import { InviteLeadService } from './services/invite-lead.service';

/**
 * Beta invite requests from the marketing site.
 *
 * A LEAF: exports nothing. Nothing in the product may read a lead — it
 * is a stranger's typed details, not a customer record, and keeping the
 * two apart is what makes an open endpoint safe to expose.
 */
@Module({
  // For the new-lead alert. EmailModule is the M1 substrate every
  // fire-once caller already uses.
  // The alert's inbox leg (NOTIF-14) alongside the mail substrate.
  imports: [EmailModule, NotificationAudienceModule],
  controllers: [PublicInviteLeadController, AdminInviteLeadController],
  providers: [InviteLeadService, StaffJwtGuard],
})
export class InviteLeadModule {}
