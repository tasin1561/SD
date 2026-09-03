-- Why a call is in the queue.
--
-- The agent screen used to infer this by looking for any EXECUTED recall
-- on the order, which found a request from a previous day that had
-- already been handled — telling the agent the seller had asked for a
-- call nobody asked for, while the real reason (a courier that could not
-- deliver) went unsaid.
CREATE TYPE "call_queue_reason" AS ENUM (
  'order_confirmation',
  'seller_asked',
  'delivery_failed'
);

-- Defaulted rather than required: every pre-existing row is a
-- confirmation call, which is what almost all of them were.
ALTER TABLE "call_queue_entries"
  ADD COLUMN "reason" "call_queue_reason" NOT NULL DEFAULT 'order_confirmation';
