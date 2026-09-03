import { Module } from '@nestjs/common';
import { ShipmentProvisionModule } from '../shipment-provision/shipment-provision.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { CourierShiprocketModule } from '../courier-shiprocket/courier-shiprocket.module';
import { LifecycleEventsModule } from '../lifecycle-events/lifecycle-events.module';
import { OrderModule } from '../order/order.module';
import { SellerWalletAccrualModule } from '../seller-wallet-accrual/seller-wallet-accrual.module';
import { AwbSupersedeService } from './services/awb-supersede.service';
import { AwbGenerationService } from './services/awb-generation.service';
import { CourierAwbDispatchService } from './services/courier-awb-dispatch.service';
import { AwbGenerationJobService } from './services/awb-generation-job.service';
import { AwbGenerationQueue } from './queue/awb-generation.queue';
import { AwbGenerationWorker } from './queue/awb-generation.worker';
import { OrderConfirmedAwbListener } from './services/order-confirmed-awb-listener.service';
import { CourierDispatchModule } from '../courier-dispatch/courier-dispatch.module';

/**
 * Module 9 — courier-awb: the AWB generation saga (CP2).
 *   - AwbSupersedeService — auto-supersede chain (CUR-7)
 *   - AwbGenerationService — per-shipment generate + label→Spaces (CUR-6/9)
 *   - AwbGenerationJobService — per-manifest orchestration, per-shipment
 *     failure isolation (CUR-2); public — also the manual ops trigger
 *   - AwbGenerationQueue / AwbGenerationWorker — the per-manifest BullMQ
 *     job (data-driven retry from courier.awb_job_retry_*)
 *
 * Imports ShipmentProvisionModule (ShipmentNumberingService for the
 * supersede replacement), CourierDelhiveryModule (the mockable adapter),
 * OrderModule (OrderWriteService — route a failed shipment's order to
 * PENDING_MANUAL_PLACEMENT). RedisService is global.
 *
 * Exports AwbGenerationJobService + AwbGenerationQueue for commit 10
 * (manifest CLOSED → enqueue).
 */
@Module({
  imports: [
    // The last hop: once every parcel on a manifest has a waybill,
    // the handoff is automatic (2026-09-03). No cycle — courier-dispatch
    // does not import courier-awb.
    CourierDispatchModule,
    ShipmentProvisionModule,
    CourierDelhiveryModule,
    // Both adapters, because the dispatcher below is the one place that
    // knows which of them a given parcel goes to.
    CourierShiprocketModule,
    CourierSharedModule,
    OrderModule,
    SellerWalletAccrualModule,
    // The R3 dep-free bus. The order module publishes to it; this
    // module subscribes, which is what lets the AWB be generated at
    // confirmation without closing an order ↔ courier-awb cycle.
    LifecycleEventsModule,
  ],
  providers: [
    CourierAwbDispatchService,
    AwbSupersedeService,
    AwbGenerationService,
    AwbGenerationJobService,
    AwbGenerationQueue,
    AwbGenerationWorker,
    OrderConfirmedAwbListener,
  ],
  exports: [
    // The one place a courier is reached for a booking (CUR-12).
    // `customer-return` books the reverse leg through it rather than
    // reaching for Delhivery directly.
    CourierAwbDispatchService,
    AwbSupersedeService,
    AwbGenerationService,
    AwbGenerationJobService,
    AwbGenerationQueue,
    // Exported for the e2e harness's between-test drain only.
    OrderConfirmedAwbListener,
  ],
})
export class CourierAwbModule {}
