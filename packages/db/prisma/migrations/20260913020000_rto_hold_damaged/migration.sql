-- WMS-8d (2026-09-13): "Keep aside (damaged)".
--
-- A returned unit that is damaged but still the seller's: it comes back
-- into stock in the receiving warehouse's DAMAGED bin (never sellable —
-- BIN-2), instead of being written off (gone) or restocked (sellable).
--
-- Its own migration file on purpose: a value added by ALTER TYPE cannot
-- be used in the same transaction that adds it, and the next migration
-- creates a table typed on this enum.
ALTER TYPE "rto_disposition" ADD VALUE 'hold_damaged';
