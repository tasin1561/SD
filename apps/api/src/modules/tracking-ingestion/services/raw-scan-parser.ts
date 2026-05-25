import { DeliveryFailureReason } from '@skydrop/db';

/**
 * Parsed shape the M10 processor needs from a courier webhook body —
 * the inputs to `DelhiveryClient.normalizeScan` plus the per-NDR
 * failure-reason string.
 */
export interface ParsedScanPayload {
  awbNumber: string;
  rawStatus: string;
  eventAtIso: string;
  locationName: string | null;
  locationCity: string | null;
  locationPincode: string | null;
  description: string | null;
  /** Free-text/code from the courier; the processor maps to the enum. */
  failureReason: string | null;
}

/**
 * Stub-mode parser for the M10 webhook body. The CONTRACT here is what
 * the M10 tests + the stub `DelhiveryClient.normalizeScan` table
 * exercise — snake_case OR camelCase keys at the top level + a nested
 * `location` object. Real Delhivery's JSON shape is TODO(delhivery-api)
 * — when sandbox-validated, this parser is the single seam to update
 * (same discipline as the courier-delhivery wire seams + the HMAC
 * scheme + the webhook header name).
 *
 * Tolerant by design: returns null when the required fields
 * (`awbNumber`, `rawStatus`, `eventAt`) are absent or non-string. The
 * caller routes a null to webhook.status=IGNORED with reason
 * PARSE_FAILED — the raw body stays preserved on courier_webhooks for
 * ops investigation.
 */
export function parseScanPayload(
  parsedBody: unknown,
): ParsedScanPayload | null {
  if (!isObject(parsedBody)) return null;
  const b = parsedBody as Record<string, unknown>;

  const awbNumber = pickString(b, ['awb_number', 'awbNumber']);
  const rawStatus = pickString(b, ['raw_status', 'rawStatus', 'status']);
  const eventAtIso = pickString(b, ['event_at', 'eventAt', 'eventAtIso']);

  if (
    awbNumber === null ||
    rawStatus === null ||
    eventAtIso === null ||
    Number.isNaN(new Date(eventAtIso).getTime())
  ) {
    return null;
  }

  const loc = isObject(b['location'])
    ? (b['location'] as Record<string, unknown>)
    : null;

  return {
    awbNumber,
    rawStatus,
    eventAtIso,
    locationName:
      pickString(b, ['location_name']) ??
      (loc ? pickString(loc, ['name']) : null),
    locationCity:
      pickString(b, ['location_city']) ??
      (loc ? pickString(loc, ['city']) : null),
    locationPincode:
      pickString(b, ['location_pincode']) ??
      (loc ? pickString(loc, ['pincode', 'postal_code']) : null),
    description: pickString(b, ['description', 'narrative']),
    failureReason: pickString(b, ['failure_reason', 'failureReason']),
  };
}

/**
 * Maps a courier-emitted failure-reason string to the
 * DeliveryFailureReason enum. Case-insensitive exact match against the
 * enum's UPPER_SNAKE_CASE values; unrecognized strings fall back to
 * `OTHER`. The raw string is preserved on `delivery_attempts.failureNotes`
 * by the processor so ops can refine the mapping later
 * (TODO(delhivery-api) — Delhivery's reason vocabulary is not reliably
 * known at build time).
 */
export function mapFailureReason(
  raw: string | null,
): DeliveryFailureReason | null {
  if (raw === null) return null;
  const norm = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  const allowed: ReadonlySet<string> = new Set(
    Object.values(DeliveryFailureReason),
  );
  if (allowed.has(norm)) return norm as DeliveryFailureReason;
  return DeliveryFailureReason.OTHER;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function pickString(
  src: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const k of keys) {
    const v = src[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}
