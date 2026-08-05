import { Injectable, Logger } from '@nestjs/common';
import { ActorType, NdrRequestStatus, Prisma, ShipmentStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { courierActor } from '../../courier-shared/services/courier-credential.service';
import { NdrAttemptContextService } from '../../courier-shared/services/ndr-attempt-context.service';
import {
  DelhiveryNdrService,
  type NdrAction,
} from '../../courier-delhivery/services/delhivery-ndr.service';
import { DelhiveryTrackingFetchService } from '../../courier-delhivery/services/delhivery-tracking-fetch.service';
import { DelhiveryWriteGuardService } from '../../courier-delhivery/services/delhivery-write-guard.service';
import { NdrSettingsService } from './ndr-settings.service';

const JOB = 'ndr-nightly-runner';

export interface NdrRunSummary {
  readonly enabled: boolean;
  readonly considered: number;
  readonly submitted: number;
  readonly skipped: number;
  readonly failed: number;
  /** Prepared but NOT sent because the action is not on the auto list. */
  readonly heldForOperator: number;
  readonly reasons: Readonly<Record<string, number>>;
  /** True when live writes are off: everything ran except the submission. */
  readonly dryRun: boolean;
  /** Per-parcel decisions. The record that makes the selection rule
   *  auditable against real parcels before anything is enabled. */
  readonly plan: readonly NdrPlanEntry[];
}

/** What the runner decided about one parcel, and why. */
export interface NdrPlanEntry {
  readonly shipmentId: string;
  readonly awbNumber: string;
  /** The FRESH code read from the courier, not our stored one. */
  readonly nslCode: string | null;
  readonly attemptCount: number;
  readonly action: string;
  readonly disposition:
    | 'WOULD_SUBMIT'
    | 'SUBMITTED'
    | 'HELD_NOT_ON_AUTO_LIST'
    | 'SKIPPED'
    | 'FAILED';
  readonly reason: string | null;
}

/**
 * The nightly NDR batch.
 *
 * ── WHY IT IS A CRON AT ALL ──────────────────────────────────────────
 * Delhivery only accepts re-attempt actions after 21:00 IST, once the
 * day's dispatches have closed and NDR parcels are back in facility. The
 * action is therefore inherently scheduled: there is no moment at which
 * an operator could usefully click it. That is what forced the CUR-10
 * amendment (2026-08-05), and this service is the thing the amendment
 * was written for — so it carries all three of the gates the amendment
 * demands, and none of them are optional:
 *
 *   1. `courier.ndr_runner_enabled` — the KILL SWITCH. Off by default.
 *   2. `courier.ndr_auto_categories` — the per-action allow list. EMPTY
 *      by default, so the runner prepares and logs and sends nothing.
 *   3. `DelhiveryWriteGuardService` — the live-write guard, which refuses
 *      underneath us regardless of what this service decides.
 *
 * Three gates rather than one because they fail differently: the kill
 * switch is the operator's "stop now", the allow list is the operator's
 * "only this much", and the write guard is the system's "not against
 * production without a deliberate act". Collapsing them would mean
 * turning one thing on turns everything on.
 *
 * ── THE FRESH-NSL RULE ───────────────────────────────────────────────
 * Every candidate has its tracking RE-READ from Delhivery immediately
 * before submitting. A stale NSL means submitting actions they reject,
 * which pollutes the UPL results and leaves reconciliation unable to
 * tell "Delhivery ignored a valid request" from "we sent an invalid
 * one" — and that distinction is the only thing that detects silent
 * failure. At 50 AWBs per tracking call and 750 calls per 5 minutes,
 * the re-read is effectively free.
 *
 * Interactive operator actions do NOT do this; they keep reading the
 * cached `delivery_attempts` row, because a human just looked at the
 * shipment.
 */
@Injectable()
export class NdrRunnerService {
  private readonly logger = new Logger(NdrRunnerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: NdrSettingsService,
    private readonly attempts: NdrAttemptContextService,
    private readonly tracking: DelhiveryTrackingFetchService,
    private readonly ndr: DelhiveryNdrService,
    private readonly writeGuard: DelhiveryWriteGuardService,
    private readonly audit: AuditLogService,
  ) {}

  /** Public so it doubles as the manual ops trigger (mirrors CUR-2). */
  async run(): Promise<NdrRunSummary> {
    const reasons: Record<string, number> = {};
    const bump = (r: string): void => {
      reasons[r] = (reasons[r] ?? 0) + 1;
    };

    if (!(await this.settings.runnerEnabled())) {
      // Not an error, and deliberately not silent: "why did nothing
      // happen last night" must be answerable without reading code.
      this.logger.log('NDR runner is disabled (courier.ndr_runner_enabled) — nothing submitted');
      return {
        enabled: false,
        considered: 0,
        submitted: 0,
        skipped: 0,
        failed: 0,
        heldForOperator: 0,
        reasons: {},
        dryRun: false,
        plan: [],
      };
    }

    // GATE 3, checked ONCE up front. The guard also refuses inside
    // `takeAction`, which is what actually makes it safe — but reaching
    // it per parcel would throw fifty times and write fifty HIGH audit
    // rows for one configuration fact. The per-call guard stays; this
    // just stops the batch from being the noisiest way to learn it.
    //
    // Writes off does NOT mean do nothing: it means DRY RUN. Everything
    // up to the submission still happens — selection, the live tracking
    // read, the eligibility verdict — and the plan is recorded instead of
    // sent. That is deliberate, because the riskiest thing in this
    // service is a guess: `ShipmentStatus.DELIVERY_ATTEMPTED` is our
    // best equivalent of Delhivery's "package must be in Pending", and
    // if it is wrong it fails SILENTLY IN BOTH DIRECTIONS — eligible
    // parcels never selected, ineligible ones submitted — with nothing
    // to show either. The dry-run plan is what makes that answerable
    // against real parcels without enabling a single write.
    //
    // The reads it performs are free and side-effect-free (tracking is
    // 750 calls per 5 minutes and creates nothing). The kill switch
    // above still stops everything, including this.
    const dryRun = !(await this.writeGuard.liveWritesEnabled());
    if (dryRun) {
      this.logger.log(
        'NDR runner: live writes are disabled — DRY RUN (planning only, nothing will be submitted)',
      );
    }

    const autoActions = await this.settings.autoActions();
    const cap = await this.settings.batchMax();
    const candidates = await this.candidates(cap);

    let submitted = 0;
    let skipped = 0;
    let failed = 0;
    let held = 0;
    const plan: NdrPlanEntry[] = [];

    for (const c of candidates) {
      // FRESH NSL — re-read from the courier, not from our rows.
      const fresh = await this.freshContext(c.shipmentId, c.awbNumber);
      if (fresh === null) {
        skipped += 1;
        bump('TRACKING_READ_FAILED');
        plan.push({
          shipmentId: c.shipmentId,
          awbNumber: c.awbNumber,
          nslCode: null,
          attemptCount: -1,
          action: 'RE-ATTEMPT',
          disposition: 'SKIPPED',
          reason: 'TRACKING_READ_FAILED',
        });
        continue;
      }

      const action: NdrAction = 'RE-ATTEMPT';
      const verdict = this.ndr.checkEligibility({
        awbNumber: c.awbNumber,
        action,
        currentNslCode: fresh.nslCode,
        attemptCount: fresh.attemptCount,
      });
      if (!verdict.eligible) {
        skipped += 1;
        bump(verdict.reason ?? 'INELIGIBLE');
        plan.push({
          shipmentId: c.shipmentId,
          awbNumber: c.awbNumber,
          nslCode: fresh.nslCode,
          attemptCount: fresh.attemptCount,
          action,
          disposition: 'SKIPPED',
          reason: verdict.reason ?? 'INELIGIBLE',
        });
        continue;
      }

      // DRY RUN stops here — everything above already happened, so the
      // entry carries the real NSL and the real verdict.
      if (dryRun) {
        plan.push({
          shipmentId: c.shipmentId,
          awbNumber: c.awbNumber,
          nslCode: fresh.nslCode,
          attemptCount: fresh.attemptCount,
          action,
          disposition: 'WOULD_SUBMIT',
          reason: autoActions.includes(action) ? null : 'would also be held: not on the auto list',
        });
        continue;
      }

      // GATE 2 — the allow list. Prepared, logged, NOT sent.
      if (!autoActions.includes(action)) {
        held += 1;
        bump('HELD_NOT_ON_AUTO_LIST');
        plan.push({
          shipmentId: c.shipmentId,
          awbNumber: c.awbNumber,
          nslCode: fresh.nslCode,
          attemptCount: fresh.attemptCount,
          action,
          disposition: 'HELD_NOT_ON_AUTO_LIST',
          reason: 'action is not in courier.ndr_auto_categories',
        });
        await this.audit.log({
          actorType: ActorType.SYSTEM,
          action: 'courier.ndr.held_for_operator',
          entityType: 'shipment',
          entityId: c.shipmentId,
          severity: 'LOW',
          metadata: {
            awbNumber: c.awbNumber,
            ndrAction: action,
            nslCode: fresh.nslCode,
            attemptCount: fresh.attemptCount,
            reason: 'action is not in courier.ndr_auto_categories',
          },
        });
        continue;
      }

      try {
        // Claim the slot BEFORE calling out (visible-vs-silent): if the
        // call is made and we crash, the row exists and the poller finds
        // it. The reverse ordering would send a van nothing recorded.
        const row = await this.prisma.client.ndrActionRequest.create({
          data: {
            shipmentId: c.shipmentId,
            awbNumber: c.awbNumber,
            action,
            nslCodeAtSubmit: fresh.nslCode,
            attemptCountAtSubmit: fresh.attemptCount,
            status: NdrRequestStatus.SUBMITTED,
          },
          select: { id: true },
        });

        const result = await this.ndr.takeAction(
          {
            awbNumber: c.awbNumber,
            action,
            currentNslCode: fresh.nslCode,
            attemptCount: fresh.attemptCount,
          },
          courierActor.runner(JOB, row.id),
        );

        await this.prisma.client.ndrActionRequest.update({
          where: { id: row.id },
          data: {
            uplId: result.uplId,
            courierMessage: result.message,
            // A submit that came back unsuccessful is FAILED now, not
            // something to poll: there is no UPL to ask about.
            ...(result.success ? {} : { status: NdrRequestStatus.FAILED }),
          },
        });

        if (result.success) submitted += 1;
        else {
          failed += 1;
          bump('COURIER_REFUSED');
        }
        plan.push({
          shipmentId: c.shipmentId,
          awbNumber: c.awbNumber,
          nslCode: fresh.nslCode,
          attemptCount: fresh.attemptCount,
          action,
          disposition: result.success ? 'SUBMITTED' : 'FAILED',
          reason: result.success ? null : result.message,
        });
      } catch (err) {
        failed += 1;
        bump('SUBMIT_THREW');
        plan.push({
          shipmentId: c.shipmentId,
          awbNumber: c.awbNumber,
          nslCode: fresh.nslCode,
          attemptCount: fresh.attemptCount,
          action,
          disposition: 'FAILED',
          reason: err instanceof Error ? err.message : String(err),
        });
        // The in-flight partial unique means a retry cannot double-send;
        // a throw here leaves the row SUBMITTED and the poller owns it.
        this.logger.warn(
          { shipmentId: c.shipmentId, err: err instanceof Error ? err.message : String(err) },
          'NDR submit failed',
        );
      }
    }

    const summary: NdrRunSummary = {
      enabled: true,
      considered: candidates.length,
      submitted,
      skipped,
      failed,
      heldForOperator: held,
      reasons,
      dryRun,
      plan,
    };

    // The plan is logged per parcel, not only counted. Counts say the
    // selection rule produced N candidates; only the rows say WHICH
    // parcels and on what NSL — which is the question that has to be
    // answered against real traffic before writes are enabled.
    for (const e of plan) {
      this.logger.log(
        {
          dryRun,
          awbNumber: e.awbNumber,
          shipmentId: e.shipmentId,
          nslCode: e.nslCode,
          attemptCount: e.attemptCount,
          action: e.action,
          disposition: e.disposition,
          reason: e.reason,
          selectedBy: 'shipment.status=DELIVERY_ATTEMPTED',
        },
        `NDR plan: ${e.disposition} ${e.awbNumber}`,
      );
    }
    await this.audit.log({
      actorType: ActorType.SYSTEM,
      action: dryRun ? 'courier.ndr.batch_dry_run' : 'courier.ndr.batch_completed',
      entityType: 'courier',
      entityId: 'delhivery',
      severity: submitted > 0 ? 'HIGH' : 'LOW',
      metadata: {
        ...summary,
        reasons: summary.reasons as Prisma.InputJsonValue,
        plan: plan as unknown as Prisma.InputJsonValue,
      },
    });
    return summary;
  }

  /**
   * Parcels whose last scan was a failed delivery and which have no NDR
   * request already in flight.
   *
   * Eligibility is only PROVISIONAL here — the authoritative check runs
   * against the freshly-read NSL below. This query exists to keep the
   * number of tracking reads proportional to the problem.
   */
  private async candidates(cap: number): Promise<{ shipmentId: string; awbNumber: string }[]> {
    const rows = await this.prisma.client.shipment.findMany({
      where: {
        status: ShipmentStatus.DELIVERY_ATTEMPTED,
        awbNumber: { not: null },
        supersededAt: null,
        deletedAt: null,
        ndrActionRequests: { none: { status: NdrRequestStatus.SUBMITTED } },
      },
      select: { id: true, awbNumber: true },
      orderBy: { updatedAt: 'asc' },
      take: cap,
    });
    return rows.flatMap((r) =>
      r.awbNumber === null ? [] : [{ shipmentId: r.id, awbNumber: r.awbNumber }],
    );
  }

  /**
   * Re-read this parcel's NSL and attempt count from the courier.
   *
   * Returns null when the read fails — a failed read must SKIP the
   * parcel, never fall back to the cached row. Falling back is precisely
   * the stale-NSL submission this rule exists to prevent, and it would
   * be invisible because the submission looks identical.
   */
  private async freshContext(
    shipmentId: string,
    awbNumber: string,
  ): Promise<{ nslCode: string | null; attemptCount: number } | null> {
    try {
      const [result] = await this.tracking.fetchTracking(
        [awbNumber],
        courierActor.runner(JOB, shipmentId),
      );
      const scans = result?.scans ?? [];
      if (scans.length === 0) return null;

      // Scans arrive oldest-first; the CURRENT NSL is the latest one
      // that carries a code at all (an informational scan may have none).
      const nslCode = [...scans].reverse().find((s) => (s.nslCode ?? '') !== '')?.nslCode ?? null;

      // The count still comes from the single seam, so the swap to a
      // courier-side field happens in one place — see
      // NdrAttemptContextService. What the live read authoritatively
      // refreshes here is the NSL, which is what eligibility turns on.
      const local = await this.attempts.resolve(shipmentId, awbNumber);
      return { nslCode, attemptCount: local.attemptCount };
    } catch (err) {
      this.logger.warn(
        { shipmentId, awbNumber, err: err instanceof Error ? err.message : String(err) },
        'NDR fresh-tracking read failed; skipping this parcel rather than using a stale NSL',
      );
      return null;
    }
  }
}
