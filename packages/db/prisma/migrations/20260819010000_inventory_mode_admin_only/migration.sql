-- Unit tracking is an ADMIN decision.
--
-- `inventory.default_inventory_mode` decides whether the warehouse floor
-- demands a scanned serial per physical unit at pick, pack and RTO. That
-- is our operating procedure, not a seller preference — a seller flipping
-- their catalogue to STRICT changes what our staff must do with every
-- parcel of theirs, and gets picks refused for SKUs nobody serialised.
--
-- The seed flips `seller_overridable` to false, which stops NEW overrides:
-- SettingsResolverService refuses to write a key that is not overridable.
-- It does not remove overrides already stored, and a stored one still
-- resolves — so any existing row is deleted here. There were none in
-- production when this ran; the statement exists so the two databases
-- cannot disagree, and so a dev machine that had one does not keep it.
DELETE FROM "seller_setting_overrides"
WHERE "key" = 'inventory.default_inventory_mode';
