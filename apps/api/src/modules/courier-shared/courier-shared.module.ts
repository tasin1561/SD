import { Module } from '@nestjs/common';
import { CourierCredentialService } from './services/courier-credential.service';

/**
 * Module 9 — courier-shared: internal infrastructure consumed by the
 * courier-* modules (courier-delhivery, courier-awb, courier-dispatch,
 * courier-manual-placement). Mirrors `inventory-shared` — the internal
 * tier whose services the cross-courier modules import.
 *
 * `CourierCredentialService` is the ONLY sanctioned path to courier
 * credential plaintext (CUR-1). PrismaService / EnvService /
 * AuditLogService are global.
 */
@Module({
  providers: [CourierCredentialService],
  exports: [CourierCredentialService],
})
export class CourierSharedModule {}
