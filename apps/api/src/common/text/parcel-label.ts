/**
 * How a parcel is NAMED in a sentence a person reads.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────
 * Five `order_events` descriptions named a shipment by its uuid — "Pack
 * completed on shipment 01a022a9-e38f-79fb-8d12-f656b7b541ea" — on the
 * one screen a seller opens to find out what happened to their order.
 * A uuid is not an identifier to a person: it cannot be read out over a
 * phone, cannot be recognised as the parcel they were just looking at,
 * and cannot be searched for on any screen we ship. The parcel already
 * HAS a name — `shipments.shipment_number`, unique, printed on the
 * handover bench and shown on the order page's parcel panel — and it
 * was sitting one column away from the id that got written instead.
 *
 * This is the same shape as `/holds` showing an order's uuid before it
 * showed `orderNumber`, and the SCRAP_REFUND ledger note naming a
 * ticket by its uuid before `ticketNumber` existed. Both were fixed the
 * same way, and both kept the uuid as the FALLBACK — which is why this
 * takes `shipmentNumber` as nullable and degrades to the id rather than
 * printing an empty string. A row that somehow has no number is far
 * better described badly than described as nothing.
 *
 * ── WHY THE WAYBILL IS NOT IN HERE ───────────────────────────────────
 * It is tempting, and it is wrong for these sentences: a waybill is the
 * COURIER's name for the parcel and it changes (CUR-7's supersede
 * chain gives a re-booked parcel a new one; CUR-14's failover rewrites
 * it). The shipment number never changes, so a history line written
 * today still names the same thing a month later. The waybill is on the
 * parcel panel beside it, where it is current rather than historical.
 *
 * ── APPEND-ONLY (ORD-4) ──────────────────────────────────────────────
 * `order_events` is insert-only by construction, so this reaches
 * FUTURE events only. Every description already stored keeps its uuid,
 * for ever, and that is correct: rewriting history to read better is
 * exactly what an append-only table exists to prevent.
 *
 * Pure: no Prisma, no DI.
 */
export interface ParcelIdentity {
  /** The row's uuid — the fallback, never the preferred name. */
  readonly id: string;
  /** `SH-2026-000123`. Nullable so a partial select degrades. */
  readonly shipmentNumber?: string | null | undefined;
}

/** `SH-2026-000123`, falling back to the uuid when there is no number. */
export function parcelLabel(parcel: ParcelIdentity): string {
  const number = parcel.shipmentNumber?.trim();
  return number !== undefined && number.length > 0 ? number : parcel.id;
}
