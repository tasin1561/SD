-- Bin tracking: a per-warehouse switch, the missing grid axis, the
-- collapse backup, and the optional location note.

-- Per-warehouse, not global: a mature site can run binned while a newly
-- opened one does not. Defaults OFF, which is where every existing
-- warehouse actually is.
ALTER TABLE "warehouses"
  ADD COLUMN "bin_tracking_enabled" BOOLEAN NOT NULL DEFAULT false;

-- `aisle` and `shelf` existed; `rack` did not. The bin code is composed
-- from all three so one physical shelf cannot be entered two ways.
ALTER TABLE "warehouse_bins" ADD COLUMN "rack" TEXT;

-- Recorded while tracking is OFF. Deliberately on the receipt line and
-- not on stock_levels: with tracking off the stock genuinely is in
-- FLOOR, and writing a location into the stock record would claim
-- knowledge the system does not have.
ALTER TABLE "goods_receipt_lines" ADD COLUMN "noted_location" TEXT;

-- The backup taken before a collapse-to-FLOOR, which merges every bin's
-- contents into one and is not otherwise recoverable.
CREATE TABLE "bin_layout_snapshots" (
  "id"                UUID         NOT NULL DEFAULT uuidv7(),
  "warehouse_id"      UUID         NOT NULL,
  "reason"            TEXT         NOT NULL,
  "taken_by_staff_id" UUID         NOT NULL,
  "restored_at"       TIMESTAMPTZ,
  "line_count"        INTEGER      NOT NULL DEFAULT 0,
  "total_qty"         INTEGER      NOT NULL DEFAULT 0,
  "expires_at"        TIMESTAMPTZ  NOT NULL,
  "created_at"        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bin_layout_snapshots_pkey" PRIMARY KEY ("id")
);

-- Bare scalar UUIDs on purpose: a snapshot is a historical fact and must
-- survive a bin being deleted after the collapse that emptied it.
CREATE TABLE "bin_layout_snapshot_lines" (
  "id"          UUID        NOT NULL DEFAULT uuidv7(),
  "snapshot_id" UUID        NOT NULL,
  "seller_id"   UUID        NOT NULL,
  "variant_id"  UUID        NOT NULL,
  "bin_id"      UUID        NOT NULL,
  "bin_code"    TEXT        NOT NULL,
  "batch_id"    UUID        NOT NULL,
  "qty_on_hand" INTEGER     NOT NULL,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bin_layout_snapshot_lines_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bin_layout_snapshots_warehouse_id_created_at_idx"
  ON "bin_layout_snapshots" ("warehouse_id", "created_at");
CREATE INDEX "bin_layout_snapshots_expires_at_idx"
  ON "bin_layout_snapshots" ("expires_at");
CREATE INDEX "bin_layout_snapshot_lines_snapshot_id_idx"
  ON "bin_layout_snapshot_lines" ("snapshot_id");

ALTER TABLE "bin_layout_snapshots"
  ADD CONSTRAINT "bin_layout_snapshots_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bin_layout_snapshots"
  ADD CONSTRAINT "bin_layout_snapshots_taken_by_staff_id_fkey"
  FOREIGN KEY ("taken_by_staff_id") REFERENCES "staff_users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bin_layout_snapshot_lines"
  ADD CONSTRAINT "bin_layout_snapshot_lines_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "bin_layout_snapshots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
