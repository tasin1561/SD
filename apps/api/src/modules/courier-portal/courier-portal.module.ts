import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierEscalationModule } from '../courier-escalation/courier-escalation.module';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { EmailModule } from '../email/email.module';
import { PortalQueue } from './queue/portal.queue';
import { PortalCanaryService } from './services/portal-canary.service';
import { PortalDispatcherService } from './services/portal-dispatcher.service';
import { PortalPacingService } from './services/portal-pacing.service';
import { PortalSessionService } from './services/portal-session.service';
import { WalletLedgerFetcherService } from './services/wallet-ledger-fetcher.service';
import { WalletSyncService } from './services/wallet-sync.service';
import { WalletSyncWorker } from './queue/wallet-sync.worker';
import { WalletLedgerModule } from '../wallet-ledger/wallet-ledger.module';
import { PortalTaxonomyService } from './services/portal-taxonomy.service';
import { ConsigneeVerifyService } from './services/consignee-verify.service';
import { ConsigneeVerifyWorker } from './queue/consignee-verify.worker';

/**
 * Phase 5 — browser automation of one.delhivery.com.
 *
 * ── THIS MODULE IS NOT IMPORTED BY AppModule, ON PURPOSE ─────────────
 * A long-lived Chromium must not run inside the process serving customer
 * HTTP. It holds a decrypted portal login for the life of the process, it
 * is by far the most memory-hungry thing in the system, and a crash in it
 * would take the API down with it.
 *
 * So this module is reachable ONLY from `portal-worker-main.ts`, which
 * `@skydrop/workers` runs as its own process. `AppModule` never mentions
 * it, so the API never constructs a browser, never loads Playwright and
 * never decrypts a portal credential.
 *
 * That isolation is the prerequisite for this phase existing at all, and
 * it is invisible in the source — nothing fails if someone adds this to
 * AppModule's imports "to expose an endpoint".
 * `portal-worker-isolation.spec.ts` asserts it structurally, which is the
 * only way it holds.
 *
 * ── IT SHIPS INERT ───────────────────────────────────────────────────
 * `portalMode` defaults to SHADOW, so even once this process is running
 * it prepares actions and executes nothing. Going LIVE is a deliberate,
 * 2FA'd, audited change — and it is separate from `writeMode`, so shadow
 * runs under MANUAL while humans keep clearing the ops queue.
 */
@Module({
  imports: [
    CourierSharedModule,
    CourierEscalationModule,
    EmailModule,
    AuthCommonModule,
    WalletLedgerModule,
  ],
  providers: [
    PortalSessionService,
    PortalPacingService,
    PortalTaxonomyService,
    PortalDispatcherService,
    PortalCanaryService,
    PortalQueue,
    WalletLedgerFetcherService,
    WalletSyncService,
    WalletSyncWorker,
    ConsigneeVerifyService,
    ConsigneeVerifyWorker,
  ],
  // The SESSION only. Logging into the portal is the expensive, fragile,
  // credential-bearing half, and there is no reason for a second module
  // to reimplement it — the wallet sync needs a logged-in page and
  // nothing else. The dispatcher, pacer and canary stay internal: those
  // are about the escalation queue, which is nobody else's business.
})
export class CourierPortalModule {}
