import { Module } from '@nestjs/common';
import { CourierAccountRoutingService } from './services/courier-account-routing.service';
import { CourierCredentialService } from './services/courier-credential.service';

/**
 * Module 9 — courier-shared: internal infrastructure consumed by the
 * courier-* modules (courier-delhivery, courier-awb, courier-dispatch,
 * courier-manual-placement). Mirrors `inventory-shared` — the internal
 * tier whose services the cross-courier modules import.
 *
 * `CourierCredentialService` is the ONLY sanctioned path to courier
 * credential plaintext (CUR-1). `CourierAccountRoutingService` (R1) is
 * the ONLY sanctioned path to multi-account selection logic.
 * PrismaService / EnvService / AuditLogService are global.
 */
@Module({
  providers: [CourierCredentialService, CourierAccountRoutingService],
  exports: [CourierCredentialService, CourierAccountRoutingService],
})
export class CourierSharedModule {}
