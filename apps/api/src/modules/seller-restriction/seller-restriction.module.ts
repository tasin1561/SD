import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SellerWalletModule } from '../seller-wallet/seller-wallet.module';
import { AdminSellerRestrictionController } from './controllers/admin-seller-restriction.controller';
import { SellerRestrictionController } from './controllers/seller-restriction.controller';
import { SellerRestrictionService } from './services/seller-restriction.service';

/**
 * The R3 shared-primitive shape: a restriction is consulted by orders,
 * consignments, withdrawals, dispatch and RTO, and depends on none of
 * them. Wiring it into any one domain would make every other domain
 * import that domain to ask a question about a seller.
 */
@Module({
  imports: [AuthCommonModule, SellerWalletModule],
  controllers: [AdminSellerRestrictionController, SellerRestrictionController],
  providers: [SellerRestrictionService],
  exports: [SellerRestrictionService],
})
export class SellerRestrictionModule {}
