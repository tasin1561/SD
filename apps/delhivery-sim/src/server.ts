import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  NON_SERVICEABLE_PIN,
  TRANSIENT_FAIL_PIN,
  addPickup,
  addScan,
  allParcels,
  allPickups,
  allRefusedPins,
  getParcel,
  issueWaybill,
  putParcel,
  refusalFor,
  refusePin,
  registerWarehouse,
  reset,
  stopRefusingPin,
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
/** Where we are reachable. `pdf_download_link` has to be ABSOLUTE — the
 *  adapter hands it straight to `fetch`, which cannot resolve a bare
 *  path, and Delhivery returns a fully-qualified pre-signed URL there. */
const SELF_URL = process.env['SIM_SELF_URL'] ?? `http://127.0.0.1:${PORT}`;
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

/** Money, to the paisa. Delhivery's own figures are two-decimal. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
/** A raw JSON body, or null if it is not one. */
function parseJsonBody(raw: string): unknown {
  if (raw.trim() === '') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

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

  // A REFUSAL THE OPERATOR NOMINATED — see `SimRefusal` in state.ts.
  //
  // Shaped exactly as a real refusal is, and that shape is the whole
  // point: the envelope `rmk` is Delhivery's boilerplate, which is the
  // same sentence whatever was wrong, and the ANSWER is the per-package
  // `err_code` + `remarks`. `parseCreateResponse` reads the package
  // first for that reason, so a simulator that put the real reason in
  // `rmk` would exercise the fallback rather than the path production
  // takes.
  const refusal = refusalFor(pin);
  if (refusal !== undefined) {
    log('refusing create for pin', pin, `[${refusal.errCode}]`, refusal.remarks);
    json(res, 200, {
      success: false,
      rmk: 'An internal Error has occurred, Please get in touch with client.support@delhivery.com',
      packages: [
        {
          status: 'Fail',
          err_code: refusal.errCode,
          remarks: [refusal.remarks],
          // NOT a serviceability refusal: the address is fine and the
          // pre-flight said so. Reporting otherwise here would make
          // `supersedeReason` NON_SERVICEABLE and the worklist would say
          // "Address not served" over an opinion about the consignee.
          serviceable: true,
        },
      ],
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
        pdf_download_link: `${SELF_URL}/_sim/label/${awb}.pdf`,
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

/**
 * The packing-slip METADATA call.
 *
 * Delhivery answers this with JSON carrying a pre-signed URL, and the
 * adapter then fetches that URL for the bytes — two steps, not one. The
 * simulator used to return the PDF itself here, so the adapter parsed
 * PDF bytes as JSON, found no `pdf_download_link`, and every label
 * fetch failed. That kept each manifest from ever reaching CONFIRMED,
 * which in turn made dispatch handoff impossible — so no parcel driven
 * through the simulator could be dispatched, let alone delivered.
 */
function handlePackingSlip(awb: string, res: ServerResponse): void {
  json(res, 200, {
    packages: [
      {
        waybill: awb,
        pdf_download_link: `${SELF_URL}/_sim/label/${awb}.pdf`,
      },
    ],
  });
}

/** The bytes the pre-signed URL points at. */
function handleLabelBytes(res: ServerResponse): void {
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
    if (path === '/_sim/refused-pins' && method === 'GET') return json(res, 200, allRefusedPins());
    if (path === '/_sim/refuse-pin' && method === 'POST') {
      const parsed = parseJsonBody(body) as {
        pin?: string;
        errCode?: string;
        remarks?: string;
      } | null;
      const pin = String(parsed?.pin ?? '').trim();
      if (pin === '') return json(res, 400, { error: 'pin is required' });
      const refusal = {
        errCode: String(parsed?.errCode ?? 'ER0005').trim(),
        remarks: String(parsed?.remarks ?? 'suspicious order/consignee').trim(),
      };
      refusePin(pin, refusal);
      log('will refuse creates for pin', pin, `[${refusal.errCode}]`, refusal.remarks);
      return json(res, 200, { pin, ...refusal });
    }
    if (path.startsWith('/_sim/refuse-pin/') && method === 'DELETE') {
      const pin = path.slice('/_sim/refuse-pin/'.length);
      const had = stopRefusingPin(pin);
      log('no longer refusing creates for pin', pin, had ? '' : '(was not refused)');
      return json(res, 200, { pin, wasRefused: had });
    }
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
    if (path === '/api/p/packing_slip') {
      return handlePackingSlip(url.searchParams.get('wbns') ?? '', res);
    }
    if (path.startsWith('/_sim/label/')) return handleLabelBytes(res);

    if (path === '/api/p/edit' && method === 'POST') {
      // Cancel and edit share this endpoint; `cancellation: "true"` is
      // the cancel.
      //
      // A RAW JSON BODY, not `data=<json>`. Only `/api/cmu/create.json`
      // uses that form encoding — `docs/delhivery-integration.md`'s
      // verified table gives this one as `{"waybill":"…",
      // "cancellation":"true"}`, and `DelhiveryShipmentEditService`
      // sends exactly that with `encoding: 'json'`.
      //
      // It was parsed with `parseFormDataKey` here, which looks for a
      // `data` key, found none, and answered "waybill not found" to
      // EVERY cancel. So the seller's own send-back — the single most
      // consequential customer-facing courier call in the product, the
      // one that reaches Delhivery with no operator in the loop — had
      // never once been exercised end to end on this box: anything
      // testing it was silently testing the refusal path. Found by
      // filming it (D4).
      //
      // The form shape is still accepted, because a fixture written
      // against the old behaviour is not worth breaking to make a point.
      const parsed = (parseJsonBody(body) ?? parseFormDataKey(body)) as {
        waybill?: string;
        cancellation?: string;
      } | null;
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

    /*
      TAT and CHARGES — the two READ endpoints, and the two this
      simulator got WRONG for as long as it has existed.

      Nothing consumed them until the courier panel on an order put both
      on screen, which is how it was found (2026-10-04, filming P2). Both
      failures were silent and neither could have been caught by a test
      that only asks "did the call succeed":

        · `expected_tat` answered `{data:[{tat:3}]}` — `data` an ARRAY
          and no `success` key at all. The adapter reads
          `res.success !== true` first and treats anything else as
          Delhivery DECLINING to quote the lane, so every local parcel
          came back `tatDays: null` with "No TAT available for this
          lane". A 200 that the adapter reads as a refusal is the worst
          shape a fake can have: the request log says it worked.
          Production, captured 2026-07-27, answers
          `{"success":true,"msg":"","data":{"tat":5}}` — an OBJECT.

        · `invoice/charges` answered three of the ten fields the real
          one carries, so `zone`, `charged_weight`, `divisor`, the
          delivery leg and the tax breakdown were all absent and read as
          "not supplied" rather than as a hole in the fake.

      Both are modelled on the production capture recorded in
      `DelhiveryCostService`'s own docstring (Delhi → Bangalore, 1500 g,
      surface: charge_DL 119, charge_COD 25, gross 149.39, total 176.29,
      zone C2, charged_weight 1500, divisor 5000, tax split SGST/CGST).
      The figures here are DERIVED from the query rather than copied, so
      a heavier parcel costs more and a prepaid one carries no COD fee —
      a fake that answers the same number to every question teaches the
      reader that the weight does not matter.
    */
    if (path === '/api/dc/expected_tat') {
      // Express is quicker than surface, which is the only thing about
      // `mot` worth reproducing.
      const tat = url.searchParams.get('mot') === 'E' ? 2 : 3;
      return json(res, 200, { success: true, msg: '', data: { tat } });
    }

    if (path.startsWith('/api/kinko/v1/invoice/charges')) {
      const grams = Math.max(1, Number(url.searchParams.get('cgm') ?? '500'));
      const isCod = (url.searchParams.get('pt') ?? '').toUpperCase() === 'COD';
      // Their slab shape: a base for the first half kilo, then per 500 g.
      const slabs = Math.ceil(grams / 500);
      const delivery = round2(45 + (slabs - 1) * 33.5);
      const codFee = isCod ? 35 : 0;
      const gross = round2(delivery + codFee);
      // 18% GST, split the way an intra-state consignment splits it.
      const half = round2((gross * 0.18) / 2);
      return json(res, 200, [
        {
          status: 'Success',
          zone: 'C2',
          charge_DL: delivery,
          charge_COD: codFee,
          charge_RTO: 0,
          charge_DTO: 0,
          gross_amount: gross,
          total_amount: round2(gross + half * 2),
          charged_weight: grams,
          divisor: 5000,
          tax_data: { SGST: half, CGST: half, IGST: 0, service_tax: 0 },
        },
      ]);
    }

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
