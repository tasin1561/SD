import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { SellerAccountStatusService } from './services/seller-account-status.service';

/**
 * Owns mutations on seller account state that span multiple side effects
 * (status changes, token revocation, audit notes, transactional emails).
 *
 * Controllers (admin or automated compliance) inject the service from
 * this module rather than mutating sellers.status directly.
 */
@Module({
  imports: [EmailModule],
  providers: [SellerAccountStatusService],
  exports: [SellerAccountStatusService],
})
export class SellerManagementModule {}
