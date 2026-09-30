/**
 * C0 — the CONSIGNMENT world (not a tutorial).
 *
 * Section C's last three videos are all about the same thing seen from
 * three sides: C1 follows a consignment from Dhaka to the shelf, C2
 * reads the inventory column that consignment creates on the way, and
 * E5 reads the freight bill it leaves behind. One seeding job wearing
 * three hats, which is why it lives here rather than inside any one of
 * them — the same shape as `lib/lifecycle.mjs` for section D.
 *
 * ── WHAT IT BUILDS, AND WHY EACH ONE ────────────────────────────────
 *
 * `RSH-CN-LANDED` — the whole journey, and C1's subject. Declared
 * VIA_BD, counted in Dhaka, dispatched, and counted again in India. Its
 * two counts DISAGREE, twice and for two different reasons, because a
 * page showing two counts that match explains nothing:
 *
 *   · one line is counted SHORT in Dhaka against what the seller
 *     declared — the seller said sixteen and sixteen did not arrive.
 *     That is ours to take up with THEM.
 *   · the same line is then counted short again in India against what
 *     Bangladesh dispatched — it left and did not land. That is ours to
 *     take up with the FORWARDER, and CNS-4 posts it as an
 *     `IN_TRANSIT_LOSS` out of the transit bin rather than pretending
 *     the goods are somewhere.
 *   · the other line matches all the way through, so the page has
 *     something un-alarming to sit beside them.
 *
 * `RSH-CN-FLYING` — declared, counted in Dhaka and DISPATCHED, and
 * that is where it stops. Its units are in the destination warehouse's
 * TRANSIT bin: in neither building, sellable from nowhere (CNS-1), and
 * therefore the one thing that makes `/inventory`'s in-transit column
 * non-zero. C2 is about why that column is never added to the others.
 *
 * ── WHAT IT REFUSES TO DO ───────────────────────────────────────────
 *
 * IT NEVER REWINDS, and unlike the lifecycle parcels it never resumes
 * either: a consignment part-way through is DELETED and rebuilt, and
 * only while every one of its legs is still PENDING. A leg that has
 * been counted has written stock and a batch points back at it, so
 * deleting it would leave the ledger describing goods that arrived
 * against a receipt that does not exist. Those are named and left,
 * exactly as `clearTutorialConsignments` already does for A4's.
 *
 * It is therefore BUILD-ONCE: run it on a clean box and it builds two
 * consignments; run it again and it finds them finished and does
 * nothing. Re-filming C1 or C2 needs no rebuild, because neither of
 * them writes on a consignment — both only read.
 */
import { prisma } from './deps.mjs';
import { call } from './api.mjs';

/**
 * The two consignments, by the seller's own reference — the identity
 * this pass is keyed on, for the same reason the lifecycle parcels are:
 * it is the one field a human can read off a screen and match to this
 * file.
 *
 * The QUANTITIES are the story. Keep them and the comments together.
 */
export const TUTORIAL_CONSIGNMENTS = [
  {
    ref: 'RSH-CN-LANDED',
    arrive: true,
    lines: [
      // Clean the whole way: declared, counted, dispatched, landed.
      { sku: 'RSH-JAMDANI-IVORY', declared: 24, dhaka: 24, dispatch: 24, india: 24 },
      // Short in Dhaka against the declaration, and short again in
      // India against what Dhaka sent.
      { sku: 'RSH-KANTHA-BLUE', declared: 16, dhaka: 15, dispatch: 15, india: 14 },
    ],
  },
  {
    ref: 'RSH-CN-FLYING',
    arrive: false,
    lines: [
      { sku: 'RSH-SCARF-EMERALD', declared: 30, dhaka: 30, dispatch: 30 },
      { sku: 'RSH-MUSLIN-ROSE', declared: 12, dhaka: 12, dispatch: 12 },
    ],
  },
];

/**
 * A consignment is finished when its last leg has been received.
 *
 * `IN_FINAL`, not `INDIA` — the enum names the LEG rather than the
 * country, and the first cut of this asked for a leg that does not
 * exist and then threw "the dispatch should have made one" about a leg
 * the dispatch had made perfectly. `dispatchedAt` is stamped on the
 * leg that is TRAVELLING (the Indian one), not on the Bangladesh
 * receipt it left, which is the same distinction one field over.
 */
function isFinished(row, wantArrival) {
  const legs = row.receipts ?? [];
  const bd = legs.find((l) => l.leg === 'BD_INTAKE');
  const india = legs.find((l) => l.leg === 'IN_FINAL');
  if (bd === undefined || bd.status !== 'COMPLETED') return false;
  if (india === undefined) return false;
  if (!wantArrival) return india.dispatchedAt !== null;
  return india.status === 'COMPLETED';
}

/**
 * Remove a half-built one, or refuse to.
 *
 * Only while EVERY leg is still PENDING. Past that a leg has written
 * stock and a batch points back at it, and deleting the receipt would
 * leave the ledger describing goods that arrived against nothing.
 */
async function clearUnstarted(sellerId, ref, log) {
  const rows = await prisma.consignment.findMany({
    where: { sellerId, sellerReference: ref },
    select: { id: true, consignmentNumber: true },
  });
  if (rows.length === 0) return true;
  const ids = rows.map((r) => r.id);
  const started = await prisma.goodsReceipt.count({
    where: { consignmentId: { in: ids }, status: { not: 'PENDING' } },
  });
  if (started > 0) {
    log(
      `  · ${ref} is part-built (${started} leg(s) counted) — left alone. ` +
        'Delete it by hand if you meant to rebuild it.',
    );
    return false;
  }
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
  log(`  · ${ref} was declared and never counted — removed, rebuilding`);
  return true;
}

/** Count one leg: start, record what was found, complete. */
async function countLeg(receiptId, counts, staffToken, binId, log, label) {
  const before = await call(`/admin/goods-receipts/${receiptId}`, { token: staffToken });
  if (before.status === 'PENDING') {
    await call(`/admin/goods-receipts/${receiptId}/start-receiving`, {
      method: 'POST',
      token: staffToken,
    });
  }
  const receipt = await call(`/admin/goods-receipts/${receiptId}`, { token: staffToken });
  const lines = receipt.lines.map((l) => {
    const want = counts.get(l.variantId);
    if (want === undefined) {
      throw new Error(`No count given for ${l.variantId} on ${receipt.receiptNumber}`);
    }
    return {
      lineId: l.id,
      receivedQty: want,
      // A bin only where the warehouse asks for one; BIN-1 says "off"
      // is not "refused", so passing one it did not ask for is fine and
      // passing none where it does is a refusal.
      ...(binId === null ? {} : { putawayBinId: binId }),
    };
  });
  await call(`/admin/goods-receipts/${receiptId}/lines`, {
    method: 'POST',
    token: staffToken,
    body: { lines },
  });
  const done = await call(`/admin/goods-receipts/${receiptId}/complete`, {
    method: 'POST',
    token: staffToken,
  });
  log(
    `  · ${label} counted on ${done.receiptNumber}` +
      (done.hasDiscrepancies === true
        ? ' — with a variance, which is a NUMBER not a block (CNS-3)'
        : ''),
  );
  return done;
}

/**
 * Build the consignment world, or leave alone what is already there.
 */
export async function ensureConsignmentWorld({ sellerId, sellerToken, staffToken, log }) {
  const variants = new Map();
  for (const c of TUTORIAL_CONSIGNMENTS) {
    for (const line of c.lines) {
      if (variants.has(line.sku)) continue;
      const v = await prisma.productVariant.findFirst({
        where: { skuCode: line.sku, product: { sellerId } },
        select: { id: true },
      });
      if (v === null) {
        throw new Error(`No ${line.sku} for this seller — the catalogue seeding runs first.`);
      }
      variants.set(line.sku, v.id);
    }
  }

  // The warehouses, by what they ARE rather than by position — the same
  // trap D0's `warehouses[0]` fell into.
  const warehouses = await call('/admin/warehouses', { token: staffToken });
  const india = warehouses.find((w) => w.fulfilsOrders === true);
  const dhaka = warehouses.find((w) => w.fulfilsOrders === false);
  if (india === undefined || dhaka === undefined) {
    throw new Error(
      'This box needs an order-fulfilling warehouse AND a Bangladesh intake one ' +
        '(CNS-2) — `ensureBdIntakeWarehouse` makes the second.',
    );
  }
  const binFor = async (warehouseId) => {
    const bins = await call(`/admin/warehouses/${warehouseId}/bins`, { token: staffToken });
    return bins.find((b) => b.type === 'STORAGE' || b.type === 'FLOOR')?.id ?? null;
  };
  const indiaBin = await binFor(india.id);
  const dhakaBin = await binFor(dhaka.id);

  for (const want of TUTORIAL_CONSIGNMENTS) {
    const counts = new Map(want.lines.map((l) => [variants.get(l.sku), l]));
    const existing = await prisma.consignment.findFirst({
      where: { sellerId, sellerReference: want.ref },
      select: {
        id: true,
        consignmentNumber: true,
        status: true,
        receipts: { select: { id: true, leg: true, status: true, dispatchedAt: true } },
      },
    });
    if (existing !== null && isFinished(existing, want.arrive)) {
      log(`  · ${want.ref} already ${existing.status} (${existing.consignmentNumber})`);
      continue;
    }

    /*
      NEVER REWOUND, BUT RESUMED — the D0 rule, one domain over.

      The first build of this threw half way (it asked for a leg named
      `INDIA`), leaving a consignment dispatched with its Indian leg
      uncounted; the next run then refused to delete it, correctly, and
      refused to finish it, which is a state nothing could get out of.
      So a consignment found short of where it should be is carried
      FORWARD from wherever it actually is, and only one that has never
      been counted at all is deleted and rebuilt.
    */
    let consignmentId = existing?.id ?? null;
    if (consignmentId === null) {
      if (!(await clearUnstarted(sellerId, want.ref, log))) continue;
      const declared = await call('/seller/consignments', {
        method: 'POST',
        token: await sellerToken(),
        body: {
          route: 'VIA_BD',
          sellerReference: want.ref,
          lines: want.lines.map((l) => ({
            variantId: variants.get(l.sku),
            expectedQty: l.declared,
          })),
        },
      });
      consignmentId = declared.id;
      log(`  · ${want.ref} declared as ${declared.consignmentNumber}`);
    } else {
      log(`  · ${want.ref} resuming from ${existing.status} (${existing.consignmentNumber})`);
    }

    const legs = async () =>
      (await call(`/admin/consignments/${consignmentId}`, { token: staffToken })).receipts;

    // ── Bangladesh ───────────────────────────────────────────────────
    const bdLeg = (await legs()).find((r) => r.leg === 'BD_INTAKE');
    if (bdLeg === undefined) {
      throw new Error(`${want.ref} has no Bangladesh leg — is the route really VIA_BD?`);
    }
    if (bdLeg.status !== 'COMPLETED') {
      await countLeg(
        bdLeg.id,
        new Map([...counts].map(([variantId, l]) => [variantId, l.dhaka])),
        staffToken,
        dhakaBin,
        log,
        `${want.ref} Dhaka`,
      );
    }

    // ── The flight ───────────────────────────────────────────────────
    let indiaLeg = (await legs()).find((r) => r.leg === 'IN_FINAL');
    if (indiaLeg === undefined) {
      const counted = await call(`/admin/goods-receipts/${bdLeg.id}`, { token: staffToken });
      const byVariant = new Map(counted.lines.map((l) => [l.variantId, l.id]));
      await call(`/admin/consignments/${consignmentId}/dispatch`, {
        method: 'POST',
        token: staffToken,
        body: {
          lines: want.lines.map((l) => ({
            lineId: byVariant.get(variants.get(l.sku)),
            quantity: l.dispatch,
          })),
        },
      });
      log(
        `  · ${want.ref} dispatched — its units are in India's TRANSIT bin, sellable from nowhere`,
      );
      indiaLeg = (await legs()).find((r) => r.leg === 'IN_FINAL');
    }

    // ── India ────────────────────────────────────────────────────────
    if (!want.arrive) continue;
    if (indiaLeg === undefined) {
      throw new Error(`${want.ref} has no India leg to count — the dispatch should have made one.`);
    }
    if (indiaLeg.status !== 'COMPLETED') {
      await countLeg(
        indiaLeg.id,
        new Map([...counts].map(([variantId, l]) => [variantId, l.india])),
        staffToken,
        indiaBin,
        log,
        `${want.ref} India`,
      );
    }
  }
}

/** What each consignment ended up as, for the seed's own report. */
export async function consignmentReport(sellerId) {
  const rows = await prisma.consignment.findMany({
    where: { sellerId, sellerReference: { in: TUTORIAL_CONSIGNMENTS.map((c) => c.ref) } },
    select: {
      sellerReference: true,
      status: true,
      receipts: { select: { leg: true, status: true, dispatchedAt: true } },
    },
  });
  const byRef = new Map(rows.map((r) => [r.sellerReference, r]));
  return TUTORIAL_CONSIGNMENTS.map((c) => {
    const got = byRef.get(c.ref) ?? null;
    return {
      ref: c.ref,
      got: got?.status ?? null,
      ok: got !== null && isFinished(got, c.arrive),
    };
  });
}
