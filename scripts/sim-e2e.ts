/**
 * One command from an empty dev database to a parcel you can move.
 *
 * The Delhivery simulator has existed since the D-phases and speaks the
 * real wire API, but getting to the point where a parcel exists took
 * about twenty manual steps: a staff user, a seller, a product, stock
 * received into a bin, a courier credential encrypted with the right
 * key, two settings pointed at the simulator, then an order placed and
 * confirmed. Every one of them is a place to get something subtly wrong
 * and spend the afternoon finding out which.
 *
 * So this does all of it, against the REAL adapter code path — the HTTP
 * client, the auth header, request marshalling, response parsing — with
 * a fake Delhivery on the other end. Nothing physical can happen: the
 * write guard recognises loopback as a simulator, and a real parcel
 * still requires docs/delhivery-go-live-test.md.
 *
 *   pnpm sim:e2e
 *
 * It is idempotent. Re-running gives you a fresh seller and a fresh
 * parcel; it never edits the ones already there.
 *
 * WHAT IT DOES NOT PROVE: that Delhivery agrees with us. The simulator
 * encodes OUR belief about their wire format, so where that belief is
 * wrong the simulator is wrong in the same direction and agrees. A green
 * run means our orchestration is self-consistent, which is what makes
 * our own bugs cheap to find — not that the integration is validated.
 */
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { prisma, StaffRole } from '@skydrop/db';

const API = process.env['SKYDROP_API_URL'] ?? 'http://127.0.0.1:4000';
const SIM = process.env['SIM_URL'] ?? 'http://127.0.0.1:4010';
const STAFF_PASSWORD = 'SimStaff-Password!42';
const SELLER_PASSWORD = 'SimSeller-Pass!42';

type Json = Record<string, unknown>;

function line(s = ''): void {
  process.stdout.write(`${s}\n`);
}

async function call(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<Json> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  const json: Json = text ? (JSON.parse(text) as Json) : {};
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}\n${text.slice(0, 600)}`);
  }
  return json;
}

/** Refuse to run against anything that is not obviously local. The whole
 *  safety argument rests on the target being a simulator. */
function assertLocal(): void {
  for (const [label, url] of [
    ['SKYDROP_API_URL', API],
    ['SIM_URL', SIM],
  ] as const) {
    const host = new URL(url).hostname;
    if (!/^(localhost|127\.|::1|0\.0\.0\.0)/.test(host)) {
      throw new Error(
        `${label} points at ${host}, which is not loopback. This script seeds test data and ` +
          `confirms orders; it must never run against a shared or production environment.`,
      );
    }
  }
}

/** Both processes up, and the adapter pointed at the simulator. */
async function preflight(): Promise<void> {
  // ── 0. Both processes up? ─────────────────────────────────────────
  const simUp = await fetch(`${SIM}/_sim/parcels`).then(
    (r) => r.ok,
    () => false,
  );
  if (!simUp) {
    throw new Error(
      `No simulator on ${SIM}. Start it first:\n\n` +
        `  PORT=4010 SKYDROP_API_URL=${API} \\\n` +
        `  TRACKING_WEBHOOK_SECRET_DELHIVERY=devsimsecret \\\n` +
        `  pnpm --filter @skydrop/delhivery-sim start\n`,
    );
  }
  await fetch(`${API}/health`).then(
    (r) => {
      if (!r.ok) throw new Error(`API on ${API} answered ${r.status}`);
    },
    () => {
      throw new Error(`No API on ${API}. Start it with: pnpm --filter @skydrop/api start:dev`);
    },
  );

  // ── 1. Point the adapter at the simulator ─────────────────────────
  // Both settings, every run: the point of the script is that you do not
  // have to remember which two they were.
  await prisma.systemSetting.update({
    where: { key: 'courier.delhivery_api_base_url' },
    data: { valueString: SIM },
  });
  await prisma.systemSetting.update({
    where: { key: 'courier.delhivery_live_writes_enabled' },
    data: { valueBoolean: true },
  });
  // The two settings the adapter needs before it will marshal a
  // create-shipment call at all. Both are seeded EMPTY on purpose —
  // they describe a real warehouse Delhivery has on file, and a wrong
  // value is worse than no value. For a simulator any value does, and
  // filling them here is what stops the run dying on
  // "pickup location not configured" thirty seconds in.
  for (const [key, value] of [
    ['courier.delhivery_origin_pincode', '560001'],
    ['courier.delhivery_pickup_location', 'Skydrop'],
  ] as const) {
    const row = await prisma.systemSetting.findUnique({
      where: { key },
      select: { valueString: true },
    });
    if (!row?.valueString) {
      await prisma.systemSetting.update({ where: { key }, data: { valueString: value } });
    }
  }
  line(`→ adapter pointed at ${SIM}, live writes ON (loopback ⇒ simulator)`);
}

interface SetupResult {
  readonly orderId: string;
  readonly awb: string;
  readonly staffToken: string;
  readonly sellerToken: string;
  readonly sellerId: string;
  readonly variantId: string;
}

/** A fresh seller, stock, and one confirmed order carrying an AWB. */
async function setupOrder(): Promise<SetupResult> {
  // ── 2. Staff + seller ─────────────────────────────────────────────
  const stamp = Date.now();
  const staffEmail = `sim-staff-${stamp}@skydrop.local`;
  await prisma.staffUser.create({
    data: {
      email: staffEmail,
      emailDisplay: staffEmail,
      passwordHash: await argon2.hash(STAFF_PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      role: StaffRole.SUPER_ADMIN,
    },
  });
  const staffLogin = await call('/auth/staff/login', {
    method: 'POST',
    body: { email: staffEmail, password: STAFF_PASSWORD },
  });
  const staffToken = staffLogin['accessToken'] as string;
  line(`→ staff  ${staffEmail} / ${STAFF_PASSWORD}`);

  // ── 3. A courier credential the adapter can decrypt ───────────────
  // Real mode builds an auth header for every call, so without one the
  // very first request dies as DELHIVERY_TRANSPORT_ERROR — which reads
  // like a network fault and is really a missing secret. The simulator
  // ignores the token's value; the adapter still requires one to exist.
  // BOTH environments, on purpose. `DelhiveryHttpService.environment()`
  // returns SANDBOX unless NODE_ENV is production, and the credential
  // lookup filters on it — so a PRODUCTION-only credential is invisible
  // to a dev API and the first call dies as DELHIVERY_TRANSPORT_ERROR,
  // which reads like a network fault and is really a missing secret.
  // This script cannot see the API's NODE_ENV, so it covers both.
  for (const environment of ['SANDBOX', 'PRODUCTION'] as const) {
    const existing = (await call(
      `/admin/courier-accounts?courierCode=delhivery&environment=${environment}`,
      { token: staffToken },
    )) as unknown as Array<{ id: string }>;
    if (existing.length > 0) continue;
    await call('/admin/courier-accounts', {
      method: 'POST',
      token: staffToken,
      body: {
        courierCode: 'delhivery',
        environment,
        label: `Simulator account (${environment})`,
        credentialFields: { apiToken: 'simulator-token-not-a-real-secret' },
        isDefault: true,
      },
    });
    line(`→ courier credential created for ${environment}`);
  }

  const sellerEmail = `sim-seller-${stamp}@brand.test`;
  const invite = (await call('/admin/seller-invitations', {
    method: 'POST',
    token: staffToken,
    body: { email: sellerEmail },
  })) as Json;
  const reg = await call('/auth/seller/register/invite', {
    method: 'POST',
    body: {
      token: invite['token'],
      companyName: 'Simulator Brand',
      contactPersonName: 'Sim Owner',
      phone: `+88017${String(stamp).slice(-8)}`,
      password: SELLER_PASSWORD,
    },
  });
  const sellerToken = reg['accessToken'] as string;
  line(`→ seller ${sellerEmail} / ${SELLER_PASSWORD}`);

  // Retire any call-queue entries left behind by earlier runs.
  //
  // `pullNext` is strict FIFO, and `release` puts an entry back where it
  // was — so a queue holding one stale order hands back that same order
  // forever and the script can never reach its own. These entries belong
  // to abandoned test orders; a dev seeding script is allowed to clear
  // its own detritus, and doing it here rather than at the end means an
  // interrupted run still leaves the next one able to start.
  const retired = await prisma.callQueueEntry.updateMany({
    where: { status: { in: ['PENDING', 'ASSIGNED'] } },
    data: { status: 'COMPLETED', closureReason: 'ORDER_CANCELLED', closedAt: new Date() },
  });
  if (retired.count > 0)
    line(`→ retired ${retired.count} stale call-queue entr(ies) from earlier runs`);

  // ── 4. Somewhere to keep stock, and stock to keep ─────────────────
  const warehouses = (await call('/admin/warehouses', { token: staffToken })) as unknown as Array<{
    id: string;
    code: string;
  }>;
  const warehouse = warehouses[0];
  if (!warehouse)
    throw new Error('No warehouse — run the seed first (pnpm --filter @skydrop/db seed)');

  // Reuse a pickable bin if the warehouse already has one. Creating a
  // fresh A-01-01 every run collides on the second, and a bin is not
  // what this script is testing.
  const existingBins = (await call(`/admin/warehouses/${warehouse.id}/bins`, {
    token: staffToken,
  })) as unknown as Array<{ id: string; type: string; code: string }>;
  let binId = existingBins.find((b) => b.type === 'STORAGE' || b.type === 'FLOOR')?.id ?? null;
  if (binId === null) {
    const zone = await call(`/admin/warehouses/${warehouse.id}/zones`, {
      method: 'POST',
      token: staffToken,
      body: { code: `S${String(stamp).slice(-4)}`, name: 'Sim zone' },
    });
    const bin = await call(`/admin/warehouses/${warehouse.id}/bins`, {
      method: 'POST',
      token: staffToken,
      body: { zoneId: zone['id'], aisle: 'A', rack: '1', shelf: '1', type: 'STORAGE' },
    });
    binId = bin['id'] as string;
  }

  const product = await call('/seller/products', {
    method: 'POST',
    token: sellerToken,
    body: { name: 'Simulator Widget', externalRef: `SIM-${stamp}` },
  });
  const variant = await call(`/seller/products/${product['id']}/variants`, {
    method: 'POST',
    token: sellerToken,
    body: { skuCode: `SIM-${stamp}-STD`, weightGrams: 500, declaredValueInr: 500 },
  });

  const receipt = await call('/seller/goods-receipts', {
    method: 'POST',
    token: sellerToken,
    body: { lines: [{ variantId: variant['id'], expectedQty: 10 }] },
  });
  const receiptLines = receipt['lines'] as Array<{ id: string }>;
  await call(`/admin/goods-receipts/${receipt['id']}/start-receiving`, {
    method: 'POST',
    token: staffToken,
  });
  await call(`/admin/goods-receipts/${receipt['id']}/lines`, {
    method: 'POST',
    token: staffToken,
    body: {
      lines: [{ lineId: receiptLines[0]?.id, receivedQty: 10, putawayBinId: binId }],
    },
  });
  await call(`/admin/goods-receipts/${receipt['id']}/complete`, {
    method: 'POST',
    token: staffToken,
  });
  line('→ 10 units received into stock');

  // ── 5. An order, confirmed — which is what calls the simulator ────
  const order = await call('/seller/orders', {
    method: 'POST',
    token: sellerToken,
    body: {
      recipientName: 'Simulator Customer',
      recipientPhoneE164: `+9198${String(stamp).slice(-8)}`,
      recipientAddressLine1: '12 Test Road',
      recipientCity: 'New Delhi',
      recipientStateProvince: 'Delhi',
      recipientPostalCode: '110001',
      paymentMode: 'COD',
      codAmountInr: 500,
      items: [{ variantId: variant['id'], quantity: 1 }],
    },
  });
  const orderId = order['id'] as string;
  await call(`/seller/orders/${orderId}/submit`, { method: 'POST', token: sellerToken });
  line(`→ order ${order['orderNumber'] as string} placed`);

  // Confirming is what generates the AWB (CUR-2b), and therefore what
  // makes the adapter talk to the simulator for the first time.
  //
  // Deliberately through the CALL CENTRE, not god mode. `forceMutate`
  // bypasses `transitionStatus` by design (ORD-2), so it provisions no
  // shipment and emits no lifecycle event — an order reaches CONFIRMED
  // and nothing else happens at all. That is correct, and it is also
  // exactly the wrong way to drive a test: the first version of this
  // script used it and produced a confirmed order with zero shipments.
  // Pull until we get OUR order. `pullNext` is strict FIFO (CC-6), so on
  // a queue with anything left over from an earlier run it hands back
  // the OLDEST entry — and confirming that one instead is a bug that
  // looks like success: the script reports "confirmed" while the order
  // it created sits untouched. Anything else is released, not consumed.
  let assignmentId: string | null = null;
  for (let i = 0; i < 25 && assignmentId === null; i += 1) {
    const pulled = await call('/agent/calls/next', { method: 'POST', token: staffToken });
    const assignment = pulled['assignment'] as { assignmentId: string; orderId: string } | null;
    if (!assignment) {
      throw new Error(
        'Call queue ran dry before our order appeared — it should have been enqueued on submit (CC-6).',
      );
    }
    if (assignment.orderId === orderId) {
      assignmentId = assignment.assignmentId;
    } else {
      await call(`/agent/calls/${assignment.assignmentId}/release`, {
        method: 'POST',
        token: staffToken,
      });
    }
  }
  if (assignmentId === null) throw new Error('Could not pull our own order off the call queue');

  const startedAt = new Date(Date.now() - 60_000).toISOString();
  await call(`/agent/calls/${assignmentId}/record-attempt`, {
    method: 'POST',
    token: staffToken,
    body: {
      outcome: 'CONFIRMED',
      startedAt,
      endedAt: new Date().toISOString(),
      outcomeNotes: 'Simulator end-to-end run',
    },
  });
  line('→ confirmed on the call — AWB job enqueued');

  // The AWB job is a queue worker, so give it a moment to land.
  const awb = await waitForAwb(orderId, staffToken);
  if (awb === null) {
    throw new Error(
      `No AWB for order ${orderId}. Check the API log for the AWB job, and the ` +
        `simulator log for an UNHANDLED line — that is how you find a call it does not speak.`,
    );
  }
  line(`→ AWB ${awb} issued by the simulator`);
  return {
    orderId,
    awb,
    staffToken,
    sellerToken,
    sellerId: reg['seller'] ? ((reg['seller'] as Json)['id'] as string) : '',
    variantId: variant['id'] as string,
  };
}

// ── the warehouse legs ──────────────────────────────────────────────
// Everything between a confirmed order and a parcel a courier can carry.
// Without these the order sits at CONFIRMED and every scan is correctly
// IGNORED: TRK-4 skips a transition whose target is not reachable from
// where the order actually is, and a parcel nobody picked has not earned
// "in transit". That guard is why the first version of this script
// looked like it worked and moved nothing.

async function driveToDispatched(orderId: string, token: string): Promise<void> {
  // PICK. `pullNext` is FOR UPDATE SKIP LOCKED over eligible shipments,
  // so it can hand back someone else's; take ours or put it back.
  let shipmentId: string | null = null;
  for (let i = 0; i < 25 && shipmentId === null; i += 1) {
    const pulled = await call('/warehouse/picks/next', { method: 'POST', token });
    const pick = pulled['pick'] as { shipmentId: string; orderId: string } | null;
    if (!pick) throw new Error('Pick queue empty — the order should be eligible once CONFIRMED');
    if (pick.orderId === orderId) shipmentId = pick.shipmentId;
  }
  if (shipmentId === null) throw new Error('Could not pull our own pick');

  const started = await call(`/warehouse/picks/${shipmentId}/start`, { method: 'POST', token });
  if (started['fullyAllocated'] !== true) {
    throw new Error(
      `Pick could not be fully allocated (status ${String(started['status'])}) — WMS-4 would ` +
        `route this to manual placement. Is there enough stock?`,
    );
  }

  // The bin and batch come from the phase-2 reservations the allocator
  // just populated (INV-4). They are the authoritative record of where
  // the goods are; `shipment_items.picked*` is only the operational hint.
  const items = await prisma.shipmentItem.findMany({
    where: { shipmentId },
    select: { id: true, orderItemId: true },
  });
  for (const item of items) {
    const reservation = await prisma.stockReservation.findFirst({
      where: { orderItemId: item.orderItemId, status: 'ACTIVE', binId: { not: null } },
      select: { binId: true, batchId: true },
    });
    if (!reservation?.binId || !reservation.batchId) {
      throw new Error(`No phase-2 reservation for shipment item ${item.id}`);
    }
    await call(`/warehouse/picks/${shipmentId}/items`, {
      method: 'POST',
      token,
      body: {
        shipmentItemId: item.id,
        pickedBinId: reservation.binId,
        pickedBatchId: reservation.batchId,
      },
    });
  }
  await call(`/warehouse/picks/${shipmentId}/complete`, { method: 'POST', token });
  line('   picked');

  // PACK. Entry to PICKED makes the shipment eligible by construction —
  // the pack queue is a virtual FIFO query, not a table.
  let packed = false;
  for (let i = 0; i < 25 && !packed; i += 1) {
    const pulled = await call('/warehouse/packs/next', { method: 'POST', token });
    const pack = pulled['pack'] as { shipmentId: string } | null;
    if (!pack) throw new Error('Pack queue empty — the shipment should be eligible once PICKED');
    if (pack.shipmentId === shipmentId) packed = true;
  }
  await call(`/warehouse/packs/${shipmentId}/complete`, { method: 'POST', token, body: {} });
  line('   packed');

  // MANIFEST. Packing auto-attached the shipment to a DRAFT manifest for
  // its (courier, warehouse) pair (WMS-7); closing it moves every
  // shipment on it to PENDING_DISPATCH and enqueues AWB generation.
  const manifests = (await call('/admin/warehouse/manifests?status=DRAFT', { token })) as {
    items: Array<{ id: string }>;
  };
  const manifestId = manifests.items[0]?.id;
  if (!manifestId) throw new Error('No DRAFT manifest — the pack auto-attach (WMS-7) did not run');
  await call(`/admin/warehouse/manifests/${manifestId}/close`, { method: 'POST', token });
  line('   manifest closed');

  // Closing the manifest enqueues AWB generation for it (CUR-2); the
  // manifest only becomes CONFIRMED once that job has run, and handoff
  // refuses until then. The AWB itself already exists — it was issued at
  // order confirmation (CUR-2b) — so this is the job reconciling the
  // manifest, not a second call to the courier.
  let manifestReady = false;
  for (let i = 0; i < 40 && !manifestReady; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const m = await prisma.manifest.findUniqueOrThrow({
      where: { id: manifestId },
      select: { status: true },
    });
    if (m.status === 'CONFIRMED' || m.status === 'DISPATCHED') manifestReady = true;
    if (m.status === 'FAILED') {
      throw new Error('Manifest AWB generation FAILED — check the API log for the reason');
    }
  }
  if (!manifestReady)
    throw new Error('Manifest never reached CONFIRMED — is the AWB worker running?');

  // HANDOFF. The supervisor confirming the courier physically took the
  // parcels is what makes them DISPATCHED — and CUR-3's one and only
  // decrement of qtyOnHand.
  await call(`/admin/courier/manifests/${manifestId}/confirm-handoff`, { method: 'POST', token });
  line('   handed to courier → DISPATCHED');
}

/** Move the parcel in the simulator. Each advance fires a signed webhook. */
async function advance(awb: string, stage: string, note?: string): Promise<void> {
  const res = await fetch(`${SIM}/_sim/parcels/${awb}/advance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stage, ...(note === undefined ? {} : { note }) }),
  });
  if (!res.ok) throw new Error(`sim advance ${stage} → ${res.status}`);
  // The webhook is processed off a queue; give the processor a moment.
  await new Promise((r) => setTimeout(r, 1500));
}

/** On-hand for one seller's variant — the number conservation is about. */
async function onHand(variantId: string): Promise<number> {
  const agg = await prisma.stockLevel.aggregate({
    _sum: { qtyOnHand: true },
    where: { variantId },
  });
  return agg._sum.qtyOnHand ?? 0;
}

async function orderStatus(orderId: string): Promise<string> {
  const row = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { status: true },
  });
  return row.status;
}

async function waitForAwb(orderId: string, token: string): Promise<string | null> {
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const shipments = (await call(`/admin/orders/${orderId}/shipments`, {
      token,
    })) as unknown as Array<{ awbNumber: string | null }>;
    const found = shipments.find((sh) => sh.awbNumber)?.awbNumber;
    if (found) return found;
  }
  return null;
}

async function main(): Promise<void> {
  assertLocal();
  await preflight();

  // ── Parcel 1: the happy path ──────────────────────────────────────
  line();
  line('━━ PARCEL 1 — delivered ━━');
  const a = await setupOrder();
  await driveToDispatched(a.orderId, a.staffToken);
  for (const stage of ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    await advance(a.awb, stage);
    line(`   scan ${stage} → order ${await orderStatus(a.orderId)}`);
  }

  // ── Parcel 2: refused, returned, and put back on the shelf ────────
  line();
  line('━━ PARCEL 2 — refused, returned, restocked ━━');
  const b = await setupOrder();
  await driveToDispatched(b.orderId, b.staffToken);
  for (const [stage, note] of [
    ['IN_TRANSIT', undefined],
    ['OUT_FOR_DELIVERY', undefined],
    ['NDR', 'customer refused the parcel'],
    ['RTO_INITIATED', undefined],
    ['RTO_IN_TRANSIT', undefined],
  ] as Array<[string, string | undefined]>) {
    await advance(b.awb, stage, note);
    line(`   scan ${stage} → order ${await orderStatus(b.orderId)}`);
  }

  // The scans stop here ON PURPOSE. A webhook may drive a parcel as far
  // as RTO_IN_TRANSIT and no further: `RTO_RECEIVED` is the warehouse's
  // to declare, because it is what triggers the conservation-critical
  // finalize chain and a spoofed scan must not be able to reach it
  // (TRK-6). Somebody has to physically have the carton.
  await call('/warehouse/rto/receive', {
    method: 'POST',
    token: b.staffToken,
    body: { awbNumber: b.awb },
  });
  line(`   warehouse received it → order ${await orderStatus(b.orderId)}`);

  const rtoShipment = await prisma.shipment.findFirstOrThrow({
    where: { awbNumber: b.awb },
    select: { id: true, items: { select: { id: true } } },
  });
  for (const item of rtoShipment.items) {
    await call(`/warehouse/rto/items/${item.id}/inspect`, {
      method: 'POST',
      token: b.staffToken,
      body: { condition: 'GOOD', disposition: 'RESTOCK', notes: 'Simulator run — sellable' },
    });
  }
  await call(`/warehouse/rto/shipments/${rtoShipment.id}/finalize`, {
    method: 'POST',
    token: b.staffToken,
  });
  line(`   inspected + finalized → order ${await orderStatus(b.orderId)}`);

  // ── What the run proved ───────────────────────────────────────────
  // Conservation, per parcel, against its own seller's stock — not a
  // running total across every test seller, which says nothing.
  //
  // Ten units received, one ordered. The delivered parcel leaves NINE:
  // qtyOnHand decrements exactly once, at dispatch (CUR-3), and
  // DELIVERED is stock-neutral. The returned-and-restocked parcel goes
  // back to TEN — the unit came home and was put back on the shelf.
  const aOnHand = await onHand(a.variantId);
  const bOnHand = await onHand(b.variantId);
  const aStatus = await orderStatus(a.orderId);
  const bStatus = await orderStatus(b.orderId);

  line();
  line('━━ RESULT ━━');
  line(`  parcel 1  ${a.awb}  ${aStatus}  · on hand ${aOnHand} (expected 9)`);
  line(`  parcel 2  ${b.awb}  ${bStatus}  · on hand ${bOnHand} (expected 10)`);
  line();

  const problems: string[] = [];
  if (aStatus !== 'DELIVERED') problems.push(`parcel 1 ended ${aStatus}, not DELIVERED`);
  if (bStatus !== 'RTO_RESTOCKED') problems.push(`parcel 2 ended ${bStatus}, not RTO_RESTOCKED`);
  if (aOnHand !== 9) problems.push(`delivered parcel left ${aOnHand} on hand, not 9`);
  if (bOnHand !== 10) problems.push(`restocked parcel left ${bOnHand} on hand, not 10`);

  if (problems.length > 0) {
    for (const p of problems) line(`  ✖ ${p}`);
    throw new Error(`${problems.length} lifecycle assertion(s) failed`);
  }
  line('  ✔ both lifecycles complete, and stock conserved on each.');
  line();
  line('To go back to the in-process stub when you are done:');
  line("  UPDATE system_settings SET value_string='' WHERE key='courier.delhivery_api_base_url';");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e: unknown) => {
    line();
    line(`✖  ${(e as Error).message}`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

void randomUUID;
