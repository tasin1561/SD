-- The parcel's CURRENT NSL code.
--
-- Delhivery permits a RE-ATTEMPT only when the shipment's CURRENT NSL is
-- one of EOD-74/15/104/43/86/11/69/6. We had nowhere to keep that: the
-- code read `NSLCode` off each scan, where Delhivery does not put it —
-- their docs place it at the SHIPMENT level, a sibling of `Status`, next
-- to `Sortcode` which we already read. Every tracking_event ever written
-- carries a null NSL as a result, and the NDR panel refused every parcel
-- with "no current NSL code known for this shipment".
ALTER TABLE "shipments" ADD COLUMN "courier_nsl_code" TEXT;
