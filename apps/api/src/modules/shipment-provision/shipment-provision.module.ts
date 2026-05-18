import { Module } from '@nestjs/common';
import { ShipmentProvisionService } from './services/shipment-provision.service';
import { ShipmentNumberingService } from './services/shipment-numbering.service';

/**
 * Module 8 — the shared shipment-provision PRIMITIVE module (R3).
 *
 * Exports `ShipmentProvisionService` (provisionFromSnapshot /
 * voidForOrder) for BOTH `order` (M6's CC-6 hook on →CONFIRMED /
 * cancellation) and the `warehouse-*` modules. It depends on NEITHER —
 * that one-way fan-in removes the order ↔ warehouse-pick circular
 * module dependency without forwardRef (same R3 spirit as M7's
 * `call-queue`). PrismaService + AuditLogService are global.
 */
@Module({
  providers: [ShipmentProvisionService, ShipmentNumberingService],
  exports: [ShipmentProvisionService],
})
export class ShipmentProvisionModule {}
