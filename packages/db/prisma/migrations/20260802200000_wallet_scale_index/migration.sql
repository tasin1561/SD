-- The wallet's current balance is the last entry's running balance.
-- Finding that row was previously a sort over the seller's entire
-- history on every money write; this makes it one index seek.
-- CONCURRENTLY is deliberate: seller_wallet_entries is on the money
-- path and must not be locked out while the index builds.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "seller_wallet_entries_seller_id_currency_id_idx"
  ON "seller_wallet_entries" ("seller_id", "currency", "id");
