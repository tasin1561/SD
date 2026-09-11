-- What the courier kept back from a COD payout, by kind. The early-COD
-- fee is booked as an EXPENSE bank entry linked to the settlement; the
-- other two are recorded so the payout explains itself.
ALTER TABLE "courier_settlements"
  ADD COLUMN "early_cod_fee_inr" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "freight_deducted_inr" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "rto_reversal_inr" DECIMAL(14,2) NOT NULL DEFAULT 0;
