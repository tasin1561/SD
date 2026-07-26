-- R5b (revised-plan roadmap) — a PAUSE between the call cap and rejection.
--
-- Additive. Existing orders are untouched; only sellers whose
-- `inventory.early_reservation_ndr_action` is MANUAL_REVIEW ever reach the
-- new status, and nobody has that set by default.
--
-- `ALTER TYPE ... ADD VALUE` is safe inside a migration transaction on
-- PG12+ provided the value is not USED in the same migration — it is not.
ALTER TYPE "order_status" ADD VALUE 'awaiting_seller_decision';
