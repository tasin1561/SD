import { Injectable, Logger } from '@nestjs/common';
import { DelhiveryHttpService } from './delhivery-http.service';
import type {
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
 * `rawStatus = ScanDetail.Scan` (the human status string — the most
 * stable mapping key; see `DelhiveryTrackingService.REAL_TABLE`). Scan
 * timestamps come back in IST with no offset (e.g.
 * `2026-07-25T19:32:50.228`); we normalise to `+05:30` so the stored
 * `tracking_events.eventAt` (TRK-3) lands at the correct instant.
 */

interface DelhiveryScanDetail {
  Scan?: string;
  ScanType?: string;
  ScanDateTime?: string;
  StatusDateTime?: string;
  ScannedLocation?: string;
  StatusCode?: string;
  Instructions?: string;
}

interface DelhiveryShipment {
  AWB?: string | number;
  Scans?: Array<{ ScanDetail?: DelhiveryScanDetail }>;
}

interface DelhiveryTrackResponse {
  ShipmentData?: Array<{ Shipment?: DelhiveryShipment }>;
}

/** Delhivery scan timestamps are IST without a zone offset — the
 *  courier operates in India. Append the IST offset when the string
 *  carries none so Date parses to the correct instant. */
function toIsoWithIst(raw: string): string {
  const s = raw.trim();
  if (s === '') return s;
  // Already zoned (…Z or …+HH:MM / …-HH:MM after the time part)?
  if (/[zZ]$/.test(s) || /T.*[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s}+05:30`;
}

@Injectable()
export class DelhiveryTrackingFetchService
  implements Pick<DelhiveryClient, 'fetchTracking'>
{
  private readonly logger = new Logger(DelhiveryTrackingFetchService.name);

  /** Delhivery caps a single tracking call at 50 waybills. */
  static readonly MAX_WAYBILLS_PER_CALL = 50;

  constructor(private readonly http: DelhiveryHttpService) {}

  async fetchTracking(
    awbNumbers: string[],
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
      method: 'GET',
      path: `/api/v1/packages/json/?waybill=${encodeURIComponent(awbs.join(','))}`,
      endpoint: 'tracking',
    });

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
      results.push({ awbNumber, scans });
    }

    this.logger.debug(
      { requested: awbs.length, returned: results.length },
      'Delhivery fetchTracking complete',
    );
    return results;
  }
}
