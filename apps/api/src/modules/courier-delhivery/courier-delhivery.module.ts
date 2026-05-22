import { Module } from '@nestjs/common';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { DelhiveryHttpService } from './services/delhivery-http.service';
import { DelhiveryAwbService } from './services/delhivery-awb.service';

/**
 * Module 9 — courier-delhivery: the Delhivery adapter. Grows
 * commit-by-commit:
 *   - commit 4 (this): DelhiveryHttpService — shared wire infrastructure
 *                      (base-URL resolution, auth, stub-mode gating,
 *                      raw request helper). TODO(delhivery-api) seams.
 *   - commit 5       : + DelhiveryAwbService (generateAwb)
 *   - commit 6       : + DelhiveryLabelService + DelhiveryServiceabilityService
 *
 * Imports CourierSharedModule for CourierCredentialService (CUR-1).
 * Exports its services for courier-awb / courier-dispatch consumption;
 * those modules mock these services wholesale in tests.
 */
@Module({
  imports: [CourierSharedModule],
  providers: [DelhiveryHttpService, DelhiveryAwbService],
  exports: [DelhiveryHttpService, DelhiveryAwbService],
})
export class CourierDelhiveryModule {}
