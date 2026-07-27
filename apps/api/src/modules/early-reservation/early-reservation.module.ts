import { Module } from '@nestjs/common';
import { SellerJwtGuard } from '../../common/guards/seller-jwt.guard';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { InventoryStockModule } from '../inventory-stock/inventory-stock.module';
import { SettingsModule } from '../settings/settings.module';
import { SellerEarlyReservationController } from './controllers/seller-early-reservation.controller';
import { AdminEarlyReservationController } from './controllers/admin-early-reservation.controller';
import { EarlyReservationReviewService } from './services/early-reservation-review.service';
import { EarlyReservationService } from './services/early-reservation.service';

/**
 * R5 — two-stage ("virtual") inventory booking.
 *
 * Depends only on inventory-stock + settings, NOT on `order` or
 * `call-center`, even though both call into it. Callers marshal what this
 * needs as a DTO (the R3 snapshot-DTO discipline), which is what keeps
 * `order → early-reservation` and `call-center → early-reservation` from
 * becoming cycles.
 */
@Module({
  imports: [AuthCommonModule, InventoryStockModule, SettingsModule],
  controllers: [SellerEarlyReservationController, AdminEarlyReservationController],
  providers: [
    EarlyReservationService,
    EarlyReservationReviewService,
    SellerJwtGuard,
    StaffJwtGuard,
  ],
  exports: [EarlyReservationService, EarlyReservationReviewService],
})
export class EarlyReservationModule {}
