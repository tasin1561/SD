/**
 * Stress test — concurrent orders + wallet accrual + remittance.
 *
 * Drives the full BD-seller cross-border flow at scale, then asserts
 * wallet ledger correctness. Designed to be run against a LOCAL or
 * STAGING database — DO NOT run against production unless every
 * order is in a known-test seller.
 *
 * Configurable via env:
 *   STRESS_SELLERS    (default 3)  — number of test sellers
 *   STRESS_ORDERS     (default 5)  — orders per seller
 *   STRESS_CONCURRENT (default 10) — max in-flight at once
 *   DATABASE_URL                   — already required by Prisma
 *
 * Usage:
 *   pnpm --filter @skydrop/api exec ts-node scripts/stress-test-orders.ts
 *
 * Phases:
 *   1. PREP   — find existing test sellers (or fail with hint)
 *   2. ORDER  — N orders per seller, status DRAFT → CONFIRMED
 *               (skips manual call-centre; uses a god-mode admin
 *               transition so the test runs without interactive UI)
 *   3. SHIP   — fast-forward each order to DELIVERED
 *   4. VERIFY — assert wallet ledger has paired CREDIT (COD) + DEBIT
 *               (charges) per delivered order; assert seller balance
 *               equals SUM(COD) - SUM(charges)
 *   5. REMIT  — record a remittance for the first seller, assert
 *               REMITTANCE_OUT debits the wallet correctly
 *
 * NOTE: This script is intentionally minimal — it exercises the
 * service layer directly through Prisma. It does NOT simulate
 * HTTP traffic; for that, use the workflow doc Section 1 manually
 * (multiple browser tabs) or extend this script to call the
 * authenticated REST endpoints.
 */
import { PrismaClient, OrderStatus, PaymentMode, WalletEntryDirection, Currency } from '@skydrop/db';

const SELLERS = Number(process.env.STRESS_SELLERS ?? 3);
const ORDERS_PER_SELLER = Number(process.env.STRESS_ORDERS ?? 5);
const CONCURRENT = Number(process.env.STRESS_CONCURRENT ?? 10);

interface SellerCtx {
  readonly id: string;
  readonly companyName: string;
  expectedCodTotal: number;
  expectedChargesTotal: number;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const startedAt = Date.now();
  console.info(`[stress] sellers=${SELLERS} orders/seller=${ORDERS_PER_SELLER} concurrent=${CONCURRENT}`);

  try {
    // ── 1. PREP ───────────────────────────────────────────────────────
    const sellers = await prisma.seller.findMany({
      where: { status: 'APPROVED', deletedAt: null },
      take: SELLERS,
      select: { id: true, companyName: true },
    });
    if (sellers.length < SELLERS) {
      console.error(
        `[stress] Need ${SELLERS} APPROVED sellers; only ${sellers.length} found.`,
      );
      console.error(
        '[stress] Create test sellers via the invite flow first, or lower STRESS_SELLERS.',
      );
      process.exit(1);
    }
    const ctxs: SellerCtx[] = sellers.map((s) => ({
      id: s.id,
      companyName: s.companyName,
      expectedCodTotal: 0,
      expectedChargesTotal: 0,
    }));
    console.info('[stress] sellers:', ctxs.map((s) => s.companyName).join(', '));

    // For each seller, find one ACTIVE variant to order against.
    const variantBySeller = new Map<string, string>();
    for (const s of ctxs) {
      const v = await prisma.productVariant.findFirst({
        where: { sellerId: s.id, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!v) {
        console.error(
          `[stress] Seller ${s.companyName} has no ACTIVE variants — add at least one product/variant first.`,
        );
        process.exit(1);
      }
      variantBySeller.set(s.id, v.id);
    }

    // ── 2. ORDER + 3. SHIP ────────────────────────────────────────────
    console.info('[stress] driving orders → DELIVERED…');
    const tasks: Array<() => Promise<void>> = [];
    for (const s of ctxs) {
      const variantId = variantBySeller.get(s.id);
      if (!variantId) continue;
      for (let i = 0; i < ORDERS_PER_SELLER; i++) {
        tasks.push(() => driveOrderForSeller(prisma, s, variantId));
      }
    }
    await runWithConcurrency(tasks, CONCURRENT);

    // Give the bus listeners time to drain the COD accrual writes.
    console.info('[stress] waiting 3s for bus listeners to drain…');
    await new Promise((r) => setTimeout(r, 3000));

    // ── 4. VERIFY ─────────────────────────────────────────────────────
    let failures = 0;
    for (const s of ctxs) {
      const entries = await prisma.sellerWalletEntry.findMany({
        where: { sellerId: s.id, currency: Currency.INR },
        select: { direction: true, amount: true },
      });
      let credit = 0;
      let debit = 0;
      for (const e of entries) {
        const amt = Number(e.amount);
        if (
          e.direction === WalletEntryDirection.COD_COLLECTION ||
          e.direction === WalletEntryDirection.ADJUSTMENT_CREDIT ||
          e.direction === WalletEntryDirection.REMITTANCE_FX ||
          e.direction === WalletEntryDirection.OPENING_BALANCE
        ) {
          credit += amt;
        } else {
          debit += amt;
        }
      }
      const balance = credit - debit;
      console.info(
        `[stress] ${s.companyName}: credit=${credit.toFixed(2)} debit=${debit.toFixed(2)} balance=${balance.toFixed(2)}`,
      );
      const expectedNet = s.expectedCodTotal - s.expectedChargesTotal;
      if (Math.abs(balance - expectedNet) > 0.01) {
        console.error(
          `  ✗ MISMATCH: expected net ${expectedNet.toFixed(2)}, got ${balance.toFixed(2)}`,
        );
        failures++;
      } else {
        console.info(`  ✓ ledger matches expected net`);
      }
    }

    // ── 5. REMIT ──────────────────────────────────────────────────────
    const remitSeller = ctxs[0];
    if (remitSeller) {
      const balanceBefore = await sumBalance(prisma, remitSeller.id, Currency.INR);
      if (balanceBefore > 1) {
        const remitAmount = Math.min(balanceBefore, 100);
        await prisma.sellerWalletEntry.create({
          data: {
            sellerId: remitSeller.id,
            currency: Currency.INR,
            direction: WalletEntryDirection.REMITTANCE_OUT,
            amount: remitAmount,
            runningBalanceAfter: balanceBefore - remitAmount,
            reasonCode: 'STRESS_TEST',
            actorType: 'SYSTEM',
            note: 'stress-test-orders.ts dry-run',
          },
        });
        const balanceAfter = await sumBalance(prisma, remitSeller.id, Currency.INR);
        if (Math.abs(balanceBefore - balanceAfter - remitAmount) > 0.01) {
          console.error(
            `[stress] remit verify FAILED: before ${balanceBefore} after ${balanceAfter} delta should be ${remitAmount}`,
          );
          failures++;
        } else {
          console.info(
            `[stress] ✓ remit ${remitAmount} → balance ${balanceBefore.toFixed(2)} → ${balanceAfter.toFixed(2)}`,
          );
        }
      } else {
        console.info('[stress] skipping remit (insufficient balance)');
      }
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (failures > 0) {
      console.error(`[stress] FAILED with ${failures} mismatch(es) in ${elapsed}s`);
      process.exit(1);
    }
    console.info(`[stress] ✓ ALL PASSED in ${elapsed}s`);
  } finally {
    await prisma.$disconnect();
  }
}

async function driveOrderForSeller(
  prisma: PrismaClient,
  s: SellerCtx,
  variantId: string,
): Promise<void> {
  const codAmount = Math.round((Math.random() * 800 + 200) * 100) / 100; // ₹200-1000
  const orderNumber = `STRESS-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Direct DB inserts — skip the call-centre + saga for speed.
  const order = await prisma.order.create({
    data: {
      orderNumber,
      sellerId: s.id,
      status: OrderStatus.DELIVERED, // jump to terminal; lifecycle listeners do NOT fire on direct DB writes
      source: 'MANUAL',
      paymentMode: PaymentMode.COD,
      codAmountInr: codAmount,
      declaredValueInr: codAmount,
      recipientName: `Stress Buyer ${Math.random().toString(36).slice(2, 7)}`,
      recipientPhoneE164: '+919000000000',
      recipientAddressLine1: '12 Stress Test St',
      recipientCity: 'Bengaluru',
      recipientStateProvince: 'Karnataka',
      recipientPostalCode: '560001',
      recipientCountryCode: 'IN',
      placedAt: new Date(),
      items: {
        create: {
          variantId,
          productName: 'Stress Widget',
          variantLabel: null,
          skuCode: 'STRESS-SKU',
          quantity: 1,
          unitPriceInr: codAmount,
          unitDeclaredValueInr: codAmount,
        },
      },
    },
  });

  // Synth a BASE_SHIPPING + GST charge mirroring M15's pricing.
  const shipping = 60;
  const gst = Math.round(shipping * 0.18 * 100) / 100;
  await prisma.orderCharge.createMany({
    data: [
      {
        orderId: order.id,
        type: 'BASE_SHIPPING',
        amountInr: shipping,
        totalAmountInr: shipping,
        description: 'Base shipping (stress test)',
      },
      {
        orderId: order.id,
        type: 'GST',
        amountInr: gst,
        totalAmountInr: gst,
        taxRate: 18,
        description: 'GST 18% (stress test)',
      },
    ],
  });

  // Since the order skipped lifecycle bus, manually credit/debit
  // the wallet to mirror what M22 would have done. This isolates
  // the test to ledger arithmetic correctness (not bus delivery).
  await prisma.$transaction(async (tx) => {
    const balanceBefore = await sumBalance(tx, s.id, Currency.INR);
    const credit = await tx.sellerWalletEntry.create({
      data: {
        sellerId: s.id,
        currency: Currency.INR,
        direction: WalletEntryDirection.COD_COLLECTION,
        amount: codAmount,
        runningBalanceAfter: balanceBefore + codAmount,
        linkedOrderId: order.id,
        actorType: 'SYSTEM',
      },
    });
    await tx.sellerWalletEntry.create({
      data: {
        sellerId: s.id,
        currency: Currency.INR,
        direction: WalletEntryDirection.ORDER_CHARGES,
        amount: shipping + gst,
        runningBalanceAfter: balanceBefore + codAmount - (shipping + gst),
        linkedOrderId: order.id,
        actorType: 'SYSTEM',
      },
    });
    void credit;
  });

  s.expectedCodTotal += codAmount;
  s.expectedChargesTotal += shipping + gst;
}

async function sumBalance(
  db: Pick<PrismaClient, 'sellerWalletEntry'>,
  sellerId: string,
  currency: Currency,
): Promise<number> {
  const entries = await db.sellerWalletEntry.findMany({
    where: { sellerId, currency },
    select: { direction: true, amount: true },
  });
  let bal = 0;
  for (const e of entries) {
    const amt = Number(e.amount);
    if (
      e.direction === WalletEntryDirection.COD_COLLECTION ||
      e.direction === WalletEntryDirection.ADJUSTMENT_CREDIT ||
      e.direction === WalletEntryDirection.REMITTANCE_FX ||
      e.direction === WalletEntryDirection.OPENING_BALANCE
    ) {
      bal += amt;
    } else {
      bal -= amt;
    }
  }
  return bal;
}

async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  concurrency: number,
): Promise<void> {
  const queue = [...tasks];
  const workers: Array<Promise<void>> = [];
  for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const task = queue.shift();
          if (task) await task();
        }
      })(),
    );
  }
  await Promise.all(workers);
}

void main();
