/**
 * Demo data for the seller-app tutorial recordings.
 *
 * WHY this exists rather than filming whatever is in the dev database: a
 * tutorial has to be re-takeable. Filming against leftover rows means the
 * second take shows different products, different stock and a different
 * order count, so every frame the narration refers to goes stale. This
 * script owns the world the camera sees.
 *
 * IDEMPOTENT in both directions:
 *   - the demo seller, its catalogue and its stock are created once and
 *     then topped up, never piled up;
 *   - the product the SECOND video creates ON CAMERA is DELETED here,
 *     because a SKU is permanent once saved (the products form says so
 *     in its own words) and a re-take would otherwise collide on it.
 *
 * LOCAL ONLY. It refuses to run against a non-local DATABASE_URL — it
 * writes sellers, products and stock, and none of that belongs anywhere
 * but a dev box.
 *
 *   node scripts/tutorials/seed-demo-data.mjs
 */
import { prisma, argon2 } from './lib/deps.mjs';

const API = process.env.SKYDROP_API_URL ?? 'http://127.0.0.1:4000';

/** The staff account the seeding needs — goods receipts are received by ops, not by the seller. */
const OPS = { email: 'tutorial-ops@skydrop.local', password: 'Tutorial-Ops-2026' };

/** The seller the camera signs in as. Both videos use this one account. */
export const DEMO_SELLER = {
  email: 'demo@rangpursilk.test',
  password: 'Skydrop-Demo-2026',
  companyName: 'Rangpur Silk House',
  contactPersonName: 'Farhana Rahman',
  phone: '+8801711223344',
};

/** Catalogue the ORDER video picks from. Each one is stocked. */
const CATALOGUE = [
  {
    name: 'Jamdani Cotton Saree',
    sku: 'RSH-JAMDANI-IVORY',
    weightGrams: 450,
    valueInr: 2400,
    qty: 60,
  },
  {
    name: 'Nakshi Kantha Throw',
    sku: 'RSH-KANTHA-BLUE',
    weightGrams: 900,
    valueInr: 1850,
    qty: 40,
  },
  {
    name: 'Rajshahi Silk Scarf',
    sku: 'RSH-SCARF-EMERALD',
    weightGrams: 120,
    valueInr: 950,
    qty: 75,
  },
  {
    name: 'Dhaka Muslin Dupatta',
    sku: 'RSH-MUSLIN-ROSE',
    weightGrams: 180,
    valueInr: 1300,
    qty: 50,
  },
];

/**
 * What the PRODUCT video creates while the camera is running. Nothing
 * here is created by this script — it is named so the cleanup below can
 * remove a previous take's rows. Keep it in step with `narration.mjs`.
 */
export const TUTORIAL_PRODUCT = { name: 'Rajshahi Silk Kurti', externalRef: 'RSH-KURTI' };

/**
 * The customer the ORDER video ships to. Named here so a previous take's
 * order and customer row can be removed — the app warns about a
 * duplicate order to the same number with the same items (correctly),
 * and a returning customer draws a history panel that a first-time one
 * does not. Both would make the second take a different video.
 * Keep in step with `flows.mjs`.
 */
export const TUTORIAL_CUSTOMER = { phoneE164: '+919845017722' };

async function call(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status} ${text.slice(0, 400)}`);
  }
  return text === '' ? {} : JSON.parse(text);
}

function assertLocal() {
  const url = process.env.DATABASE_URL ?? '';
  if (!/(^|@|\/\/)(127\.0\.0\.1|localhost)(:|\/)/.test(url)) {
    throw new Error(
      `Refusing to seed: DATABASE_URL does not look local (${url.replace(/:[^:@/]*@/, ':***@')}).`,
    );
  }
}

function hash(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
}

/** Ops staff, password force-set so a re-run always authenticates. */
async function ensureOps() {
  const passwordHash = await hash(OPS.password);
  // RBAC is a ROW, not only the legacy `role` enum — a staff user without
  // a `staffRole` cannot be created at all, and one created with the enum
  // alone would hold no permissions.
  const superAdmin = await prisma.staffRoleDefinition.findFirstOrThrow({
    where: { key: 'super_admin' },
    select: { id: true },
  });
  await prisma.staffUser.upsert({
    where: { email: OPS.email },
    update: {
      passwordHash,
      role: 'SUPER_ADMIN',
      staffRole: { connect: { id: superAdmin.id } },
      deletedAt: null,
    },
    create: {
      email: OPS.email,
      emailDisplay: OPS.email,
      passwordHash,
      role: 'SUPER_ADMIN',
      staffRole: { connect: { id: superAdmin.id } },
    },
  });
  const login = await call('/auth/staff/login', { method: 'POST', body: OPS });
  return login.accessToken;
}

/** The demo seller, created through the real invite flow the first time. */
async function ensureSeller(staffToken) {
  const existing = await prisma.seller.findUnique({ where: { email: DEMO_SELLER.email } });
  if (existing === null) {
    const invite = await call('/admin/seller-invitations', {
      method: 'POST',
      token: staffToken,
      body: { email: DEMO_SELLER.email },
    });
    await call('/auth/seller/register/invite', {
      method: 'POST',
      body: {
        token: invite.token,
        companyName: DEMO_SELLER.companyName,
        contactPersonName: DEMO_SELLER.contactPersonName,
        phone: DEMO_SELLER.phone,
        password: DEMO_SELLER.password,
      },
    });
  }

  // Force APPROVED and a known password. A registration lands PENDING and
  // the recording cannot wait on a human approval step; forcing the
  // password means a re-run recovers an account whose password drifted.
  const seller = await prisma.seller.findUniqueOrThrow({ where: { email: DEMO_SELLER.email } });
  await prisma.seller.update({
    where: { id: seller.id },
    data: { status: 'APPROVED', approvedAt: seller.approvedAt ?? new Date() },
  });
  await prisma.sellerUser.updateMany({
    where: { sellerId: seller.id },
    data: { passwordHash: await hash(DEMO_SELLER.password), emailVerifiedAt: new Date() },
  });

  // LAZY. Seller login is throttled at 5 attempts per 15 minutes per
  // email+IP, and the recorder needs one of those for every take — so a
  // steady-state re-seed, which has no catalogue work to do, must not
  // spend one just to hold a token it never uses.
  let token = null;
  return {
    id: seller.id,
    async token() {
      if (token === null) {
        const login = await call('/auth/seller/login', {
          method: 'POST',
          body: { email: DEMO_SELLER.email, password: DEMO_SELLER.password },
        });
        token = login.accessToken;
      }
      return token;
    },
  };
}

/** One product, one variant, and enough stock that the order form is never short. */
async function ensureStockedVariant(sellerToken, staffToken, binId, item) {
  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: item.sku, deletedAt: null },
    select: { id: true },
  });

  let variantId;
  if (variant === null) {
    const product = await call('/seller/products', {
      method: 'POST',
      token: await sellerToken(),
      body: { name: item.name, externalRef: item.sku },
    });
    const created = await call(`/seller/products/${product.id}/variants`, {
      method: 'POST',
      token: await sellerToken(),
      body: { skuCode: item.sku, weightGrams: item.weightGrams, declaredValueInr: item.valueInr },
    });
    variantId = created.id;
  } else {
    variantId = variant.id;
  }

  // Top up rather than always receiving: re-running must not pile 60 more
  // of everything into the warehouse on every take.
  const onHand = await prisma.stockLevel.aggregate({
    where: { variantId },
    _sum: { qtyOnHand: true },
  });
  const have = onHand._sum.qtyOnHand ?? 0;
  if (have >= item.qty) {
    console.log(`  · ${item.name} — ${have} on hand, nothing to receive`);
    return;
  }
  const want = item.qty - have;

  const gr = await call('/seller/goods-receipts', {
    method: 'POST',
    token: await sellerToken(),
    body: { lines: [{ variantId, expectedQty: want }] },
  });
  await call(`/admin/goods-receipts/${gr.id}/start-receiving`, {
    method: 'POST',
    token: staffToken,
  });
  await call(`/admin/goods-receipts/${gr.id}/lines`, {
    method: 'POST',
    token: staffToken,
    body: {
      lines: [
        {
          lineId: gr.lines[0].id,
          receivedQty: want,
          ...(binId === null ? {} : { putawayBinId: binId }),
        },
      ],
    },
  });
  await call(`/admin/goods-receipts/${gr.id}/complete`, { method: 'POST', token: staffToken });
  console.log(`  · ${item.name} (${item.sku}) — received ${want}, now ${have + want}`);
}

/**
 * Remove the product the second video creates, so the take can create it
 * again. Hard delete: these rows are minutes old, carry no stock and no
 * order, and a soft delete would leave the SKU's unique key occupied —
 * which is exactly what a re-take would collide on.
 */
async function clearTutorialProduct(sellerId) {
  const products = await prisma.product.findMany({
    where: {
      sellerId,
      OR: [{ name: TUTORIAL_PRODUCT.name }, { externalRef: TUTORIAL_PRODUCT.externalRef }],
    },
    select: { id: true, variants: { select: { id: true } } },
  });
  if (products.length === 0) return;

  const variantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const referenced =
    variantIds.length === 0
      ? 0
      : await prisma.orderItem.count({ where: { variantId: { in: variantIds } } });
  if (referenced > 0) {
    throw new Error(
      `"${TUTORIAL_PRODUCT.name}" has order lines against it — refusing to delete. ` +
        'Rename the tutorial product here and in narration.mjs, or clear those orders by hand.',
    );
  }

  await prisma.$transaction([
    prisma.productImage.deleteMany({ where: { variantId: { in: variantIds } } }),
    prisma.productVariant.deleteMany({ where: { id: { in: variantIds } } }),
    prisma.product.deleteMany({ where: { id: { in: products.map((p) => p.id) } } }),
  ]);
  console.log(
    `  · removed a previous take's "${TUTORIAL_PRODUCT.name}" (${variantIds.length} variants)`,
  );
}

/**
 * Remove the orders a previous take placed, and the customer they
 * created. Hard delete, for the same reason the tutorial product is:
 * these rows are minutes old, nothing has shipped, and what is wanted is
 * a world identical to the one the first take filmed.
 *
 * Only PRE-DISPATCH orders are removable. Anything further along has
 * stock movements and money behind it and is left alone with a warning —
 * on a local dev box that means somebody has been using this seller for
 * something else, and quietly deleting their work would be worse than a
 * duplicate-order dialog on camera.
 */
const REMOVABLE_STATUSES = ['DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'AWAITING_COURIER'];

async function clearPreviousOrders(sellerId) {
  const orders = await prisma.order.findMany({
    where: { sellerId },
    select: { id: true, orderNumber: true, status: true },
  });
  if (orders.length === 0) return;

  const removable = orders.filter((o) => REMOVABLE_STATUSES.includes(o.status));
  const kept = orders.filter((o) => !REMOVABLE_STATUSES.includes(o.status));
  if (kept.length > 0) {
    console.log(
      `  · leaving ${kept.length} order(s) past dispatch alone: ${kept
        .map((o) => `${o.orderNumber} (${o.status})`)
        .join(', ')}`,
    );
  }
  if (removable.length === 0) return;

  const ids = removable.map((o) => o.id);
  await prisma.$transaction([
    prisma.orderCharge.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.callQueueEntry.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.orderItem.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.orderEvent.deleteMany({ where: { orderId: { in: ids } } }),
    prisma.order.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`  · removed a previous take's ${removable.length} order(s)`);

  // The customer row outlives the order and makes the recipient panel
  // show a history the first take did not have.
  const gone = await prisma.customer.deleteMany({
    where: { sellerId, phoneE164: TUTORIAL_CUSTOMER.phoneE164 },
  });
  if (gone.count > 0) console.log('  · removed the demo customer record');
}

async function main() {
  assertLocal();
  console.log(`Seeding tutorial demo data against ${API}`);

  const staffToken = await ensureOps();
  const { token: sellerToken, id: sellerId } = await ensureSeller(staffToken);
  console.log(`  · seller "${DEMO_SELLER.companyName}" ready (${DEMO_SELLER.email})`);

  const warehouses = await call('/admin/warehouses', { token: staffToken });
  const warehouse = warehouses[0];
  if (warehouse === undefined) {
    throw new Error('No warehouse in this database — run the db seed first.');
  }
  const bins = await call(`/admin/warehouses/${warehouse.id}/bins`, { token: staffToken });
  // A bin is optional when the warehouse is not bin-tracking; BinPolicy
  // self-heals a missing FLOOR bin on first putaway (BIN-1).
  const binId = bins.find((b) => b.type === 'STORAGE' || b.type === 'FLOOR')?.id ?? null;

  for (const item of CATALOGUE) {
    await ensureStockedVariant(sellerToken, staffToken, binId, item);
  }

  await clearTutorialProduct(sellerId);
  await clearPreviousOrders(sellerId);

  console.log('\nReady.');
  console.log(`  SELLER  http://localhost:3003  ${DEMO_SELLER.email} / ${DEMO_SELLER.password}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(`\n${e.message}`);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
