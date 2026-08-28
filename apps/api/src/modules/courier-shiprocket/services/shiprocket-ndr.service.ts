import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { CourierWriteGuardService } from '../../courier-shared/services/courier-write-guard.service';
import { ShiprocketHttpService } from './shiprocket-http.service';

/**
 * What we can ask Shiprocket to do with a failed delivery.
 *
 * Deliberately the SAME vocabulary Delhivery's service uses for the
 * overlapping case, so the courier-agnostic layer above can pass one
 * value through without translating twice. `FAKE_ATTEMPT` has no
 * Delhivery counterpart and is Shiprocket-only: it disputes a delivery
 * attempt the driver logged but never made.
 */
export type ShiprocketNdrAction = 'RE-ATTEMPT' | 'RETURN' | 'FAKE_ATTEMPT';

export interface ShiprocketNdrActionInput {
  readonly awbNumber: string;
  readonly action: ShiprocketNdrAction;
  readonly courierAccountId: string;
  /** Free text the courier shows its field executive. */
  readonly comment: string;
  /** Only meaningful for RE-ATTEMPT; ignored otherwise. */
  readonly scheduledDate?: string | null;
  /** A corrected phone or address, when that is why it failed. */
  readonly recipientPhone?: string | null;
  readonly recipientAddress?: string | null;
}

export interface ShiprocketNdrActionResult {
  readonly success: boolean;
  readonly awbNumber: string;
  readonly message: string | null;
  readonly raw: unknown;
}

export interface ShiprocketNdrEligibility {
  readonly eligible: boolean;
  readonly reason: string | null;
}

/**
 * Shiprocket caps re-attempts the same way Delhivery does — three total
 * delivery attempts, so two re-attempts after the first failure. Asking
 * for a fourth is refused at their end, so we refuse it here rather than
 * spend a call learning that.
 */
const MAX_ATTEMPT_COUNT = 2;

/**
 * Acting on a failed delivery (NDR) — the Shiprocket half.
 *
 * ── WHY THIS MIRRORS DelhiveryNdrService RATHER THAN INVENTING ───────
 * The two couriers disagree about how eligibility is expressed and
 * agree about everything the business cares about. Delhivery carries the
 * reason in an NSL code and publishes which codes permit a re-attempt;
 * Shiprocket exposes an NDR list with a per-parcel action flag and does
 * not publish a code table. So the eligibility CHECK differs and the
 * SHAPE does not: check first, refuse locally when it cannot work, and
 * return the same verdict type — which is what lets the layer above
 * treat the two couriers as one.
 *
 * ── CUR-11 STILL HOLDS ───────────────────────────────────────────────
 * A successful action here does NOT move the order. Shiprocket's own
 * scans do that, through the tracking poll. Their reply says the request
 * was accepted, not that a van went out; writing a transition here would
 * give the order two authorities that can disagree.
 */
@Injectable()
export class ShiprocketNdrService {
  private readonly logger = new Logger(ShiprocketNdrService.name);

  constructor(
    private readonly http: ShiprocketHttpService,
    private readonly writeGuard: CourierWriteGuardService,
  ) {}

  /**
   * Can this action work at all, decided before spending a call.
   *
   * Shiprocket has no published code table, so what is checkable locally
   * is the attempt count and the action's own preconditions. Everything
   * else is their verdict, and we take it from the response.
   */
  checkEligibility(input: {
    readonly action: ShiprocketNdrAction;
    readonly attemptCount: number;
    readonly comment: string;
  }): ShiprocketNdrEligibility {
    if (input.action === 'RE-ATTEMPT' && input.attemptCount >= MAX_ATTEMPT_COUNT) {
      return {
        eligible: false,
        reason: `Already re-attempted ${input.attemptCount} times (max ${MAX_ATTEMPT_COUNT})`,
      };
    }
    // Their API rejects an empty comment, and a re-attempt with no
    // reason is also useless to the person who reads it on the road.
    if (input.comment.trim().length === 0) {
      return { eligible: false, reason: 'A comment is required — the driver reads it' };
    }
    return { eligible: true, reason: null };
  }

  async takeAction(input: ShiprocketNdrActionInput): Promise<ShiprocketNdrActionResult> {
    if (await this.http.isStubMode()) {
      return { success: true, awbNumber: input.awbNumber, message: 'stub', raw: null };
    }

    // Changes what happens to a real parcel tomorrow morning.
    await this.writeGuard.assertWritable('shiprocket', 'ndr.action', {
      awbNumber: input.awbNumber,
      action: input.action,
    });

    const raw = await this.http.request<Record<string, unknown>>({
      method: 'POST',
      // Their path takes the AWB, not their own shipment id — the one
      // endpoint of theirs that does.
      path: `/v1/external/ndr/${encodeURIComponent(input.awbNumber)}/action`,
      body: {
        action: this.wireAction(input.action),
        comment: input.comment,
        ...(input.scheduledDate != null ? { scheduled_delivery_date: input.scheduledDate } : {}),
        ...(input.recipientPhone != null ? { phone: input.recipientPhone } : {}),
        ...(input.recipientAddress != null ? { address: input.recipientAddress } : {}),
      },
      actor: { type: ActorType.SYSTEM },
      courierAccountId: input.courierAccountId,
    });

    // They answer with a status field rather than an id to poll — an
    // NDR action is synchronous at their end, which is the one place
    // this genuinely differs from Delhivery's async UPL.
    const status = raw['status'];
    const success = status === 1 || status === '1' || status === true;
    const message =
      (raw['message'] as string | undefined) ?? (raw['response'] as string | undefined) ?? null;

    if (!success) {
      this.logger.warn(
        { awbNumber: input.awbNumber, action: input.action, message },
        'Shiprocket refused the NDR action',
      );
    }
    return { success, awbNumber: input.awbNumber, message, raw };
  }

  /** Their wire vocabulary, which is not ours. */
  private wireAction(action: ShiprocketNdrAction): string {
    switch (action) {
      case 'RE-ATTEMPT':
        return 're-attempt';
      case 'RETURN':
        return 'return';
      case 'FAKE_ATTEMPT':
        return 'fake-attempt';
    }
  }

  /**
   * The parcels Shiprocket currently considers to be in NDR.
   *
   * Delhivery has no equivalent — its NDR state is read off the scan's
   * NSL code, which we already store. This exists because Shiprocket's
   * eligibility is only knowable from their side, so the nightly sweep
   * asks them rather than guessing from our own tracking history.
   */
  async listNdr(courierAccountId: string): Promise<
    ReadonlyArray<{
      readonly awbNumber: string;
      readonly attemptCount: number;
      readonly reason: string | null;
    }>
  > {
    if (await this.http.isStubMode()) return [];
    const res = await this.http.request<{ data?: unknown }>({
      method: 'GET',
      path: '/v1/external/ndr',
      actor: { type: ActorType.SYSTEM },
      courierAccountId,
    });
    const rows = Array.isArray(res.data) ? res.data : [];
    const out: Array<{ awbNumber: string; attemptCount: number; reason: string | null }> = [];
    for (const r of rows) {
      if (typeof r !== 'object' || r === null) continue;
      const row = r as Record<string, unknown>;
      const awb = row['awb'] ?? row['awb_code'];
      if (typeof awb !== 'string' || awb.length === 0) continue;
      out.push({
        awbNumber: awb,
        attemptCount: Number(row['attempts'] ?? row['ndr_attempts'] ?? 0),
        reason: typeof row['reason'] === 'string' ? row['reason'] : null,
      });
    }
    return out;
  }
}
