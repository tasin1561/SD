-- A ticket now records WHICH problem it is, in the courier's own
-- vocabulary, chosen by the seller when they raise it.
--
-- Stored as the courier's `external_id` rather than a foreign key: the
-- taxonomy is re-fetched from Delhivery and rows get replaced, so a FK
-- would either block that refresh or cascade a ticket's category away.
-- The natural key is (courier_code, external_id) and it survives a
-- refetch; a row id does not.
--
-- Nullable on purpose. Tickets raised before there was a taxonomy have
-- no category, and back-filling one would be a guess recorded as a fact.
ALTER TABLE "tickets"
  ADD COLUMN "issue_category_external_id" TEXT,
  ADD COLUMN "issue_subcategory_external_id" TEXT;
