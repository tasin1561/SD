-- A flat fee is AGREED in a currency and CHARGED in rupees.
--
-- The delivery and RTO fees were rupee figures by construction: the
-- setting key ended in `_inr` and nothing recorded a currency, so a fee
-- negotiated in taka had to be re-typed as rupees and then drifted
-- every time the rate moved. Holding the currency BESIDE the amount is
-- what lets ৳200 stay ৳200: it is converted at the rate in force at the
-- moment the charge is taken, and the source amount, its currency and
-- the rate used are all recorded on the charge so the figure can be
-- explained months later.
--
-- The keys are RENAMED rather than kept, because `..._fee_inr` holding
-- a taka amount is a name that lies, and this schema has been bitten by
-- that before. The AMOUNTS do not move: 200 stays 200 and 30 stays 30 —
-- what changes is that they are now read as taka. At the rate on record
-- that is about ₹162.60 and ₹24.39, which is the owner's intent
-- (2026-09-20), not an accident of conversion.
--
-- Per-seller override rows are renamed with the key so nobody's
-- negotiated fee is lost. There are none on production today; the
-- statements are written for correctness, not because they will match.

-- AlterData: rename the amount keys
UPDATE "system_settings" SET "key" = 'pricing.flat_delivery_fee'  WHERE "key" = 'pricing.flat_delivery_fee_inr';
UPDATE "system_settings" SET "key" = 'pricing.flat_rto_fee'       WHERE "key" = 'pricing.flat_rto_fee_inr';
UPDATE "system_settings" SET "key" = 'pricing.customer_return_fee' WHERE "key" = 'pricing.customer_return_fee_inr';

UPDATE "seller_setting_overrides" SET "key" = 'pricing.flat_delivery_fee'   WHERE "key" = 'pricing.flat_delivery_fee_inr';
UPDATE "seller_setting_overrides" SET "key" = 'pricing.flat_rto_fee'        WHERE "key" = 'pricing.flat_rto_fee_inr';
UPDATE "seller_setting_overrides" SET "key" = 'pricing.customer_return_fee' WHERE "key" = 'pricing.customer_return_fee_inr';

-- The display names carried "(INR)" as a fact about the value. It is no
-- longer one.
UPDATE "system_settings" SET "display_name" = 'Delivery Fee (flat)'    WHERE "key" = 'pricing.flat_delivery_fee';
UPDATE "system_settings" SET "display_name" = 'RTO Return Fee (flat)'  WHERE "key" = 'pricing.flat_rto_fee';
UPDATE "system_settings" SET "display_name" = 'Customer Return Fee'    WHERE "key" = 'pricing.customer_return_fee';

-- CreateData: the currency each amount is read in.
--
-- seedSystemSettings() is create-only on value columns, so a seed edit
-- alone would never move a deployed row — the same reason the accrual
-- tier and the auto-pickup switches each needed a migration. These rows
-- do not exist yet, so the INSERT is what creates them; ON CONFLICT
-- keeps the migration re-runnable.
INSERT INTO "system_settings"
  ("key", "category", "value_type", "value_string", "display_name", "description", "seller_overridable", "is_editable_by_admin")
VALUES
  ('pricing.flat_delivery_fee_currency', 'pricing', 'string', 'BDT',
   'Delivery Fee — currency',
   'INR or BDT. Decides how pricing.flat_delivery_fee is read. A BDT fee is converted to rupees at the rate in force AT THE MOMENT THE CHARGE IS TAKEN, and the source amount, currency and rate are all recorded on the charge so the figure can be explained later. Seller-overridable alongside the amount.',
   true, true),
  ('pricing.flat_rto_fee_currency', 'pricing', 'string', 'BDT',
   'RTO Return Fee — currency',
   'INR or BDT. Decides how pricing.flat_rto_fee is read. Converted at the rate in force when the return is physically received, which is when the fee is charged. Seller-overridable alongside the amount.',
   true, true),
  ('pricing.customer_return_fee_currency', 'pricing', 'string', 'INR',
   'Customer Return Fee — currency',
   'INR or BDT. Decides how pricing.customer_return_fee is read. Converted at the rate in force when the customer return is charged. Seller-overridable alongside the amount.',
   true, true)
ON CONFLICT ("key") DO NOTHING;
