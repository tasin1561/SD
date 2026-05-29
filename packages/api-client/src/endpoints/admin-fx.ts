/**
 * Admin FX surface (Module 16).
 *
 *   GET   /admin/fx-rates    — list current rates.
 *   PATCH /admin/fx-rates    — manual override.
 */
import type { Currency, FxRateSource } from '@skydrop/db';

export interface FxRateView {
  readonly fromCurrency: Currency;
  readonly toCurrency: Currency;
  readonly rate: string;
  readonly source: FxRateSource;
  readonly fetchedAt: string;
  readonly isManualOverride: boolean;
  readonly overrideReason: string | null;
  readonly overrideByStaffId: string | null;
}

export interface SetFxRateRequest {
  readonly fromCurrency: Currency;
  readonly toCurrency: Currency;
  readonly rate: number;
  readonly reason: string;
}
