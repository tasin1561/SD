import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { StaffJwtGuard } from '../../common/guards/staff-jwt.guard';
import { AdminCourierOpsController } from './controllers/admin-courier-ops.controller';
import { AdminCourierNetworkController } from './controllers/admin-courier-network.controller';
import { AdminPickupController } from './controllers/admin-pickup.controller';
import { CourierMarginReportService } from './services/courier-margin-report.service';
import { CourierPickupService } from './services/courier-pickup.service';
import { CourierWarehouseRegistrationService } from './services/courier-warehouse-registration.service';
import { CourierShiprocketModule } from '../courier-shiprocket/courier-shiprocket.module';
import { CourierNdrDispatchService } from './services/courier-ndr-dispatch.service';
import { CourierOpsDispatchService } from './services/courier-ops-dispatch.service';
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
 * Nearly a LEAF module: its controllers are the only callers of most of
 * it, and the ONE thing it exports is the NDR dispatcher, which the
 * nightly runner shares so a batch re-attempt and an operator's click
 * reach the courier by the same path.
 *
 * Three controllers because there are three grains: per-SHIPMENT
 * actions; per-WAREHOUSE-per-DAY pickups (a van, not a parcel, with its
 * own idempotency record); and per-ACCOUNT things you do once or
 * periodically — registering a pickup location, reading real margin.
 */
@Module({
  imports: [CourierShiprocketModule, AuthCommonModule, CourierDelhiveryModule],
  controllers: [AdminCourierOpsController, AdminPickupController, AdminCourierNetworkController],
  providers: [
    ShipmentCourierContextService,
    CourierShipmentInsightService,
    CourierNdrDispatchService,
    CourierOpsDispatchService,
    CourierShipmentActionService,
    CourierPickupService,
    CourierMarginReportService,
    CourierWarehouseRegistrationService,
    StaffJwtGuard,
  ],
  // The ONE export, and it is deliberate. `delivery-action` turns a
  // seller's request into a courier call, and the call already lives
  // here — re-implementing it there would give two modules a way to
  // dispatch a van. Direction stays one-way: delivery-action imports
  // this, never the reverse.
  // The NDR dispatcher is exported because the nightly runner needs the
  // SAME routing an operator's click goes through — a batch that reached
  // couriers differently from a manual re-attempt would be two
  // behaviours wearing one name.
  exports: [CourierShipmentActionService, CourierNdrDispatchService],
})
export class CourierOpsModule {}
