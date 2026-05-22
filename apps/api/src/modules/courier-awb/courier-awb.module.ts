import { Module } from '@nestjs/common';
import { ShipmentProvisionModule } from '../shipment-provision/shipment-provision.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { AwbSupersedeService } from './services/awb-supersede.service';
import { AwbGenerationService } from './services/awb-generation.service';

/**
 * Module 9 — courier-awb: the AWB generation saga. Grows
 * commit-by-commit:
 *   - commit 7 (this): AwbSupersedeService — auto-supersede chain (CUR-7)
 *   - commit 8       : + AwbGenerationService (per-shipment generate +
 *                      label→Spaces, CUR-6/CUR-9)
 *   - commit 9       : + the per-manifest AWB BullMQ job (CUR-2)
 *   - commit 10      : wire manifest CLOSED → enqueue job
 *
 * Imports ShipmentProvisionModule for ShipmentNumberingService (the
 * replacement parcel needs a shipment number). PrismaService +
 * AuditLogService global.
 */
@Module({
  imports: [ShipmentProvisionModule, CourierDelhiveryModule],
  providers: [AwbSupersedeService, AwbGenerationService],
  exports: [AwbSupersedeService, AwbGenerationService],
})
export class CourierAwbModule {}
