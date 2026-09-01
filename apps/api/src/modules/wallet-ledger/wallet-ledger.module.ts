import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { WalletImportService } from './services/wallet-import.service';

/**
 * Reading a courier's wallet export into "what each parcel cost".
 *
 * A dependency-free PRIMITIVE (the R3 pattern), because two processes
 * need it and they must not learn about each other: the API imports it
 * for the manual upload, and the PORTAL WORKER imports it for the
 * nightly fetch. Putting it in either one would drag that process into
 * the other — and in this case the wrong direction puts a Chromium in
 * the API, which `portal-worker-isolation.spec.ts` exists to prevent.
 *
 * It knows nothing about browsers or HTTP. It takes a Buffer.
 */
@Module({
  imports: [AuthCommonModule],
  providers: [WalletImportService],
  exports: [WalletImportService],
})
export class WalletLedgerModule {}
