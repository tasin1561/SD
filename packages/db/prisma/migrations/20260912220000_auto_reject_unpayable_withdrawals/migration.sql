-- wallet.auto_reject_unpayable_withdrawals (owner request, 2026-09-12).
--
-- A PENDING withdrawal request holds its amount out of what the seller may
-- withdraw until somebody decides it. When charges land afterwards and the
-- balance falls below it, nobody can pay it (approval and the remittance
-- both re-check and refuse), yet it keeps blocking every new request and
-- the automatic sweep, and the liabilities page lists it as money asked
-- for. Production: Menev Store's automatic request of 2026-09-02 for
-- ₹2,946.40, against a wallet now holding ₹111.40.
--
-- ON by default because the owner asked for it; seller-overridable (SET-1)
-- so it can be switched off per seller. seedSystemSettings() is create-only
-- on value columns and deploy runs migrations, not the seed, so the row is
-- inserted here to exist on the deployed database.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_boolean",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(),
  'wallet.auto_reject_unpayable_withdrawals',
  'wallet',
  'boolean',
  true,
  'Auto-reject withdrawal requests the wallet no longer covers',
  'A withdrawal request holds its amount out of what the seller may withdraw until somebody decides it. When charges land after it was raised and the balance falls below it, nobody can pay it — approval and payout both refuse — yet it keeps blocking every new request and the automatic sweep, and sits in the liabilities as money asked for. When on, a PENDING request the balance no longer covers is rejected automatically (every 15 minutes) with the numbers in the reason, and the seller is told they can ask again. APPROVED requests are never auto-rejected — they may already be mid-payout — they are raised on the system issues board instead. Per-seller override.',
  true,
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
