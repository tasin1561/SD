import { createHmac } from 'node:crypto';
import type { SimParcel, SimScan } from './state.js';

/**
 * Firing scans BACK at Skydrop.
 *
 * This is the half the in-process stub cannot do at all. The stub can
 * pretend an AWB was issued, but it cannot make a parcel move: the whole
 * tracking lifecycle — in transit, out for delivery, delivered, a failed
 * attempt, a return — arrives as webhooks from the courier, and until
 * now there was no way to produce one except by hand-crafting a signed
 * request.
 *
 * That matters because the interesting bugs live downstream of the scan,
 * not upstream: the monotonic-forward guard, the NDR delivery_attempts
 * row, the RTO boundary, the wallet accrual at DELIVERED. None of it can
 * be exercised end to end without something playing the courier.
 */

const SIGNATURE_HEADER = 'x-skydrop-signature';

export interface WebhookTarget {
  /** e.g. http://localhost:3000 — the Skydrop API. */
  readonly apiBaseUrl: string;
  /** Must equal TRACKING_WEBHOOK_SECRET_DELHIVERY in the API's env. */
  readonly secret: string;
  readonly courierCode: string;
}

/**
 * Delhivery's scan vocabulary, as the raw-scan parser expects to read
 * it. The prefixed codes match the adapter's stub table, so a scenario
 * behaves identically whichever mode it runs against.
 */
const RAW_CODE: Record<SimScan['stage'], string> = {
  MANIFESTED: 'DLV-MANIFESTED',
  IN_TRANSIT: 'DLV-IN-TRANSIT',
  OUT_FOR_DELIVERY: 'DLV-OFD',
  DELIVERED: 'DLV-DELIVERED',
  NDR: 'DLV-NDR',
  RTO_INITIATED: 'DLV-RTO-INIT',
  RTO_IN_TRANSIT: 'DLV-RTO-IT',
  RTO_DELIVERED: 'DLV-RTO-DEL',
  LOST: 'DLV-LOST',
  DAMAGED: 'DLV-DAMAGED',
  CANCELLED: 'DLV-CANCELLED',
};

export interface WebhookOutcome {
  readonly ok: boolean;
  readonly status: number;
  readonly body: string;
}

/**
 * How the API is configured to authenticate this courier's webhooks.
 *
 * Two schemes exist and they are NOT interchangeable. `HMAC_SHA256`
 * expects a signature over the body; `SHARED_SECRET` expects the static
 * credential itself, compared in constant time. Delhivery is seeded as
 * SHARED_SECRET — they send a fixed token, they do not sign — so that is
 * the default here.
 *
 * This mattered: the simulator signed an HMAC while the API compared it
 * against the raw secret, so every webhook it ever sent came back 401
 * and the entire tracking half of the simulator had never once worked.
 * The scan fires, the parcel moves on screen, and nothing reaches the
 * order — which looks like a bug in the processor rather than in the
 * thing pretending to be the courier.
 *
 * Override with SIM_WEBHOOK_AUTH_SCHEME to exercise the other path.
 */
export type SimAuthScheme = 'SHARED_SECRET' | 'HMAC_SHA256';

const AUTH_SCHEME: SimAuthScheme =
  process.env['SIM_WEBHOOK_AUTH_SCHEME'] === 'HMAC_SHA256' ? 'HMAC_SHA256' : 'SHARED_SECRET';

/**
 * Post one scan as a webhook, authenticated the way the API expects.
 *
 * Under HMAC the signature is computed over the EXACT bytes sent — from
 * the serialised string, not re-serialised from an object. Signing a
 * different rendering of the same JSON is the classic way a webhook
 * verifies locally and fails in production.
 */
export async function fireScanWebhook(
  target: WebhookTarget,
  parcel: SimParcel,
  scan: SimScan,
): Promise<WebhookOutcome> {
  const payload = {
    Shipment: {
      AWB: parcel.awb,
      ReferenceNo: parcel.orderRef,
      Status: {
        Status: scan.stage,
        StatusCode: RAW_CODE[scan.stage],
        StatusDateTime: scan.at,
        StatusLocation: scan.location,
        Instructions: scan.note ?? '',
      },
    },
  };
  // Serialise ONCE. The bytes signed and the bytes sent must be the same
  // bytes — the API verifies over the raw body it received.
  const raw = JSON.stringify(payload);
  const credential =
    AUTH_SCHEME === 'HMAC_SHA256'
      ? createHmac('sha256', target.secret).update(raw, 'utf8').digest('hex')
      : target.secret;

  const url = `${target.apiBaseUrl.replace(/\/$/, '')}/public/tracking/webhooks/${target.courierCode}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: credential },
    body: raw,
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 400) };
}
