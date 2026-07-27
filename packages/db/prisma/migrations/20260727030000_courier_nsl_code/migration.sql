-- Persist the courier's NSL (Net Service Level) code.
--
-- The webhook parser has always extracted it and then dropped it on the
-- floor. It is the fine-grained reason UNDER a status — "Pending" says
-- nothing, `EOD-74` says "customer unavailable" — and Delhivery decides
-- whether a failed delivery may be re-attempted from that code alone.
-- Without keeping it, an NDR action can only be taken blind, which earns
-- a rejection and burns rate budget.
--
-- Both tables get it, for two different questions:
--   tracking_events  — "what did the courier say at each scan" (timeline,
--                      support, and the audit trail for a dispute)
--   delivery_attempts — "what is the CURRENT reason this parcel failed",
--                      which is exactly the input the re-attempt call takes
--
-- Nullable throughout: historical rows genuinely do not have it, and a
-- backfill would be inventing data. A null reads as "we do not know", which
-- the eligibility check already treats as not-eligible.

-- tracking_events is a TimescaleDB hypertable; ADD COLUMN propagates to
-- every chunk and is a catalog-only operation (no rewrite) for a nullable
-- column with no default.
ALTER TABLE "tracking_events" ADD COLUMN "nsl_code" TEXT;

ALTER TABLE "delivery_attempts" ADD COLUMN "courier_nsl_code" TEXT;

-- The NDR flow asks "which shipments are sitting on a re-attemptable NSL
-- right now" — a partial index, because the overwhelming majority of
-- attempts have no code and are never the answer to that question.
CREATE INDEX "delivery_attempts_courier_nsl_code_idx"
  ON "delivery_attempts" ("courier_nsl_code")
  WHERE "courier_nsl_code" IS NOT NULL;
