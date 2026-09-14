import { WalletEntryDirection } from '@skydrop/db';

/**
 * RS-4 — the Skydrop fees a reseller store's terms split between the
 * store and the seller.
 *
 * ── WHY A CLOSED LIST, AND WHY F2-EXHAUSTIVE ─────────────────────────
 * Each fee type is one column on `reseller_store_terms_versions` (so a
 * CHECK can hold each share to 0–100) and one wallet direction the fee is
 * charged under. Every function below is an exhaustive `switch` ending in
 * `never`, so adding a seventh fee type fails to COMPILE until somebody
 * decides its column, its wallet direction and its words — a default
 * branch would quietly let a new fee be charged to nobody's share.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────
 * Inbound freight (`INBOUND_FREIGHT`) is the seller's alone: it is the
 * cost of getting THEIR stock into our warehouse, whoever later sells it.
 * It is not a fee type, so no version can hand any of it to a store.
 *
 * Kept a TypeScript union rather than a Prisma enum: nothing stores a fee
 * type as a value yet (the shares are columns). Phase 3b's per-order
 * split lines will be the first column to need one — promote it then, in
 * the same change, and keep this file its only translator.
 */
export const RESELLER_FEE_TYPES = [
  'DELIVERY_FEE',
  'RETURN_FEE',
  'CUSTOMER_RETURN_FEE',
  'COD_FEE',
  'COD_TAX',
  'INSTANT_PAY_FEE',
] as const;

export type ResellerFeeType = (typeof RESELLER_FEE_TYPES)[number];

/** The version columns that hold the STORE's share of each fee. */
export type StorePercentField =
  | 'deliveryFeeStorePercent'
  | 'returnFeeStorePercent'
  | 'customerReturnFeeStorePercent'
  | 'codFeeStorePercent'
  | 'codTaxStorePercent'
  | 'instantPayFeeStorePercent';

/** One value per fee type, keyed by column — a version's shares. */
export type StorePercents<T> = { readonly [K in StorePercentField]: T };

export function isResellerFeeType(value: string): value is ResellerFeeType {
  return (RESELLER_FEE_TYPES as readonly string[]).includes(value);
}

/** The ONE place a fee type becomes a column. */
export function storePercentField(feeType: ResellerFeeType): StorePercentField {
  switch (feeType) {
    case 'DELIVERY_FEE':
      return 'deliveryFeeStorePercent';
    case 'RETURN_FEE':
      return 'returnFeeStorePercent';
    case 'CUSTOMER_RETURN_FEE':
      return 'customerReturnFeeStorePercent';
    case 'COD_FEE':
      return 'codFeeStorePercent';
    case 'COD_TAX':
      return 'codTaxStorePercent';
    case 'INSTANT_PAY_FEE':
      return 'instantPayFeeStorePercent';
    default: {
      const exhaustive: never = feeType;
      throw new Error(`Unhandled reseller fee type: ${String(exhaustive)}`);
    }
  }
}

/** A version's share for one fee type. */
export function storePercentOf<T>(percents: StorePercents<T>, feeType: ResellerFeeType): T {
  return percents[storePercentField(feeType)];
}

/**
 * The wallet direction the fee is charged under today (for the seller's
 * own orders). Phase 3b charges each party's share under the same
 * direction on its own wallet, so "what did COD tax cost this store"
 * stays answerable from a ledger alone (WAL-1).
 */
export function walletDirectionForFee(feeType: ResellerFeeType): WalletEntryDirection {
  switch (feeType) {
    case 'DELIVERY_FEE':
      return WalletEntryDirection.ORDER_CHARGES;
    case 'RETURN_FEE':
      return WalletEntryDirection.RTO_FEE;
    case 'CUSTOMER_RETURN_FEE':
      return WalletEntryDirection.CUSTOMER_RETURN_FEE;
    case 'COD_FEE':
      return WalletEntryDirection.COD_COLLECTION_FEE;
    case 'COD_TAX':
      return WalletEntryDirection.GST_WITHHOLDING;
    case 'INSTANT_PAY_FEE':
      return WalletEntryDirection.INSTANT_PAY_FEE;
    default: {
      const exhaustive: never = feeType;
      throw new Error(`Unhandled reseller fee type: ${String(exhaustive)}`);
    }
  }
}

/**
 * The fee a wallet direction is, or null when the direction is not a
 * splittable Skydrop fee (a credit, a refund, inbound freight, …).
 * Derived from `walletDirectionForFee`, so the two can never disagree.
 */
export function feeTypeForWalletDirection(direction: WalletEntryDirection): ResellerFeeType | null {
  return RESELLER_FEE_TYPES.find((t) => walletDirectionForFee(t) === direction) ?? null;
}

/** Words for people. */
export function feeTypeLabel(feeType: ResellerFeeType): string {
  switch (feeType) {
    case 'DELIVERY_FEE':
      return 'Delivery fee';
    case 'RETURN_FEE':
      return 'Return fee (parcel came back undelivered)';
    case 'CUSTOMER_RETURN_FEE':
      return 'Customer return fee';
    case 'COD_FEE':
      return 'COD fee';
    case 'COD_TAX':
      return 'COD tax (18% taken from the COD)';
    case 'INSTANT_PAY_FEE':
      return 'Instant Pay fee';
    default: {
      const exhaustive: never = feeType;
      throw new Error(`Unhandled reseller fee type: ${String(exhaustive)}`);
    }
  }
}
