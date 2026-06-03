import type { FxRateSource } from '@skydrop/db';

export interface FxRateHistoryRow {
  readonly id: string;
  readonly rate: string;
  readonly previousRate: string | null;
  readonly source: FxRateSource;
  readonly isManualOverride: boolean;
  readonly changedByStaffId: string | null;
  readonly changeReason: string | null;
  readonly recordedAt: string;
}
