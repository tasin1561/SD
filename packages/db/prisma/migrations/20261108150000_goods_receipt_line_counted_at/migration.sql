-- goods_receipt_lines.counted_at: distinguishes "counted zero" from "nobody
-- has counted". received_qty is NOT NULL DEFAULT 0, so a line nobody touched
-- read as a real count of 0, and Complete on an untouched receipt banked it.
ALTER TABLE "goods_receipt_lines"
  ADD COLUMN IF NOT EXISTS "counted_at" TIMESTAMPTZ;

-- Backfill so history does not suddenly read as uncounted. A line is counted
-- if it carries any quantity, or if its receipt was completed by a count.
-- Deliberately left NULL: zero-quantity lines on a receipt still open (we
-- cannot know they were counted), and every line of a Bangladesh leg that
-- was forwarded WITHOUT a count (those are genuinely uncounted).
UPDATE "goods_receipt_lines" l
   SET "counted_at" = l."updated_at"
  FROM "goods_receipts" r
 WHERE r."id" = l."receipt_id"
   AND l."counted_at" IS NULL
   AND (
        l."received_qty" > 0
     OR l."damaged_qty" > 0
     OR (r."status" IN ('completed', 'discrepancy') AND r."forwarded_without_count" = false)
   );
