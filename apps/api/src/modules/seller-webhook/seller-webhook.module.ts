import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWebhookController } from './seller-webhook.controller';
import { SellerWebhookService } from './services/seller-webhook.service';

/**
 * Seller outbound webhook endpoint configuration (Phase 1A scope —
 * config CRUD + secret rotation; actual delivery worker deferred to
 * Phase 1B). The schema rows + UI live now so sellers can configure
 * their integration target ahead of the worker landing.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [SellerWebhookController],
  providers: [SellerWebhookService, SellerJwtGuard],
})
export class SellerWebhookModule {}
