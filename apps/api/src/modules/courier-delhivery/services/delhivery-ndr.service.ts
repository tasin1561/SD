import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import { DelhiveryWriteGuardService } from './delhivery-write-guard.service';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

export type NdrAction = 'RE-ATTEMPT' | 'PICKUP_RESCHEDULE';

export interface NdrActionInput {
  readonly awbNumber: string;
  readonly action: NdrAction;
  /** The shipment's CURRENT NSL code — eligibility depends on it. */
  readonly currentNslCode: string | null;
  /** How many delivery attempts have already been made. */
  readonly attemptCount: number;
}

export interface NdrActionResult {
  readonly success: boolean;
  readonly awbNumber: string;
  /** Delhivery's async job id; the outcome is polled with it. */
  readonly uplId: string | null;
  readonly message: string | null;
  readonly raw: unknown;
}

export interface NdrEligibility {
  readonly eligible: boolean;
  readonly reason: string | null;
}

/**
 * NSL codes that permit a RE-ATTEMPT. Straight from Delhivery's docs —
 * anything else is refused by them, so sending it just earns a rejection.
 */
const REATTEMPT_NSL = new Set([
  'EOD-74',
  'EOD-15',
  'EOD-104',
  'EOD-43',
  'EOD-86',
  'EOD-11',
  'EOD-69',
  'EOD-6',
]);

/** NSL codes that permit a PICKUP_RESCHEDULE (reverse pickups). */
const RESCHEDULE_NSL = new Set([
  'EOD-777', // RVP QC fail
  'EOD-21', // pickup cancelled — must be NON-OTP-verified
]);

const MAX_ATTEMPT_COUNT = 2;

/**
 * Acting on a failed delivery (NDR).
 *
 * ── WHY THIS CHECKS BEFORE IT CALLS ──────────────────────────────────
 * Delhivery will only accept a re-attempt when the parcel is in exactly
 * the right state, and the state is carried in the NSL code — the
 * fine-grained reason under the status. `EOD-74` (customer unavailable)
 * is re-attemptable; most other codes are not. Attempt count matters too:
 * only the 1st or 2nd failure may be retried.
 *
 * Firing blindly and reading the rejection would work, but it burns rate
 * budget, fills the log with noise, and — worse — makes "we asked for a
 * re-attempt" indistinguishable from "we asked and were refused" unless
 * somebody reads every response. So eligibility is checked locally first
 * and the reason is explicit.
 *
 * ── ASYNCHRONOUS ─────────────────────────────────────────────────────
 * The call returns a **UPL id**, not an outcome. Whether the re-attempt
 * was actually accepted is a second call (`checkStatus`). Treating the
 * first response as success would tell a seller their parcel is being
 * retried when it may not be.
 *
 * ── TIMING ───────────────────────────────────────────────────────────
 * Delhivery advises firing these after 21:00 IST, once the day's
 * dispatches are closed and the failed parcels are physically back at
 * the facility. Earlier requests can be silently ineffective, which is
 * why the scheduling of this belongs in a cron rather than in a
 * "customer clicked retry" handler.
 */
@Injectable()
export class DelhiveryNdrService {
  private readonly logger = new Logger(DelhiveryNdrService.name);

  constructor(
    private readonly http: DelhiveryHttpService,
    private readonly writeGuard: DelhiveryWriteGuardService,
  ) {}

  /** Local eligibility check — no network. */
  checkEligibility(input: NdrActionInput): NdrEligibility {
    const nsl = (input.currentNslCode ?? '').trim().toUpperCase();
    if (nsl === '') {
      return {
        eligible: false,
        reason:
          'No current NSL code known for this shipment; Delhivery decides eligibility from it, so acting blind would just earn a rejection',
      };
    }
    if (input.attemptCount < 1 || input.attemptCount > MAX_ATTEMPT_COUNT) {
      return {
        eligible: false,
        reason: `Attempt count ${input.attemptCount} is outside Delhivery's allowed 1-${MAX_ATTEMPT_COUNT}`,
      };
    }
    const allowed = input.action === 'RE-ATTEMPT' ? REATTEMPT_NSL : RESCHEDULE_NSL;
    if (!allowed.has(nsl)) {
      return {
        eligible: false,
        reason: `NSL ${nsl} does not permit ${input.action} (allowed: ${[...allowed].join(', ')})`,
      };
    }
    return { eligible: true, reason: null };
  }

  async takeAction(
    input: NdrActionInput,
    actor?: CourierCredentialActor,
  ): Promise<NdrActionResult> {
    const eligibility = this.checkEligibility(input);
    if (!eligibility.eligible) {
      this.logger.log(
        { awbNumber: input.awbNumber, action: input.action, reason: eligibility.reason },
        'Skipping NDR action — not eligible',
      );
      return {
        success: false,
        awbNumber: input.awbNumber,
        uplId: null,
        message: eligibility.reason,
        raw: null,
      };
    }

    if (await this.http.isStubMode()) {
      return {
        success: true,
        awbNumber: input.awbNumber,
        uplId: 'UPLSTUB0000000000',
        message: 'stub',
        raw: null,
      };
    }
    // Changes what happens to a real parcel tomorrow morning.
    await this.writeGuard.assertWritable('ndr.action', {
      awbNumber: input.awbNumber,
      action: input.action,
      nsl: input.currentNslCode,
    });

    const raw = await this.http.request<Record<string, unknown>>({
      actor,
      method: 'POST',
      path: '/api/p/update',
      endpoint: 'ndr',
      encoding: 'json',
      // Up to 1000 waybills per call; we send one so a rejection is
      // attributable to a specific parcel rather than a batch.
      body: { data: [{ waybill: input.awbNumber, act: input.action }] },
    });

    const uplId =
      (raw['upl'] as string | undefined) ??
      (raw['request_id'] as string | undefined) ??
      (raw['UPL'] as string | undefined) ??
      null;
    const message =
      (raw['error'] as string | undefined) ?? (raw['remark'] as string | undefined) ?? null;

    if (uplId === null) {
      this.logger.warn(
        { awbNumber: input.awbNumber, action: input.action, message },
        'NDR action returned no UPL id — treating as failed',
      );
      return { success: false, awbNumber: input.awbNumber, uplId: null, message, raw };
    }

    this.logger.log(
      { awbNumber: input.awbNumber, action: input.action, uplId },
      'NDR action accepted for processing (async — outcome must be polled)',
    );
    return { success: true, awbNumber: input.awbNumber, uplId, message, raw };
  }

  /**
   * The second half: did the action actually take?
   *
   * `takeAction` only proves Delhivery accepted the request. Without
   * this, a re-attempt that was refused downstream would look identical
   * to one that worked.
   */
  async checkStatus(
    uplId: string,
    actor?: CourierCredentialActor,
  ): Promise<{
    readonly complete: boolean;
    readonly success: boolean | null;
    readonly raw: unknown;
  }> {
    if (await this.http.isStubMode()) {
      return { complete: true, success: true, raw: null };
    }
    const raw = await this.http.request<Record<string, unknown>>({
      actor,
      method: 'GET',
      path: `/api/cmu/get_bulk_upl/${encodeURIComponent(uplId)}?verbose=true`,
      endpoint: 'ndr',
    });
    const status = String(raw['status'] ?? raw['upl_status'] ?? '').toUpperCase();
    // "Package action is being performed" is Delhivery's in-progress
    // signal — not a failure, just not finished.
    const inProgress = status.includes('PROGRESS') || status.includes('PERFORMED') || status === '';
    return {
      complete: !inProgress,
      success: inProgress ? null : status.includes('SUCCESS') || status === 'DONE',
      raw,
    };
  }
}
