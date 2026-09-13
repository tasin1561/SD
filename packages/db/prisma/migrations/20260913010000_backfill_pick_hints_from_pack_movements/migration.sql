-- Backfill the WMS-9 pick hint on batch-picked parcels (2026-09-13).
--
-- `shipment_items.picked_bin_id / picked_batch_id` was written only by the
-- retired per-parcel pick station (`PickExecutionService.recordItem`). The
-- everyday print-first batch pick (`PickBatchService.markPicked`) never
-- wrote it, so every batch-picked parcel that came back had no hint, and
-- RTO finalize refused every RESTOCK line on it
-- (`RTO_RESTOCK_MISSING_CONTEXT`). Finalize now reads where the stock left
-- from the PACK_CONFIRM movements directly, and markPicked stamps the hint
-- going forward; this fills in the lines already out there, for the other
-- readers of the hint (return putaway's suggested shelf, the freight
-- attribution walk).
--
-- Source: the order's NET pack movements for the SAME order item —
-- PACK_CONFIRM (Model C) or DISPATCH (the pre-2026-09-03 history), minus
-- any a PACK_REVERSED names in `metadata.reversesMovementId` — grouped by
-- (bin, batch). Filled ONLY when that is exactly one (bin, batch) with a
-- positive quantity; a line that left from two shelves, or never left at
-- all, is left NULL and finalize handles it from the movements.
--
-- Read-only on stock: `stock_movements` and `stock_levels` are not
-- touched (MUST NOT #3). Only lines with BOTH columns NULL are written, so
-- a hint the picker recorded at the station is never overwritten.
--
-- Expected on production (13 Sep 2026): the 6 lines on real packed,
-- batch-picked parcels with NULL hints (e.g. SD-2026-26-000009,
-- QA-SKU-001). Seeded parcels with no movements (SH-TEST-523902) stay NULL.

WITH left_stock AS (
  SELECT m.order_id,
         m.order_item_id,
         m.bin_id,
         m.batch_id,
         SUM(-m.qty_change) AS qty
  FROM stock_movements m
  WHERE m.type IN ('pack_confirm', 'dispatch')
    AND m.order_id IS NOT NULL
    AND m.order_item_id IS NOT NULL
    AND m.bin_id IS NOT NULL
    AND m.batch_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM stock_movements r
      WHERE r.type = 'pack_reversed'
        AND r.order_id = m.order_id
        AND r.metadata ->> 'reversesMovementId' = m.id::text
    )
  GROUP BY m.order_id, m.order_item_id, m.bin_id, m.batch_id
  HAVING SUM(-m.qty_change) > 0
),
single_source AS (
  SELECT order_id,
         order_item_id,
         MIN(bin_id::text)::uuid   AS bin_id,
         MIN(batch_id::text)::uuid AS batch_id
  FROM left_stock
  GROUP BY order_id, order_item_id
  HAVING COUNT(*) = 1
)
UPDATE shipment_items si
SET picked_bin_id   = s.bin_id,
    picked_batch_id = s.batch_id
FROM order_items oi
JOIN single_source s
  ON s.order_item_id = oi.id
 AND s.order_id = oi.order_id
WHERE si.order_item_id = oi.id
  AND si.picked_bin_id IS NULL
  AND si.picked_batch_id IS NULL;
