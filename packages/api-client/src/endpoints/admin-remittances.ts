import type { Currency } from '@skydrop/db';

export interface RemittanceListItem {
  readonly id: string;
  readonly sellerId: string;
  readonly currency: Currency;
  readonly amount: string;
  readonly sourceCurrency: Currency;
  readonly sourceAmount: string;
  readonly fxRateSnapshot: string;
  readonly bankReference: string;
  readonly paidAt: string;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface RemittanceListResponse {
  readonly items: ReadonlyArray<RemittanceListItem>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface CreateRemittanceRequest {
  readonly sellerId: string;
  readonly currency: Currency;
  readonly amount: number;
  readonly sourceCurrency: Currency;
  readonly sourceAmount: number;
  readonly fxRateSnapshot: number;
  readonly bankReference: string;
  /** Which of OUR accounts the money left. */
  readonly paidFromAccountId: string;
  /** ISO 8601 */
  readonly paidAt: string;
  readonly note?: string;
}
