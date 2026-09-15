/**
 * RS-6 phase 3c — a reseller store order's money, read three ways:
 *
 *   GET /store/orders/:id/money             (the store: its own lines only)
 *   GET /seller/orders/:id/reseller-money   (the seller: their own lines only)
 *   GET /admin/orders/:id/reseller-money    (staff: both wallets)
 *
 * Each answers 404 ORDER_NOT_FOUND for a channel order. Every amount is a
 * decimal string in rupees; a wallet line's `amountInr` is SIGNED (+ credited
 * to that wallet, − taken from it).
 */
import type {
  PaymentMode,
  ResellerCreditStatus,
  ResellerCreditTrigger,
  ResellerMoneyParty,
  WalletEntryDirection,
} from '@skydrop/db';

export interface ResellerPartyCreditView {
  readonly party: ResellerMoneyParty;
  readonly trigger: ResellerCreditTrigger;
  readonly days: number;
  /** The timing in words, as the Terms screens say it. */
  readonly timing: string;
  readonly status: ResellerCreditStatus;
  readonly dueAt: string | null;
  readonly creditedAt: string | null;
  readonly reversedAt: string | null;
  readonly skippedReason: string | null;
  readonly grossInr: string;
  readonly transferInr: string;
  readonly taxShareInr: string;
  readonly codFeeShareInr: string;
  readonly instantFeeShareInr: string;
  readonly netInr: string;
}

export interface ResellerMoneyLineView {
  readonly id: string;
  /** A StoreWalletEntryDirection on store lines, a WalletEntryDirection on seller lines. */
  readonly direction: string;
  readonly shareOf: WalletEntryDirection | null;
  readonly amountInr: string;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface ResellerFeeSplitView {
  readonly fee: WalletEntryDirection;
  readonly storeInr: string;
  readonly sellerInr: string;
  readonly totalInr: string;
}

export interface ResellerOrderMoneyView {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly paymentMode: PaymentMode;
  readonly codInr: string | null;
  readonly transferTotalInr: string;
  readonly retailTotalInr: string;
  readonly termsVersionId: string;
  readonly storePercents: Readonly<Record<string, string>>;
  readonly parties: readonly ResellerPartyCreditView[];
  readonly fees: readonly ResellerFeeSplitView[];
  readonly storeLines: readonly ResellerMoneyLineView[] | null;
  readonly sellerLines: readonly ResellerMoneyLineView[] | null;
  readonly storeNetInr: string | null;
  readonly sellerNetInr: string | null;
}
