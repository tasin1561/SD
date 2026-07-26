-- R1 (revised-plan roadmap) — multi-account courier routing.
--
-- Additive except for one deliberate loosening: courier_credentials no
-- longer enforces "at most one active credential per courier+
-- environment, platform-wide" — CourierAccount now owns that
-- uniqueness (one DEFAULT account per courier+environment via a
-- partial unique index, same pattern as
-- call_queue_entries_open_order_uq). Multiple simultaneously-active
-- credentials per (courier, environment) is the intended state going
-- forward, one per CourierAccount.

-- ── Drop the old courier-wide active-credential uniqueness ────────────
DROP INDEX "courier_credentials_courier_id_environment_is_active_key";

-- ── courier_accounts ────────────────────────────────────────────────────
CREATE TABLE "courier_accounts" (
  "id"                 UUID NOT NULL DEFAULT uuidv7(),
  "courier_id"         UUID NOT NULL,
  "environment"        "credential_environment" NOT NULL,
  "label"              TEXT NOT NULL,
  "credential_id"      UUID NOT NULL,
  "is_default"         BOOLEAN NOT NULL DEFAULT false,
  "is_active"          BOOLEAN NOT NULL DEFAULT true,
  "created_by_staff_id" UUID,
  "notes"              TEXT,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ NOT NULL,
  "deleted_at"         TIMESTAMPTZ,

  CONSTRAINT "courier_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courier_accounts_credential_id_key"
  ON "courier_accounts" ("credential_id");
CREATE INDEX "courier_accounts_courier_id_environment_idx"
  ON "courier_accounts" ("courier_id", "environment");
CREATE INDEX "courier_accounts_is_active_idx"
  ON "courier_accounts" ("is_active");
CREATE INDEX "courier_accounts_deleted_at_idx"
  ON "courier_accounts" ("deleted_at");
CREATE INDEX "courier_accounts_created_by_staff_id_idx"
  ON "courier_accounts" ("created_by_staff_id");

-- Partial unique (migration-managed — Prisma cannot declare a filtered
-- unique). Invariant: at most ONE default, non-deleted account per
-- (courier, environment) — the fallback target for sellers with no
-- explicit SellerCourierAccountLink.
CREATE UNIQUE INDEX "courier_accounts_default_uq"
  ON "courier_accounts" ("courier_id", "environment")
  WHERE "is_default" AND "deleted_at" IS NULL;

ALTER TABLE "courier_accounts"
  ADD CONSTRAINT "courier_accounts_courier_id_fkey"
    FOREIGN KEY ("courier_id") REFERENCES "couriers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "courier_accounts"
  ADD CONSTRAINT "courier_accounts_credential_id_fkey"
    FOREIGN KEY ("credential_id") REFERENCES "courier_credentials"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "courier_accounts"
  ADD CONSTRAINT "courier_accounts_created_by_staff_id_fkey"
    FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── seller_courier_account_links ───────────────────────────────────────
CREATE TABLE "seller_courier_account_links" (
  "id"                  UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"           UUID NOT NULL,
  "courier_account_id"  UUID NOT NULL,
  "distribution_weight" INTEGER NOT NULL DEFAULT 100,
  "is_active"           BOOLEAN NOT NULL DEFAULT true,
  "created_by_staff_id" UUID,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ NOT NULL,

  CONSTRAINT "seller_courier_account_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "seller_courier_account_links_seller_id_courier_account_id_key"
  ON "seller_courier_account_links" ("seller_id", "courier_account_id");
CREATE INDEX "seller_courier_account_links_seller_id_idx"
  ON "seller_courier_account_links" ("seller_id");
CREATE INDEX "seller_courier_account_links_courier_account_id_idx"
  ON "seller_courier_account_links" ("courier_account_id");

ALTER TABLE "seller_courier_account_links"
  ADD CONSTRAINT "seller_courier_account_links_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_courier_account_links"
  ADD CONSTRAINT "seller_courier_account_links_courier_account_id_fkey"
    FOREIGN KEY ("courier_account_id") REFERENCES "courier_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "seller_courier_account_links"
  ADD CONSTRAINT "seller_courier_account_links_created_by_staff_id_fkey"
    FOREIGN KEY ("created_by_staff_id") REFERENCES "staff_users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── shipments.courier_account_id ───────────────────────────────────────
ALTER TABLE "shipments" ADD COLUMN "courier_account_id" UUID;
CREATE INDEX "shipments_courier_account_id_idx"
  ON "shipments" ("courier_account_id");
ALTER TABLE "shipments"
  ADD CONSTRAINT "shipments_courier_account_id_fkey"
    FOREIGN KEY ("courier_account_id") REFERENCES "courier_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
