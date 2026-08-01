-- Flat pricing: one delivery fee per seller, plus a return fee charged
-- when the parcel actually comes back.
--
-- The wallet direction is its own value rather than folded into
-- ORDER_CHARGES so that "what did returns cost us this month" stays a
-- question the ledger can answer by itself. Always a DEBIT — see the
-- CREDIT_DIRECTIONS note in WalletService (WAL-1): a direction omitted
-- from that set is treated as a debit, which is correct here and would
-- be catastrophic if it were wrong in the other direction.
ALTER TYPE "wallet_entry_direction" ADD VALUE IF NOT EXISTS 'rto_fee';
