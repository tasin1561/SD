-- A deferred (T+N) accrual that is closed WITHOUT billing says why.
--
-- The hourly sweep billed a pending accrual whatever had happened to the
-- order since it was delivered: a delivery forced by god mode and then
-- cancelled was charged, credited and freight-billed up to seven days
-- later, and nothing gave it back. The sweep now re-checks the order and
-- closes the row with a reason instead; a cancel, reject or loss retires
-- the row at once. The reason is also what lets a re-delivery ("lost then
-- found") re-arm a skipped row without re-arming one that really billed.
ALTER TABLE "pending_accruals" ADD COLUMN "skipped_reason" TEXT;

-- A courier cancel IN FLIGHT. Claimed before the courier is called and
-- cleared after, so two operators clicking at once cannot both reach the
-- courier for one waybill (the stamp was guarded; the call was not).
ALTER TABLE "shipments" ADD COLUMN "courier_cancel_started_at" TIMESTAMPTZ;
