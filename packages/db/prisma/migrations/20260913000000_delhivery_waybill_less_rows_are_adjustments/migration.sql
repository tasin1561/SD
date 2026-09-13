-- Delhivery wallet rows that name no waybill are ACCOUNT adjustments,
-- not parcel carriage (2026-09-12).
--
-- Carriage is always written against a waybill: on the production ledger
-- every one of 23,435 Delhivery carriage rows carries `wbn` in its
-- description, equal to its awb_number. Exactly 18 stored as 'parcel' do
-- not, all with a blank shipment status (blank is in the parser's parcel
-- vocabulary, which is how they got through):
--
--   12 CREDITS  {"notes":"Claim settled - CMS"}          ₹16,579.00
--      Delhivery paying out the VALUE of lost goods (e.g. ₹1,499 on
--      38061110487620). As carriage they net a parcel's courier cost
--      negative, and after the P&L cutover would reduce "courier charges
--      on no live Skydrop parcel" instead of sitting on "Courier account
--      adjustments".
--    6 DEBITS   one lump per "Communication VAS" invoice ₹41,705.92
--      (`serial_number` names the invoice, e.g. EPVASH26140201).
--
-- The parser now classifies such rows as ADJUSTMENT on import
-- (wallet-ledger-parser.ts `classify`); this moves the ones already held.
-- A re-import never rewrites a held row (insert-new-only, and the mutation
-- check compares amount, direction and waybill — not category), so the
-- move is not undone by the next nightly sync.
--
-- Delhivery rows ONLY. Shiprocket's passbook rows are classified by their
-- own rules (shiprocket-wallet-rows.ts) and their description has a
-- different shape entirely — it never carries `wbn`, and this would move
-- every Shiprocket parcel charge.
--
-- None of the 18 waybills is a Skydrop shipment, so no stamped parcel cost
-- (shipments.actual_courier_cost_inr / actual_rto_cost_inr) changes.
UPDATE "courier_wallet_transactions"
SET "category" = 'adjustment'
WHERE "category" = 'parcel'
  AND NOT (COALESCE("detail", '{}'::jsonb) ? 'wbn')
  AND "courier_account_id" IN (
    SELECT ca."id"
    FROM "courier_accounts" ca
    JOIN "couriers" c ON c."id" = ca."courier_id"
    WHERE c."code" = 'delhivery'
  );
