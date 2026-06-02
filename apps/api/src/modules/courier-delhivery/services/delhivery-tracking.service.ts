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
   * Stub raw-code → ShipmentStatus table (DLV- prefix; intentionally
   * distinguishable from real Delhivery codes so no collision).
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

  /**
   * Real-mode mapping — Delhivery's published "Status Push" taxonomy
   * uses StatusType codes (two/three letters). Documented set as of
   * 2025-Q4 docs:
   *
   *   StatusType         Meaning                          → ShipmentStatus
   *   ---------          -------                          ---------------
   *   PU                 Manifested / pickup awaited      (informational; not mapped)
   *   IT / UD            In transit / At hub              IN_TRANSIT
   *   OFD                Out for delivery                 OUT_FOR_DELIVERY
   *   DL / DLVD          Delivered                        DELIVERED
   *   UD-EOD / UD-NDR    Undelivered / NDR                DELIVERY_ATTEMPTED
   *   RT / DTO           RTO initiated                    RTO_INITIATED
   *   RT-IT              RTO in transit                   RTO_IN_TRANSIT
   *   RT-DLVD            RTO delivered to seller          RTO_DELIVERED
   *   LT                 Lost in transit                  LOST
   *   DG                 Damaged in transit               DAMAGED
   *
   * Any other code → UNMAPPABLE (still audited as a tracking_event).
   * The list is best-effort against the public docs; the sandbox-smoke
   * surfaces real codes that don't appear here as STUB-style audit
   * entries the operator can review.
   */
  private static readonly REAL_TABLE: ReadonlyMap<string, ShipmentStatus> =
    new Map([
      ['IT', ShipmentStatus.IN_TRANSIT],
      ['UD', ShipmentStatus.IN_TRANSIT],
      ['OFD', ShipmentStatus.OUT_FOR_DELIVERY],
      ['DL', ShipmentStatus.DELIVERED],
      ['DLVD', ShipmentStatus.DELIVERED],
      ['UD-EOD', ShipmentStatus.DELIVERY_ATTEMPTED],
      ['UD-NDR', ShipmentStatus.DELIVERY_ATTEMPTED],
      ['NDR', ShipmentStatus.DELIVERY_ATTEMPTED],
      ['RT', ShipmentStatus.RTO_INITIATED],
      ['DTO', ShipmentStatus.RTO_INITIATED],
      ['RT-IT', ShipmentStatus.RTO_IN_TRANSIT],
      ['RT-DLVD', ShipmentStatus.RTO_DELIVERED],
      ['LT', ShipmentStatus.LOST],
      ['DG', ShipmentStatus.DAMAGED],
    ]);

  normalizeScan(raw: DelhiveryRawScan): NormalizedScan {
    const code = raw.rawStatus.trim().toUpperCase();
    // Try the stub table first (DLV- prefixed) for back-compat with
    // existing e2e specs; then the real table.
    const stub = DelhiveryTrackingService.STUB_TABLE.get(code);
    if (stub !== undefined) {
      return { kind: 'NORMALIZED', shipmentStatus: stub };
    }
    const real = DelhiveryTrackingService.REAL_TABLE.get(code);
    if (real !== undefined) {
      return { kind: 'NORMALIZED', shipmentStatus: real };
    }
    this.logger.debug(
      { awbNumber: raw.awbNumber, rawStatus: raw.rawStatus },
      'normalizeScan: unmappable raw code',
    );
    return {
      kind: 'UNMAPPABLE',
      reason: code.startsWith('DLV-') ? 'STUB_UNKNOWN_CODE' : 'UNKNOWN_COURIER_CODE',
    };
  }
}
