-- Name the two bank-change foreign keys after their COLUMNS.
--
-- The original migration named them after the relation
-- (`..._requested_by_fkey`, `..._decided_by_fkey`) while the columns are
-- `requested_by_seller_user_id` and `decided_by_staff_id`. Prisma derives
-- the expected name from the column, so every `migrate diff` reported the
-- database as drifted from the schema — noise that hides a real
-- difference the next time somebody looks.
--
-- Renaming a constraint takes only a catalog lock and rewrites no rows.
-- Guarded on the old name existing, so this is a no-op on a database
-- built fresh from migrations after the names were already corrected,
-- and safe to re-run.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'seller_bank_change_requests_requested_by_fkey'
    ) THEN
        ALTER TABLE "seller_bank_change_requests"
            RENAME CONSTRAINT "seller_bank_change_requests_requested_by_fkey"
                           TO "seller_bank_change_requests_requested_by_seller_user_id_fkey";
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'seller_bank_change_requests_decided_by_fkey'
    ) THEN
        ALTER TABLE "seller_bank_change_requests"
            RENAME CONSTRAINT "seller_bank_change_requests_decided_by_fkey"
                           TO "seller_bank_change_requests_decided_by_staff_id_fkey";
    END IF;
END $$;
