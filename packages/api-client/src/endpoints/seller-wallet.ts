import type { Currency, WalletEntryDirection } from '@skydrop/db';

export interface WalletBalanceView {
  readonly currency: Currency;
  readonly balance: string;
  /**
   * True when this figure is the INR balance expressed in another
   * currency rather than a balance of its own. INR is canonical — every
   * entry the system writes is INR — and BDT is a VIEW of it at the
   * current rate.
   *
   * Worth flagging rather than leaving to the reader: a second balance
   * is money you could withdraw separately, a conversion is the same
   * money counted again, and a UI that labels both "owed to you" reads
   * as twice as much.
   */
  readonly isConverted: boolean;
  /** The rate used, when converted — so the figure can be checked. */
  readonly fxRate: string | null;
}

export interface WalletEntryView {
  readonly id: string;
  readonly currency: Currency;
  readonly direction: WalletEntryDirection;
  readonly amount: string;
  readonly runningBalanceAfter: string;
  readonly linkedOrderId: string | null;
  /**
   * The order's human number. The id alone is unmatchable against
   * anything the seller holds — in the table it read as a bare
   * "Order →", and in the CSV export as a UUID.
   */
  readonly linkedOrderNumber: string | null;
  readonly linkedRemittanceId: string | null;
  /**
   * Set on an INBOUND_FREIGHT debit. Freight belongs to a CONSIGNMENT
   * rather than an order, so this is the only thing that lets the ledger
   * point at what the seller was charged for.
   */
  readonly linkedConsignmentId: string | null;
  readonly linkedConsignmentNumber: string | null;
  readonly reasonCode: string | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface WalletBalancesResponse {
  readonly balances: ReadonlyArray<WalletBalanceView>;
}

export interface WalletEntriesPage {
  readonly items: ReadonlyArray<WalletEntryView>;
  readonly nextCursor: string | null;
}
