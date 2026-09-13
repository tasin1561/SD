-- The nightly Delhivery invoice check (COST-3's follow-up, 2026-09-12).
--
-- seedSystemSettings() is create-only on value columns and deploy runs
-- migrations, not the seed, so the rows are inserted here to exist on the
-- deployed database. ON CONFLICT DO NOTHING: a row the seed already made
-- (dev, CI) keeps whatever it holds.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_boolean", "value_int",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES
(
  uuidv7(),
  'courier.delhivery_invoice_check_enabled',
  'courier',
  'boolean',
  true,
  NULL,
  'Delhivery invoice check — run nightly',
  'Each night (04:10 IST, after the wallet sync) read the Delhivery ONE invoice list, every Domestic and Communication VAS invoice’s "Invoice Transaction list", and the Credit / Debit Notes, and compare them with what their wallet charged, from our stored ledger. Names a waybill billed differently from the net of everything their wallet charged and refunded on it, a file that does not add up to its invoice, a VAS invoice with no matching wallet debit, waybills charged and never invoiced, and credit notes that match no claim payout. Reads only; changes no cost.',
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  uuidv7(),
  'courier.delhivery_invoice_check_window_days',
  'courier',
  'int',
  NULL,
  120,
  'Delhivery invoice check — days of invoices to check',
  'Invoices dated within this many days are checked. Their list is read with its widest preset, "Last 90 days", so in practice ninety is as far back as it reaches; a larger number costs nothing. Every invoice on the list is used to tell a charged waybill that is billed from one that is not.',
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  uuidv7(),
  'courier.delhivery_invoice_dispute_days',
  'courier',
  'int',
  NULL,
  15,
  'Delhivery invoice check — days to dispute an invoice (assumed)',
  'How long after the invoice date a disagreeing invoice is raised as HIGH (somebody is notified) rather than MEDIUM (recorded for the pattern). Delhivery’s own dispute window is NOT known — fifteen is our assumption, mirroring Shiprocket’s. Change it once Delhivery says.',
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
