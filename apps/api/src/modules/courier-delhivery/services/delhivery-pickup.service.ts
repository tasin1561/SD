import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import { DelhiveryWriteGuardService } from './delhivery-write-guard.service';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';

export interface PickupRequestInput {
  /** Must match a registered pickup location EXACTLY (case + spaces). */
  readonly pickupLocation: string;
  /** YYYY-MM-DD. */
  readonly pickupDate: string;
  /** HH:mm:ss. */
  readonly pickupTime: string;
  readonly expectedPackageCount: number;
}

export interface PickupRequestResult {
  readonly success: boolean;
  readonly pickupId: string | null;
  readonly message: string | null;
  readonly raw: unknown;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

/**
 * Asking Delhivery to send a van.
 *
 * ── THE SHAPE THAT SURPRISES PEOPLE ──────────────────────────────────
 * A pickup request is raised against a WAREHOUSE, not a waybill. Twenty
 * parcels leaving the same building need ONE request, not twenty — and
 * requesting per parcel would summon a fleet. Two warehouses shipping
 * the same day need one request each.
 *
 * Delhivery also allows only one OPEN request per warehouse per day: a
 * second can be raised "only when the existing pickup request is
 * closed". So this is not an idempotent call we can retry freely; a
 * blind retry after a timeout risks either a duplicate van or a
 * confusing rejection. Callers should treat a failure as "check the One
 * panel", not "try again in a loop".
 *
 * Timing matters too: the right moment is when parcels are packed and
 * ready to hand over, not when they are manifested.
 *
 * Integration is optional — pickups can be raised from the One panel, or
 * the account can be set to auto-pickup by Delhivery's team. Worth
 * knowing before wiring this into an automated flow.
 */
@Injectable()
export class DelhiveryPickupService {
  private readonly logger = new Logger(DelhiveryPickupService.name);

  constructor(
    private readonly http: DelhiveryHttpService,
    private readonly writeGuard: DelhiveryWriteGuardService,
  ) {}

  async requestPickup(
    input: PickupRequestInput,
    actor?: CourierCredentialActor,
  ): Promise<PickupRequestResult> {
    this.validate(input);

    if (await this.http.isStubMode()) {
      return { success: true, pickupId: 'STUB-PICKUP', message: 'stub', raw: null };
    }
    // A real van, driven by a real person, to a real building.
    await this.writeGuard.assertWritable('pickup.request', {
      pickupLocation: input.pickupLocation,
      pickupDate: input.pickupDate,
      packages: input.expectedPackageCount,
    });

    const raw = await this.http.request<Record<string, unknown>>({
      actor,
      method: 'POST',
      path: '/fm/request/new/',
      endpoint: 'pickup',
      encoding: 'json',
      body: {
        pickup_location: input.pickupLocation,
        pickup_date: input.pickupDate,
        pickup_time: input.pickupTime,
        expected_package_count: input.expectedPackageCount,
      },
    });

    const pickupId = (raw['pickup_id'] as string | number | undefined)?.toString() ?? null;
    const message =
      (raw['error'] as string | undefined) ??
      (raw['prn'] as string | undefined) ??
      (raw['message'] as string | undefined) ??
      null;
    // Delhivery reports failure in the body while answering 200.
    const success = raw['error'] === undefined && pickupId !== null;

    if (!success) {
      this.logger.warn(
        { ...input, message },
        'Delhivery pickup request rejected — check the One panel before retrying (one open request per warehouse per day)',
      );
    } else {
      this.logger.log({ pickupId, ...input }, 'Delhivery pickup requested');
    }
    return { success, pickupId, message, raw };
  }

  private validate(input: PickupRequestInput): void {
    if (!DATE_RE.test(input.pickupDate)) {
      throw new Error(`pickupDate must be YYYY-MM-DD, got '${input.pickupDate}'`);
    }
    if (!TIME_RE.test(input.pickupTime)) {
      throw new Error(`pickupTime must be HH:mm:ss, got '${input.pickupTime}'`);
    }
    if (!Number.isInteger(input.expectedPackageCount) || input.expectedPackageCount < 1) {
      throw new Error(
        `expectedPackageCount must be a positive integer, got ${input.expectedPackageCount}`,
      );
    }
    if (input.pickupLocation !== input.pickupLocation.trim()) {
      // Same trap as warehouse registration: the name is matched exactly.
      throw new Error(
        `pickupLocation '${input.pickupLocation}' has surrounding whitespace; Delhivery matches the registered name exactly`,
      );
    }
  }
}
