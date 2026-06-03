import { Module } from '@nestjs/common';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWebhookDeliveryModule } from '../seller-webhook-delivery/seller-webhook-delivery.module';
import { AdminWebhookDeliveriesController } from './admin-webhook-deliveries.controller';

@Module({
  imports: [AuthCommonModule, SellerWebhookDeliveryModule],
  controllers: [AdminWebhookDeliveriesController],
  providers: [StaffJwtGuard],
})
export class AdminWebhookDeliveriesModule {}
