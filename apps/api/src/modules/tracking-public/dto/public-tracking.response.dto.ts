/**
 * Module 10 (TRK-8) — the CUSTOMER-SAFE public-tracking projection.
 *
 * The AWB number IS the access token for this endpoint (no auth). The
 * customer pasting it learned it from the courier/seller; anyone with
 * the AWB can view the tracking page. So the discipline is:
 *
 *   - Expose ONLY data the AWB-holder already knows (the courier name,
 *     a coarse current status, scan timeline + cities, ETA).
 *   - HIDE internal identifiers (orderId, shipmentId, webhookId,
 *     trackingEventId, sellerId, etc.) — no enumeration value, no
 *     cross-correlation pivot.
 *   - HIDE recipient PII (name, phone, full address) — the AWB doesn't
 *     prove the viewer IS the recipient (it could be a gift).
 *   - HIDE the raw courier code, lat/long, internal scan metadata,
 *     and the precise ShipmentStatus internals (pre-dispatch values
 *     bucket to "processing").
 *   - HIDE scans the processor flagged isVisibleToCustomer=false (the
 *     UNMAPPABLE / REJECT audit entries from M10 commit 8).
 *   - LIMIT location to the city level (no exact pincode, no street).
 *   - Same shape on 404 / found — the rate limiter is what guards
 *     enumeration attacks (the seeded
 *     `tracking.public_lookup_rate_limit_per_min` ceiling).
 */

/**
 * The customer-facing display bucket. Internal ShipmentStatus values
 * collapse to these 11 buckets — frontend (apps/track, deferred) does
 * the localized copy (EN + HI). Keep the enum SMALL: every internal
 * status either maps cleanly to one of these, or — for the pre-dispatch
 * lifecycle the customer shouldn't care about — collapses to
 * `processing`.
 */
export type PublicShipmentDisplayStatus =
  | 'processing' // pre-dispatch internals (created, awb_pending, awb_generated, failed_at_creation, handed_to_courier, at_hub)
  | 'dispatched'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivery_attempted'
  | 'delivered'
  | 'return_initiated' // RTO_INITIATED
  | 'returning' // RTO_IN_TRANSIT
  | 'returned' // RTO_DELIVERED
  | 'lost'
  | 'damaged'
  | 'cancelled';

export interface PublicTrackingTimelineEvent {
  /** The customer-facing display bucket for this scan. */
  status: PublicShipmentDisplayStatus;
  /** Scan timestamp (ISO 8601, UTC). TRK-3 — scan time, never the
   *  receive time of the webhook. */
  eventAt: string;
  /** Courier-emitted free-text describing the scan, when available. */
  description: string | null;
  /** City the scan was recorded in, when available. NO precise
   *  location, NO street, NO pincode. */
  locationCity: string | null;
}

export interface PublicTrackingResponse {
  /** The AWB the customer asked about — echoed for confirmation. */
  awbNumber: string;
  /** Display name of the courier (e.g. "Delhivery"). Never the
   *  internal courier code. */
  courierDisplayName: string;
  /** The customer-facing CURRENT status — derived from the latest
   *  isVisibleToCustomer=true tracking_event by eventAt DESC, or
   *  falling back to the shipment's `status` projection when no
   *  customer-visible scan exists yet (e.g. pre-dispatch). */
  currentStatus: PublicShipmentDisplayStatus;
  /** Timestamp of the latest scan (or shipment creation when no scans). */
  currentStatusAt: string;
  /** Coarse destination city the parcel is heading to. */
  destinationCity: string;
  /** Estimated delivery, when the courier supplied one. */
  estimatedDeliveryAt: string | null;
  /** Customer-visible scan timeline — DESC by eventAt (most recent
   *  first), each event projected to the safe shape above. */
  timeline: PublicTrackingTimelineEvent[];
}
