-- Returning the delivery fee when an order is cancelled before it ships.
-- Its own direction rather than ADJUSTMENT_CREDIT: nothing went wrong,
-- so it must not be counted among our ledger corrections.
ALTER TYPE "wallet_entry_direction" ADD VALUE IF NOT EXISTS 'order_charges_refund';
