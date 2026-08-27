/**
 * Attach REAL Delhivery waybills to test orders, so the tracking poller
 * drives a real lifecycle end to end.
 *
 * WHY A SCRIPT, NOT AN ENDPOINT: this fabricates dispatched orders. That
 * is a reasonable thing to do once, deliberately, with someone watching.
 * It is not a thing to leave reachable in production, so there is no
 * button for it and should not be.
 *
 * WHY IT SKIPS `CONFIRMED`: entry to CONFIRMED generates the AWB by
 * CALLING DELHIVERY (CUR-2b), and live writes are ON — confirming would
 * manifest a real parcel and expect us to hand one over. These orders
 * are written straight at DISPATCHED with the waybill already on them.
 *
 * WHY NO STOCK MOVES: the parcels are not ours and no goods leave the
 * shelf. Reserving or decrementing would make the warehouse count wrong
 * to make a test look tidy. DELIVERED is stock-neutral anyway (TRK-7),
 * and RTO stops at RTO_IN_TRANSIT without a warehouse receipt (TRK-6).
 *
 * WHAT IT WILL COST: when one of these reaches DELIVERED the accrual
 * listener debits the seller's wallet for the delivery fee. Real money
 * in a real ledger — the point of an end-to-end test, but said out loud.
 *
 * NO CUSTOMER EMAIL IS SET, on purpose: NOTIF-8 turns a missing address
 * into a SKIPPED notification row rather than a failure, so no stranger
 * is emailed about a parcel that is not theirs. Seller-side notifications
 * still fire, to the seller's own address.
 *
 *   node scripts/seed-tracking-test-orders.mjs --dry-run AWB...
 *   node scripts/seed-tracking-test-orders.mjs --commit  AWB...
 *   node scripts/seed-tracking-test-orders.mjs --undo            (removes them)
 */
import { prisma } from '@skydrop/db';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const UNDO = args.includes('--undo');
const AWBS = args.filter((a) => !a.startsWith('--'));

const SELLER_ID = '019fd096-eb5a-70ed-8eca-705d263bb6a6'; // Menev Store
/** Stamped on every order so `--undo` finds exactly these and nothing else. */
const MARK = 'TRACKING-TEST';

const RECIPIENT = {
  name: 'Tracking Test (Skydrop)',
  phone: '+919860028043',
  line1: '2nd Floor, Prestige Tech Park',
  line2: 'Near Marathahalli Bridge',
  city: 'Bengaluru',
  state: 'Karnataka',
  pin: '560103',
};

async function main() {
  if (UNDO) return undo();
  if (AWBS.length === 0) {
    console.error('Give at least one AWB, or --undo. Nothing was done.');
    process.exit(1);
  }

  const seller = await prisma.seller.findUniqueOrThrow({
    where: { id: SELLER_ID },
    select: { id: true, companyName: true },
  });
  const level = await prisma.stockLevel.findFirstOrThrow({
    where: { variant: { product: { sellerId: SELLER_ID } }, qtyOnHand: { gt: 0 } },
    select: { variantId: true, qtyOnHand: true, warehouseId: true },
    orderBy: { qtyOnHand: 'desc' },
  });
  const variant = await prisma.productVariant.findUniqueOrThrow({
    where: { id: level.variantId },
    select: { id: true, skuCode: true, product: { select: { name: true } } },
  });
  const warehouse = await prisma.warehouse.findUniqueOrThrow({
    where: { id: level.warehouseId },
    select: { id: true, code: true },
  });

  const existing = await prisma.shipment.findMany({
    where: { awbNumber: { in: AWBS } },
    select: { awbNumber: true },
  });
  const taken = new Set(existing.map((s) => s.awbNumber));

  console.log(`seller    : ${seller.companyName}`);
  console.log(`product   : ${variant.product.name} / ${variant.skuCode}`);
  console.log(`warehouse : ${warehouse.code}  (stock NOT touched)`);
  console.log(`recipient : ${RECIPIENT.name}, ${RECIPIENT.city} ${RECIPIENT.pin}`);
  console.log(`mode      : ${COMMIT ? 'COMMIT' : 'DRY RUN - writes nothing'}`);
  console.log('');

  let n = 0;
  for (const awb of AWBS) {
    if (taken.has(awb)) {
      console.log(`  ${awb}  SKIP - a shipment already carries it`);
      continue;
    }
    if (!COMMIT) {
      console.log(`  ${awb}  would create order (DISPATCHED) + shipment`);
      n += 1;
      continue;
    }
    const created = await createOne(awb, seller.id, variant, warehouse.id);
    console.log(`  ${awb}  created ${created.orderNumber}`);
    n += 1;
  }

  console.log('');
  console.log(
    COMMIT
      ? `${n} order(s) created. The poller picks them up within 20 minutes.`
      : `${n} would be created. Re-run with --commit.`,
  );
}

async function createOne(awb, sellerId, variant, warehouseId) {
  // Numbering mirrors ORD-8's shape without taking its sequence: these
  // are fixtures and must not consume real order numbers, so the mark is
  // in the number itself and they can never be mistaken for trade.
  const suffix = awb.slice(-6);
  const orderNumber = `SD-TEST-${suffix}`;
  const shipmentNumber = `SH-TEST-${suffix}`;

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        orderNumber,
        sellerId,
        source: 'MANUAL',
        recipientName: RECIPIENT.name,
        recipientPhoneE164: RECIPIENT.phone,
        recipientAddressLine1: RECIPIENT.line1,
        recipientAddressLine2: RECIPIENT.line2,
        recipientCity: RECIPIENT.city,
        recipientStateProvince: RECIPIENT.state,
        recipientPostalCode: RECIPIENT.pin,
        recipientCountryCode: 'IN',
        paymentMode: 'PREPAID',
        declaredValueInr: '999.00',
        // Straight to DISPATCHED: this is what makes the poller consider
        // it in flight, and it skips the CONFIRMED step that would call
        // Delhivery for a waybill we already have.
        status: 'DISPATCHED',
        // Honest about what it is - the same flag god mode sets, so the
        // order carries a visible mark that its history was written
        // rather than lived.
        hasAdminOverride: true,
        internalNotes: MARK,
        items: {
          create: {
            variantId: variant.id,
            skuCode: variant.skuCode,
            productName: variant.product.name,
            quantity: 1,
            unitPriceInr: '999.00',
            unitWeightGrams: 250,
          },
        },
      },
      select: { id: true, orderNumber: true },
    });

    const shipment = await tx.shipment.create({
      data: {
        shipmentNumber,
        courierCode: 'delhivery',
        awbNumber: awb,
        originWarehouseId: warehouseId,
        destRecipientName: RECIPIENT.name,
        destRecipientPhoneE164: RECIPIENT.phone,
        destAddressLine1: RECIPIENT.line1,
        destCity: RECIPIENT.city,
        destStateProvince: RECIPIENT.state,
        destPostalCode: RECIPIENT.pin,
        destCountryCode: 'IN',
        totalWeightGrams: 250,
        declaredValueInr: '999.00',
        // Where a real parcel is once it has left us. Deliberately not
        // CREATED: that is the pick/pack queue's marker (WMS-2), and
        // these must never appear on a picker's screen.
        status: 'HANDED_TO_COURIER',
      },
      select: { id: true },
    });

    await tx.orderShipment.create({
      data: { orderId: order.id, shipmentId: shipment.id },
    });

    return order;
  });
}

async function undo() {
  const orders = await prisma.order.findMany({
    where: { sellerId: SELLER_ID, internalNotes: MARK },
    select: { id: true, orderNumber: true, orderShipments: { select: { shipmentId: true } } },
  });
  if (orders.length === 0) {
    console.log('Nothing to undo.');
    return;
  }
  const orderIds = orders.map((o) => o.id);
  const shipmentIds = orders.flatMap((o) => o.orderShipments.map((s) => s.shipmentId));
  await prisma.$transaction(async (tx) => {
    // Children first: tracking rows reference the shipment, and the
    // point of an undo is to leave nothing behind.
    await tx.trackingEvent.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await tx.deliveryAttempt.deleteMany({ where: { shipmentId: { in: shipmentIds } } });
    await tx.orderShipment.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
    await tx.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await tx.order.deleteMany({ where: { id: { in: orderIds } } });
  });
  console.log(`Removed ${orders.length}: ${orders.map((o) => o.orderNumber).join(', ')}`);
  console.log('Wallet entries are NOT removed - a ledger is append-only.');
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
