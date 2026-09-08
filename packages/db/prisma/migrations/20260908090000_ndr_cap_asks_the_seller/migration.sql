-- At the call cap, ask the seller instead of dropping the order.
--
-- Under AUTO_RELEASE an order nobody could reach went straight to the
-- REJECTED_NDR terminal. The seller — the one person who knows whether
-- that customer is worth another ring — was never asked, and found out
-- afterwards if at all. MANUAL_REVIEW pauses it in
-- AWAITING_SELLER_DECISION and puts the decision in front of them.
--
-- It costs no stock: at-placement booking is off by default, so there
-- is no hold to keep. And it delays a rejection rather than preventing
-- one — an unanswered pause still expires on
-- `inventory.early_reservation_ttl_hours` and lands on the same
-- terminal it would have reached immediately.
--
-- A migration and not just a seed edit: `seedSystemSettings()` is
-- create-only on the value columns, so changing the default alone would
-- leave every deployed environment on AUTO_RELEASE. A seller who has
-- set their own override is left alone — that is their choice, not the
-- default being carried forward.
UPDATE system_settings
SET value_string = 'MANUAL_REVIEW',
    updated_at = NOW()
WHERE key = 'inventory.early_reservation_ndr_action'
  AND value_string = 'AUTO_RELEASE';
