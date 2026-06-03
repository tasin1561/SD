-- Phase 1B — append-only history of every FX rate change.
--
-- One row written per FxRateService.setManualRate (and future
-- automated fetcher) call. Lets the admin /fx page render a
-- timeline of how a (from, to) rate has moved.
--
-- Discipline:
--   - Append-only at the service layer (FxRateService is the sole
--     writer; the row is created inside the same tx that upserts
--     FxRate).
--   - No UPDATE/DELETE path.

CREATE TABLE "fx_rate_history" (
  "id"                  UUID NOT NULL DEFAULT uuidv7(),
  "from_currency"       "currency" NOT NULL,
  "to_currency"         "currency" NOT NULL,
  "rate"                DECIMAL(12, 6) NOT NULL,
  "previous_rate"       DECIMAL(12, 6),
  "source"              "fx_rate_source" NOT NULL,
  "is_manual_override"  BOOLEAN NOT NULL DEFAULT false,
  "changed_by_staff_id" UUID,
  "change_reason"       TEXT,
  "recorded_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "fx_rate_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fx_rate_history_from_to_recorded_at_idx"
  ON "fx_rate_history" ("from_currency", "to_currency", "recorded_at");
CREATE INDEX "fx_rate_history_changed_by_staff_id_idx"
  ON "fx_rate_history" ("changed_by_staff_id");

ALTER TABLE "fx_rate_history"
  ADD CONSTRAINT "fx_rate_history_changed_by_staff_id_fkey"
    FOREIGN KEY ("changed_by_staff_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
