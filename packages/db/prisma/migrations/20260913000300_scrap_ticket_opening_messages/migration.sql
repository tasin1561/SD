-- A scrap/damage ticket we opened with nothing to say gets its opening message.
--
-- ONE-OFF. The RTO inspection opened SCRAP_DAMAGE tickets with the
-- inspector's notes as the only description, so a ticket inspected without
-- notes showed the seller "Nothing said yet." (production: exactly one, the
-- 13 Sep 2026 ticket on SD-TEST-524086). New tickets carry a message built
-- by scrapTicketOpeningMessage() in
-- apps/api/src/modules/warehouse-rto/services/rto-scrap-ticket-message.ts;
-- this restates that wording in SQL for the tickets opened before it. If
-- the function's wording changes later, this migration is NOT expected to
-- follow — it has already run.
--
-- Only EMPTY descriptions are filled; a non-empty one is never overwritten.
-- ticket_events is APPEND-ONLY (TKT-1) and is not touched: the description
-- lives on the ticket, which is what both conversations render first.
--
-- The facts are read as they stand now (the current inspection of the
-- line), because that is what the ticket is about today. The warehouse is
-- the receiving one, else the origin — a NULL rto_received_warehouse_id
-- means received at the origin (R6). Runs after 20260913000200, so every
-- ticket already has its number.

UPDATE "tickets" t
SET "description" = m.message
FROM (
  SELECT
    tk.id,
    concat_ws(
      E'\n\n',
      'Ticket ' || tk.ticket_number || ' — we opened this for you after inspecting a returned parcel.',
      concat_ws(
        E'\n',
        si.product_name || ' (' || si.sku_code || '), quantity ' || si.quantity || ': ' ||
          CASE si.rto_condition
            WHEN 'damaged' THEN 'arrived damaged'
            WHEN 'missing' THEN 'was missing from the returned parcel'
            ELSE 'is in good condition'
          END || '.',
        NULLIF(
          concat_ws(
            ' · ',
            'Order ' || o.order_number,
            'parcel ' || s.shipment_number,
            'waybill ' || s.awb_number
          ),
          ''
        ),
        CASE
          WHEN s.rto_received_at IS NULL THEN NULL
          ELSE 'Received back on ' ||
            to_char(s.rto_received_at AT TIME ZONE COALESCE(w.timezone, 'Asia/Kolkata'), 'FMDD Mon YYYY') ||
            COALESCE(' at ' || w.code || ' (' || w.name || ')', '') || '.'
        END,
        CASE si.rto_disposition
          WHEN 'restock' THEN 'What we are doing with it: putting it back into your sellable stock.'
          WHEN 'write_off' THEN 'What we are doing with it: writing it off — it will not go back into your sellable stock.'
          WHEN 'inspect_later' THEN 'What we are doing with it: holding it aside for a closer look — it stays out of your sellable stock until we decide.'
          ELSE NULL
        END,
        CASE
          WHEN NULLIF(btrim(si.rto_inspection_notes, E' \t\r\n'), '') IS NULL THEN NULL
          ELSE 'Inspector''s note: "' || btrim(si.rto_inspection_notes, E' \t\r\n') || '"'
        END
      ),
      'What happens next: ' ||
        CASE si.rto_condition
          WHEN 'missing' THEN 'we look into what happened to it and reply here'
          WHEN 'damaged' THEN 'we review the damage and reply here'
          ELSE 'we review this and reply here'
        END ||
        '. If a refund is due, it is credited to your wallet and shown on this ticket. ' ||
        'If you have anything that helps — how the product is normally packaged, or a photo of it new — reply below.'
    ) AS message
  FROM "tickets" tk
  JOIN "shipment_items" si ON si.id = tk.shipment_item_id
  JOIN "shipments" s ON s.id = si.shipment_id
  LEFT JOIN "orders" o ON o.id = tk.order_id
  LEFT JOIN "warehouses" w ON w.id = COALESCE(s.rto_received_warehouse_id, s.origin_warehouse_id)
  WHERE tk.ticket_type = 'scrap_damage'
    AND (tk.description IS NULL OR btrim(tk.description, E' \t\r\n') = '')
) m
WHERE t.id = m.id;
