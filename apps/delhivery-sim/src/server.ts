import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  NON_SERVICEABLE_PIN,
  TRANSIENT_FAIL_PIN,
  addPickup,
  addScan,
  allParcels,
  allPickups,
  getParcel,
  issueWaybill,
  putParcel,
  registerWarehouse,
  reset,
  type ScanStage,
  type SimParcel,
} from './state.js';
import { fireScanWebhook, type WebhookTarget } from './webhooks.js';

/**
 * A fake Delhivery.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The adapter has two modes. STUB mode short-circuits inside the
 * process: useful, and it is what every test has run against, but it
 * means the REAL branch — the HTTP client, the request marshalling, the
 * auth header, the response parsing, the retry and rate-limit paths —
 * has never executed once. That is most of the integration surface, and
 * it is all unexercised.
 *
 * Point `courier.delhivery_api_base_url` at this server and the real
 * branch runs. Nothing physical happens, nothing is charged, and it can
 * be run a thousand times.
 *
 * ── WHAT IT CANNOT TELL YOU ──────────────────────────────────────────
 * This encodes OUR BELIEF about Delhivery's wire format. Where that
 * belief is wrong, the simulator is wrong in exactly the same way and
 * agrees with us — so a green run here proves our orchestration is
 * self-consistent, NOT that Delhivery agrees. Only a real parcel proves
 * that. Treat this as a way to find our own bugs cheaply, and keep the
 * controlled first-parcel test on the list.
 *
 * ── THE CONTROL SURFACE ──────────────────────────────────────────────
 * `/_sim/*` is not Delhivery. It is how a human drives a parcel:
 * advance it to out-for-delivery, fail a delivery, send it back. Each
 * advance fires a signed webhook at the API, which is the only way to
 * exercise the tracking lifecycle end to end.
 */

const PORT = Number(process.env['PORT'] ?? 4010);
const API_BASE_URL = process.env['SKYDROP_API_URL'] ?? 'http://localhost:3000';
const WEBHOOK_SECRET = process.env['TRACKING_WEBHOOK_SECRET_DELHIVERY'] ?? '';
const COURIER_CODE = process.env['COURIER_CODE'] ?? 'delhivery';

const webhookTarget: WebhookTarget = {
  apiBaseUrl: API_BASE_URL,
  secret: WEBHOOK_SECRET,
  courierCode: COURIER_CODE,
};

// ── plumbing ─────────────────────────────────────────────────────────

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Delhivery's create endpoint takes `format=json&data=<JSON>` as form
 * encoding rather than a JSON body — an oddity of their API, and one the
 * adapter already accounts for. Parsing it here is what proves the
 * adapter's `form-data-key` encoding actually produces what a server
 * expects.
 */
function parseFormDataKey(raw: string): unknown {
  const params = new URLSearchParams(raw);
  const data = params.get('data');
  if (data === null) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function log(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(new Date().toISOString(), ...args);
}

// ── the wire endpoints ───────────────────────────────────────────────

interface CreateShipmentInput {
  waybill?: string;
  order?: string;
  pin?: string;
  name?: string;
  cod_amount?: number | string;
  weight?: number | string;
}

function handleCreate(bodyRaw: string, res: ServerResponse): void {
  const parsed = parseFormDataKey(bodyRaw) as {
    shipments?: CreateShipmentInput[];
    pickup_location?: { name?: string };
  } | null;

  if (parsed === null || !Array.isArray(parsed.shipments) || parsed.shipments.length === 0) {
    // Delhivery answers a malformed envelope with success:false, not a
    // 4xx — worth mirroring, because the adapter has to cope with a 200
    // that means failure.
    json(res, 200, { success: false, rmk: 'ClientError: no shipments in payload' });
    return;
  }

  const s = parsed.shipments[0] as CreateShipmentInput;
  const pin = String(s.pin ?? '');

  if (pin === TRANSIENT_FAIL_PIN) {
    // A 500 is a transport error, which the adapter must treat as
    // retryable rather than as "this address cannot be served".
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('upstream unavailable');
    return;
  }
  if (pin === NON_SERVICEABLE_PIN) {
    json(res, 200, {
      success: false,
      rmk: `ServiceableArea: ${pin} is not serviceable`,
      packages: [{ status: 'Fail', remarks: ['ServiceableArea'] }],
    });
    return;
  }

  const awb = typeof s.waybill === 'string' && s.waybill.length > 0 ? s.waybill : issueWaybill();
  const parcel: SimParcel = {
    awb,
    refnum: `REF-${awb}`,
    orderRef: String(s.order ?? ''),
    destinationPin: pin,
    consigneeName: String(s.name ?? ''),
    codAmount: Number(s.cod_amount ?? 0),
    weightGrams: Number(s.weight ?? 0),
    stage: 'MANIFESTED',
    cancelled: false,
    scans: [],
    createdAt: new Date().toISOString(),
  };
  putParcel(parcel);
  log('created parcel', awb, 'for order', parcel.orderRef, 'pin', pin);

  json(res, 200, {
    success: true,
    packages: [
      {
        waybill: awb,
        refnum: parcel.refnum,
        status: 'Success',
        remarks: [''],
        pdf_download_link: `/api/p/packing_slip?wbns=${awb}`,
      },
    ],
  });
}

function handleServiceability(pincode: string, res: ServerResponse): void {
  if (pincode === NON_SERVICEABLE_PIN) {
    // An EMPTY delivery_codes list is the real non-serviceable signal —
    // not an error, not a 404. The adapter reads it that way.
    json(res, 200, { delivery_codes: [] });
    return;
  }
  json(res, 200, {
    delivery_codes: [
      {
        postal_code: {
          pin: Number(pincode),
          city: 'Simulated City',
          district: 'Simulated District',
          state_code: 'KA',
          country_code: 'IN',
          pre_paid: 'Y',
          cod: 'Y',
          pickup: 'Y',
          repl: 'Y',
          cash: 'Y',
          is_oda: 'N',
          max_amount: 50000,
          max_weight: 30000,
          sort_code: 'BLR/SIM',
          center: [{ cn: 'Simulated_Hub', ud: 'N', code: 'SIM' }],
        },
      },
    ],
  });
}

function handleWaybillBulk(count: number, res: ServerResponse): void {
  const list = Array.from({ length: Math.max(1, count) }, () => issueWaybill());
  // Delhivery returns a bare JSON array of strings here.
  json(res, 200, list);
}

function handlePackingSlip(res: ServerResponse): void {
  // A minimal but VALID PDF, so the label upload path exercises real
  // bytes rather than a string that happens not to crash.
  const pdf = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
      '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
      '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 288 432]>>endobj\n' +
      'trailer<</Root 1 0 R>>\n%%EOF\n',
    'utf8',
  );
  res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(pdf.length) });
  res.end(pdf);
}

// ── the control surface ──────────────────────────────────────────────

/** What each stage means when a human drives it from the panel. */
const STAGE_LOCATION: Record<ScanStage, string> = {
  MANIFESTED: 'Bengaluru_Hub',
  IN_TRANSIT: 'Bengaluru_Hub',
  OUT_FOR_DELIVERY: 'Simulated City',
  DELIVERED: 'Simulated City',
  NDR: 'Simulated City',
  RTO_INITIATED: 'Simulated City',
  RTO_IN_TRANSIT: 'Bengaluru_Hub',
  RTO_DELIVERED: 'Bengaluru_Hub',
  LOST: 'Unknown',
  DAMAGED: 'Bengaluru_Hub',
  CANCELLED: 'Bengaluru_Hub',
};

async function handleAdvance(awb: string, bodyRaw: string, res: ServerResponse): Promise<void> {
  const parcel = getParcel(awb);
  if (!parcel) {
    json(res, 404, { error: `no parcel ${awb}` });
    return;
  }
  let stage: ScanStage;
  let note: string | null = null;
  try {
    const body = JSON.parse(bodyRaw) as { stage?: string; note?: string };
    stage = String(body.stage ?? '') as ScanStage;
    note = typeof body.note === 'string' ? body.note : null;
  } catch {
    json(res, 400, { error: 'body must be {"stage": "...", "note": "..."}' });
    return;
  }
  if (!(stage in STAGE_LOCATION)) {
    json(res, 400, { error: `unknown stage; one of ${Object.keys(STAGE_LOCATION).join(', ')}` });
    return;
  }

  const scan = {
    stage,
    at: new Date().toISOString(),
    location: STAGE_LOCATION[stage],
    note,
  };
  addScan(awb, scan);

  if (WEBHOOK_SECRET.length === 0) {
    json(res, 200, {
      parcel: getParcel(awb),
      webhook: 'NOT SENT — set TRACKING_WEBHOOK_SECRET_DELHIVERY to match the API',
    });
    return;
  }
  const outcome = await fireScanWebhook(webhookTarget, parcel, scan);
  log('advanced', awb, '→', stage, '| webhook', outcome.status);
  json(res, 200, { parcel: getParcel(awb), webhook: outcome });
}

// ── router ───────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const body = method === 'GET' ? '' : await readBody(req);

    // ── control ──
    if (path === '/_sim/parcels' && method === 'GET') return json(res, 200, allParcels());
    if (path === '/_sim/pickups' && method === 'GET') return json(res, 200, allPickups());
    if (path === '/_sim/reset' && method === 'POST') {
      reset();
      return json(res, 200, { ok: true });
    }
    if (path.startsWith('/_sim/parcels/') && path.endsWith('/advance') && method === 'POST') {
      const awb = path.slice('/_sim/parcels/'.length, -'/advance'.length);
      return handleAdvance(awb, body, res);
    }
    if (path === '/_sim/health') {
      return json(res, 200, {
        ok: true,
        apiBaseUrl: API_BASE_URL,
        webhooksConfigured: WEBHOOK_SECRET.length > 0,
        parcels: allParcels().length,
      });
    }

    // ── wire ──
    if (path === '/api/cmu/create.json' && method === 'POST') return handleCreate(body, res);
    if (path === '/c/api/pin-codes/json/')
      return handleServiceability(url.searchParams.get('filter_codes') ?? '', res);
    if (path === '/waybill/api/bulk/json/')
      return handleWaybillBulk(Number(url.searchParams.get('count') ?? '1'), res);
    if (path === '/api/p/packing_slip') return handlePackingSlip(res);

    if (path === '/api/p/edit' && method === 'POST') {
      // Cancel and edit share this endpoint; `cancellation: "true"` is
      // the cancel.
      const parsed = parseFormDataKey(body) as { waybill?: string; cancellation?: string } | null;
      const awb = String(parsed?.waybill ?? '');
      const parcel = getParcel(awb);
      if (!parcel) return json(res, 200, { status: false, error: ['waybill not found'] });
      if (String(parsed?.cancellation) === 'true') {
        parcel.cancelled = true;
        log('cancelled parcel', awb);
      }
      return json(res, 200, { status: true, waybill: awb });
    }

    if (path === '/fm/request/new/' && method === 'POST') {
      const parsed = JSON.parse(body || '{}') as { pickup_location?: string; pickup_date?: string };
      const id = `PU-${Date.now()}`;
      addPickup({
        id,
        location: String(parsed.pickup_location ?? ''),
        date: String(parsed.pickup_date ?? ''),
        createdAt: new Date().toISOString(),
      });
      log('pickup requested', id, parsed.pickup_location);
      return json(res, 200, { pickup_id: id, incoming_center_name: 'Simulated_Hub' });
    }

    if (path.startsWith('/api/backend/clientwarehouse/') && method === 'POST') {
      const parsed = JSON.parse(body || '{}') as { name?: string };
      registerWarehouse(String(parsed.name ?? ''));
      return json(res, 200, { success: true, data: { name: parsed.name } });
    }

    if (path === '/api/v1/packages/json/') {
      const awbs = (url.searchParams.get('waybill') ?? '').split(',').filter(Boolean);
      return json(res, 200, {
        ShipmentData: awbs.map((awb) => {
          const p = getParcel(awb);
          return {
            Shipment: {
              AWB: awb,
              Status: { Status: p?.stage ?? 'UNKNOWN', StatusDateTime: new Date().toISOString() },
              Scans: (p?.scans ?? []).map((s) => ({
                ScanDetail: {
                  Scan: s.stage,
                  ScanDateTime: s.at,
                  ScannedLocation: s.location,
                  Instructions: s.note ?? '',
                },
              })),
            },
          };
        }),
      });
    }

    if (path === '/api/dc/expected_tat')
      return json(res, 200, { data: [{ tat: 3, expected_delivery_date: null }] });

    if (path.startsWith('/api/kinko/v1/invoice/charges'))
      return json(res, 200, [{ total_amount: 78.5, charge_COD: 35, gross_amount: 66.5 }]);

    if (path === '/api/p/update' && method === 'POST')
      return json(res, 200, { status: true, request_id: `NDR-${Date.now()}` });

    if (path.startsWith('/api/rest/ewaybill/')) return json(res, 200, { success: true });

    if (path.startsWith('/api/cmu/get_bulk_upl/'))
      return json(res, 200, { status: 'Completed', packages: [] });

    log('UNHANDLED', method, path);
    json(res, 404, { error: `simulator has no route for ${method} ${path}` });
  })().catch((err: unknown) => {
    log('handler error', err);
    if (!res.headersSent) json(res, 500, { error: String(err) });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log(`Delhivery simulator on http://127.0.0.1:${PORT}`);
  log(
    `  webhooks → ${API_BASE_URL} (${WEBHOOK_SECRET.length > 0 ? 'signed' : 'DISABLED — no secret'})`,
  );
  log(`  point courier.delhivery_api_base_url at http://127.0.0.1:${PORT}`);
});
