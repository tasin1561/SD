-- CSV rows that could not become orders on their own.
--
-- They used to go into a downloadable error report, which is a dead end:
-- the seller could see WHAT was wrong and had nowhere to fix it. The only
-- route back was editing the spreadsheet and re-uploading the whole file,
-- which re-ran every row that had already imported.
--
-- Clean rows still import exactly as before. This is the remainder, and
-- it is a queue rather than a report.
CREATE TYPE "staged_row_status" AS ENUM (
  'needs_input',
  'duplicate_suspected',
  'imported',
  'discarded'
);

CREATE TABLE "staged_order_rows" (
  "id"                UUID                NOT NULL DEFAULT uuidv7(),
  "upload_id"         UUID                NOT NULL,
  "seller_id"         UUID                NOT NULL,
  -- 1-based line in the seller's own file, header included, so "row 47"
  -- means row 47 in their spreadsheet.
  "row_number"        INTEGER             NOT NULL,
  -- The mapped values, edited in place. JSON rather than columns because
  -- this is a half-formed order — giving it the orders table's NOT NULL
  -- constraints is precisely why it could not be stored as one.
  "data"              JSONB               NOT NULL,
  "status"            "staged_row_status" NOT NULL DEFAULT 'needs_input',
  "problems"          JSONB               NOT NULL,
  "duplicate_of"      JSONB,
  "resolved_order_id" UUID,
  "resolved_at"       TIMESTAMPTZ,
  "created_at"        TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staged_order_rows_pkey" PRIMARY KEY ("id")
);

-- One staged row per line per upload: re-processing the same file must
-- update a row, never accumulate duplicates of it.
CREATE UNIQUE INDEX "staged_order_rows_upload_id_row_number_key"
  ON "staged_order_rows" ("upload_id", "row_number");
CREATE INDEX "staged_order_rows_seller_id_status_idx"
  ON "staged_order_rows" ("seller_id", "status");

ALTER TABLE "staged_order_rows"
  ADD CONSTRAINT "staged_order_rows_upload_id_fkey"
  FOREIGN KEY ("upload_id") REFERENCES "bulk_order_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staged_order_rows"
  ADD CONSTRAINT "staged_order_rows_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
