import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { AdminNsaController } from './controllers/admin-nsa.controller';
import { SellerNsaController } from './controllers/seller-nsa.controller';
import { NsaSweepWorker } from './queue/nsa-sweep.worker';
import { OrderAttentionService } from './services/order-attention.service';

/**
 * NSA — Needs Seller Attention.
 *
 * A LEAF module: it exports nothing and nothing imports it. The flag is
 * raised by its own sweep from what the orders already say, and read by
 * its own two controllers — so it needs no seat at the order module's
 * table, and the order module never needs to know it exists.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [AdminNsaController, SellerNsaController],
  providers: [OrderAttentionService, NsaSweepWorker, StaffJwtGuard, SellerJwtGuard],
})
export class OrderAttentionModule {}
