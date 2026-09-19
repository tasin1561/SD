import type {
  CourierTrackingResult,
  NormalizedScan,
} from '../../courier-delhivery/types/delhivery.types';

/**
 * What the tracking poller needs from a courier, and nothing else.
 *
 * ── WHY AN INTERFACE RATHER THAN A BRANCH IN THE POLLER ──────────────
 * The poll cycle is the careful part: batching, per-batch failure
 * isolation, the heartbeat that only stamps when tracking actually
 * moved, the alarm when stub mode would silently mean "tracking is
 * off". None of that is courier-specific and none of it should exist
 * twice. What IS courier-specific is small and lives here: how many
 * AWBs fit in one call, whether calls are per-account, and how a raw
 * status string becomes a scan.
 *
 * The alternative — a second poller for Shiprocket — would mean two
 * copies of the escalation logic, and the copy nobody is looking at is
 * the one that stops working.
 */
export interface CourierTrackingSource {
  readonly courierCode: string;

  /** No base URL configured: the adapter never reaches the network. */
  isStubMode(): Promise<boolean>;

  /** Their cap per call. Delhivery takes 50 waybills; Shiprocket is
   *  one AWB per request, so its "batch" is a loop it does itself. */
  readonly maxAwbsPerCall: number;

  /**
   * Whether tracking calls must be made PER COURIER ACCOUNT.
   *
   * Delhivery's poller uses one set of credentials for the whole
   * estate. Shiprocket's token is per account, so a parcel booked on
   * account B is invisible to account A's token — polling it with the
   * wrong one returns "not found", which reads exactly like a parcel
   * that has not moved.
   */
  readonly perAccount: boolean;

  /**
   * @param courierAccountId null when `perAccount` is false.
   */
  fetchTracking(
    awbNumbers: readonly string[],
    courierAccountId: string | null,
  ): Promise<CourierTrackingResult[]>;

  /**
   * Raw courier status → our vocabulary. Pure; no network.
   *
   * ── THE WHOLE SCAN, NOT THREE FIELDS OF IT ───────────────────────
   * This declared only `{awbNumber, rawStatus, eventAtIso}`, which is
   * narrower than every implementation actually accepts and narrower
   * than the webhook processor has. The processor got away with it
   * because it injected Delhivery's adapter CONCRETELY as a fallback,
   * so the call was typed against the class rather than this interface;
   * removing that fallback (a courier with no source is now refused by
   * name rather than read as Delhivery) is what exposed the gap.
   *
   * The extra fields are load-bearing, not decoration: without
   * `statusType` a return leg cannot be told from ordinary transit, and
   * without `nslCode` an NDR looks like transit too (D5) — so an
   * interface that dropped them would have quietly degraded any
   * implementation reached through it.
   */
  normalizeScan(raw: {
    awbNumber: string;
    rawStatus: string;
    eventAtIso: string;
    statusType?: string | null;
    nslCode?: string | null;
    locationName?: string | null;
    locationCity?: string | null;
    locationPincode?: string | null;
    description?: string | null;
    failureReason?: string | null;
  }): NormalizedScan;

  /**
   * What an operator must actually do if this source is in stub mode
   * while real parcels are in flight. Named per courier because the
   * setting key differs and "set the base URL" is not actionable
   * without knowing which one.
   */
  readonly stubRemedy: string;
}

/** DI token — the poller injects every registered source. */
export const COURIER_TRACKING_SOURCES = Symbol('COURIER_TRACKING_SOURCES');
