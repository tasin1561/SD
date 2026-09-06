-- Whether a courier ticket is worth OPENING. The sweep sees ~200 tickets
-- on the account and ~11 are ours; opening a thread costs ~10s of
-- browser, so re-reading conversations that have not moved is where the
-- entire cost of the sweep was going.
ALTER TABLE "courier_escalations" ADD COLUMN "portal_row_hash" TEXT;
