-- Two freight numbers existed and nothing joined them.
--
-- `inbound_freight_charges.our_cost_inr` is what the forwarder billed
-- US, and it is the cost side of the P&L's BD→India line. A payment to
-- that forwarder was ALSO recorded as an `expense` bank entry, which
-- feeds operating expenses. Enter both and the same rupees are
-- subtracted twice — once from gross margin, once from net — and the
-- P&L's own coverage note ("Add it on the freight bill") was telling
-- people to do exactly that.
--
-- The link is what lets the report tell an ATTRIBUTED cost from a
-- general one. An unlinked forwarder payment keeps counting as an
-- operating expense, which is right: it belongs to no consignment.
--
-- RESTRICT rather than SET NULL. Nulling the link would silently return
-- the entry to operating expenses and re-create the double count with
-- nothing anywhere to say it happened.

ALTER TABLE "bank_entries"
  ADD COLUMN "inbound_freight_charge_id" UUID;

ALTER TABLE "bank_entries"
  ADD CONSTRAINT "bank_entries_inbound_freight_charge_id_fkey"
    FOREIGN KEY ("inbound_freight_charge_id")
    REFERENCES "inbound_freight_charges"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "bank_entries_inbound_freight_charge_id_idx"
  ON "bank_entries" ("inbound_freight_charge_id");
