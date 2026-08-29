import { Injectable, Logger } from '@nestjs/common';
import type { CourierCredentialActor } from '../../courier-shared/services/courier-credential.service';
import { toIsoWithIst } from '../../tracking-events/services/courier-time';
import { DelhiveryHttpService } from './delhivery-http.service';
import type {
  CourierParcelFacts,
  CourierTrackingResult,
  DelhiveryClient,
  DelhiveryRawScan,
} from '../types/delhivery.types';

/**
 * Module 10 (poll) — Delhivery tracking FETCH. Implements the
 * `fetchTracking` slice of the `DelhiveryClient` adapter. The polling
 * counterpart to `normalizeScan` (which is pure): this service does the
 * network call; `normalizeScan` classifies each returned scan.
 *
 * ── STUB MODE (default, Phase 1A) ─────────────────────────────────
 * Returns `[]` — no network. The poll worker therefore does nothing in
 * stub mode / e2e / CI. Real mode is reached only when
 * `courier.delhivery_api_base_url` is set (the go-live switch).
 *
 * ── REAL MODE ──────────────────────────────────────────────────────
 * Validated against the live API (2026-07): the account is B2C
 * self-serve — Delhivery pushes NO webhooks, so tracking is poll-based.
 *
 *   GET /api/v1/packages/json/?waybill=<comma-separated, ≤50>
 *
 * Response (confirmed live):
 *   { ShipmentData: [ { Shipment: {
 *       AWB, Status: { Status, StatusType, StatusCode, Instructions },
 *       Scans: [ { ScanDetail: {
 *         Scan, ScanType, ScanDateTime, ScannedLocation, StatusCode,
 *         Instructions } } ] } } ] }
 *
 * We marshal each `ScanDetail` into a `DelhiveryRawScan` with
 * `rawStatus = ScanDetail.Scan` PLUS the StatusType and NSL — the
 * status string alone is ambiguous ("In Transit" means opposite
 * directions under UD and RT), so the mapping needs the pair; see
 * `DelhiveryTrackingService.normalizeScan`. Scan
 * timestamps come back in IST with no offset (e.g.
 * `2026-07-25T19:32:50.228`); we normalise to `+05:30` so the stored
 * `tracking_events.eventAt` (TRK-3) lands at the correct instant.
 */

interface DelhiveryScanDetail {
  Scan?: string;
  /** The journey leg: UD / DL / RT / PP / PU / CN. Delhivery uses both
   *  `ScanType` and `StatusType` for this depending on the surface, so
   *  both are read. */
  ScanType?: string;
  StatusType?: string;
  ScanDateTime?: string;
  StatusDateTime?: string;
  ScannedLocation?: string;
  StatusCode?: string;
  /** NSL — the fine-grained reason under the status (e.g. EOD-74). */
  NSLCode?: string;
  Instructions?: string;
}

interface DelhiveryShipment {
  AWB?: string | number;
  Scans?: Array<{ ScanDetail?: DelhiveryScanDetail }>;

  /**
   * ── THE ENVELOPE WE USED TO THROW AWAY ─────────────────────────────
   * The parser read `AWB` and `Scans` and dropped the rest, so the
   * weight Delhivery actually charges us for, the date they now expect
   * to deliver, and the amount they will collect at the door were all
   * arriving on every poll and being discarded. Their own panel shows
   * all three; ours could not, because we never kept them.
   *
   * Every one is optional and read defensively. Their naming varies
   * across surfaces and account types — hence the alternates below —
   * and a field that is absent must read as "not stated" rather than
   * as a zero.
   */
  Status?: {
    Status?: string;
    StatusType?: string;
    StatusDateTime?: string;
    StatusLocation?: string;
    Instructions?: string;
  };
  /** Their belt weight, in GRAMS. */
  ChargedWeight?: number | string | null;
  /** Seen as both on different surfaces. */
  ExpectedDeliveryDate?: string | null;
  PromisedDeliveryDate?: string | null;
  EDD?: string | null;
  PickUpDate?: string | null;
  /** What they will collect at the door. */
  CODAmount?: number | string | null;
  Sortcode?: string | null;
  ReferenceNo?: string | number | null;
}

interface DelhiveryTrackResponse {
  ShipmentData?: Array<{ Shipment?: DelhiveryShipment }>;
  /** Present and false when the call failed — with HTTP 200. */
  Success?: boolean;
  Error?: string;
  rmk?: string;
}

/** Delhivery scan timestamps are IST without a zone offset — the
 *  courier operates in India. Append the IST offset when the string
 *  carries none so Date parses to the correct instant. */

/** A courier number that may arrive as a string, or not at all. */
function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  // NaN and negatives are refused rather than stored: a negative
  // chargeable weight is not a fact, it is a parse that went wrong, and
  // storing it would put it on an invoice.
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** A courier date, IST and usually without a zone. */
function when(v: string | null | undefined): Date | null {
  const raw = (v ?? '').trim();
  if (raw === '') return null;
  const d = new Date(toIsoWithIst(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Read the parcel-level facts, taking the first field that is actually
 * present.
 *
 * The alternates are not defensive padding — Delhivery names the
 * expected-delivery field differently across their surfaces, and a
 * parser that knows only one name reports "no ETA" on an account that
 * has been sending one all along.
 */
function parcelFacts(shipment: DelhiveryShipment): CourierParcelFacts {
  const cod = num(shipment.CODAmount);
  return {
    chargedWeightGrams: num(shipment.ChargedWeight),
    expectedDeliveryAt: when(shipment.ExpectedDeliveryDate ?? shipment.EDD),
    promisedDeliveryAt: when(shipment.PromisedDeliveryDate),
    pickedUpAt: when(shipment.PickUpDate),
    // A string, because money is a string everywhere else in this
    // codebase and a float here would round differently than every
    // other figure on the page.
    collectableAmountInr: cod === null ? null : cod.toFixed(2),
    sortCode: shipment.Sortcode ?? null,
    currentStatus: shipment.Status?.Status ?? null,
    currentStatusLocation: shipment.Status?.StatusLocation ?? null,
    currentInstructions: shipment.Status?.Instructions ?? null,
  };
}

@Injectable()
export class DelhiveryTrackingFetchService implements Pick<DelhiveryClient, 'fetchTracking'> {
  private readonly logger = new Logger(DelhiveryTrackingFetchService.name);

  /** Delhivery caps a single tracking call at 50 waybills. */
  static readonly MAX_WAYBILLS_PER_CALL = 50;

  constructor(private readonly http: DelhiveryHttpService) {}

  async fetchTracking(
    awbNumbers: string[],
    actor?: CourierCredentialActor,
  ): Promise<CourierTrackingResult[]> {
    const awbs = awbNumbers.map((a) => a.trim()).filter((a) => a !== '');
    if (awbs.length === 0) return [];

    // STUB MODE — the poller is inert (no network). Phase-1A default.
    if (await this.http.isStubMode()) {
      return [];
    }

    if (awbs.length > DelhiveryTrackingFetchService.MAX_WAYBILLS_PER_CALL) {
      throw new Error(
        `fetchTracking called with ${awbs.length} waybills; max is ${DelhiveryTrackingFetchService.MAX_WAYBILLS_PER_CALL} (the poll service must batch)`,
      );
    }

    const response = await this.http.request<DelhiveryTrackResponse>({
      actor,
      method: 'GET',
      path: `/api/v1/packages/json/?waybill=${encodeURIComponent(awbs.join(','))}`,
      endpoint: 'tracking',
    });

    // Delhivery signals tracking failures IN THE BODY with HTTP 200 —
    // verified against production, where an unknown AWB returns
    // `{"Success": false, "Error": "Data does not exists for provided
    // Waybill(s)"}`. `res.ok` is therefore not the answer: without this
    // check the poller reads a failure as "no new scans" and goes quiet
    // on exactly the shipments that need attention. And since a failed
    // webhook push is retried once and then dropped FOREVER, the poller
    // is the only backstop there is.
    if (response.Success === false) {
      const message = response.Error ?? response.rmk ?? 'unknown tracking error';
      this.logger.warn(
        { awbs: awbs.length, message },
        'Delhivery tracking returned an in-body failure (HTTP 200)',
      );
      throw new Error(`Delhivery tracking failed: ${message}`);
    }

    const results: CourierTrackingResult[] = [];
    for (const entry of response.ShipmentData ?? []) {
      const shipment = entry.Shipment;
      if (!shipment) continue;
      const awbNumber = String(shipment.AWB ?? '').trim();
      if (awbNumber === '') continue;

      const scans: DelhiveryRawScan[] = [];
      for (const s of shipment.Scans ?? []) {
        const d = s.ScanDetail;
        if (!d) continue;
        const rawStatus = (d.Scan ?? '').trim();
        const when = (d.ScanDateTime ?? d.StatusDateTime ?? '').trim();
        if (rawStatus === '' || when === '') continue;
        scans.push({
          awbNumber,
          rawStatus,
          // The journey leg and the NSL are what make the scan
          // unambiguous — see DelhiveryTrackingService.normalizeScan.
          statusType: d.StatusType ?? d.ScanType ?? null,
          nslCode: d.NSLCode ?? null,
          eventAtIso: toIsoWithIst(when),
          locationName: d.ScannedLocation ?? null,
          locationCity: d.ScannedLocation ?? null,
          locationPincode: null,
          description: d.Instructions ?? null,
          failureReason: d.Instructions ?? null,
        });
      }
      // Oldest-first so the poll service applies scans in order.
      scans.sort((a, b) => a.eventAtIso.localeCompare(b.eventAtIso));
      results.push({ awbNumber, scans, facts: parcelFacts(shipment) });
    }

    this.logger.debug(
      { requested: awbs.length, returned: results.length },
      'Delhivery fetchTracking complete',
    );
    return results;
  }
}
