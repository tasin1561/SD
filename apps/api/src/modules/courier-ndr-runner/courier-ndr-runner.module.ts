import { Module } from '@nestjs/common';
import { AuthCommonModule } from '../auth-common/auth-common.module';
import { CourierDelhiveryModule } from '../courier-delhivery/courier-delhivery.module';
import { CourierEscalationModule } from '../courier-escalation/courier-escalation.module';
import { CourierSharedModule } from '../courier-shared/courier-shared.module';
import { EmailModule } from '../email/email.module';
import { TicketModule } from '../ticket/ticket.module';
import { NdrQueue } from './queue/ndr.queue';
import { NdrWorker } from './queue/ndr.worker';
import { NdrReconciliationService } from './services/ndr-reconciliation.service';
import { NdrRunnerService } from './services/ndr-runner.service';
import { NdrSettingsService } from './services/ndr-settings.service';
import { NdrUplPollerService } from './services/ndr-upl-poller.service';

/**
 * Phase 1 of the courier-escalation work: the official-API tier.
 *
 * Roughly 60% of what would otherwise become a support ticket is a
 * re-attempt request, and Delhivery has a real API for it. Doing that
 * over the API rather than through a human (or, later, a browser) is the
 * highest-value and lowest-risk part of the whole escalation design,
 * which is why it is built first.
 *
 * Three jobs, one queue, and they are deliberately different shapes:
 *
 *   - **The nightly runner** submits. It is the only one that can cause
 *     a physical-world effect, so it carries all three CUR-10 gates.
 *   - **The UPL poller** finds out what happened, because the NDR API is
 *     asynchronous and returns a handle rather than an outcome.
 *   - **Reconciliation** asks whether the confirmed requests actually
 *     produced anything. It is the only check that can catch Delhivery
 *     accepting our calls and not acting on them — every other signal in
 *     the chain reports success either way.
 *
 * A LEAF module: nothing imports it, it exports nothing. Same shape as
 * `courier-ops`, `courier-dispatch` and `courier-manual-placement`.
 *
 * It has NO controller. Every entry point is either the schedule or a
 * public method (`run` / `poll` / `reconcile`) that doubles as the
 * manual ops trigger, mirroring CUR-2's `processManifest`. An HTTP
 * "submit NDR now" endpoint would be a fourth way to send a van, and
 * `courier-ops` already owns the operator-triggered path.
 */
@Module({
  imports: [
    CourierSharedModule, // NdrAttemptContextService — the single attempt-count seam
    CourierDelhiveryModule, // the adapter: NDR, tracking fetch, write guard
    TicketModule, // the escalation path for a failed request
    CourierEscalationModule, // opens the courier conversation on that ticket
    EmailModule, // the M11 substrate the reconciliation alert goes through
    AuthCommonModule, // audit
  ],
  providers: [
    NdrSettingsService,
    NdrRunnerService,
    NdrUplPollerService,
    NdrReconciliationService,
    NdrQueue,
    NdrWorker,
  ],
})
export class CourierNdrRunnerModule {}
