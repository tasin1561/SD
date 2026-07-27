export { DelhiveryHttpService } from './delhivery-http.service';

/**
 * One row of Delhivery's invoice-charges response, as production
 * actually returns it (captured 2026-07-27). Only the fields we read are
 * typed; the rest of the ~30 `charge_*` keys are picked up generically
 * for the forensic component breakdown.
 */
export interface DelhiveryChargeRow {
  status?: string;
  zone?: string;
  charge_DL?: number;
  charge_COD?: number;
  charge_RTO?: number;
  charge_DTO?: number;
  gross_amount?: number;
  total_amount?: number;
  charged_weight?: number;
  /** Volumetric divisor (5000 on this account). */
  divisor?: number;
  tax_data?: {
    SGST?: number;
    CGST?: number;
    IGST?: number;
    service_tax?: number;
  };
  [key: string]: unknown;
}
