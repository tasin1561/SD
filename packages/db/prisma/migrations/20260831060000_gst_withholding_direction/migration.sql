-- GST withheld from a COD collection gets its own direction.
--
-- It had been written as `order_charges` with an explanatory note. WAL-4
-- says the withheld amount is a LIABILITY we file rather than revenue,
-- and warns that treating it otherwise makes it "read as revenue and be
-- spent before the return is due". A note cannot be grouped by, so
-- summing ORDER_CHARGES for a period silently included tax we merely
-- hold for the government — and the seller's ledger labelled a tax line
-- "Order charges".
ALTER TYPE "wallet_entry_direction" ADD VALUE IF NOT EXISTS 'gst_withholding';
