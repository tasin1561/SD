import type { Currency, WalletEntryDirection } from '@skydrop/db';

export interface WalletBalanceView {
  readonly currency: Currency;
  readonly balance: string;
}

export interface WalletEntryView {
  readonly id: string;
  readonly currency: Currency;
  readonly direction: WalletEntryDirection;
  readonly amount: string;
  readonly runningBalanceAfter: string;
  readonly linkedOrderId: string | null;
  readonly linkedRemittanceId: string | null;
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
