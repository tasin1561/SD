-- How many times a document has been produced for a parcel or a batch.
--
-- Counted at GENERATION rather than at the operator's confirmation: a
-- second sheet is physically in the building whether or not anybody
-- confirmed it, and the question these answer — "could there be two of
-- these labels out there?" — is asked after a box reaches the wrong
-- customer, when the confirmation is not the part that matters.
--
-- Existing rows start at 0 rather than 1. Backfilling a 1 would be a
-- guess dressed as a record: nothing counted these prints at the time,
-- and a column that says "printed once" about a parcel nobody counted is
-- worse than one that says "not counted".
ALTER TABLE "shipments" ADD COLUMN "label_print_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pick_batches" ADD COLUMN "print_count" INTEGER NOT NULL DEFAULT 0;
