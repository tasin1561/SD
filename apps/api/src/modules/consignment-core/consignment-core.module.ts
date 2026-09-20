import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { SettingsModule } from '../settings/settings.module';
import { ConsignmentEventService } from './services/consignment-event.service';
import { ConsignmentFreightModeService } from './services/consignment-freight-mode.service';
import { ConsignmentNumberingService } from './services/consignment-numbering.service';
import { ConsignmentStatusService } from './services/consignment-status.service';

/**
 * R3 shared primitive — the EIGHTH extraction of this shape.
 *
 * Two domains need the same cross-cutting primitive and wiring it into
 * either would close a cycle: `consignment` owns declaration, dispatch
 * and labelling; `inventory-receipt` is what discovers that a leg has
 * been counted and must therefore move the consignment's status and
 * write its timeline event. `consignment` already imports
 * `inventory-receipt`, so the reverse call cannot exist.
 *
 * This module depends on NEITHER of them (only Prisma), so importing it
 * from both introduces no cycle and needs no `forwardRef` — see the
 * call-queue / shipment-provision / lifecycle-events precedents.
 */
@Module({
  // SettingsModule and AuthCommonModule are themselves dependency-free
  // (Prisma + audit), so importing them here keeps this module's
  // no-cycle property: neither knows what a consignment is.
  imports: [PrismaModule, SettingsModule, AuthCommonModule],
  providers: [
    ConsignmentNumberingService,
    ConsignmentEventService,
    ConsignmentStatusService,
    ConsignmentFreightModeService,
  ],
  exports: [
    ConsignmentNumberingService,
    ConsignmentEventService,
    ConsignmentStatusService,
    ConsignmentFreightModeService,
  ],
})
export class ConsignmentCoreModule {}
