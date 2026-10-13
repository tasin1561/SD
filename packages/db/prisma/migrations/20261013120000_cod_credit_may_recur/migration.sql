-- A COD that is reversed and then paid again IS credited again (WAL-6),
-- and this index forbade exactly that.
--
-- A re-credit needs a second `cod_collection` and its three deductions.
-- The index refused them, and a P2002 aborts the whole surrounding
-- transaction — which for a courier payout is the settlement row, every
-- line, EVERY OTHER SELLER's credit on that payout, and the bank entry
-- for cash that really landed. The operator's obvious response,
-- re-uploading the file, reproduced it exactly. One order could stop a
-- payout covering sixty.
--
-- So the rule the business states wins, and the double-credit guard
-- moves to the layer that can express "more credits than reversals" —
-- which an index cannot say at all.
--
-- WHAT STILL PREVENTS A DOUBLE CREDIT, per writer, traced before this
-- was written rather than assumed:
--
--   1. `AdvisoryLock.WALLET` — `pg_advisory_xact_lock` on
--      `<sellerId>|<currency>`, taken by `WalletService.applyEntry`
--      itself, which takes a transaction client as its first argument so
--      it CANNOT be called outside one. Transaction-scoped, so it is
--      held until commit or rollback and a crash cannot wedge it.
--   2. The gate, read under that lock in the same transaction:
--      `CodCreditService.isCredited` — count(cod_collection) >
--      count(cod_reversal) — or, on a reseller order, a guarded
--      `updateMany` on `reseller_order_credits.status = DUE`.
--   3. `wallet-guard-locking.spec.ts`, which reads every source file and
--      asserts PER METHOD that the lock is taken before the first ledger
--      read. A future caller that forgets fails CI.
--
-- The three deductions are written inside the same gated branch as the
-- credit, so they cannot drift from it.
--
-- HONEST ABOUT WHAT IS LOST: this swaps a database guarantee for a
-- lock-plus-CI guarantee, which is weaker in kind. The five directions
-- that REMAIN covered are each guarded by a plain existence or pairing
-- query — which is what a unique index enforces — so both layers still
-- hold for them. `order_charges` stays deliberately: a delivery fee
-- genuinely happens once, and the owner's standing decision there is to
-- skip and raise rather than re-bill.
--
-- SHIPPED WITH a change to `CodCreditService`: the deductions now carry
-- `linked_entry_id` pointing at the COD they were taken from, and
-- `reverseForOrder` narrows on it. Without that, one reversal would
-- refund EVERY unrefunded deduction on the order — which was exact only
-- while this index made a second unrefunded set unrepresentable, and
-- would otherwise return tax and fees still owed. That error is worse
-- than the one being fixed: an inflated balance shows up in a
-- reconciliation, an over-refund leaves the wallet consistent and
-- quietly understates the P&L.
--
-- NO DATA CLEANUP: relaxing a unique predicate cannot fail on existing
-- rows — every row satisfying the nine-direction predicate satisfies the
-- five-direction one.
--
-- Postgres cannot alter an index predicate, so it is dropped and
-- recreated. Not CONCURRENTLY: Prisma runs a migration inside a
-- transaction and Postgres refuses CREATE INDEX CONCURRENTLY there.
DROP INDEX "seller_wallet_entries_once_per_order_uq";

CREATE UNIQUE INDEX "seller_wallet_entries_once_per_order_uq"
  ON "seller_wallet_entries" ("linked_order_id", "direction")
  WHERE "linked_order_id" IS NOT NULL
    AND "direction" IN (
      'customer_return_fee',
      'inbound_freight',
      'order_charges',
      'order_charges_refund',
      'rto_fee'
    );
