import { CourierWriteGuardService } from './services/courier-write-guard.service';
import { Module } from '@nestjs/common';
import { CourierAccountRoutingService } from './services/courier-account-routing.service';
import { CourierCredentialService } from './services/courier-credential.service';
import { CourierMcpReaderService } from './services/courier-mcp-reader.service';
import { NdrAttemptContextService } from './services/ndr-attempt-context.service';
import { CourierSelectionService } from './services/courier-selection.service';
import { CourierDistributionService } from './services/courier-distribution.service';

/**
 * Module 9 — courier-shared: internal infrastructure consumed by the
 * courier-* modules (courier-delhivery, courier-awb, courier-dispatch,
 * courier-manual-placement). Mirrors `inventory-shared` — the internal
 * tier whose services the cross-courier modules import.
 *
 * `CourierCredentialService` is the ONLY sanctioned path to courier
 * credential plaintext (CUR-1). `CourierAccountRoutingService` (R1) is
 * the ONLY sanctioned path to multi-account selection logic.
 * `NdrAttemptContextService` is the ONE place the NDR attempt count and
 * current NSL are resolved — the numbers Delhivery's eligibility rules
 * are judged on, and the seam that swaps to a courier-side field.
 * PrismaService / EnvService / AuditLogService are global.
 */
@Module({
  providers: [
    CourierCredentialService,
    CourierAccountRoutingService,
    CourierSelectionService,
    CourierDistributionService,
    NdrAttemptContextService,
    CourierMcpReaderService,
    CourierWriteGuardService,
  ],
  exports: [
    CourierCredentialService,
    CourierAccountRoutingService,
    CourierSelectionService,
    CourierDistributionService,
    NdrAttemptContextService,
    CourierMcpReaderService,
    CourierWriteGuardService,
  ],
})
export class CourierSharedModule {}
