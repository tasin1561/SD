import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWebhookController } from './seller-webhook.controller';
import { SellerWebhookService } from './services/seller-webhook.service';

/**
 * Seller outbound webhook endpoint CONFIGURATION — create, edit,
 * enable, rotate the secret, delete. The sending half lives in
 * `SellerWebhookDeliveryModule` and is live; this module is only the
 * register it reads.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [SellerWebhookController],
  providers: [SellerWebhookService, SellerJwtGuard],
})
export class SellerWebhookModule {}
