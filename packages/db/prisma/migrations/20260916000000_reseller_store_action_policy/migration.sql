-- What a reseller store may do about an order on its own (2026-09-16, owner).
--
-- The owner's rule: give the store the access, and let the SELLER choose
-- which parts go straight through and which come to them first. One row
-- per store, owned by the seller — the shape `reseller_store_auto_pause`
-- already uses for "a rule about one store only its seller may set".
--
-- Defaults are deliberate. `cancel` is DIRECT because stores already hold
-- `orders.cancel`: this table must not quietly take away something they
-- can do today. The other no-cost capabilities are DIRECT because that is
-- the instruction. `reattempt` and `send_back` start at ASK_SELLER — a
-- re-attempt sends a van and a send-back turns a moving parcel round, and
-- whatever this says, both still pass the CUR-10 operator gate.
--
-- Additive: no row is written here. A store with no row reads as the
-- defaults, so every existing store keeps working with nobody deciding
-- anything.

-- CreateEnum
CREATE TYPE "reseller_store_action_mode" AS ENUM ('off', 'ask_seller', 'direct');

-- CreateTable
CREATE TABLE "reseller_store_action_policy" (
    "store_id" UUID NOT NULL,
    "recall" "reseller_store_action_mode" NOT NULL DEFAULT 'direct',
    "address_fix" "reseller_store_action_mode" NOT NULL DEFAULT 'direct',
    "cancel" "reseller_store_action_mode" NOT NULL DEFAULT 'direct',
    "call_cap_decision" "reseller_store_action_mode" NOT NULL DEFAULT 'direct',
    "chase_skydrop" "reseller_store_action_mode" NOT NULL DEFAULT 'direct',
    "reattempt" "reseller_store_action_mode" NOT NULL DEFAULT 'ask_seller',
    "send_back" "reseller_store_action_mode" NOT NULL DEFAULT 'ask_seller',
    "updated_by_seller_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "reseller_store_action_policy_pkey" PRIMARY KEY ("store_id")
);

-- AddForeignKey
ALTER TABLE "reseller_store_action_policy" ADD CONSTRAINT "reseller_store_action_policy_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "seller_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A store's request lives in the SAME queue as a seller's: one table, so
-- the two cannot drift into different shapes. Who may decide it is the
-- store's policy above, never a second table.
-- AlterTable
ALTER TABLE "order_delivery_action_requests"
    ADD COLUMN "reseller_store_id" UUID,
    ADD COLUMN "decided_by_seller_user_id" UUID;

-- CreateIndex
CREATE INDEX "order_delivery_action_requests_reseller_store_id_status_idx" ON "order_delivery_action_requests"("reseller_store_id", "status");

-- AddForeignKey
ALTER TABLE "order_delivery_action_requests" ADD CONSTRAINT "order_delivery_action_requests_reseller_store_id_fkey" FOREIGN KEY ("reseller_store_id") REFERENCES "seller_stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Whether the SELLER must say yes before this runs, SNAPSHOTTED when the
-- store asked. Read live, a policy changed while a request was open would
-- retroactively decide a question that had already been put — or skip one
-- that had not.
ALTER TABLE "order_delivery_action_requests"
    ADD COLUMN "needs_seller_approval" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "seller_decided_at" TIMESTAMPTZ;

-- A call the STORE asked for. Its own reason, not the seller's: the agent
-- is told who wants the customer rung, and "the store asked" and "the
-- seller asked" are different things to say on a call.
--
-- Safe inside Prisma's migration transaction on PostgreSQL 12+ because
-- nothing here USES the new value; the first row carrying it is written
-- by a later request.
ALTER TYPE "call_queue_reason" ADD VALUE IF NOT EXISTS 'store_asked';
