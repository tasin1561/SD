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

async function main(): Promise<void> {
  assertLocal();

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
  const origin = await prisma.systemSetting.findUnique({
    where: { key: 'courier.delhivery_origin_pincode' },
    select: { valueString: true },
  });
  if (!origin?.valueString) {
    await prisma.systemSetting.update({
      where: { key: 'courier.delhivery_origin_pincode' },
      data: { valueString: '560001' },
    });
  }
  line(`→ adapter pointed at ${SIM}, live writes ON (loopback ⇒ simulator)`);

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
  let awb: string | null = null;
  for (let i = 0; i < 40 && awb === null; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const shipments = (await call(`/admin/orders/${orderId}/shipments`, {
      token: staffToken,
    })) as unknown as Array<{ awbNumber: string | null }>;
    awb = shipments.find((s) => s.awbNumber)?.awbNumber ?? null;
  }

  line();
  if (awb === null) {
    line('⚠  No AWB yet. Check the API log for the AWB job, and the simulator log for');
    line('   an UNHANDLED line — that is how you find a call the simulator does not speak.');
    line(`   Order: ${orderId}`);
  } else {
    line(`✔  AWB ${awb} issued by the simulator — the real adapter path ran end to end.`);
    line();
    line('Move the parcel (each advance fires a SIGNED webhook at the API):');
    line();
    for (const stage of ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      line(
        `  curl -s -XPOST ${SIM}/_sim/parcels/${awb}/advance \\\n` +
          `    -H 'content-type: application/json' -d '{"stage":"${stage}"}'`,
      );
    }
    line();
    line('  Failed delivery instead:  {"stage":"NDR","note":"customer unreachable"}');
    line('  Then a return:            RTO_INITIATED → RTO_IN_TRANSIT');
    line('  (RTO_RECEIVED is deliberately warehouse-only — TRK-6.)');
  }
  line();
  line(`Order:  ${API.replace(':4000', ':3002')}/orders/${orderId}   (admin)`);
  line(`Track:  ${SIM}/_sim/parcels`);
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
