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
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma, argon2 } from './lib/deps.mjs';
import { MOCK_ROOT } from './lib/spaces-shim.mjs';

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

/**
 * The customers the BULK IMPORT video's CSV ships to — the fixture at
 * `fixtures/rangpur-bulk-orders.csv`, one entry per row. Same reason as
 * `TUTORIAL_CUSTOMER`: a returning customer draws a panel a first-time one
 * does not, so leaving these behind makes the second take a different
 * video from the first. Keep in step with the fixture.
 */
export const TUTORIAL_CSV_CUSTOMERS = [
  '+919845011021',
  '+919845011034',
  '+919845011047',
  '+919845011052',
  '+919845011068',
];

/**
 * The consignment the A4 video declares, and the profile fields the A2
 * video types. Named here so a previous take's rows can be removed —
 * a second consignment on the register makes the closing shot a
 * different picture, and a pending bank change makes the save dialog
 * ask a different question. Keep in step with `flows.mjs`.
 */
export const TUTORIAL_CONSIGNMENT_REF = 'RSH-CN-2026-07';

/** The shopfront the store video adds ON CAMERA. Keep in step with flows.mjs. */
export const TUTORIAL_STORE_NAME = 'Dhaka Boutique';

/**
 * The product the C3 video edits ON CAMERA, and the size it adds to it.
 *
 * A product with DEFAULTS is the point of that video, and the seeded
 * catalogue does not have one: `ensureStockedVariant` sets weight and
 * value on the VARIANT, so every product's own defaults are null and
 * the tiles read "Not set". The video's whole third scene is those
 * tiles and its ninth is a new size INHERITING them, so the defaults
 * are put on this one product here rather than the narration being
 * written around their absence.
 *
 * The dimensions are deliberately left null: filling them in is what
 * the video does, and it is the scene that explains volumetric weight.
 */
export const TUTORIAL_EDIT_PRODUCT = {
  name: 'Dhaka Muslin Dupatta',
  defaultWeightGrams: 180,
  defaultDeclaredValueInr: '1300',
  /** The size added on camera. Deleted before every take — a SKU is permanent. */
  newVariantSku: 'RSH-MUSLIN-INDIGO',
};

/** The role the roles video builds ON CAMERA. Keep in step with flows.mjs. */
export const TUTORIAL_ROLE_NAME = 'Warehouse manager';

/** The SKU the photos video uploads pictures to. Cleared before every take. */
export const TUTORIAL_PHOTO_SKU = 'RSH-MUSLIN-ROSE';

/** The per-seller key the delivery-fee video writes. Cleared before every take. */
const DELIVERY_FEE_KEY = 'orders.default_customer_delivery_fee_inr';

/**
 * Orders placed so the ORIENTATION video has a dashboard with something
 * on it. Only that video wants them: every other seed run clears the
 * seller's pre-dispatch orders, which is what makes each take identical.
 */
const TOUR_ORDERS = [
  { name: 'Meera Krishnan', phone: '+919845030011', ref: 'RSH-TOUR-01', qty: 1 },
  { name: 'Arjun Nair', phone: '+919845030012', ref: 'RSH-TOUR-02', qty: 2 },
  { name: 'Divya Menon', phone: '+919845030013', ref: 'RSH-TOUR-03', qty: 1 },
  { name: 'Rohit Sharma', phone: '+919845030014', ref: 'RSH-TOUR-04', qty: 3 },
];

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
 * Put the catalogue back the way the C3 video finds it.
 *
 * That video does four things on camera that outlive it, and all four
 * make the second take a different video from the first:
 *
 *  1. It ARCHIVES a product, and archiving CASCADES to every variant
 *     (`CatalogProductService.archive` updates them in the same tx).
 *     Restoring does NOT cascade back — the service says so in its own
 *     audit note, "variants left as-is" — which is the single most
 *     useful thing the video teaches and the reason this function
 *     cannot just trust the on-camera restore. Left alone, the whole
 *     seeded catalogue product is unsellable and the ORDER video's
 *     picker would not list it.
 *  2. It adds a size. A SKU is permanent, so a second take collides on
 *     it (the same reason `clearTutorialProduct` exists).
 *  3. It fills in the product's box dimensions, which is the scene that
 *     explains volumetric weight — true only from a standing start.
 *  4. It may override the new size's own weight, which goes with it.
 *
 * It also SETS the defaults the video's third scene is about, because
 * the shared seeding does not: `ensureStockedVariant` puts weight and
 * value on the variant, leaving the product's own defaults null.
 *
 * Runs BEFORE the catalogue loop, not with the other clears: a goods
 * receipt against an archived variant is refused, so an archived
 * catalogue left over from a previous take would fail the top-up.
 */
async function resetCatalogueEdits(sellerId) {
  const product = await prisma.product.findFirst({
    where: { sellerId, name: TUTORIAL_EDIT_PRODUCT.name, deletedAt: null },
    select: { id: true },
  });

  // Archiving cascades and restoring does not, so BOTH halves are put
  // back — and across the whole catalogue rather than just this one
  // product, because an archived SKU anywhere is a row the order
  // video's picker silently stops offering.
  const products = await prisma.product.updateMany({
    where: { sellerId, status: 'ARCHIVED' },
    data: { status: 'ACTIVE' },
  });
  const variants = await prisma.productVariant.updateMany({
    where: { product: { sellerId }, status: 'ARCHIVED', deletedAt: null },
    data: { status: 'ACTIVE' },
  });
  if (products.count > 0 || variants.count > 0) {
    console.log(
      `  · restored ${products.count} archived product(s) and ${variants.count} archived SKU(s)`,
    );
  }

  const added = await prisma.productVariant.findFirst({
    where: { skuCode: TUTORIAL_EDIT_PRODUCT.newVariantSku, product: { sellerId } },
    select: { id: true },
  });
  if (added !== null) {
    // Same guard as the tutorial product: a variant with order lines
    // against it is somebody else's work, and a video is not a reason
    // to delete it.
    const referenced = await prisma.orderItem.count({ where: { variantId: added.id } });
    if (referenced > 0) {
      throw new Error(
        `"${TUTORIAL_EDIT_PRODUCT.newVariantSku}" has order lines against it — refusing to delete.`,
      );
    }
    await prisma.$transaction([
      prisma.productImage.deleteMany({ where: { variantId: added.id } }),
      prisma.stockLevel.deleteMany({ where: { variantId: added.id } }),
      prisma.productVariant.delete({ where: { id: added.id } }),
    ]);
    console.log(`  · removed a previous take's "${TUTORIAL_EDIT_PRODUCT.newVariantSku}" size`);
  }

  if (product === null) return;
  await prisma.product.update({
    where: { id: product.id },
    data: {
      defaultWeightGrams: TUTORIAL_EDIT_PRODUCT.defaultWeightGrams,
      defaultDeclaredValueInr: TUTORIAL_EDIT_PRODUCT.defaultDeclaredValueInr,
      defaultLengthCm: null,
      defaultWidthCm: null,
      defaultHeightCm: null,
    },
  });
  console.log(`  · "${TUTORIAL_EDIT_PRODUCT.name}" back to its defaults, box unset`);
}

/**
 * Clear the pictures the PHOTOS video uploads, on disk as well as in
 * the database.
 *
 * Its first two scenes are an empty drop zone and an empty gallery, and
 * its eighth is about WHICH picture stands for the rest — which is the
 * earliest one uploaded. Leave a previous take's three behind and the
 * gallery opens with six in it, the delete scene removes a different
 * one, and the "earliest" the narration points at was uploaded by a
 * take nobody is watching.
 *
 * HARD delete, and the objects go too. A soft delete would leave the
 * rows out of every read path but keep the files in mock storage
 * forever, and the whole directory is per variant — so removing it is
 * exactly as wide as removing the rows.
 */
async function clearVariantPhotos(sellerId) {
  const variant = await prisma.productVariant.findFirst({
    where: { skuCode: TUTORIAL_PHOTO_SKU, product: { sellerId } },
    select: { id: true },
  });
  if (variant === null) return;

  const images = await prisma.productImage.deleteMany({ where: { variantId: variant.id } });
  const bucket = process.env.SPACES_BUCKET ?? 'skydrop-storage';
  const dir = path.join(MOCK_ROOT, bucket, 'sellers', sellerId, 'variants', variant.id);
  await fs.rm(dir, { recursive: true, force: true });
  if (images.count > 0) {
    console.log(`  · removed ${images.count} picture(s) from ${TUTORIAL_PHOTO_SKU}`);
  }
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
    where: {
      sellerId,
      phoneE164: { in: [TUTORIAL_CUSTOMER.phoneE164, ...TUTORIAL_CSV_CUSTOMERS] },
    },
  });
  if (gone.count > 0) console.log(`  · removed ${gone.count} demo customer record(s)`);
}

/**
 * Remove the bulk imports a previous take ran, and the CSVs they were
 * run from.
 *
 * The orders those imports CREATED are already gone: `clearPreviousOrders`
 * above removes every pre-dispatch order of this seller, and a
 * freshly-imported order is PENDING_CONFIRMATION — the first entry in
 * `REMOVABLE_STATUSES`. So the references are cleared before this runs and
 * nothing here has to reason about them. What it removes is the IMPORT
 * RECORD itself, which the "Recent imports" table on camera lists newest
 * first: leave it and the second take opens on a table already holding the
 * first take's run, and the scene that says "no imports yet" is a lie.
 *
 * `staged_order_rows` cascade from the upload, but they are deleted
 * EXPLICITLY here: they FK `sellers` with RESTRICT as well, so leaving
 * them to the cascade would make this depend on delete order rather than
 * saying what it means.
 *
 * The CSV itself lives in local object storage (DEV_MOCK_SPACES), under
 * the seller's own `order-imports/` prefix — the uploaded file AND the
 * error report the worker writes beside it. Both go, because the external
 * references in the fixture are re-used by every take and an orphaned
 * object is the one piece of a previous run nothing else would clear.
 */
async function clearPreviousImports(sellerId) {
  const uploads = await prisma.bulkOrderUpload.findMany({
    where: { sellerId },
    select: { id: true, fileName: true },
  });
  if (uploads.length > 0) {
    const ids = uploads.map((u) => u.id);
    await prisma.$transaction([
      prisma.stagedOrderRow.deleteMany({ where: { uploadId: { in: ids } } }),
      prisma.bulkOrderUpload.deleteMany({ where: { id: { in: ids } } }),
    ]);
    console.log(`  \u00b7 removed a previous take's ${uploads.length} bulk import(s)`);
  }

  // Keep in step with SpacesService (`MOCK_ROOT/<bucket>/<key>`) and with
  // `buildOrderCsvKey` (`sellers/<id>/order-imports/...`).
  const bucket = process.env.SPACES_BUCKET ?? 'skydrop-storage';
  const dir = path.join(MOCK_ROOT, bucket, 'sellers', sellerId, 'order-imports');
  const files = await fs.readdir(dir).catch(() => null);
  if (files !== null && files.length > 0) {
    await fs.rm(dir, { recursive: true, force: true });
    console.log(`  \u00b7 removed ${files.length} stale upload object(s) from ${dir}`);
  }
}

/**
 * The Bangladesh intake warehouse, and the setting that points at it.
 *
 * CNS-2: `ops.bd_intake_warehouse_id` is seeded EMPTY on purpose, and a
 * VIA_BD declaration is REFUSED rather than quietly routed to India —
 * which is correct, and which makes the more interesting half of the
 * consignment form unfilmable until somebody configures one. So the
 * seed configures one.
 *
 * `fulfilsOrders: false` is not decoration: the resolver re-checks the
 * flag on every read and refuses an intake warehouse that still fulfils
 * orders (`BD_WAREHOUSE_FULFILS_ORDERS`), because nothing in Bangladesh
 * is sellable from Bangladesh.
 *
 * Idempotent in both halves — the warehouse is found by its code, and
 * the setting is only written when it does not already point somewhere.
 */
const BD_WAREHOUSE = { code: 'BD-DHK-1', name: 'Dhaka Intake' };

async function ensureBdIntakeWarehouse(staffToken) {
  const warehouses = await call('/admin/warehouses', { token: staffToken });
  let bd = warehouses.find((w) => w.code === BD_WAREHOUSE.code);
  if (bd === undefined) {
    bd = await call('/admin/warehouses', {
      method: 'POST',
      token: staffToken,
      body: {
        code: BD_WAREHOUSE.code,
        name: BD_WAREHOUSE.name,
        countryCode: 'BD',
        timezone: 'Asia/Dhaka',
        fulfilsOrders: false,
      },
    });
    console.log(`  · created the Bangladesh intake warehouse (${BD_WAREHOUSE.code})`);
  }

  const current = await prisma.systemSetting.findUnique({
    where: { key: 'ops.bd_intake_warehouse_id' },
    select: { valueString: true },
  });
  if (current !== null && (current.valueString ?? '') !== bd.id) {
    await call('/admin/system-settings/ops.bd_intake_warehouse_id', {
      method: 'PATCH',
      token: staffToken,
      body: { valueType: 'STRING', value: bd.id },
    });
    console.log('  · pointed ops.bd_intake_warehouse_id at it');
  }
}

/**
 * Remove the consignment a previous take announced, and the bank change
 * it left pending.
 *
 * A consignment is hard-deleted for the same reason the tutorial product
 * is: it is minutes old, nothing was ever received against it, and what
 * is wanted is a register identical to the one the first take filmed. A
 * consignment that HAS been received is left alone and said out loud —
 * on a dev box that means somebody was using this seller for something
 * else, and deleting their work to tidy a video would be worse than a
 * second row on screen.
 *
 * The pending bank change matters for a subtler reason: with one open,
 * the profile video's save dialog asks a DIFFERENT question, so the take
 * would not match its own narration.
 */
async function clearTutorialConsignments(sellerId) {
  const rows = await prisma.consignment.findMany({
    where: { sellerId, sellerReference: TUTORIAL_CONSIGNMENT_REF },
    select: { id: true, consignmentNumber: true },
  });
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    // DECLARING a consignment already creates its legs as PENDING goods
    // receipts, so "has a goods receipt" is not the test — every fresh
    // one has two. What must never be deleted is a leg somebody has
    // started counting, because a receipt past PENDING may have written
    // stock and a batch points back at it.
    const counted = await prisma.goodsReceipt.count({
      where: { consignmentId: { in: ids }, status: { not: 'PENDING' } },
    });
    if (counted > 0) {
      console.log(
        `  · leaving ${rows.length} consignment(s) alone — ${counted} leg(s) have been counted`,
      );
    } else {
      const receipts = await prisma.goodsReceipt.findMany({
        where: { consignmentId: { in: ids } },
        select: { id: true },
      });
      const receiptIds = receipts.map((r) => r.id);
      await prisma.$transaction([
        prisma.goodsReceiptLine.deleteMany({ where: { receiptId: { in: receiptIds } } }),
        prisma.goodsReceipt.deleteMany({ where: { id: { in: receiptIds } } }),
        prisma.consignmentEvent.deleteMany({ where: { consignmentId: { in: ids } } }),
        prisma.consignment.deleteMany({ where: { id: { in: ids } } }),
      ]);
      console.log(
        `  · removed a previous take's ${rows.length} consignment(s) and ${receiptIds.length} leg(s)`,
      );
    }
  }

  const changes = await prisma.sellerBankChangeRequest.deleteMany({
    where: { sellerId, status: 'PENDING' },
  });
  if (changes.count > 0) {
    console.log(`  · removed ${changes.count} pending bank change request(s)`);
  }

  // The bank details the profile video ENTERS on camera. This one is
  // not cosmetic: with an account already on file the form takes the
  // approval branch, and its submit button stops saying "Save details"
  // and starts saying "Send for approval" — so the second take hangs
  // waiting for a button that is no longer there. (It did: a re-take
  // timed out on exactly this while the first take had looked fine.)
  // The video films the FIRST-TIME path, and the narration describes
  // it, so every take has to start from no account.
  await prisma.seller.updateMany({
    where: { id: sellerId, NOT: { bankAccountNumber: null } },
    data: {
      bankName: null,
      bankBranchName: null,
      bankAccountName: null,
      bankAccountNumber: null,
      bankAccountNumberMasked: null,
      bankAccountNumberKeyVersion: null,
      bankRoutingNumber: null,
      bankSwiftCode: null,
    },
  });

  // The logo the profile video uploads ON CAMERA. Left in place, the
  // next take opens on a logo already there and a Remove button beside
  // it — a different picture from the one the narration describes, and
  // the frame the whole scene is about. The object under it goes too,
  // or mock storage accumulates one per take.
  const seller = await prisma.seller.findUnique({
    where: { id: sellerId },
    select: { logoUrl: true },
  });
  if ((seller?.logoUrl ?? null) !== null) {
    await prisma.seller.update({ where: { id: sellerId }, data: { logoUrl: null } });
    const bucket = process.env.SPACES_BUCKET ?? 'skydrop-storage';
    const dir = path.join(MOCK_ROOT, bucket, 'sellers', sellerId, 'logo');
    await fs.rm(dir, { recursive: true, force: true });
    console.log("  · removed a previous take's company logo");
  }
}

/**
 * Undo what the two SETTINGS videos do on camera.
 *
 * Both of them film a FIRST-TIME path, and both leave the account in a
 * state where the second take would film something else — the same
 * lesson the profile video taught the expensive way, where a saved bank
 * account changed the submit button's label and the re-take hung on a
 * button that was no longer there.
 *
 * The store video adds "Dhaka Boutique" and makes it the default. Left
 * in place, the next take opens on a register that already has it, the
 * add fails on a duplicate name, and the store the narration says is
 * "not the default" is the default. So it goes, and the original store
 * is put back as the default — which also matters to every OTHER video,
 * since an order with no store named on it is filed under whatever the
 * default currently is.
 *
 * The delivery-fee video's whole fourth scene is the badge reading
 * "Skydrop default". That is TRUE only while the seller has no override
 * of their own, and the video's own save is what creates one. Clearing
 * it is what makes the take repeatable.
 *
 * A store with orders against it is left alone and said out loud: on a
 * dev box that means somebody used this seller for something else, and
 * deleting their work to tidy a video would be worse than a second row.
 */
async function clearTutorialSettings(sellerId) {
  const store = await prisma.sellerStore.findFirst({
    where: { sellerId, name: TUTORIAL_STORE_NAME },
    select: { id: true, isDefault: true },
  });
  if (store !== null) {
    const orders = await prisma.order.count({ where: { storeId: store.id } });
    if (orders > 0) {
      console.log(
        `  · leaving the "${TUTORIAL_STORE_NAME}" store alone — ${orders} order(s) are filed under it`,
      );
    } else {
      // The default moves FIRST. A partial unique index allows exactly
      // one default per seller, so promoting the original while the
      // tutorial store still holds the flag would be refused — and
      // deleting the default first would leave order create with
      // nothing to pre-select in between.
      if (store.isDefault) {
        const original = await prisma.sellerStore.findFirst({
          where: { sellerId, kind: 'CHANNEL', deletedAt: null, id: { not: store.id } },
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true },
        });
        if (original === null) {
          throw new Error(
            `"${TUTORIAL_STORE_NAME}" is the only store left — refusing to delete the default.`,
          );
        }
        await prisma.$transaction([
          prisma.sellerStore.update({ where: { id: store.id }, data: { isDefault: false } }),
          prisma.sellerStore.update({ where: { id: original.id }, data: { isDefault: true } }),
        ]);
        console.log(`  · put "${original.name}" back as the default store`);
      }
      await prisma.sellerStore.delete({ where: { id: store.id } });
      console.log(`  · removed a previous take's "${TUTORIAL_STORE_NAME}" store`);
    }
  }

  const fee = await prisma.sellerSettingOverride.deleteMany({
    where: { sellerId, key: DELIVERY_FEE_KEY },
  });
  if (fee.count > 0) {
    console.log("  · cleared the seller's own delivery fee, back to the Skydrop default");
  }

  // The stock-alert video's third scene is the badge reading "Off —
  // nothing alerts by default", and its whole lesson is that blank and
  // zero are different. Both are true only from a standing start: the
  // video's own two saves set the account default AND a per-SKU
  // override, and a second take would open on "Warning below 10 units"
  // and on a SKU that already says 25.
  //
  // Cleared to NULL rather than to a number, because null IS the state
  // being filmed — `StockAlertService` resolves `variant.lowStockThreshold
  // ?? seller.defaultLowStockThreshold ?? null` and returns
  // SKIPPED_NO_THRESHOLD on null, which is exactly what "nothing alerts"
  // means and exactly what a new seller has.
  // The top-up video RECORDS a transfer on camera, and its last scene is
  // the Top-ups tab showing exactly one pending row. Left in place, take
  // two shows two rows and take three shows three — and the narration
  // says "it appears under Top-ups", singular, pointing at a list that
  // is mostly previous takes.
  //
  // PENDING only. An ACCEPTED one has a wallet entry behind it and the
  // ledger is append-only, so deleting the claim would leave a credit
  // with nothing explaining it — worse than a second row on screen.
  const topups = await prisma.walletTopupRequest.deleteMany({
    where: { sellerId, status: 'PENDING' },
  });
  if (topups.count > 0) {
    console.log(`  · removed ${topups.count} pending top-up claim(s) from a previous take`);
  }

  // The roles video BUILDS a role on camera, and a second take would
  // fail on the duplicate name — and film a list that already has it
  // while the narration says "let us build one".
  //
  // Only a role NOBODY HOLDS is removed. A role with members is somebody
  // using this account for something else, and taking their access away
  // to tidy a video is worse than a second row on screen.
  const role = await prisma.sellerRoleDefinition.findFirst({
    where: { sellerId, name: TUTORIAL_ROLE_NAME },
    select: { id: true, _count: { select: { users: true } } },
  });
  if (role !== null) {
    if (role._count.users > 0) {
      console.log(
        `  · leaving the "${TUTORIAL_ROLE_NAME}" role alone — ${role._count.users} member(s) hold it`,
      );
    } else {
      await prisma.sellerRolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.sellerRoleDefinition.delete({ where: { id: role.id } });
      console.log(`  · removed a previous take's "${TUTORIAL_ROLE_NAME}" role`);
    }
  }

  const account = await prisma.seller.updateMany({
    where: { id: sellerId, NOT: { defaultLowStockThreshold: null } },
    data: { defaultLowStockThreshold: null },
  });
  const perSku = await prisma.productVariant.updateMany({
    where: { product: { sellerId }, NOT: { lowStockThreshold: null } },
    data: { lowStockThreshold: null },
  });
  if (account.count > 0 || perSku.count > 0) {
    console.log(
      `  · cleared low-stock thresholds — account default${account.count > 0 ? '' : ' (already off)'}` +
        `, ${perSku.count} per-SKU override(s)`,
    );
  }
}

/**
 * Give the ORIENTATION video a dashboard worth looking at.
 *
 * Runs only for that slug. The tour narrates a recent-orders list and a
 * search box that returns something, and an empty dashboard would make
 * both of those sentences false — while every other video wants the
 * seller's order list cleared, which is what `clearPreviousOrders` above
 * has just done. So this is the one place an order is created by the
 * SEED rather than by the camera.
 */
async function placeTourOrders(sellerToken) {
  const variants = await prisma.productVariant.findMany({
    where: { skuCode: { in: CATALOGUE.map((c) => c.sku) }, deletedAt: null },
    select: { id: true, skuCode: true },
  });
  if (variants.length === 0) throw new Error('No catalogue variants to place tour orders against');

  for (const [i, o] of TOUR_ORDERS.entries()) {
    const variant = variants[i % variants.length];
    const order = await call('/seller/orders', {
      method: 'POST',
      token: await sellerToken(),
      body: {
        recipientName: o.name,
        recipientPhoneE164: o.phone,
        recipientAddressLine1: `${12 + i}, Residency Road`,
        // ORD-5: line two is the LANDMARK and is required.
        recipientAddressLine2: 'Near the Bangalore Club, opposite the petrol pump',
        recipientPostalCode: '560025',
        paymentMode: 'COD',
        codAmountInr: String(1800 + i * 450),
        sellerOrderRef: o.ref,
        items: [{ variantId: variant.id, quantity: o.qty }],
      },
    });
    await call(`/seller/orders/${order.id}/submit`, {
      method: 'POST',
      token: await sellerToken(),
    });
  }
  console.log(`  · placed ${TOUR_ORDERS.length} order(s) so the dashboard is not empty`);
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

  await resetCatalogueEdits(sellerId);

  for (const item of CATALOGUE) {
    await ensureStockedVariant(sellerToken, staffToken, binId, item);
  }

  await ensureBdIntakeWarehouse(staffToken);

  await clearVariantPhotos(sellerId);
  await clearTutorialProduct(sellerId);
  await clearPreviousOrders(sellerId);
  await clearPreviousImports(sellerId);
  await clearTutorialConsignments(sellerId);
  await clearTutorialSettings(sellerId);

  // Per-video tailoring, AFTER the clearing. The slug is optional: with
  // none, this is the shared world every video that needs nothing extra
  // records against.
  const slug = process.argv[2];
  if (slug === 'find-your-way-around') await placeTourOrders(sellerToken);

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
