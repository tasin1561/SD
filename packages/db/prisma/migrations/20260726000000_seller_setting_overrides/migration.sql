-- Phase-1B settings-resolver mechanism (R0 of the revised-plan roadmap).
--
-- Additive only: no existing table/column is dropped, no constraint is
-- loosened. Adds seller-override capability to system_settings (a key
-- opts in via seller_overridable + optional min/max bounds) and the
-- new seller_setting_overrides table that SettingsResolverService
-- resolves as sellerOverride ?? systemDefault.

-- ── system_settings — seller-override caps ─────────────────────────────
ALTER TABLE "system_settings"
  ADD COLUMN "seller_overridable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "override_min_int" INTEGER,
  ADD COLUMN "override_max_int" INTEGER,
  ADD COLUMN "override_min_decimal" DECIMAL(20, 6),
  ADD COLUMN "override_max_decimal" DECIMAL(20, 6);

-- ── seller_setting_overrides ────────────────────────────────────────────
CREATE TABLE "seller_setting_overrides" (
  "id"              UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"       UUID NOT NULL,
  "key"             TEXT NOT NULL,
  "value_type"      "setting_value_type" NOT NULL,
  "value_string"    TEXT,
  "value_int"       INTEGER,
  "value_decimal"   DECIMAL(20, 6),
  "value_boolean"   BOOLEAN,
  "value_json"      JSONB,
  "value_date"      TIMESTAMPTZ,
  "set_by_staff_id" UUID,
  "note"            TEXT,
  "created_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ NOT NULL,

  CONSTRAINT "seller_setting_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_setting_overrides_seller_id_key_key"
  ON "seller_setting_overrides" ("seller_id", "key");
CREATE INDEX "seller_setting_overrides_key_idx"
  ON "seller_setting_overrides" ("key");

ALTER TABLE "seller_setting_overrides"
  ADD CONSTRAINT "seller_setting_overrides_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_setting_overrides"
  ADD CONSTRAINT "seller_setting_overrides_set_by_staff_id_fkey"
    FOREIGN KEY ("set_by_staff_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
