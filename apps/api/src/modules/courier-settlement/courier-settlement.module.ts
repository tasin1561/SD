import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { CourierSettlementService } from './services/courier-settlement.service';
import { AdminCourierSettlementController } from './controllers/admin-courier-settlement.controller';

/**
 * R2c — the courier settlement ledger: what the courier paid US, matched
 * to the orders it covers.
 *
 * A LEAF module with no cross-domain dependencies: it reads orders and
 * courier accounts directly because it is a FINANCE view over them, not an
 * operational writer — it never transitions an order, moves stock, or
 * touches a wallet. That last part is deliberate: a short-payment from the
 * courier is a dispute to raise with the courier, not something to silently
 * claw back from a seller who was paid in good faith.
 */
@Module({
  imports: [AuthCommonModule],
  controllers: [AdminCourierSettlementController],
  providers: [CourierSettlementService, StaffJwtGuard],
  exports: [CourierSettlementService],
})
export class CourierSettlementModule {}
