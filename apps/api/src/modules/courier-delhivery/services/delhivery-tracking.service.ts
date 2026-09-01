import { Injectable, Logger } from '@nestjs/common';
import { ShipmentStatus } from '@skydrop/db';
import type { DelhiveryClient, DelhiveryRawScan, NormalizedScan } from '../types/delhivery.types';

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
 * ── REAL MODE ─────────────────────────────────────────────────────
 * Implemented against Delhivery's documented vocabulary: scans are
 * mapped on the (StatusType, Status) PAIR, with an EOD-* NSL on a
 * forward leg recognised as a failed delivery attempt. See the
 * PAIR_TABLE doc below for why the pair is load-bearing.
 */
@Injectable()
export class DelhiveryTrackingService implements Pick<DelhiveryClient, 'normalizeScan'> {
  private readonly logger = new Logger(DelhiveryTrackingService.name);

  /**
   * Stub raw-code → ShipmentStatus table (DLV- prefix; intentionally
   * distinguishable from real Delhivery codes so no collision).
   */
  private static readonly STUB_TABLE: ReadonlyMap<string, ShipmentStatus> = new Map([
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
   * Real-mode mapping, keyed on the (StatusType, Status) PAIR.
   *
   * ── WHY A PAIR AND NOT A CODE ─────────────────────────────────────
   * Delhivery reports two things: a StatusType (which leg of the journey
   * this is) and a Status (which stage). The status alone is ambiguous
   * and dangerously so — "In Transit" under `UD` means the parcel is
   * moving TOWARD the customer, and under `RT` it means it is coming
   * BACK to us. A code-only table maps both to IN_TRANSIT and walks the
   * order forward while the goods return. Same trap with "Dispatched":
   * out for delivery on a forward leg, heading back to our warehouse on
   * a return one.
   *
   * The vocabulary below is Delhivery's own, from the package-lifecycle
   * and webhook pages (docs/delhivery-integration.md §4).
   *
   *   UD  forward leg      Manifested / Not Picked / In Transit /
   *                        Pending / Dispatched
   *   DL  a terminal       Delivered / RTO / DTO
   *   RT  return leg       In Transit / Pending / Dispatched
   *   PP  reverse, pre-    Open / Scheduled / Dispatched
   *       collection
   *   PU  reverse, moving  In Transit / Pending / Dispatched
   *   CN  cancellation     Canceled / Closed
   *
   * Pre-transit states (Manifested, Not Picked) deliberately map to
   * nothing: they are audited as tracking_events but must not fire a
   * lifecycle transition, because the parcel has not moved.
   */
  /**
   * Pairs we KNOW and deliberately do nothing with.
   *
   * A manifest scan means a label exists, not that a parcel moved — the
   * lifecycle must not advance on it. That is a decision, and it is
   * worth being able to tell apart from a pair we have simply never
   * seen: one needs nobody, the other needs the table extending. Both
   * normalise to UNMAPPABLE, so without this list a diagnostic screen
   * reports a correct system as broken.
   */
  static readonly INFORMATIONAL_PAIRS: ReadonlySet<string> = new Set([
    'UD|MANIFESTED',
    'UD|NOT PICKED',
  ]);

  private static readonly PAIR_TABLE: ReadonlyMap<string, ShipmentStatus> = new Map([
    // ── UD: forward leg ──────────────────────────────────────────
    // "Manifested" / "Not Picked" → intentionally unmapped.
    ['UD|IN TRANSIT', ShipmentStatus.IN_TRANSIT],
    ['UD|PENDING', ShipmentStatus.IN_TRANSIT],
    // Delhivery's "Dispatched" is our OUT_FOR_DELIVERY: the parcel is
    // on a vehicle heading to the customer.
    ['UD|DISPATCHED', ShipmentStatus.OUT_FOR_DELIVERY],

    // ── DL: terminals ────────────────────────────────────────────
    ['DL|DELIVERED', ShipmentStatus.DELIVERED],
    ['DL|RTO', ShipmentStatus.RTO_DELIVERED],
    ['DL|DTO', ShipmentStatus.RTO_DELIVERED],

    // ── RT: the return leg. NONE of these are forward movement. ──
    ['RT|IN TRANSIT', ShipmentStatus.RTO_IN_TRANSIT],
    ['RT|PENDING', ShipmentStatus.RTO_IN_TRANSIT],
    ['RT|DISPATCHED', ShipmentStatus.RTO_IN_TRANSIT],

    // ── PU: reverse pickup already collected, moving to us ───────
    ['PU|IN TRANSIT', ShipmentStatus.RTO_IN_TRANSIT],
    ['PU|PENDING', ShipmentStatus.RTO_IN_TRANSIT],
    ['PU|DISPATCHED', ShipmentStatus.RTO_IN_TRANSIT],
  ]);

  /**
   * NSL prefixes that mark a failed delivery ATTEMPT.
   *
   * This is how an NDR actually presents: the status stays `UD|Pending`
   * (the parcel is back at the DC) and the NSL carries the reason —
   * `EOD-74`, `EOD-15`, and so on. Reading only the status would record
   * a routine in-transit scan and lose the fact that a delivery was
   * tried and failed, which is the event the customer and the NDR
   * workflow both care about.
   */
  private static readonly NDR_NSL_PREFIX = 'EOD-';

  /**
   * Failed-delivery remarks, matched when the NSL is ABSENT.
   *
   * ── WHY THIS IS NEEDED AT ALL ────────────────────────────────────
   * The NSL check below is the right test and cannot fire in
   * production: Delhivery's TRACK API does not carry `NSLCode` inside
   * `Scans[].ScanDetail` — their own docs show it as a Shipment-level
   * field, sibling of `Status`. Verified against the live API on
   * 2026-09-01: every scan came back `nslCode: null` while
   * `statusType: "UD"` was present, and all 229 tracking_events on
   * production carry a null NSL.
   *
   * So a real failed delivery arrived as `Scan: "Pending"`,
   * `StatusType: "UD"`, `Instructions: "Consignee Unavailable"` and was
   * recorded as ordinary IN_TRANSIT. No delivery_attempts row, no
   * DELIVERY_FAILED, no call queued, no seller notification, and the
   * "Ask us to act" panel never appeared. The customer's parcel had
   * failed and the whole NDR pipeline never heard about it.
   *
   * ── WHY AN ALLOW-LIST, NOT A PATTERN ─────────────────────────────
   * A false NDR is expensive in the other direction: it moves an order
   * to DELIVERY_FAILED, queues a call to a customer whose parcel is
   * fine, and counts toward the NDR cap that eventually REJECTS the
   * order. So only remarks that unambiguously mean "we tried to hand it
   * over and could not" are listed. Anything else under UD stays
   * transit and is logged, so the list grows from evidence rather than
   * from guesses about a vocabulary the vendor has never published.
   */
  private static readonly NDR_REMARKS: readonly string[] = [
    'CONSIGNEE UNAVAILABLE',
    'CONSIGNEE NOT AVAILABLE',
    'CONSIGNEE REFUSED TO ACCEPT',
    'CONSIGNEE REFUSED',
    'CONSIGNEE SHIFTED',
    'ADDRESS INCOMPLETE',
    'INCOMPLETE ADDRESS',
    'ADDRESS INCORRECT',
    'PAYMENT NOT READY',
    'COD AMOUNT NOT READY',
    'OFFICE CLOSED',
    'ENTRY RESTRICTED',
    'FUTURE DELIVERY REQUESTED',
  ];

  /**
   * Statuses whose meaning does NOT depend on the journey leg, so they
   * can be mapped when a payload omits StatusType.
   *
   * The split is the whole point. "Delivered", "RTO" and "DTO" are
   * terminals that say where the parcel ended up, and no leg can change
   * that. "In Transit", "Pending" and "Dispatched" are deliberately
   * ABSENT: they mean opposite directions under UD and RT, so mapping
   * them without a leg is a coin flip — and getting it wrong walks an
   * order forward while the goods come back. Better to record the scan
   * as unmappable (it is still audited) than to guess the direction.
   */
  private static readonly STATUS_ONLY_TABLE: ReadonlyMap<string, ShipmentStatus> = new Map([
    ['DELIVERED', ShipmentStatus.DELIVERED],
    ['RTO', ShipmentStatus.RTO_DELIVERED],
    ['DTO', ShipmentStatus.RTO_DELIVERED],
    ['RTO INITIATED', ShipmentStatus.RTO_INITIATED],
    ['RTO IN TRANSIT', ShipmentStatus.RTO_IN_TRANSIT],
    ['RTO DELIVERED', ShipmentStatus.RTO_DELIVERED],
    ['DTO DELIVERED', ShipmentStatus.RTO_DELIVERED],
    ['UNDELIVERED', ShipmentStatus.DELIVERY_ATTEMPTED],
    ['OUT FOR DELIVERY', ShipmentStatus.OUT_FOR_DELIVERY],
    ['LOST', ShipmentStatus.LOST],
    ['DAMAGED', ShipmentStatus.DAMAGED],
  ]);

  normalizeScan(raw: DelhiveryRawScan): NormalizedScan {
    const code = raw.rawStatus.trim().toUpperCase();
    // Stub table first (DLV- prefixed) so existing e2e paths keep working.
    const stub = DelhiveryTrackingService.STUB_TABLE.get(code);
    if (stub !== undefined) {
      return { kind: 'NORMALIZED', shipmentStatus: stub };
    }

    const statusType = (raw.statusType ?? '').trim().toUpperCase();
    const nsl = (raw.nslCode ?? '').trim().toUpperCase();

    // An NDR is an EOD-* NSL on a forward leg. Checked BEFORE the pair
    // table, because the status itself is an unremarkable "Pending" and
    // would otherwise be recorded as ordinary transit.
    if (statusType === 'UD' && nsl.startsWith(DelhiveryTrackingService.NDR_NSL_PREFIX)) {
      return {
        kind: 'NORMALIZED',
        shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
      };
    }

    // The same fact, read off the remark, for the case above that the
    // track API cannot answer. Deliberately AFTER the NSL check so a
    // response that does carry one is still decided by the better
    // signal.
    const remark = (raw.description ?? '').trim().toUpperCase();
    if (statusType === 'UD' && remark !== '') {
      if (DelhiveryTrackingService.NDR_REMARKS.some((r) => remark.includes(r))) {
        return {
          kind: 'NORMALIZED',
          shipmentStatus: ShipmentStatus.DELIVERY_ATTEMPTED,
        };
      }
      // An unrecognised remark on a "Pending" forward scan is the exact
      // shape a missed NDR takes. Logged at WARN rather than debug: the
      // point is that somebody reads it and decides whether the list
      // needs another entry.
      if (code === 'PENDING') {
        this.logger.warn(
          { awbNumber: raw.awbNumber, remark: raw.description, nslCode: raw.nslCode ?? null },
          'Pending forward scan with an unrecognised remark — if this is a failed delivery, ' +
            'it is being recorded as ordinary transit and NDR_REMARKS needs it',
        );
      }
    }

    if (statusType !== '') {
      const paired = DelhiveryTrackingService.PAIR_TABLE.get(`${statusType}|${code}`);
      if (paired !== undefined) {
        return { kind: 'NORMALIZED', shipmentStatus: paired };
      }
    }

    // No leg supplied (or a leg we don't know): fall back to the statuses
    // that cannot be misread without one.
    const unambiguous = DelhiveryTrackingService.STATUS_ONLY_TABLE.get(code);
    if (unambiguous !== undefined) {
      return { kind: 'NORMALIZED', shipmentStatus: unambiguous };
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
