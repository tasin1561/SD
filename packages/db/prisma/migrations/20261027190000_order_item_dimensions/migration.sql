-- Parcel dimensions, snapshotted onto the order line.
--
-- `shipments` has carried length/width/height since it was created, the
-- Delhivery AWB payload sends them when present, and Shiprocket's
-- requires them. Nothing ever WROTE them: `shipment.create` set
-- `total_weight_grams` and skipped the three dimension columns, so
-- `awb-generation.service.ts` fell through to its `?? 10` default and
-- every parcel we have ever manifested was declared 10x10x10 cm.
--
-- The catalogue has had the real figures the whole time (variant, with
-- the product default inherited behind it). They are snapshotted here
-- rather than read live at dispatch, for the same reason the unit weight
-- beside them is: ORD-6. A parcel is manifested days after the order is
-- placed, and the courier must be told the box as it was sold, not as the
-- catalogue has since been edited.
--
-- Nullable and additive: a line whose variant carries no dimensions is
-- exactly today's situation, and provisioning keeps the 10x10x10 floor
-- for it.
ALTER TABLE "order_items"
  ADD COLUMN "unit_length_cm" DECIMAL(6,2),
  ADD COLUMN "unit_width_cm"  DECIMAL(6,2),
  ADD COLUMN "unit_height_cm" DECIMAL(6,2);
