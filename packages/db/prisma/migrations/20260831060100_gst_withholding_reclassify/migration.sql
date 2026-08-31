-- Reclassify the rows already written under the wrong direction.
--
-- Postgres will not let a value added by ALTER TYPE be USED in the same
-- transaction that added it, which is why this is its own migration
-- rather than the tail of the previous one.
--
-- Matched against `gst_withholdings` rather than by amount or by the
-- note text: that table is the authoritative liability record (UNIQUE
-- per order), so a row is a GST line if and only if it is the wallet
-- entry whose order and amount the liability names. An amount-only
-- match could catch a genuine order charge that happened to equal the
-- tax.
UPDATE seller_wallet_entries e
SET direction = 'gst_withholding'
FROM gst_withholdings g
WHERE e.linked_order_id = g.order_id
  AND e.direction = 'order_charges'
  AND e.amount = g.gst_amount_inr;
