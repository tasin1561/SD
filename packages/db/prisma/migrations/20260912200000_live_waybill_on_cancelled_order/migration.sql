-- A cancelled or rejected order's shipment is VOIDED locally
-- (ShipmentProvisionService.voidForOrder), but a waybill booked at
-- confirmation (CUR-2b) stays LIVE with the courier until somebody cancels
-- it with them — and the courier credits the booking charge back only
-- then. Nothing recorded whether that had happened.

-- 1. The fact: when the courier ACCEPTED a cancellation of this waybill.
--    Stamped by CourierShipmentActionService.cancelWithCourier on success.
ALTER TABLE "shipments" ADD COLUMN "courier_cancelled_at" TIMESTAMPTZ;

-- 2. The issue kind the watchdog raises for a voided shipment whose
--    waybill has no such stamp.
ALTER TYPE "system_issue_kind" ADD VALUE IF NOT EXISTS 'live_waybill';

-- 3. How long a voided waybill may stay live before it is raised.
--    seedSystemSettings() is create-only on value columns, so a new
--    setting must be inserted here to exist in a deployed database.
INSERT INTO "system_settings" (
  "id", "key", "category", "value_type", "value_int",
  "display_name", "description",
  "is_editable_by_admin", "is_sensitive", "seller_overridable",
  "created_at", "updated_at"
)
VALUES (
  uuidv7(),
  'ops.cancelled_waybill_alert_hours',
  'ops',
  'int',
  2,
  'Cancelled order, waybill still live — hours before we flag it',
  'A waybill is booked (and charged) when an order is confirmed. If the order is then cancelled or rejected, its shipment is voided here but the waybill stays live with the courier until somebody cancels it with them — and the courier credits the charge back only then. After this many hours each such waybill is raised on the system issues board. The sweep never cancels anything itself; an operator does it from the order’s courier panel.',
  true,
  false,
  false,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
