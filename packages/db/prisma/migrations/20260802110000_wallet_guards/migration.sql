-- Wallet guards: a balance floor, a seller-local auto-withdraw hour, and
-- proof that a payout actually left our account.

-- Auto-withdrawal fires at an hour of the SELLER's day. Without a zone,
-- "10am" silently means 10am wherever the server happens to run — which
-- for a Bangladeshi seller and an Indian warehouse is never the same
-- thing twice.
ALTER TABLE "sellers"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka';

-- Evidence the transfer left our account: for the seller when they are
-- waiting, and for us when they say it never arrived. A KEY, not a URL —
-- reads are presigned on demand.
ALTER TABLE "remittances" ADD COLUMN "proof_spaces_key" TEXT;
ALTER TABLE "remittances" ADD COLUMN "proof_mime_type" TEXT;
