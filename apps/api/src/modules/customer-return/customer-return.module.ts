import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { OrderModule } from '../order/order.module';
import { AdminCustomerReturnController } from './controllers/admin-customer-return.controller';
import { SellerCustomerReturnController } from './controllers/seller-customer-return.controller';
import { CustomerReturnService } from './services/customer-return.service';

/**
 * Customer-initiated returns — a LEAF module.
 *
 * It owns the REQUEST and nothing else: the goods come home along the
 * existing RTO path and are received by `RtoReceiptService`, and the
 * money is taken there too. Keeping the receipt in one place is the
 * point — two ways to take goods back in would mean the rarer one rots.
 */
@Module({
  imports: [AuthCommonModule, OrderModule],
  controllers: [SellerCustomerReturnController, AdminCustomerReturnController],
  providers: [CustomerReturnService],
})
export class CustomerReturnModule {}
