import { Injectable, Logger } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import type {
  DelhiveryClient,
  DelhiveryRawScan,
  NormalizedScan,
} from '../types/delhivery.types';

/**
 * Module 10 — Delhivery scan normalization (commit 6, F8). Implements
 * the `normalizeScan` slice of the `DelhiveryClient` adapter
 * interface. The fourth capability service alongside the M9 trio
 * (AWB / label / serviceability).
 *
 * ── STUB MODE (default, Phase 1A) ─────────────────────────────────
 * A deterministic raw-code → ShipmentStatus table — every test path
 * the M10 e2e exercises lives here. The codes are PREFIXED `DLV-` so
 * no real Delhivery code could collide with a stub (stubs are
 * intentionally distinguishable).
 *
 *   DLV-IN-TRANSIT   → IN_TRANSIT
 *   DLV-OFD          → OUT_FOR_DELIVERY
 *   DLV-DELIVERED    → DELIVERED
 *   DLV-NDR          → DELIVERY_ATTEMPTED (NDR — failed delivery
 *                      attempt, processor maps to DELIVERY_FAILED
 *                      and writes a delivery_attempts row)
 *   DLV-RTO-INIT     → RTO_INITIATED
 *   DLV-RTO-IT       → RTO_IN_TRANSIT
 *   DLV-RTO-DEL      → RTO_DELIVERED (TRK-6 — informational only;
 *                      the warehouse boundary owns RTO_RECEIVED)
 *   DLV-LOST         → LOST
 *   DLV-DAMAGED      → DAMAGED (informational only — RTO_DAMAGED is
 *                      a warehouse-finalize disposition, not a scan
 *                      terminal)
 *
 * Anything else → UNMAPPABLE — the processor still records the raw
 * scan on tracking_events (audit) but emits NO order transition.
 *
 * ── REAL MODE (TODO(delhivery-api)) ───────────────────────────────
 * Delhivery's real scan codes / status taxonomy is NOT reliably
 * known at build time. The real-mode path throws — the table above
 * is what every M10 test exercises. Validating the real table is a
 * separate sandbox task (alongside the M9 wire seams + the HMAC
 * scheme + the webhook header name from M10 commit 4/5).
 */
@Injectable()
export class DelhiveryTrackingService
  implements Pick<DelhiveryClient, 'normalizeScan'>
{
  private readonly logger = new Logger(DelhiveryTrackingService.name);

  /**
   * Stub raw-code → ShipmentStatus table. The keys are deliberately
   * exhaustive over our test paths; an unknown raw code is a
   * STUB_UNKNOWN_CODE → UNMAPPABLE (still audited downstream).
   */
  private static readonly STUB_TABLE: ReadonlyMap<string, ShipmentStatus> =
    new Map([
      ['DLV-IN-TRANSIT', ShipmentStatus.IN_TRANSIT],
      ['DLV-OFD', ShipmentStatus.OUT_FOR_DELIVERY],
      ['DLV-DELIVERED', ShipmentStatus.DELIVERED],
      ['DLV-NDR', ShipmentStatus.DELIVERY_ATTEMPTED],
      ['DLV-RTO-INIT', ShipmentStatus.RTO_INITIATED],
      ['DLV-RTO-IT', ShipmentStatus.RTO_IN_TRANSIT],
      ['DLV-RTO-DEL', ShipmentStatus.RTO_DELIVERED],
      ['DLV-LOST', ShipmentStatus.LOST],
      ['DLV-DAMAGED', ShipmentStatus.DAMAGED],
    ]);

  normalizeScan(raw: DelhiveryRawScan): NormalizedScan {
    // Stub mode is the only operational mode in Phase 1A. Real-mode
    // mapping is a separate sandbox-validation task — see the
    // TODO(delhivery-api) note on the class JSDoc.
    const code = raw.rawStatus.trim().toUpperCase();
    const status = DelhiveryTrackingService.STUB_TABLE.get(code);
    if (status === undefined) {
      this.logger.debug(
        { awbNumber: raw.awbNumber, rawStatus: raw.rawStatus },
        'normalizeScan: unmappable raw code (stub)',
      );
      return { kind: 'UNMAPPABLE', reason: 'STUB_UNKNOWN_CODE' };
    }
    return { kind: 'NORMALIZED', shipmentStatus: status };
  }
}
