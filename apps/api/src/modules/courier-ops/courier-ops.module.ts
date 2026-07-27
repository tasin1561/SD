import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminCourierOpsController } from './controllers/admin-courier-ops.controller';
import { CourierShipmentActionService } from './services/courier-shipment-action.service';
import { CourierShipmentInsightService } from './services/courier-shipment-insight.service';
import { ShipmentCourierContextService } from './services/shipment-courier-context.service';

/**
 * courier-ops — the orchestration layer over the Delhivery adapter.
 *
 * The adapter (`courier-delhivery`) knows the wire and nothing about our
 * domain: it takes pincodes and grams. This module knows the domain and
 * nothing about the wire: it turns a shipment id into those inputs,
 * decides who is allowed to act, and writes the audit trail. Keeping the
 * two apart is what lets the adapter be tested against the contract
 * alone, and it is why eleven capability services could be built and
 * verified before anything consumed them.
 *
 * A LEAF module: nothing imports it, it exports nothing. Same shape as
 * `courier-dispatch` and `courier-manual-placement`.
 *
 * NOT here, on purpose: pickups (raised per WAREHOUSE per day, not per
 * shipment — a different grain with its own idempotency record) and
 * warehouse registration (an account-setup act, not a parcel one).
 */
@Module({
  imports: [AuthCommonModule, CourierDelhiveryModule],
  controllers: [AdminCourierOpsController],
  providers: [
    ShipmentCourierContextService,
    CourierShipmentInsightService,
    CourierShipmentActionService,
    StaffJwtGuard,
  ],
})
export class CourierOpsModule {}
