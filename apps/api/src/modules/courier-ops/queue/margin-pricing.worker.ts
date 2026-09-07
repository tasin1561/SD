import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { WorkerRoleService } from '../../../common/queue/worker-role.service';
import { SystemIssueService } from '../../system-issues/services/system-issue.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierMarginReportService } from '../services/courier-margin-report.service';
import { JOB_PRICE_UNPRICED, MARGIN_QUEUE_NAME } from './margin-pricing.queue';

const ENABLED_KEY = 'courier.margin_nightly_pricing_enabled';
const LIMIT_KEY = 'courier.margin_nightly_pricing_limit';
const MIN_AGE_KEY = 'courier.margin_nightly_pricing_min_age_hours';

/**
 * Fills in what each parcel actually cost, overnight.
 *
 * Until this existed the cost was known only for parcels somebody had
 * pressed Run over, so the P&L's delivery line was measured across
 * whatever sample happened to have been priced — and the page said
 * "1 parcel has no real courier cost yet" with no route to fixing it
 * other than spending the calls by hand.
 *
 * SWITCHED OFF unless somebody turns it on. Every parcel is a real call
 * to a rate-limited courier, and a batch that starts running the moment
 * it deploys is a batch nobody decided to run.
 */
@Injectable()
export class MarginPricingWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarginPricingWorker.name);
  private worker!: Worker;

  constructor(
    private readonly redis: RedisService,
    private readonly workerRole: WorkerRoleService,
    private readonly margin: CourierMarginReportService,
    private readonly prisma: PrismaService,
    private readonly issues: SystemIssueService,
  ) {}

  onModuleInit(): void {
    // SCALE-1: only the queue-owning instance starts workers, or a
    // second API process doubles every courier call this job makes.
    if (!this.workerRole.shouldStart(MarginPricingWorker.name)) return;

    this.worker = new Worker(
      MARGIN_QUEUE_NAME,
      async (job: Job): Promise<void> => {
        if (job.name !== JOB_PRICE_UNPRICED) {
          this.logger.warn({ name: job.name }, 'Unknown margin job; ignoring');
          return;
        }
        // Read GLOBALLY: courier pricing is ours, not a seller's, so
        // SettingsResolverService's per-seller override has nothing to
        // resolve against here.
        const enabled = await this.flag(ENABLED_KEY, false);
        if (!enabled) return;

        const limit = await this.int(LIMIT_KEY, 100);
        const minAgeHours = await this.int(MIN_AGE_KEY, 24);
        const s = await this.margin.priceUnpriced({ staffId: null, limit, minAgeHours });
        this.logger.log(s, 'Nightly margin pricing complete');

        // A sweep that priced NOTHING while parcels waited is worth
        // knowing about — it means every call failed, which reads
        // identically to "there was nothing to do" in a log nobody
        // opens.
        if (s.considered > 0 && s.priced === 0 && s.failed > 0) {
          await this.issues.raise({
            kind: SystemIssueKind.API_ERROR,
            severity: SystemIssueSeverity.HIGH,
            title: 'Nightly courier pricing priced nothing',
            detail:
              `${s.failed} of ${s.considered} parcels failed to price and none succeeded.\n\n` +
              'Every parcel that moved is left without a real courier cost, so the delivery ' +
              'line in the P&L is measured over an older sample than it looks. Check the ' +
              'courier credentials and the rate-limit budget.',
            source: MarginPricingWorker.name,
            dedupeKey: 'margin-nightly-pricing-all-failed',
            metadata: { ...s },
          });
        }
      },
      {
        connection: this.redis.createConnection(),
        // ONE. The service is already sequential inside a run, and two
        // runs at once would double the calls against the same budget.
        concurrency: 1,
      },
    );

    this.worker.on('failed', (job, err) => {
      void this.issues.reportJobFailure(MarginPricingWorker.name, job, err);
      this.logger.warn({ jobId: job?.id, err: err?.message }, 'Margin pricing job failed');
    });
    this.worker.on('error', (err) => {
      void this.issues.reportWorkerError(MarginPricingWorker.name, err);
      this.logger.error({ err: err.message }, 'Margin pricing worker error');
    });
    this.logger.log(`Margin pricing worker ready (queue=${MARGIN_QUEUE_NAME})`);
  }

  private async flag(key: string, fallback: boolean): Promise<boolean> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueBoolean: true },
    });
    return row?.valueBoolean ?? fallback;
  }

  private async int(key: string, fallback: number): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key },
      select: { valueInt: true },
    });
    return row?.valueInt ?? fallback;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close();
  }
}
