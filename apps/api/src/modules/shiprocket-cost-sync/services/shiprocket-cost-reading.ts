/**
 * What one Shiprocket order says a parcel cost — pure, no I/O.
 *
 * ── THEIR FINAL FIGURE IS THE ONLY COST ──────────────────────────────
 * `awb_data.charges.billing_amount` is Shiprocket's own final number for
 * the parcel, and it already nets their reversals: a returned parcel's
 * COD charge is refunded and its RTO freight added (measured: ₹114.40
 * forward − ₹47 COD + ₹96 RTO = ₹163.40, exactly their billing amount).
 * It is empty until they finalise billing, which on 2026-09-11 was 113
 * of 135 sampled orders — including many delivered weeks earlier.
 *
 * ── THE PROVISIONAL FIGURE IS AN ESTIMATE, AND SAYS SO ───────────────
 * Rebuilt from the breakdown the way their passbook debits: freight and
 * COD at booking; on a return the COD charge reversed and RTO freight
 * added. It matched their final figure on 21 of 22 parcels and missed one
 * by ₹2.25, so it is shown to people and never stamped as a cost (TRE-6).
 *
 * A value they send as '', 'N/A', '-' or anything non-numeric is
 * UNKNOWN, never zero — zero would claim a parcel was free.
 */
export interface ShiprocketCostReading {
  readonly theirStatus: string;
  readonly awbNumber: string | null;
  readonly billedInr: string | null;
  readonly provisionalInr: string | null;
  readonly forwardInr: string | null;
  readonly codChargeInr: string | null;
  readonly rtoInr: string | null;
  readonly appliedWeightKg: string | null;
  readonly chargedWeightKg: string | null;
  readonly returned: boolean;
  readonly fingerprint: string;
}

/** A number they sent, or null when it is blank or not a number. */
export function amount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

const paise = (n: number): number => Math.round(n * 100);
const inr = (n: number | null): string | null => (n === null ? null : (paise(n) / 100).toFixed(2));
const kg = (n: number | null): string | null => (n === null ? null : n.toFixed(3));

/**
 * Did the parcel come back? Their words for it include `RTO DELIVERED`,
 * `RTO IN INTRANSIT`, `RTO_NDR`, `RTO_OFD` and `REACHED BACK AT THE
 * SELLER CITY` — matched as a word, so `RTO_NDR` counts (a `\b` would not
 * see the boundary before the underscore). An RTO charge on the order is
 * the same fact from the billing side.
 */
function cameBack(status: string, rto: number | null): boolean {
  return /(^|[^a-z])rto([^a-z]|$)/i.test(status) || /reached back/i.test(status) || (rto ?? 0) > 0;
}

/** Null when the order carries no status at all — nothing to record. */
export function readingFromOrder(data: unknown): ShiprocketCostReading | null {
  if (data === null || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const status = typeof d['status'] === 'string' ? d['status'].trim() : '';
  if (status === '') return null;

  const awbData = (d['awb_data'] ?? {}) as Record<string, unknown>;
  const ch = (awbData['charges'] ?? {}) as Record<string, unknown>;

  const billed = amount(ch['billing_amount']);
  // The CHARGED weight's amount is what they settled on after any
  // dispute; the applied one is what they started from.
  const forward =
    amount(ch['charged_weight_amount']) ??
    amount(ch['applied_weight_amount']) ??
    amount(ch['freight_charges']);
  const cod = amount(ch['cod_charges']);
  const rto = amount(ch['charged_weight_amount_rto']) ?? amount(ch['applied_weight_amount_rto']);
  const returned = cameBack(status, rto);
  const cancelled = /cancel/i.test(status);

  let provisional: number | null;
  if (cancelled)
    provisional = 0; // their freight is reversed on a cancellation
  else if (forward === null) provisional = null;
  else if (returned) provisional = (paise(forward) - paise(cod ?? 0) + paise(rto ?? 0)) / 100;
  else provisional = forward;

  const awbRaw = awbData['awb'];
  const awb = typeof awbRaw === 'string' && awbRaw.trim() !== '' ? awbRaw.trim() : null;

  const out = {
    theirStatus: status,
    awbNumber: awb,
    billedInr: inr(billed),
    provisionalInr: inr(provisional),
    forwardInr: inr(forward),
    codChargeInr: inr(cod),
    rtoInr: inr(rto),
    appliedWeightKg: kg(amount(ch['applied_weight'])),
    chargedWeightKg: kg(amount(ch['charged_weight'])),
    returned,
  };
  return {
    ...out,
    fingerprint: JSON.stringify([
      out.theirStatus,
      out.billedInr,
      out.provisionalInr,
      out.forwardInr,
      out.codChargeInr,
      out.rtoInr,
      out.appliedWeightKg,
      out.chargedWeightKg,
      out.returned,
    ]),
  };
}
