-- A COD the courier reverses (RTO reversal) is taken back from the seller,
-- and what we deducted from it given back; and each payout line records
-- the COD shortfall it recognised, so the P&L can count short-payments.
ALTER TYPE "wallet_entry_direction" ADD VALUE 'cod_reversal';
ALTER TYPE "wallet_entry_direction" ADD VALUE 'cod_deduction_refund';

ALTER TABLE "courier_settlement_lines"
  ADD COLUMN "shortfall_inr" DECIMAL(12,2) NOT NULL DEFAULT 0;
