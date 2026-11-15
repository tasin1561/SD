import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { ResellerOrderModule } from '../reseller-order/reseller-order.module';
import {
  AdminCourierWhatsappController,
  SellerCourierWhatsappController,
  StoreCourierWhatsappController,
} from './controllers/courier-whatsapp.controllers';
import { CourierWhatsappReadService } from './services/courier-whatsapp-read.service';
import { CourierWhatsappRequestService } from './services/courier-whatsapp-request.service';

/**
 * The courier's WhatsApp messages to the customer, as a READ for every
 * console plus a staff "refresh" that only enqueues. The browser work is
 * in `courier-portal` (a different process); this module has no
 * Playwright and never imports it.
 */
@Module({
  imports: [AuthCommonModule, ResellerOrderModule],
  controllers: [
    AdminCourierWhatsappController,
    SellerCourierWhatsappController,
    StoreCourierWhatsappController,
  ],
  providers: [CourierWhatsappReadService, CourierWhatsappRequestService],
  exports: [CourierWhatsappReadService],
})
export class CourierWhatsappModule {}
