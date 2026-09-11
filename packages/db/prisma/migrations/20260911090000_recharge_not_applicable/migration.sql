-- A failed top-up has nothing to reconcile.
--
-- `matchOne` never looked at the courier's own status, so a recharge
-- their page marks FAILED was reported as "not in our books" at HIGH
-- severity — asking an operator to record which of our accounts paid
-- for a payment that never left one. Four of eleven open money issues
-- were this, and acting on any of them would have put a bank entry in
-- the book with no statement line behind it.
ALTER TYPE "courier_recharge_match" ADD VALUE IF NOT EXISTS 'not_applicable';
