-- A courier login reaches ONE company's panel. A ticket raised on the
-- wrong session is filed against a waybill that account cannot see, and
-- its replies are never found — the sweep reads one account at a time.
ALTER TABLE "courier_escalations" ADD COLUMN "courier_account_id" UUID;

CREATE INDEX "courier_escalations_courier_account_id_idx"
  ON "courier_escalations" ("courier_account_id");
