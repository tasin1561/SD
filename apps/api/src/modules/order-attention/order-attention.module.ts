import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { NotificationLedgerModule } from '../notification-ledger/notification-ledger.module';
import { CourierAwbModule } from '../courier-awb/courier-awb.module';
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
  // The LEDGER only — not the notifications module. NOTIF-5 keeps the
  // ORDER module unaware of notifications and it still is; this is a
  // leaf that raises the NSA flag and knows perfectly well it wants to
  // tell somebody. Nothing in the ledger imports back, so there is no
  // cycle for the lifecycle bus to break.
  // CourierAwbModule for the AWB job service: the stalled-waybill check
  // ASKS AGAIN before it raises, and `processOrder` is the documented
  // manual re-trigger. Nothing in courier-awb imports back, so this
  // stays a leaf.
  imports: [AuthCommonModule, NotificationLedgerModule, CourierAwbModule],
  controllers: [AdminNsaController, SellerNsaController],
  providers: [OrderAttentionService, NsaSweepWorker, StaffJwtGuard, SellerJwtGuard],
})
export class OrderAttentionModule {}
