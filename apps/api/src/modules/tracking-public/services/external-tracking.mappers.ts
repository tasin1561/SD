import type {
  ExternalCourierCode,
  PublicShipmentDisplayStatus,
  PublicTrackingResponse,
  PublicTrackingTimelineEvent,
} from '../dto/public-tracking.response.dto';

/**
 * Pure mapping from a courier's PUBLIC tracking payload to the customer-safe
 * view the track page already renders (owner decision 2026-11-22).
 *
 * PUBLIC-SAFE BY CONSTRUCTION: every field of the output is read by name from
 * an allow-list below. Nothing is spread or copied wholesale, so a field a
 * courier adds later (consignee, phone, referenceNo, COD amount …) cannot
 * reach a customer. Free text that a courier writes (scan remarks) is passed
 * through `safeText`, which removes anything shaped like a phone number.
 *
 * A payload that is not the shape we know throws `ExternalShapeError`; the
 * caller turns that into ONE system issue per courier.
 */
export class ExternalShapeError extends Error {
  constructor(
    readonly courier: ExternalCourierCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExternalShapeError';
  }
}

export type MapResult = Omit<PublicTrackingResponse, 'source' | 'courier'> | 'NOT_FOUND';

const DELHIVERY_NAME = 'Delhivery';
const SHIPROCKET_NAME = 'Shiprocket';
const MAX_TIMELINE = 60;

/** Letters, digits and dashes only: the AWB goes into a courier URL. */
export function isPlausibleAwb(awb: string): boolean {
  return /^[A-Za-z0-9-]{6,30}$/.test(awb);
}

/** Delhivery waybills are 11-14 digits; anything else is tried on Shiprocket first. */
export function courierTryOrder(awb: string): ExternalCourierCode[] {
  return /^\d{11,14}$/.test(awb) ? ['delhivery', 'shiprocket'] : ['shiprocket', 'delhivery'];
}

/** Free text from a courier: drop phone-like digit runs and emails, cap the length. */
export function safeText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > 200 ? `${cleaned.slice(0, 197)}...` : cleaned;
}

function place(raw: unknown): string | null {
  const t = safeText(raw);
  return t === null ? null : t.slice(0, 80);
}

/** Courier clocks are India time with no zone. Returns an ISO string or null. */
export function parseIst(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let s = raw.trim().replace(' ', 'T');
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    s = s.replace(/(\.\d{3})\d+$/, '$1');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00';
    s += '+05:30';
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Words → the display status. Order matters: most specific first. */
function statusFromWords(words: string, fallback: PublicShipmentDisplayStatus) {
  const w = words.toLowerCase();
  if (/\brto\b.*(deliver|received)|returned (to|at) (origin|seller|shipper)/.test(w))
    return 'returned' as const;
  if (/\b(rto|return)\b.*(initiat|request)/.test(w)) return 'return_initiated' as const;
  if (/\brto\b|out for return|return(ing)?\b/.test(w)) return 'returning' as const;
  if (/out for delivery|\bofd\b/.test(w)) return 'out_for_delivery' as const;
  if (/undeliver|attempt|refus|unavailable|reattempt|not home|address/.test(w))
    return 'delivery_attempted' as const;
  if (/\bdelivered\b/.test(w)) return 'delivered' as const;
  if (/\blost\b/.test(w)) return 'lost' as const;
  if (/damage/.test(w)) return 'damaged' as const;
  if (/cancel/.test(w)) return 'cancelled' as const;
  if (
    /manifest|pickup (scheduled|pending|generated)|not picked|awb (assigned|generated)|created/.test(
      w,
    )
  )
    return 'processing' as const;
  if (/picked|shipped|dispatch/.test(w)) return 'dispatched' as const;
  if (/transit|reached|arrived|departed|hub|facility|bagged|received/.test(w))
    return 'in_transit' as const;
  return fallback;
}

// ---------------------------------------------------------------- Delhivery

function delhiveryStatus(
  type: string,
  words: string,
  fallback: PublicShipmentDisplayStatus,
): PublicShipmentDisplayStatus {
  const t = type.toUpperCase();
  if (t === 'DL') {
    // DL with an RTO word is the return arriving back; plain DL is delivery.
    return /rto|return/i.test(words) ? 'returned' : 'delivered';
  }
  if (t === 'RT') return /initiat|request/i.test(words) ? 'return_initiated' : 'returning';
  if (t === 'PP') return 'processing';
  if (t === 'PU') return 'dispatched';
  if (t === 'CN') return 'cancelled';
  return statusFromWords(words, fallback);
}

function delhiveryEta(first: Record<string, unknown>, returning: boolean): string | null {
  if (returning) return null;
  const text = str(first['deliveryDate']);
  const m = /(\d{1,2}) ([A-Za-z]{3}) (\d{4})/.exec(text);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]} ${m[3]} 23:59:00 GMT+0530`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export function mapDelhivery(payload: unknown, awb: string): MapResult {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['data'])) {
    throw new ExternalShapeError('delhivery', 'no data array');
  }
  const first = asRecord(root['data'][0]);
  if (first === null) return 'NOT_FOUND';
  const st = asRecord(first['status']);
  if (st === null || typeof st['status'] !== 'string') {
    throw new ExternalShapeError('delhivery', 'no status block');
  }

  const statusWords = `${str(st['status'])} ${str(st['instructions'])}`;
  const current = delhiveryStatus(str(st['statusType']), statusWords, 'in_transit');
  const nowIso = parseIst(st['statusDateTime']) ?? new Date().toISOString();

  const timeline: PublicTrackingTimelineEvent[] = [];
  const states = Array.isArray(first['trackingStates']) ? first['trackingStates'] : [];
  for (const state of states) {
    const stateRec = asRecord(state);
    const scans = Array.isArray(stateRec?.['scans']) ? (stateRec['scans'] as unknown[]) : [];
    for (const raw of scans) {
      const sc = asRecord(raw);
      if (sc === null) continue;
      const words = `${str(sc['scan'])} ${str(sc['scanNslRemark'])}`;
      timeline.push({
        status: delhiveryStatus(str(sc['scanType']), words, current),
        eventAt: parseIst(sc['scanDateTime']) ?? parseIst(sc['scanDate']) ?? nowIso,
        description: safeText(sc['scanNslRemark']) ?? safeText(sc['scan']),
        locationCity: place(sc['cityLocation']) ?? place(sc['scannedLocation']),
      });
    }
  }
  if (timeline.length === 0) {
    timeline.push({
      status: current,
      eventAt: nowIso,
      description: safeText(st['instructions']) ?? safeText(st['status']),
      locationCity: null,
    });
  }
  timeline.sort((a, b) => b.eventAt.localeCompare(a.eventAt));

  return {
    awbNumber: awb,
    courierDisplayName: DELHIVERY_NAME,
    currentStatus: current,
    currentStatusAt: nowIso,
    destinationCity: place(first['destination']) ?? '',
    estimatedDeliveryAt: delhiveryEta(
      first,
      current === 'returning' || current === 'return_initiated',
    ),
    timeline: timeline.slice(0, MAX_TIMELINE),
  };
}

// --------------------------------------------------------------- Shiprocket

export function mapShiprocket(payload: unknown, awb: string): MapResult {
  const root = asRecord(payload);
  const td = asRecord(root?.['tracking_data']);
  if (td === null) throw new ExternalShapeError('shiprocket', 'no tracking_data');

  const tracks = Array.isArray(td['shipment_track']) ? td['shipment_track'] : [];
  const track = asRecord(tracks[0]);
  const acts = Array.isArray(td['shipment_track_activities'])
    ? (td['shipment_track_activities'] as unknown[])
    : [];
  // track_status 0 is "nothing here" for an unknown AWB AND for one with no
  // scans yet; Shiprocket does not let us tell them apart. Nothing to show
  // means not found, so a made-up number never gets a "tracking" page.
  if (track === null && acts.length === 0) {
    if (td['track_status'] === 0 || td['track_status'] === '0' || typeof td['error'] === 'string') {
      return 'NOT_FOUND';
    }
    throw new ExternalShapeError('shiprocket', 'no shipment_track and no activities');
  }

  const timeline: PublicTrackingTimelineEvent[] = [];
  for (const raw of acts) {
    const a = asRecord(raw);
    if (a === null) continue;
    const label = str(a['sr-status-label']) || str(a['status']);
    timeline.push({
      status: statusFromWords(`${label} ${str(a['activity'])}`, 'in_transit'),
      eventAt: parseIst(a['date']) ?? new Date().toISOString(),
      description: safeText(a['activity']) ?? safeText(label),
      locationCity: place(a['location']),
    });
  }
  timeline.sort((a, b) => b.eventAt.localeCompare(a.eventAt));

  const currentWords = str(track?.['current_status']);
  const latest = timeline[0];
  const current = currentWords
    ? statusFromWords(currentWords, latest?.status ?? 'processing')
    : (latest?.status ?? 'processing');

  const etaRaw = str(td['etd']) || str(track?.['edd']);
  const eta = parseIst(etaRaw);
  const returning =
    current === 'returning' || current === 'return_initiated' || current === 'returned';

  return {
    awbNumber: awb,
    courierDisplayName: SHIPROCKET_NAME,
    currentStatus: current,
    currentStatusAt:
      latest?.eventAt ?? parseIst(track?.['pickup_date']) ?? new Date().toISOString(),
    // `destination` / `delivered_to` are CITY names; consignee_name, address and
    // phone live in the same object and are never read.
    destinationCity: place(track?.['delivered_to']) ?? place(track?.['destination']) ?? '',
    estimatedDeliveryAt: returning ? null : eta,
    timeline: timeline.slice(0, MAX_TIMELINE),
  };
}
