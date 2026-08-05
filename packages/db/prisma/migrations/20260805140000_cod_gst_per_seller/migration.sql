-- GST withheld from COD becomes a per-seller rate.
--
-- It was global, on the reasoning that a tax rate is set by law rather
-- than negotiated. True, but it drew the wrong conclusion: Indian GST is
-- SLABBED by what is being sold — apparel at 5% or 12%, electronics at
-- 18% — so one platform-wide rate is wrong for most sellers rather than
-- safely conservative. The override records which slab a seller trades
-- in; it is still not something a seller argues down.
--
-- Clamped 0–28 at write time (SET-1). Those are the slabs, and a wider
-- range would let a typo withhold a third of somebody's takings.
--
-- Needed as a migration because `seedSystemSettings()` is create-only on
-- these columns — changing the seed alone would never reach a database
-- that already has the row.
UPDATE "system_settings"
SET "seller_overridable"   = true,
    "override_min_decimal" = 0,
    "override_max_decimal" = 28,
    "description" = 'The customer pays a tax-INCLUSIVE price, so this is extracted from the COD (cod × r / (100 + r)), never added on top: ₹1,000 at 18% withholds ₹152.54, not ₹180. WE file it, so the withheld amount is a liability recorded in gst_withholdings — not margin. Per-seller override because GST is slabbed by what is being sold — apparel is 5% or 12%, electronics 18% — so one rate across every seller is wrong for most of them. It is still not NEGOTIABLE: the override records which slab a seller trades in, and the rate is snapshotted per order so changing it never restates a filed quarter.'
WHERE "key" = 'wallet.cod_gst_percent';
