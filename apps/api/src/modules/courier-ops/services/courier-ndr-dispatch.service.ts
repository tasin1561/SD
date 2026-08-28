import { Injectable, Logger } from '@nestjs/common';
import {
  DelhiveryNdrService,
  type NdrAction,
} from '../../courier-delhivery/services/delhivery-ndr.service';
import { ShiprocketNdrService } from '../../courier-shiprocket/services/shiprocket-ndr.service';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

export interface NdrDispatchInput {
  readonly courierCode: string;
  readonly courierAccountId: string | null;
  readonly awbNumber: string;
  readonly action: NdrAction;
  readonly currentNslCode: string | null;
  readonly attemptCount: number;
  /** What the driver is told. Shiprocket requires it; Delhivery has no
   *  field for it, so it is recorded in our audit either way. */
  readonly comment: string;
}

export interface NdrDispatchResult {
  readonly success: boolean;
  readonly awbNumber: string;
  /** Delhivery decides asynchronously and hands back an id to poll.
   *  Shiprocket answers synchronously, so this is null there — the
   *  absence is the honest signal, not a missing feature. */
  readonly uplId: string | null;
  readonly message: string | null;
}

export interface NdrDispatchEligibility {
  readonly eligible: boolean;
  readonly reason: string | null;
}

/**
 * One NDR request, whichever courier has the parcel.
 *
 * ── WHY A DISPATCHER RATHER THAN A BRANCH IN THE ACTION SERVICE ──────
 * The same reason the AWB saga got one. `courier-shipment-action` owns
 * the things that must happen identically no matter who carries the
 * parcel — the audit row, the operator attribution, CUR-11's refusal to
 * move the order — and none of that should be written twice with a
 * chance of drifting. This is the only place that knows Delhivery's
 * eligibility comes from an NSL code table while Shiprocket's comes
 * from an attempt count and a required comment.
 *
 * ── WHAT IS GENUINELY DIFFERENT, AND STAYS VISIBLE ───────────────────
 * Delhivery is ASYNC: accepting a re-attempt returns a UPL id and the
 * outcome must be polled. Shiprocket is SYNCHRONOUS: the reply is the
 * verdict. Flattening that would mean either inventing an id nobody can
 * poll, or dropping Delhivery's. So `uplId` is nullable and the caller
 * reports what actually happened.
 */
@Injectable()
export class CourierNdrDispatchService {
  private readonly logger = new Logger(CourierNdrDispatchService.name);

  constructor(
    private readonly delhivery: DelhiveryNdrService,
    private readonly shiprocket: ShiprocketNdrService,
  ) {}

  /**
   * Can this action work, asked before the operator clicks.
   *
   * Answering locally is the point: both couriers refuse an ineligible
   * request, and a refusal an operator has to decode from a raw courier
   * message is worse than a button that explains why it is disabled.
   */
  checkEligibility(input: NdrDispatchInput): NdrDispatchEligibility {
    switch (input.courierCode) {
      case 'shiprocket':
        if (input.courierAccountId === null) {
          return { eligible: false, reason: 'No Shiprocket account recorded on this shipment' };
        }
        return this.shiprocket.checkEligibility({
          action: input.action === 'RE-ATTEMPT' ? 'RE-ATTEMPT' : 'RETURN',
          attemptCount: input.attemptCount,
          comment: input.comment,
        });
      case 'delhivery':
        return this.delhivery.checkEligibility({
          awbNumber: input.awbNumber,
          action: input.action,
          currentNslCode: input.currentNslCode,
          attemptCount: input.attemptCount,
        });
      default:
        // A manual courier is a person and a phone call (CUR-8). Saying
        // "not eligible" is the truth an operator can act on; pretending
        // otherwise would offer a button that cannot do anything.
        return {
          eligible: false,
          reason: `${input.courierCode} is booked by hand — arrange the re-attempt with them directly`,
        };
    }
  }

  async takeAction(
    input: NdrDispatchInput,
    actor: CourierCredentialActor,
  ): Promise<NdrDispatchResult> {
    switch (input.courierCode) {
      case 'shiprocket': {
        if (input.courierAccountId === null) {
          return {
            success: false,
            awbNumber: input.awbNumber,
            uplId: null,
            message: 'No Shiprocket account recorded on this shipment',
          };
        }
        const eligibility = this.checkEligibility(input);
        if (!eligibility.eligible) {
          return {
            success: false,
            awbNumber: input.awbNumber,
            uplId: null,
            message: eligibility.reason,
          };
        }
        const r = await this.shiprocket.takeAction({
          awbNumber: input.awbNumber,
          // PICKUP_RESCHEDULE has no Shiprocket counterpart; the nearest
          // honest thing is a return, and offering it silently as a
          // reschedule would be a lie about what happens to the parcel.
          action: input.action === 'RE-ATTEMPT' ? 'RE-ATTEMPT' : 'RETURN',
          courierAccountId: input.courierAccountId,
          comment: input.comment,
        });
        return { success: r.success, awbNumber: r.awbNumber, uplId: null, message: r.message };
      }
      case 'delhivery': {
        const r = await this.delhivery.takeAction(
          {
            awbNumber: input.awbNumber,
            action: input.action,
            currentNslCode: input.currentNslCode,
            attemptCount: input.attemptCount,
          },
          actor,
        );
        return { success: r.success, awbNumber: r.awbNumber, uplId: r.uplId, message: r.message };
      }
      default:
        this.logger.log(
          { courierCode: input.courierCode, awbNumber: input.awbNumber },
          'NDR action asked of a courier with no integration — manual only',
        );
        return {
          success: false,
          awbNumber: input.awbNumber,
          uplId: null,
          message: `${input.courierCode} is booked by hand — arrange the re-attempt with them directly`,
        };
    }
  }
}
