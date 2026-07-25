import { Module } from '@nestjs/common';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { DelhiveryHttpService } from './services/delhivery-http.service';
import { DelhiveryAwbService } from './services/delhivery-awb.service';
import { DelhiveryLabelService } from './services/delhivery-label.service';
import { DelhiveryServiceabilityService } from './services/delhivery-serviceability.service';
import { DelhiveryTrackingService } from './services/delhivery-tracking.service';
import { DelhiveryTrackingFetchService } from './services/delhivery-tracking-fetch.service';

/**
 * Module 9 — courier-delhivery: the Delhivery adapter (CP1 complete).
 *   - DelhiveryHttpService — shared wire infrastructure (base-URL
 *     resolution, auth, stub-mode gating, raw request helper)
 *   - DelhiveryAwbService — generateAwb (stub-mode + real-mode seam)
 *   - DelhiveryLabelService — fetchLabel
 *   - DelhiveryServiceabilityService — checkServiceability (advisory)
 *   - DelhiveryTrackingService — normalizeScan (M10 commit 6)
 *
 * Together the four capability services realise the `DelhiveryClient`
 * adapter interface. Imports CourierSharedModule for
 * CourierCredentialService (CUR-1). Exports its services for
 * courier-awb / courier-dispatch / tracking-ingestion; those modules
 * mock these wholesale in tests — no real Delhivery network is ever
 * hit in the suite.
 */
@Module({
  imports: [CourierSharedModule],
  providers: [
    DelhiveryHttpService,
    DelhiveryAwbService,
    DelhiveryLabelService,
    DelhiveryServiceabilityService,
    DelhiveryTrackingService,
    DelhiveryTrackingFetchService,
  ],
  exports: [
    DelhiveryHttpService,
    DelhiveryAwbService,
    DelhiveryLabelService,
    DelhiveryServiceabilityService,
    DelhiveryTrackingService,
    DelhiveryTrackingFetchService,
  ],
})
export class CourierDelhiveryModule {}
