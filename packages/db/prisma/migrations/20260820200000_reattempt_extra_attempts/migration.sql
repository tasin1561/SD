-- How many EXTRA calls an approved re-attempt grants.
--
-- Unlocking the queue was not enough on its own: an order that reached
-- the cap came back already at 3 of 3, so the next unanswered ring
-- re-rejected it and the whole approval was spent on a customer who
-- simply was not in — a poor return on a seller writing a case and an
-- admin reading it.
--
-- Granted explicitly and bounded rather than resetting the count. The
-- count is the record that this customer has already refused three
-- times, and an order that could be called indefinitely through repeated
-- requests is exactly what this flow exists to prevent.
ALTER TABLE "order_reattempt_requests"
  ADD COLUMN "extra_attempts" INTEGER NOT NULL DEFAULT 0;
