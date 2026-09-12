import { Module } from '@nestjs/common';
import { AdminWalletSyncController } from './controllers/admin-wallet-sync.controller';
import { AdminDelhiveryBillingProbeController } from './controllers/admin-delhivery-billing-probe.controller';
import { WalletSyncHistoryService } from './services/wallet-sync-history.service';
import { WalletSyncTriggerService } from './services/wallet-sync-trigger.service';
import { DelhiveryBillingProbeReaderService } from './services/delhivery-billing-probe-reader.service';

/**
 * The cost sync, as seen from the API.
 *
 * Its own module rather than a controller inside `courier-portal`,
 * because that module is deliberately unreachable from `AppModule` —
 * the portal owns a Chromium and runs in its own process
 * (`portal-worker-main.ts`), and `portal-worker-isolation.spec.ts`
 * enforces the separation. A controller placed there is registered by
 * nobody and answers 404, which is exactly what happened on the first
 * attempt at this page.
 *
 * So the split follows the process boundary: everything here READS
 * (audit rows, shipment costs) and the one write is an enqueue onto the
 * queue the portal worker already listens to. A LEAF module — nothing
 * imports it, and it imports nothing but the globals.
 */
@Module({
  controllers: [AdminWalletSyncController, AdminDelhiveryBillingProbeController],
  providers: [
    WalletSyncHistoryService,
    WalletSyncTriggerService,
    DelhiveryBillingProbeReaderService,
  ],
})
export class CourierCostSyncModule {}
