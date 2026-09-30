/**
 * E5 — the FREIGHT world (not a tutorial).
 *
 * `/freight` exists to teach one idea: a bill for getting a consignment
 * into India is spread PER UNIT, and a unit owes its share only when it
 * leaves. Stock still on the shelf owes nothing yet. A screen showing a
 * bill at nought per cent says half of that and a bill at a hundred says
 * the other half, so the world this builds is a bill that is genuinely
 * PART-owed — which needs three things to be true at once, and the third
 * is the one nothing before this had arranged.
 *
 * ── 1. A CONSIGNMENT THAT HAS LANDED AND BEEN COUNTED ────────────────
 * C0 (`lib/consignments.mjs`) already builds it: `RSH-CN-LANDED`,
 * declared VIA_BD, counted in Dhaka, dispatched, counted again in India.
 * Nothing here rebuilds it; E5's slug is in `CONSIGNMENT_SLUGS` so that
 * pass runs first.
 *
 * ── 2. A BILL AGAINST THE ARRIVAL ────────────────────────────────────
 * PAY_NOW and PAY_LATER bill the INDIA leg (FRT-5 decides which receipt
 * from the mode; PAY_ADVANCE would bill Dhaka before it flew). It has to
 * be PAY_LATER, and not only because that is the interesting one: it is
 * the ONLY mode that amortises at all — PAY_NOW is debited in full at
 * record time and is never spread, so on any other mode this video has
 * no subject. The bill is raised through the real endpoint, priced per
 * kilo in TAKA off an invented forwarder's invoice, which is what a
 * Dhaka forwarder actually sends.
 *
 * ── 3. SOME OF ITS UNITS HAVING ACTUALLY LEFT ────────────────────────
 * This is the part that is not obvious, and it is worth reading before
 * changing anything here.
 *
 * FRT-1 charges a unit's share when the unit LEAVES, and attributes it
 * by walking `shipment_item.pickedBatchId → stock_batch →
 * goods_receipt_lines.batchId → inbound_freight_allocations`. So only a
 * parcel picked FROM THIS CONSIGNMENT'S OWN BATCH charges this bill.
 * Shipping a parcel is therefore not enough: the demo seller already
 * holds older stock of both of its SKUs, and FEFO
 * (`expiresAt ASC NULLS LAST, then receivedAt ASC` — the `fefo`
 * comparator in `StockPickAllocationService`) reaches the OLDEST first.
 * Every batch on this box has a null expiry, so the tie is broken on
 * `receivedAt`, and the consignment's batch is the NEWEST thing in the
 * warehouse. Left alone, every parcel this seeding drove would pick the
 * standing stock and the bill would sit at nought units charged for
 * ever, looking exactly as if the amortisation were broken.
 *
 * `giveTheConsignmentAnExpiry` is the fix, and it is a real field rather
 * than a thumb on the scale: a seller declaring a consignment may state
 * a manufacture and expiry date per line, `GoodsReceiptService.complete`
 * copies the line's expiry onto the batch it creates, and the child
 * `<parent>-IN` batch inherits it across the flight. Setting BOTH — the
 * receipt lines and the batches — leaves the data exactly as it would
 * be had the seller filled that box in on the declaration form. It is
 * written here rather than in `TUTORIAL_CONSIGNMENTS` because C0 is
 * BUILD-ONCE and never rewinds: on every box that has already filmed C1
 * the consignment is counted, its batches exist, and a declaration-time
 * field can no longer reach them.
 *
 * ── WHAT IT REFUSES TO DO ────────────────────────────────────────────
 * IDEMPOTENT and FORWARD-ONLY, the D0 and C0 rule. A bill already
 * raised is never re-raised (FRT-7's partial unique would refuse a
 * second LIVE one anyway, and a second bill on the same consignment is
 * `FREIGHT_CONSIGNMENT_ALREADY_BILLED`); a parcel already delivered is
 * left alone; a parcel part-way is carried forward by the same
 * `driveOrderThrough` D0 uses. Nothing is ever unwound — a freight
 * charge is money out of a wallet and a delivered parcel is stock that
 * has gone.
 *
 * E5 PRESSES NOTHING, so a re-take needs none of this rebuilt.
 */
import { prisma, BullMQ } from './deps.mjs';
import { call, waitFor } from './api.mjs';
import { driveOrderThrough } from './lifecycle.mjs';

/** The consignment the bill hangs on — C0 built it. */
export const FREIGHT_CONSIGNMENT_REF = 'RSH-CN-LANDED';

/**
 * The forwarder's invoice, in their own currency and their own units.
 *
 * PER_KG for both lines because this is air freight, and the weights are
 * the forwarder's CHARGEABLE ones rather than the catalogue's: rounding
 * up to the next half kilo is routine, which is exactly why the API
 * takes the weight rather than working it out (`FREIGHT_WEIGHT_REQUIRED`
 * says so in as many words).
 */
const INVOICE = {
  currency: 'BDT',
  ratePerKg: '320.00',
  /** SKU → the chargeable weight the forwarder billed for, in kg. */
  chargeableKg: {
    'RSH-JAMDANI-IVORY': '11.0',
    'RSH-KANTHA-BLUE': '13.0',
  },
  /**
   * What the seller reads under the bill on their own consignment page.
   *
   * PUBLISHED MATERIAL: `/inbound/[id]`'s freight panel prints it in
   * full, and E5 dwells on that panel. It says what the bill IS, and
   * nothing about a tutorial — a note reading "seeded for the freight
   * video" on camera is the mistake E2 already made once with a top-up
   * reference.
   */
  note:
    'Dhaka–Bangalore air freight, Meghna Forwarders invoice MF-2026-09-114. ' +
    'Chargeable weight is theirs, rounded up to the next half kilo.',
};

/**
 * The parcel that makes the bill part-owed.
 *
 * TWO products on one order, deliberately: the bill is split per line,
 * so a parcel carrying both proves the split is per product rather than
 * one pot. Five units out of the consignment's thirty-eight is a
 * fraction that reads as "a handful have gone, the rest still owe",
 * which is the sentence the page exists to make true.
 */
const FREIGHT_PARCEL = {
  ref: 'RSH-FRT-01',
  customer: { name: 'Shalini Iyer', phone: '+919845070011' },
  codAmountInr: '9050',
  lines: [
    { sku: 'RSH-JAMDANI-IVORY', quantity: 3 },
    { sku: 'RSH-KANTHA-BLUE', quantity: 2 },
  ],
};

/** Two years past the day the goods were counted. */
const SHELF_LIFE_MS = 730 * 24 * 60 * 60 * 1000;

/** The landed consignment, with everything this pass needs off it. */
async function landedConsignment(sellerId) {
  return prisma.consignment.findFirst({
    where: { sellerId, sellerReference: FREIGHT_CONSIGNMENT_REF },
    select: {
      id: true,
      consignmentNumber: true,
      receipts: {
        select: {
          id: true,
          receiptNumber: true,
          leg: true,
          status: true,
          lines: {
            select: {
              id: true,
              variantId: true,
              receivedQty: true,
              batchId: true,
              expiresAt: true,
              variant: { select: { skuCode: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Put an expiry on the consignment's goods so FEFO reaches it FIRST.
 *
 * See the header: without this the allocator picks the seller's older
 * standing stock every time and the bill never moves off zero. Only
 * ever writes where the field is null, so a box that already has one —
 * or a future `TUTORIAL_CONSIGNMENTS` that declares one properly — is
 * left exactly as it is.
 */
async function giveTheConsignmentAnExpiry(row, log) {
  const lineIds = [];
  const batchIds = [];
  for (const receipt of row.receipts) {
    for (const line of receipt.lines) {
      if (line.expiresAt === null) lineIds.push(line.id);
      if (line.batchId !== null) batchIds.push(line.batchId);
    }
  }
  const batches = await prisma.stockBatch.findMany({
    where: { OR: [{ id: { in: batchIds } }, { parentBatchId: { in: batchIds } }] },
    select: { id: true, batchCode: true, expiresAt: true, receivedAt: true },
  });
  const undated = batches.filter((b) => b.expiresAt === null);
  if (lineIds.length === 0 && undated.length === 0) return;

  await prisma.$transaction([
    ...lineIds.map((id) =>
      prisma.goodsReceiptLine.update({
        where: { id },
        // The line has no `receivedAt` of its own; its batch does, and
        // every batch of one receipt is stamped in the same instant.
        data: { expiresAt: new Date(Date.now() + SHELF_LIFE_MS) },
      }),
    ),
    ...undated.map((b) =>
      prisma.stockBatch.update({
        where: { id: b.id },
        data: { expiresAt: new Date(b.receivedAt.getTime() + SHELF_LIFE_MS) },
      }),
    ),
  ]);
  log(
    `  · gave ${undated.length} batch(es) of ${FREIGHT_CONSIGNMENT_REF} an expiry so FEFO ` +
      'reaches them before the seller’s older stock',
  );
}

/** The bill on the India arrival, if one is live. */
async function liveBillFor(goodsReceiptId) {
  return prisma.inboundFreightCharge.findFirst({
    where: { goodsReceiptId, voidedAt: null },
    select: {
      id: true,
      status: true,
      mode: true,
      totalInr: true,
      amountSettledInr: true,
    },
  });
}

/** Raise the forwarder's bill against the arrival, once. */
async function recordTheBill(arrival, staffToken, log) {
  const existing = await liveBillFor(arrival.id);
  if (existing !== null) {
    log(`  · ${arrival.receiptNumber} is already billed (${existing.status})`);
    return existing;
  }
  const lines = arrival.lines
    .filter((l) => l.receivedQty > 0)
    .map((l) => {
      const kg = INVOICE.chargeableKg[l.variant.skuCode];
      if (kg === undefined) {
        throw new Error(
          `No chargeable weight for ${l.variant.skuCode} — every counted product must be ` +
            'priced, or its units ship freight-free for ever (FREIGHT_LINE_MISSING).',
        );
      }
      return {
        goodsReceiptLineId: l.id,
        basis: 'PER_KG',
        rate: INVOICE.ratePerKg,
        chargeableWeightKg: kg,
      };
    });
  const bill = await call('/admin/inbound-freight', {
    method: 'POST',
    token: staffToken,
    body: {
      goodsReceiptId: arrival.id,
      lines,
      currency: INVOICE.currency,
      // PINS the consignment, and it must: PAY_NOW is debited in full at
      // record time and never amortises, so on the default mode this
      // video has nothing to be about.
      mode: 'PAY_LATER',
      note: INVOICE.note,
    },
  });
  log(
    `  · billed ${arrival.receiptNumber} — ₹${bill.totalInr} on pay-as-it-sells terms, ` +
      `${bill.totalUnits} units to spread it over`,
  );
  return bill;
}

/**
 * Ship a few of the consignment's units, so some of the bill is charged.
 *
 * The same journey D0 drives — confirmed on a call, a waybill, the pick,
 * the box ritual at the bench, the handover scan, then the simulator's
 * scans — through the same helper rather than a second copy of it.
 */
async function shipSomeOfIt(sellerId, sellerToken, staffToken, log) {
  const existing = await prisma.order.findFirst({
    where: { sellerId, sellerOrderRef: FREIGHT_PARCEL.ref },
    select: { id: true, status: true, orderNumber: true },
  });
  if (existing !== null && existing.status === 'DELIVERED') {
    log(`  · ${FREIGHT_PARCEL.ref} already delivered (${existing.orderNumber})`);
    return existing.id;
  }

  let orderId = existing?.id ?? null;
  if (orderId === null) {
    const items = [];
    for (const line of FREIGHT_PARCEL.lines) {
      const variant = await prisma.productVariant.findFirst({
        where: { skuCode: line.sku, product: { sellerId } },
        select: { id: true },
      });
      if (variant === null) {
        throw new Error(`No ${line.sku} for this seller — the catalogue seeding runs first.`);
      }
      items.push({ variantId: variant.id, quantity: line.quantity });
    }
    const order = await call('/seller/orders', {
      method: 'POST',
      token: await sellerToken(),
      body: {
        recipientName: FREIGHT_PARCEL.customer.name,
        recipientPhoneE164: FREIGHT_PARCEL.customer.phone,
        recipientAddressLine1: '44, Cunningham Road',
        // ORD-5: line two is the LANDMARK, and it is required.
        recipientAddressLine2: 'Above the sari shop, next to the temple gate',
        recipientPostalCode: '560052',
        paymentMode: 'COD',
        codAmountInr: FREIGHT_PARCEL.codAmountInr,
        sellerOrderRef: FREIGHT_PARCEL.ref,
        items,
      },
    });
    orderId = order.id;
    await call(`/seller/orders/${orderId}/submit`, {
      method: 'POST',
      token: await sellerToken(),
    });
    log(`  · ${FREIGHT_PARCEL.ref} placed as ${order.orderNumber}`);
  } else {
    log(`  · ${FREIGHT_PARCEL.ref} resuming from ${existing.status} (${existing.orderNumber})`);
  }

  await driveOrderThrough({
    orderId,
    staffToken,
    log,
    want: 'DELIVERED',
    stages: ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  });
  return orderId;
}

/**
 * Let the clock run on the parcel's money.
 *
 * A delivered order does NOT pay for itself on the spot. The default
 * accrual tier is `T_PLUS_N` with `wallet.accrual_delay_days` of seven
 * (R2c chose it deliberately: crediting at delivery fronts every
 * seller's COD), so `DeliveredAccrualService` SCHEDULES the whole
 * delivered-money step — the order charges, the COD credit on an
 * instant-pay seller, and the inbound-freight share — as a
 * `pending_accruals` row a week out, and an hourly sweep runs it when
 * the day arrives.
 *
 * Which means the first cut of this pass produced a perfect parcel, a
 * perfect bill, and a `/freight` page reading "0 of 38 units charged".
 * Nothing was broken; the money was simply dated the 7th.
 *
 * So the row's due date is pulled forward and the SAME hourly job is
 * asked to run now. Both halves matter: back-dating alone would leave it
 * waiting for the top of the hour, and adding the job alone would sweep
 * nothing, because the sweep takes `eligibleAt <= now`. It is an early
 * TICK rather than a bypass — `PendingAccrualSweepService` does every
 * bit of the work and none of its gates are touched, so the money that
 * lands is exactly the money the 7th would have brought.
 */
async function letTheClockRun(orderId, log) {
  const due = await prisma.pendingAccrual.updateMany({
    where: { orderId, processedAt: null },
    data: { eligibleAt: new Date(Date.now() - 60_000) },
  });
  if (due.count === 0) {
    // Already swept, or the seller is on the INSTANT tier and the money
    // landed at delivery. Either way there is nothing to hurry along.
    return;
  }
  const url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  const host = new globalThis.URL(url);
  const local = ['localhost', '127.0.0.1', '::1', 'redis'].includes(host.hostname);
  if (!local) {
    throw new Error(
      `Refusing to drive the accrual sweep on "${host.hostname}" — this is a local recording ` +
        'convenience and that queue debits real sellers.',
    );
  }
  const queue = new BullMQ.Queue('wallet-pending-accrual', {
    connection: {
      host: host.hostname,
      port: Number(host.port === '' ? 6379 : host.port),
      maxRetriesPerRequest: null,
    },
  });
  try {
    await queue.add('sweep-pending-accruals', {}, { attempts: 1, removeOnComplete: true });
    log('  \u00b7 asked the pending-accrual sweep to run now rather than on the 7th');
  } finally {
    await queue.close();
  }
}

/**
 * Build the freight world, or leave alone what is already there.
 */
export async function ensureFreightWorld({ sellerId, sellerToken, staffToken, log }) {
  const row = await landedConsignment(sellerId);
  if (row === null) {
    throw new Error(
      `No ${FREIGHT_CONSIGNMENT_REF} for this seller — C0 builds it, and E5's slug is in ` +
        'CONSIGNMENT_SLUGS so that pass runs first.',
    );
  }
  const arrival = row.receipts.find((r) => r.leg === 'IN_FINAL');
  if (arrival === undefined || arrival.status !== 'COMPLETED') {
    throw new Error(
      `${FREIGHT_CONSIGNMENT_REF} has not been counted in India, so there is nothing to bill ` +
        '(PAY_LATER bills the arrival). Run the consignment pass first.',
    );
  }

  await giveTheConsignmentAnExpiry(row, log);
  await recordTheBill(arrival, staffToken, log);
  const orderId = await shipSomeOfIt(sellerId, sellerToken, staffToken, log);
  await letTheClockRun(orderId, log);
  await waitFor('the freight share to be charged', async () => {
    const [bill] = await freightReport(sellerId);
    return bill !== undefined && bill.unitsSettled > 0 ? bill : null;
  });

  /*
    THE ONE THING WORTH ASSERTING, because it is the one thing that can
    silently not happen: a parcel can be delivered perfectly and charge
    a DIFFERENT batch's freight — or none — and the only sign is a page
    that reads "0 of 38 units charged" under narration saying some of it
    has been paid for. Say which, rather than leaving it to the frame.
  */
  const after = await freightReport(sellerId);
  const bill = after[0];
  if (bill === undefined || bill.unitsSettled === 0) {
    throw new Error(
      'The freight bill is still at zero units charged — the parcel did not pick from the ' +
        "consignment's own batch. FEFO is expiresAt ASC NULLS LAST then receivedAt ASC; check " +
        '`giveTheConsignmentAnExpiry` actually stamped the batches.',
    );
  }
}

/** What the pass is supposed to have produced, for the seed's own report. */
export async function freightReport(sellerId) {
  const rows = await prisma.inboundFreightCharge.findMany({
    where: { sellerId, voidedAt: null },
    select: {
      status: true,
      mode: true,
      totalInr: true,
      amountSettledInr: true,
      totalUnits: true,
      unitsSettled: true,
      goodsReceipt: { select: { receiptNumber: true } },
    },
  });
  return rows.map((r) => ({
    receiptNumber: r.goodsReceipt.receiptNumber,
    status: r.status,
    mode: r.mode,
    totalInr: r.totalInr.toString(),
    chargedInr: r.amountSettledInr.toString(),
    units: r.totalUnits,
    unitsSettled: r.unitsSettled,
    // PART-owed is the whole point: neither nought nor all of it.
    ok: r.mode === 'PAY_LATER' && r.unitsSettled > 0 && r.unitsSettled < r.totalUnits,
  }));
}
