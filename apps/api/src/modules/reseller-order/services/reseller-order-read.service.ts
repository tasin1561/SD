import { Injectable } from '@nestjs/common';
import { OrderStatus, PaymentMode, Prisma, ResellerStockMode, SellerStoreKind } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { StorePercents } from '../../reseller-store-terms/terms/reseller-fee-types';
import type { CreditTiming } from '../../reseller-store-terms/terms/terms-rules';

/** One line of a reseller order, as placed. */
export interface ResellerOrderLineSnapshot {
  readonly orderItemId: string;
  readonly variantId: string;
  readonly quantity: number;
  readonly transferPriceInr: Prisma.Decimal;
  readonly retailUnitInr: Prisma.Decimal;
  readonly minRetailInr: Prisma.Decimal | null;
  readonly maxRetailInr: Prisma.Decimal | null;
  readonly stockMode: ResellerStockMode;
}

/**
 * RS-5 — everything the reseller MONEY (phase 3c) needs about one order,
 * read off the order itself and never joined back to live terms: the
 * version it was placed under, the six store shares (feed to
 * `splitFeeLines`), both credit timings, and each line's transfer price
 * and retail. Decimals, never floats.
 */
export interface ResellerOrderSnapshot {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly storeId: string;
  readonly status: OrderStatus;
  readonly paymentMode: PaymentMode;
  readonly codAmountInr: Prisma.Decimal | null;
  readonly termsVersionId: string;
  readonly storePercents: StorePercents<Prisma.Decimal>;
  readonly storeCredit: CreditTiming;
  readonly sellerCredit: CreditTiming;
  readonly lines: readonly ResellerOrderLineSnapshot[];
  /** Σ transfer price × quantity — what the seller is owed for the goods. */
  readonly transferTotalInr: Prisma.Decimal;
  /** Σ retail × quantity — what the store sold the goods for. */
  readonly retailTotalInr: Prisma.Decimal;
}

/**
 * RS-5 — THE seam phase 3c hooks the reseller money onto.
 *
 * 3c's listeners (on the existing `OrderLifecycleEventBus` — delivered,
 * RTO received, cancelled / rejected, lost; see docs/reseller-stores.md
 * "Store orders as built → Seams for 3c") call `snapshotFor(orderId)`
 * and act ONLY when it returns a snapshot: a channel order returns null
 * and keeps the money path it has today. This module adds no money
 * listener and posts no wallet entry.
 *
 * Exported by `ResellerOrderModule` for exactly that; it reads, never
 * writes.
 */
@Injectable()
export class ResellerOrderReadService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshotFor(orderId: string): Promise<ResellerOrderSnapshot | null> {
    const o = await this.prisma.client.order.findFirst({
      where: { id: orderId, storeKind: SellerStoreKind.RESELLER },
      select: {
        id: true,
        orderNumber: true,
        sellerId: true,
        storeId: true,
        status: true,
        paymentMode: true,
        codAmountInr: true,
        resellerTermsVersionId: true,
        resellerDeliveryFeeStorePercent: true,
        resellerReturnFeeStorePercent: true,
        resellerCustomerReturnFeeStorePercent: true,
        resellerCodFeeStorePercent: true,
        resellerCodTaxStorePercent: true,
        resellerInstantPayFeeStorePercent: true,
        resellerStoreCreditTrigger: true,
        resellerStoreCreditDays: true,
        resellerSellerCreditTrigger: true,
        resellerSellerCreditDays: true,
        items: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            variantId: true,
            quantity: true,
            resellerTransferPriceInr: true,
            resellerRetailUnitInr: true,
            resellerMinRetailInr: true,
            resellerMaxRetailInr: true,
            resellerStockMode: true,
          },
        },
      },
    });
    if (o === null) return null;
    // The CHECK constraints make every one of these present on a reseller
    // order and line; a null here is a row the database should have
    // refused, so it is reported as no snapshot rather than guessed.
    if (
      o.resellerTermsVersionId === null ||
      o.resellerDeliveryFeeStorePercent === null ||
      o.resellerReturnFeeStorePercent === null ||
      o.resellerCustomerReturnFeeStorePercent === null ||
      o.resellerCodFeeStorePercent === null ||
      o.resellerCodTaxStorePercent === null ||
      o.resellerInstantPayFeeStorePercent === null ||
      o.resellerStoreCreditTrigger === null ||
      o.resellerStoreCreditDays === null ||
      o.resellerSellerCreditTrigger === null ||
      o.resellerSellerCreditDays === null
    ) {
      return null;
    }
    const lines: ResellerOrderLineSnapshot[] = [];
    for (const i of o.items) {
      if (
        i.resellerTransferPriceInr === null ||
        i.resellerRetailUnitInr === null ||
        i.resellerStockMode === null
      ) {
        return null;
      }
      lines.push({
        orderItemId: i.id,
        variantId: i.variantId,
        quantity: i.quantity,
        transferPriceInr: i.resellerTransferPriceInr,
        retailUnitInr: i.resellerRetailUnitInr,
        minRetailInr: i.resellerMinRetailInr,
        maxRetailInr: i.resellerMaxRetailInr,
        stockMode: i.resellerStockMode,
      });
    }
    const zero = new Prisma.Decimal(0);
    return {
      orderId: o.id,
      orderNumber: o.orderNumber,
      sellerId: o.sellerId,
      storeId: o.storeId,
      status: o.status,
      paymentMode: o.paymentMode,
      codAmountInr: o.codAmountInr,
      termsVersionId: o.resellerTermsVersionId,
      storePercents: {
        deliveryFeeStorePercent: o.resellerDeliveryFeeStorePercent,
        returnFeeStorePercent: o.resellerReturnFeeStorePercent,
        customerReturnFeeStorePercent: o.resellerCustomerReturnFeeStorePercent,
        codFeeStorePercent: o.resellerCodFeeStorePercent,
        codTaxStorePercent: o.resellerCodTaxStorePercent,
        instantPayFeeStorePercent: o.resellerInstantPayFeeStorePercent,
      },
      storeCredit: { trigger: o.resellerStoreCreditTrigger, days: o.resellerStoreCreditDays },
      sellerCredit: { trigger: o.resellerSellerCreditTrigger, days: o.resellerSellerCreditDays },
      lines,
      transferTotalInr: lines.reduce((s, l) => s.add(l.transferPriceInr.mul(l.quantity)), zero),
      retailTotalInr: lines.reduce((s, l) => s.add(l.retailUnitInr.mul(l.quantity)), zero),
    };
  }
}
