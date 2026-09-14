import type { Prisma, ResellerCreditTrigger, ResellerStockMode } from '@skydrop/db';

/**
 * RS-5 — what a RESELLER STORE's order snapshots at create (ORD-6; RS-4
 * "later edits never re-price"). Types and one builder, no DI: the order
 * core writes these columns, `ResellerOrderService` decides them, and 3c
 * reads them back through `ResellerOrderReadService.snapshotFor`.
 */

/** One line's terms as placed. `unit_price_inr` carries the same retail. */
export interface ResellerLineTerms {
  readonly transferPriceInr: Prisma.Decimal;
  readonly retailUnitInr: Prisma.Decimal;
  readonly minRetailInr: Prisma.Decimal | null;
  readonly maxRetailInr: Prisma.Decimal | null;
  /** The store's stock mode for the variant when the order was placed. */
  readonly stockMode: ResellerStockMode;
}

/** The order-level terms: the version, the six store shares, both timings. */
export interface ResellerOrderTerms {
  readonly termsVersionId: string;
  readonly deliveryFeeStorePercent: Prisma.Decimal;
  readonly returnFeeStorePercent: Prisma.Decimal;
  readonly customerReturnFeeStorePercent: Prisma.Decimal;
  readonly codFeeStorePercent: Prisma.Decimal;
  readonly codTaxStorePercent: Prisma.Decimal;
  readonly instantPayFeeStorePercent: Prisma.Decimal;
  readonly storeCreditTrigger: ResellerCreditTrigger;
  readonly storeCreditDays: number;
  readonly sellerCreditTrigger: ResellerCreditTrigger;
  readonly sellerCreditDays: number;
}

/**
 * Handed to `OrderService.create` ONLY by `ResellerOrderService`, after
 * every refusal has run. `lockAndReadTerms` runs FIRST inside the create
 * transaction: it locks the store row FOR SHARE (RS-1's close race),
 * re-checks the store is still ACTIVE, and reads the terms in force from
 * the same snapshot the order is written in.
 */
export interface ResellerCreateContext {
  readonly storeId: string;
  /** What the customer sees: `display_name ?? name` at create (RS-10 reads it). */
  readonly storeName: string;
  /** One per `CreateOrderDto.items` entry, in the same order. */
  readonly lines: readonly ResellerLineTerms[];
  readonly lockAndReadTerms: (tx: Prisma.TransactionClient) => Promise<ResellerOrderTerms>;
}

/** The order columns a reseller order carries (every one NOT NULL by CHECK). */
export function resellerOrderColumns(t: ResellerOrderTerms): {
  resellerTermsVersionId: string;
  resellerDeliveryFeeStorePercent: Prisma.Decimal;
  resellerReturnFeeStorePercent: Prisma.Decimal;
  resellerCustomerReturnFeeStorePercent: Prisma.Decimal;
  resellerCodFeeStorePercent: Prisma.Decimal;
  resellerCodTaxStorePercent: Prisma.Decimal;
  resellerInstantPayFeeStorePercent: Prisma.Decimal;
  resellerStoreCreditTrigger: ResellerCreditTrigger;
  resellerStoreCreditDays: number;
  resellerSellerCreditTrigger: ResellerCreditTrigger;
  resellerSellerCreditDays: number;
} {
  return {
    resellerTermsVersionId: t.termsVersionId,
    resellerDeliveryFeeStorePercent: t.deliveryFeeStorePercent,
    resellerReturnFeeStorePercent: t.returnFeeStorePercent,
    resellerCustomerReturnFeeStorePercent: t.customerReturnFeeStorePercent,
    resellerCodFeeStorePercent: t.codFeeStorePercent,
    resellerCodTaxStorePercent: t.codTaxStorePercent,
    resellerInstantPayFeeStorePercent: t.instantPayFeeStorePercent,
    resellerStoreCreditTrigger: t.storeCreditTrigger,
    resellerStoreCreditDays: t.storeCreditDays,
    resellerSellerCreditTrigger: t.sellerCreditTrigger,
    resellerSellerCreditDays: t.sellerCreditDays,
  };
}
