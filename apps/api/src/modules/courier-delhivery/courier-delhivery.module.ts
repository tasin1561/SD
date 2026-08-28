import { Module } from '@nestjs/common';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { DelhiveryHttpService } from './services/delhivery-http.service';
import { DelhiveryRateLimitService } from './services/delhivery-rate-limit.service';
import { DelhiverySupportAdapterService } from './services/delhivery-support-adapter.service';
import { DelhiveryTrackingSourceService } from './services/delhivery-tracking-source.service';
import { DelhiveryWriteGuardService } from './services/delhivery-write-guard.service';
import { DelhiveryAwbService } from './services/delhivery-awb.service';
import { DelhiveryLabelService } from './services/delhivery-label.service';
import { DelhiveryServiceabilityService } from './services/delhivery-serviceability.service';
import { DelhiveryTatService } from './services/delhivery-tat.service';
import { DelhiveryCostService } from './services/delhivery-cost.service';
import { DelhiveryWaybillPoolService } from './services/delhivery-waybill-pool.service';
import { DelhiveryWarehouseService } from './services/delhivery-warehouse.service';
import { DelhiveryShipmentEditService } from './services/delhivery-shipment-edit.service';
import { DelhiveryPickupService } from './services/delhivery-pickup.service';
import { DelhiveryNdrService } from './services/delhivery-ndr.service';
import { DelhiveryDocumentService } from './services/delhivery-document.service';
import { DelhiveryEwaybillService } from './services/delhivery-ewaybill.service';
import { DelhiveryMpsService } from './services/delhivery-mps.service';
import { DelhiveryRvpQcService } from './services/delhivery-rvp-qc.service';
import { DelhiveryMarginReconciliationService } from './services/delhivery-margin-reconciliation.service';
import { WaybillRefillQueue } from './queue/waybill-refill.queue';
import { WaybillRefillWorker } from './queue/waybill-refill.worker';
import { DelhiveryTrackingService } from './services/delhivery-tracking.service';
import { DelhiveryTrackingFetchService } from './services/delhivery-tracking-fetch.service';
import { AdminDelhiveryOpsController } from './controllers/admin-delhivery-ops.controller';

/**
 * Module 9 — courier-delhivery: the Delhivery adapter (CP1 complete).
 *   - DelhiveryHttpService — shared wire infrastructure (base-URL
 *     resolution, auth, stub-mode gating, raw request helper)
 *   - DelhiveryAwbService — generateAwb (stub-mode + real-mode seam)
 *   - DelhiveryLabelService — fetchLabel
 *   - DelhiveryServiceabilityService — checkServiceability (advisory)
 *   - DelhiveryTrackingService — normalizeScan (M10 commit 6)
 *   - DelhiveryRateLimitService — the documented per-endpoint WAF
 *     budgets (a 403 blocks our whole egress IP, so this is a
 *     production-safety control, not an optimisation)
 *   - DelhiveryWriteGuardService — Skydrop has NO Delhivery sandbox, so
 *     physical-world writes (manifest, pickup, cancel, NDR) are gated on
 *     an explicit, audited, default-OFF setting
 *
 * Together the four capability services realise the `DelhiveryClient`
 * adapter interface. Imports CourierSharedModule for
 * CourierCredentialService (CUR-1). Exports its services for
 * courier-awb / courier-dispatch / tracking-ingestion; those modules
 * mock these wholesale in tests — no real Delhivery network is ever
 * hit in the suite.
 */
@Module({
  imports: [CourierSharedModule, AuthCommonModule],
  controllers: [AdminDelhiveryOpsController],
  providers: [
    DelhiveryHttpService,
    DelhiveryRateLimitService,
    DelhiveryWriteGuardService,
    DelhiveryTrackingSourceService,
    DelhiverySupportAdapterService,
    DelhiveryAwbService,
    DelhiveryLabelService,
    DelhiveryServiceabilityService,
    DelhiveryTatService,
    DelhiveryCostService,
    DelhiveryWaybillPoolService,
    DelhiveryWarehouseService,
    DelhiveryShipmentEditService,
    DelhiveryPickupService,
    DelhiveryNdrService,
    DelhiveryDocumentService,
    DelhiveryEwaybillService,
    DelhiveryMpsService,
    DelhiveryRvpQcService,
    DelhiveryMarginReconciliationService,
    WaybillRefillQueue,
    WaybillRefillWorker,
    DelhiveryTrackingService,
    DelhiveryTrackingFetchService,
  ],
  exports: [
    DelhiveryHttpService,
    DelhiveryRateLimitService,
    DelhiveryWriteGuardService,
    DelhiveryTrackingSourceService,
    DelhiverySupportAdapterService,
    DelhiveryAwbService,
    DelhiveryLabelService,
    DelhiveryServiceabilityService,
    DelhiveryTatService,
    DelhiveryCostService,
    DelhiveryWaybillPoolService,
    DelhiveryWarehouseService,
    DelhiveryShipmentEditService,
    DelhiveryPickupService,
    DelhiveryNdrService,
    DelhiveryDocumentService,
    DelhiveryEwaybillService,
    DelhiveryMpsService,
    DelhiveryRvpQcService,
    DelhiveryMarginReconciliationService,
    DelhiveryTrackingService,
    DelhiveryTrackingFetchService,
  ],
})
export class CourierDelhiveryModule {}
