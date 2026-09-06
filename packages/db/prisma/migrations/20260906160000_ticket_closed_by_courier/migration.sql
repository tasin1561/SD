-- Delhivery closing their ticket is not a resolution of ours: no money
-- moved, no goods came back, the seller accepted nothing and we rejected
-- nothing. Its own status, so none of the other four has to lie.
ALTER TYPE "ticket_status" ADD VALUE IF NOT EXISTS 'closed_by_courier';
