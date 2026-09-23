/**
 * Local screenshot fixtures for the apps restyle (feat/apps-premium-restyle).
 *
 * Builds a small, realistic, deterministic data set on the LOCAL dev
 * database so every console page has something to show: orders spread
 * across the lifecycle, a wallet with top-ups and a withdrawal request,
 * a ticket, a consignment and a reseller store with a login. Everything
 * goes through the real API as the local test seller and test admin
 * (created by `scripts/dev-accounts.ts`, which must run first), except the
 * store user's password, which is set directly because the invitation
 * token is only ever emailed.
 *
 * Idempotent: orders are keyed on their `UI-FIX-nn` reference and every
 * other step checks for its own row first, so it can be re-run before the
 * "after" screenshots and add nothing twice.
 *
 * DEV-ONLY, and it refuses to run anywhere else. Four checks, all required:
 * SKYDROP_UI_FIXTURES=1 is set explicitly; NODE_ENV is not "production";
 * the API URL is 127.0.0.1/localhost; the DATABASE_URL and REDIS_URL hosts
 * are 127.0.0.1/localhost. God mode (used here to spread orders across
 * statuses) is audited CRITICAL and must never be exercised against a real
 * environment by a script. Run the local API with WORKERS_ENABLED=false so
 * nothing queued by these actions (email, webhooks, courier bookings) is
 * ever processed.
 *
 * Run from packages/db (where tsx, argon2 and @skydrop/db resolve):
 *   set -a; . ../../apps/api/.env; set +a
 *   SKYDROP_UI_FIXTURES=1 npx tsx ../../scripts/ui-fixtures.ts [--bulk]
 *
 * `--bulk` (Phase 6 — interaction-latency checks on long lists) also adds
 * 200 orders (`UI-BULK-nnn`, a quarter of them spread across the lifecycle
 * by god mode) and 150 accepted top-ups, so the order list, the wallet
 * ledger and the admin queues have enough rows to measure INP against.
 * Idempotent the same way: it tops up to the counts, never past them.
 */
import argon2 from 'argon2';
import { prisma } from '@skydrop/db';

const API = process.env['SKYDROP_API_URL'] ?? 'http://127.0.0.1:4000';
const STAFF = { email: 'admin@test.local', password: 'Test-Admin-1234' };
const SELLER = { email: 'seller@test.local', password: 'Test-Seller-1234' };
const STORE_USER = { email: 'store@test.local', password: 'Test-Store-1234' };

function assertLocal(): void {
  const local = (u: string): boolean => /\/\/([^@/]*@)?(127\.0\.0\.1|localhost)[:/]/.test(u);
  const refusals = [
    process.env['SKYDROP_UI_FIXTURES'] !== '1' && 'SKYDROP_UI_FIXTURES=1 is not set',
    process.env['NODE_ENV'] === 'production' && 'NODE_ENV is production',
    !local(API) && `API ${API} is not local`,
    !local(process.env['DATABASE_URL'] ?? '') && 'DATABASE_URL is not local',
    !local(process.env['REDIS_URL'] ?? '') && 'REDIS_URL is not local',
  ].filter(Boolean);
  if (refusals.length > 0) {
    throw new Error(`ui-fixtures is dev-only and refused to run: ${refusals.join('; ')}.`);
  }
}

type Json = Record<string, unknown>;
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
  const t = await res.text();
  if (!res.ok)
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${t.slice(0, 240)}`);
  return t ? (JSON.parse(t) as Json) : {};
}

/** One step's failure is reported and the rest carry on. */
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
  }
}

// Fixture customers. Names and addresses are invented; phone numbers sit in
// the +91 90000 000xx block so they cannot be anybody's real number.
const CUSTOMERS = [
  ['Priya Sharma', 'Near Shiv Mandir', 'Flat 12, Lake View Apartments', '700019'],
  ['Arjun Mehta', 'Opposite City Mall', '44 Park Street, 2nd floor', '700016'],
  ['Kavya Nair', 'Behind Post Office', '7 Temple Road, Ward 3', '682001'],
  ['Rohan Gupta', 'Next to SBI ATM', 'B-203 Green Park', '110016'],
  ['Ananya Iyer', 'Near Bus Stand', '19 Gandhi Nagar Main Road', '600020'],
  ['Vikram Singh', 'Above Sweet House', 'Shop 4, Clock Tower Market', '302001'],
  ['Meera Pillai', 'Near Government School', 'House 88, Kovil Street', '641001'],
  ['Farhan Ali', 'Opposite Masjid', '23 Nawab Lane', '226001'],
  ['Sneha Kulkarni', 'Near Railway Crossing', 'Plot 5, Shivaji Colony', '411001'],
  ['Aditya Rao', 'Behind Big Bazaar', '301 Silver Oak Towers', '560034'],
  ['Ishita Das', 'Near Kali Bari', '12/3 Hazra Road', '700026'],
  ['Karan Malhotra', 'Opposite Petrol Pump', '58 Model Town', '141002'],
  ['Divya Menon', 'Near Church Junction', 'TC 21/450 Palace Road', '695001'],
  ['Sahil Khan', 'Beside Medical Store', '9 Civil Lines', '462001'],
] as const;

// Where each fixture order should end up. God mode spreads them, so the
// order list, the tracking page and the dashboard all have every chip.
const TARGETS: Array<string | null> = [
  null, // stays PENDING_CONFIRMATION
  null,
  'CONFIRMED',
  'PICKED',
  'PACKED',
  'DISPATCHED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'DELIVERED',
  'DELIVERY_FAILED',
  'RTO_IN_TRANSIT',
  'CANCELLED',
  'DRAFT_KEEP', // left as a draft (never submitted)
];

async function main(): Promise<void> {
  assertLocal();
  const staff = (await call('/auth/staff/login', { method: 'POST', body: STAFF }))[
    'accessToken'
  ] as string;
  const seller = (await call('/auth/seller/login', { method: 'POST', body: SELLER }))[
    'accessToken'
  ] as string;
  const sellerRow = await prisma.seller.findUniqueOrThrow({ where: { email: SELLER.email } });
  const variants = await prisma.productVariant.findMany({
    where: { sellerId: sellerRow.id, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 3,
  });
  if (variants.length === 0) throw new Error('No variants — run scripts/dev-accounts.ts first.');

  // ── Orders ───────────────────────────────────────────────────────────
  for (let i = 0; i < CUSTOMERS.length; i++) {
    const ref = `UI-FIX-${String(i + 1).padStart(2, '0')}`;
    const [name, landmark, line1, pin] = CUSTOMERS[i]!;
    await step(`order ${ref}`, async () => {
      const existing = await prisma.order.findFirst({
        where: { sellerId: sellerRow.id, sellerOrderRef: ref },
      });
      if (existing) return;
      const v = variants[i % variants.length]!;
      const qty = 1 + (i % 3);
      const created = await call('/seller/orders', {
        method: 'POST',
        token: seller,
        body: {
          sellerOrderRef: ref,
          recipientName: name,
          recipientPhoneE164: `+919000000${String(10 + i).padStart(3, '0')}`,
          recipientAddressLine1: line1,
          recipientAddressLine2: landmark,
          recipientPostalCode: pin,
          paymentMode: 'COD',
          codAmountInr: 450 + i * 135,
          declaredValueInr: 600,
          totalWeightGrams: 400 * qty,
          acknowledgeDuplicate: true,
          items: [{ variantId: v.id, quantity: qty }],
        },
      });
      const id = created['id'] as string;
      const target = TARGETS[i] ?? null;
      if (target === 'DRAFT_KEEP') return;
      if ((created['status'] as string) === 'DRAFT') {
        await call(`/seller/orders/${id}/submit`, { method: 'POST', token: seller });
      }
      if (target) {
        await call(`/admin/orders/${id}/force-mutation`, {
          method: 'POST',
          token: staff,
          body: {
            targetStatus: target,
            reason: 'Local screenshot fixture for the apps restyle — not a real order.',
            acknowledgeDataIntegrityRisk: true,
          },
        });
      }
    });
  }

  // ── Wallet: one accepted top-up, one waiting, one withdrawal request ──
  const bank = await prisma.platformBankAccount.findFirst({
    where: { currency: 'INR', isActive: true, deletedAt: null },
  });
  await step('top-ups', async () => {
    if (!bank) throw new Error('no active INR platform bank account');
    const have = await prisma.walletTopupRequest.count({ where: { sellerId: sellerRow.id } });
    if (have >= 2) return;
    const accepted = await call('/seller/wallet/topups', {
      method: 'POST',
      token: seller,
      body: { bankAccountId: bank.id, amount: 5000, transactionRef: 'UIFIX-NEFT-0001' },
    });
    await call(`/admin/wallet/topups/${accepted['id'] as string}/accept`, {
      method: 'POST',
      token: staff,
      body: { note: 'Seen on the statement (fixture).' },
    });
    await call('/seller/wallet/topups', {
      method: 'POST',
      token: seller,
      body: { bankAccountId: bank.id, amount: 2500, transactionRef: 'UIFIX-NEFT-0002' },
    });
  });
  await step('withdrawal request', async () => {
    const have = await prisma.withdrawalRequest.count({ where: { sellerId: sellerRow.id } });
    if (have > 0) return;
    // A withdrawal needs somewhere to send the money. A first set of bank
    // details may go to staff for approval; approve it if it does.
    await call('/seller/profile/bank-details', {
      method: 'PATCH',
      token: seller,
      body: {
        bankName: 'Fixture Bank Ltd',
        bankBranchName: 'Gulshan',
        bankAccountName: 'Test Brand',
        bankAccountNumber: '0011223344556',
        bankRoutingNumber: '090261234',
        bankSwiftCode: 'FIXTBDDH',
      },
    });
    const pendingChange = await prisma.sellerBankChangeRequest
      .findFirst({ where: { sellerId: sellerRow.id, status: 'PENDING' } })
      .catch(() => null);
    if (pendingChange) {
      await call(`/admin/bank-change-requests/${pendingChange.id}/approve`, {
        method: 'POST',
        token: staff,
        body: {},
      });
    }
    await call('/seller/wallet/withdrawal-requests', {
      method: 'POST',
      token: seller,
      body: { currency: 'INR', amount: '1200.00', note: 'Fixture payout request.' },
    });
  });

  // ── A ticket on a delivered order ─────────────────────────────────────
  await step('ticket', async () => {
    const have = await prisma.ticket.count({ where: { sellerId: sellerRow.id } });
    if (have > 0) return;
    const order = await prisma.order.findFirst({
      where: { sellerId: sellerRow.id, sellerOrderRef: 'UI-FIX-09' },
    });
    await call('/seller/tickets', {
      method: 'POST',
      token: seller,
      body: {
        subject: 'Customer says one item was missing',
        description: 'The customer received the box but says one of the two items was not inside.',
        ...(order ? { orderId: order.id } : {}),
      },
    });
  });

  // ── A consignment announced straight to India ─────────────────────────
  await step('consignment', async () => {
    const have = await prisma.consignment.count({ where: { sellerId: sellerRow.id } });
    if (have > 0) return;
    await call('/seller/consignments', {
      method: 'POST',
      token: seller,
      body: {
        route: 'DIRECT_IN',
        sellerReference: 'UIFIX-SHIP-01',
        expectedArrivalAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        lines: variants
          .slice(0, 2)
          .map((v, k) => ({ variantId: v.id, expectedQty: 20 + k * 10, unitCostInr: 180 })),
      },
    });
  });

  // ── A reseller store with a login ──────────────────────────────────────
  await step('reseller store', async () => {
    const existing = await prisma.sellerStore.findFirst({
      where: { sellerId: sellerRow.id, kind: 'RESELLER', deletedAt: null },
    });
    let storeId = existing?.id;
    if (!storeId) {
      const created = await call('/seller/reseller-stores', {
        method: 'POST',
        token: seller,
        body: {
          name: 'Kolkata Kurta House',
          displayName: 'Kurta House',
          contactEmail: STORE_USER.email,
          contactPhone: '+919000000099',
          invite: { email: STORE_USER.email, fullName: 'Store Owner', roleKey: 'owner' },
        },
      });
      storeId = created['id'] as string;
    }
    const user = await prisma.storeUser.findUnique({ where: { email: STORE_USER.email } });
    if (user) return;
    const invitation = await prisma.storeUserInvitation.findFirst({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
    });
    if (!invitation) throw new Error('store created but no invitation row to take the role from');
    await prisma.storeUser.create({
      data: {
        storeId,
        email: STORE_USER.email,
        emailDisplay: STORE_USER.email,
        fullName: 'Store Owner',
        roleId: invitation.roleId,
        emailVerifiedAt: new Date(),
        passwordHash: await argon2.hash(STORE_USER.password, {
          type: argon2.argon2id,
          memoryCost: 19456,
          timeCost: 2,
          parallelism: 1,
        }),
      },
    });
  });

  if (process.argv.includes('--bulk')) await bulk(seller, staff, sellerRow.id, variants, bank);

  console.log(
    '\nSTORE   http://localhost:3005   ' + STORE_USER.email + ' / ' + STORE_USER.password,
  );
}

const BULK_ORDERS = 200;
const BULK_TOPUPS = 150;
const BULK_TARGETS = ['CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'] as const;

/** The API rate-limits a burst; wait it out and try the same row again. */
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= 6 || !(e as Error).message.includes('→ 429')) throw e;
      await new Promise((r) => setTimeout(r, 20_000));
    }
  }
}

/** Phase 6: enough rows to measure long lists. Tops up to the counts. */
async function bulk(
  seller: string,
  staff: string,
  sellerId: string,
  variants: ReadonlyArray<{ id: string }>,
  bank: { id: string } | null,
): Promise<void> {
  const have = await prisma.order.count({
    where: { sellerId, sellerOrderRef: { startsWith: 'UI-BULK-' } },
  });
  let failed = 0;
  for (let i = have; i < BULK_ORDERS; i++) {
    const ref = `UI-BULK-${String(i + 1).padStart(3, '0')}`;
    const c = CUSTOMERS[i % CUSTOMERS.length];
    const v = variants[i % variants.length];
    if (!c || !v) break;
    const [name, landmark, line1, pin] = c;
    try {
      const created = await paced(() =>
        call('/seller/orders', {
          method: 'POST',
          token: seller,
          body: {
            sellerOrderRef: ref,
            recipientName: name,
            recipientPhoneE164: `+919000000${String(100 + (i % 800)).padStart(3, '0')}`,
            recipientAddressLine1: line1,
            recipientAddressLine2: landmark,
            recipientPostalCode: pin,
            paymentMode: 'COD',
            codAmountInr: 300 + (i % 17) * 55,
            declaredValueInr: 600,
            totalWeightGrams: 400,
            acknowledgeDuplicate: true,
            items: [{ variantId: v.id, quantity: 1 }],
          },
        }),
      );
      const id = created['id'] as string;
      if ((created['status'] as string) === 'DRAFT') {
        await paced(() => call(`/seller/orders/${id}/submit`, { method: 'POST', token: seller }));
      }
      if (i % 4 === 0) {
        await call(`/admin/orders/${id}/force-mutation`, {
          method: 'POST',
          token: staff,
          body: {
            targetStatus: BULK_TARGETS[(i / 4) % BULK_TARGETS.length],
            reason: 'Local bulk fixture for the apps restyle INP checks — not a real order.',
            acknowledgeDataIntegrityRisk: true,
          },
        });
      }
    } catch (e) {
      failed++;
      if (failed <= 3) console.log(`  FAIL bulk order ${ref}: ${(e as Error).message}`);
    }
  }
  console.log(`  ok   bulk orders (${BULK_ORDERS - have - failed} added, ${failed} failed)`);

  if (!bank) {
    console.log('  FAIL bulk top-ups: no active INR platform bank account');
    return;
  }
  const topups = await prisma.walletTopupRequest.count({
    where: { sellerId, transactionRef: { startsWith: 'UIBULK-' } },
  });
  failed = 0;
  for (let i = topups; i < BULK_TOPUPS; i++) {
    try {
      const claim = await paced(() =>
        call('/seller/wallet/topups', {
          method: 'POST',
          token: seller,
          body: {
            bankAccountId: bank.id,
            amount: 100 + (i % 9) * 25,
            transactionRef: `UIBULK-${String(i + 1).padStart(4, '0')}`,
          },
        }),
      );
      await call(`/admin/wallet/topups/${claim['id'] as string}/accept`, {
        method: 'POST',
        token: staff,
        body: { note: 'Seen on the statement (bulk fixture).' },
      });
    } catch (e) {
      failed++;
      if (failed <= 3) console.log(`  FAIL bulk top-up ${i + 1}: ${(e as Error).message}`);
    }
  }
  console.log(`  ok   bulk top-ups (${BULK_TOPUPS - topups - failed} added, ${failed} failed)`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error((e as Error).message);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
