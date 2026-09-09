import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SettingsResolverService } from '../../settings/services/settings-resolver.service';
import { ShiprocketClientService } from '../../courier-shiprocket/services/shiprocket-client.service';
import {
  CourierOptionSelectionService,
  type CourierOption,
  type CourierSelectionPolicy,
} from '../../courier-shared/services/courier-option-selection.service';

const POLICY_KEY = 'courier.selection_policy';
/**
 * Where our parcels are collected from.
 *
 * The key is named for Delhivery and is read by four other services as
 * the ONE origin pin — it is the building's pincode, not a courier's
 * opinion of it, and the name is historical. Reading it here keeps that
 * count at five rather than introducing a second key that would drift
 * from the first the day somebody moved warehouse.
 */
const ORIGIN_PIN_KEY = 'courier.delhivery_origin_pincode';
const MAX_DAYS_KEY = 'courier.selection_max_days';

/** Every policy the settings key may hold. A value outside this set is
 *  a typo in the database, and is treated as SHIPROCKET_DEFAULT rather
 *  than throwing — a bad setting must not strand a real parcel. */
const POLICIES: readonly CourierSelectionPolicy[] = [
  'SHIPROCKET_DEFAULT',
  'CHEAPEST',
  'FASTEST',
  'CHEAPEST_WITHIN_DAYS',
  'MANUAL',
];

export interface ChoiceInput {
  readonly shipmentId: string;
  readonly courierCode: string;
  readonly courierAccountId: string;
  readonly sellerId: string | null;
  readonly deliveryPincode: string;
  /**
   * A decision somebody already made — an operator on the decision
   * screen, or the TTL sweep choosing on their behalf.
   *
   * Read FIRST and short-circuits everything below. Without it a
   * MANUAL-policy parcel would be paused again the instant it was
   * un-paused, which is a loop rather than a workflow.
   */
  readonly chosenCourierCompanyId?: number | null;
  readonly weightGrams: number;
  readonly isCod: boolean;
}

export type ChoiceOutcome =
  /** Book now. `courierCompanyId` null means "let the carrier rank". */
  | { readonly kind: 'BOOK'; readonly courierCompanyId: number | null; readonly why: string }
  /** Stop and put it in front of a person. */
  | { readonly kind: 'PAUSE'; readonly options: readonly CourierOption[]; readonly why: string };

/**
 * CUR-17 — WHICH carrier carries the parcel, when the courier is an
 * aggregator that offers several.
 *
 * Delhivery IS a carrier: booking with them is the choice. Shiprocket
 * resells a dozen, quotes them all, and will rank them itself if we say
 * nothing — which is a real answer, and the default, but not one a
 * seller should be stuck with. This service is the ONE place that turns
 * a seller's policy into a carrier, and it is deliberately thin: the
 * arithmetic lives in the pure `CourierOptionSelectionService` and the
 * wire call lives in the adapter.
 *
 * ── EVERY FAILURE HERE BOOKS ANYWAY ──────────────────────────────────
 * A serviceability call that times out, a setting that will not read, a
 * courier with no options endpoint — none of those are reasons to stop
 * a parcel. They all resolve to `BOOK` with no `courierCompanyId`,
 * which is exactly the behaviour before this existed: Shiprocket picks.
 * The failure mode this avoids is the expensive one — a choice layer
 * that goes down and takes the day's dispatches with it.
 */
@Injectable()
export class CourierChoiceService {
  private readonly logger = new Logger(CourierChoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
    private readonly shiprocket: ShiprocketClientService,
    private readonly selection: CourierOptionSelectionService,
  ) {}

  async decide(input: ChoiceInput): Promise<ChoiceOutcome> {
    // Only an aggregator has anything to decide. Asking Delhivery which
    // Delhivery to use is a category error, and routing it through the
    // policy would make a MANUAL seller's Delhivery parcels wait for a
    // decision screen with one button on it.
    if (input.courierCode !== 'shiprocket') {
      return { kind: 'BOOK', courierCompanyId: null, why: 'this courier is the carrier' };
    }

    if (input.chosenCourierCompanyId != null) {
      return {
        kind: 'BOOK',
        courierCompanyId: input.chosenCourierCompanyId,
        why: 'a carrier was already chosen for this parcel',
      };
    }

    const policy = await this.policyFor(input.sellerId);

    // The DEFAULT costs no call. Fetching options we will not read, on
    // every confirmed order, would add a live API round-trip to the
    // critical path of the most common configuration for no benefit.
    if (policy.policy === 'SHIPROCKET_DEFAULT') {
      return {
        kind: 'BOOK',
        courierCompanyId: null,
        why: 'policy leaves the choice to the carrier',
      };
    }

    // The lane needs both ends. With no origin configured there is
    // nothing to quote, so we book the way we always did rather than
    // holding the parcel over a missing setting.
    const pickupPincode = await this.originPincode();
    if (pickupPincode === null) {
      return { kind: 'BOOK', courierCompanyId: null, why: 'no origin pincode is configured' };
    }

    let options: readonly CourierOption[] = [];
    try {
      const r = await this.shiprocket.listCourierOptions(
        {
          pickupPincode,
          deliveryPincode: input.deliveryPincode,
          weightGrams: input.weightGrams,
          isCod: input.isCod,
        },
        input.courierAccountId,
      );
      options = r.options;
    } catch (err) {
      this.logger.warn(
        { shipmentId: input.shipmentId, err: err instanceof Error ? err.message : String(err) },
        'could not list courier options — booking with the carrier’s own choice',
      );
      return { kind: 'BOOK', courierCompanyId: null, why: 'the options call failed' };
    }

    // Persisted whatever the outcome, and BEFORE the decision is acted
    // on. If a person later asks why a parcel went by the courier it
    // did, the answer is the list that was on the table at the time —
    // rates move, and re-fetching a week later answers a different
    // question. Best-effort: a write failure must not stop the booking.
    await this.persistOptions(input.shipmentId, options);

    const outcome = this.selection.select(options, policy.policy, policy.maxDays);
    switch (outcome.kind) {
      case 'CHOSEN':
        return {
          kind: 'BOOK',
          courierCompanyId: outcome.option.courierCompanyId,
          why: outcome.why,
        };
      case 'DEFER_TO_CARRIER':
        return { kind: 'BOOK', courierCompanyId: null, why: outcome.why };
      case 'ASK_A_HUMAN':
        return { kind: 'PAUSE', options, why: outcome.why };
      default: {
        const exhaustive: never = outcome;
        throw new Error(`Unhandled selection outcome: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /**
   * The policy and its deadline, per seller, through SET-1.
   *
   * FAILS OPEN to the carrier's own choice. A settings outage that
   * stopped every booking would be a far worse failure than one that
   * books the way the system did before policies existed.
   */
  async policyFor(
    sellerId: string | null,
  ): Promise<{ readonly policy: CourierSelectionPolicy; readonly maxDays: number }> {
    if (sellerId === null) return { policy: 'SHIPROCKET_DEFAULT', maxDays: 5 };
    try {
      const [p, d] = await Promise.all([
        this.settings.resolve(sellerId, POLICY_KEY),
        this.settings.resolve(sellerId, MAX_DAYS_KEY),
      ]);
      const raw = typeof p.value === 'string' ? p.value.trim().toUpperCase() : '';
      const policy = POLICIES.find((x) => x === raw) ?? 'SHIPROCKET_DEFAULT';
      const maxDays = typeof d.value === 'number' && d.value > 0 ? d.value : 5;
      return { policy, maxDays };
    } catch (err) {
      this.logger.warn(
        { sellerId, err: err instanceof Error ? err.message : String(err) },
        'could not resolve the courier selection policy — leaving the choice to the carrier',
      );
      return { policy: 'SHIPROCKET_DEFAULT', maxDays: 5 };
    }
  }

  /** Best-effort, and null on anything unexpected — see the class note. */
  private async originPincode(): Promise<string | null> {
    try {
      const row = await this.prisma.client.systemSetting.findUnique({
        where: { key: ORIGIN_PIN_KEY },
        select: { valueString: true },
      });
      const pin = row?.valueString?.trim() ?? '';
      return pin === '' ? null : pin;
    } catch {
      return null;
    }
  }

  private async persistOptions(
    shipmentId: string,
    options: readonly CourierOption[],
  ): Promise<void> {
    try {
      await this.prisma.client.shipment.update({
        where: { id: shipmentId },
        data: {
          courierOptions: options as unknown as object[],
          courierOptionsFetchedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        { shipmentId, err: err instanceof Error ? err.message : String(err) },
        'could not record the courier options',
      );
    }
  }
}
