import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { OrderModule } from '../order/order.module';
import { AdminCustomerReturnController } from './controllers/admin-customer-return.controller';
import { SellerCustomerReturnController } from './controllers/seller-customer-return.controller';
import { CustomerReturnService } from './services/customer-return.service';
import { ReversePickupBookingService } from './services/reverse-pickup-booking.service';
import { CourierAwbModule } from '../courier-awb/courier-awb.module';

/**
 * Customer-initiated returns — a LEAF module.
 *
 * It owns the REQUEST and nothing else: the goods come home along the
 * existing RTO path and are received by `RtoReceiptService`, and the
 * money is taken there too. Keeping the receipt in one place is the
 * point — two ways to take goods back in would mean the rarer one rots.
 */
@Module({
  imports: [
    // The dispatcher that books the collection (CUR-12).
    CourierAwbModule,
    AuthCommonModule,
    OrderModule,
  ],
  controllers: [SellerCustomerReturnController, AdminCustomerReturnController],
  providers: [ReversePickupBookingService, CustomerReturnService],
})
export class CustomerReturnModule {}
