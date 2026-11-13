-- In-app AI assistant, phase D: ticket proposals and the budget alert guard.
--
-- Two new tables and one new enum, purely additive: nothing existing is
-- altered, so it can be rolled out (and, if need be, left in place by a
-- rollback of the code) without a data step.
--
-- `assistant_ticket_proposals` is what the model's `propose_ticket` tool
-- writes. It is a proposal ONLY: the ticket is raised by the person
-- pressing a button, through the console's own ticket service. The owner
-- columns mirror `assistant_conversations`; ticket_id / order_id /
-- request_id are soft references (no FK), like the conversation's own
-- owner columns, so a proposal can never block a ticket or order wipe.
-- The single FK is to the conversation, ON DELETE RESTRICT.
--
-- `assistant_budget_alerts` is the dedupe for "admins were told the month
-- crossed 80% / 100% of the budget". UNIQUE (month, threshold): the first
-- INSERT owns the alert, every concurrent or later one hits the constraint
-- and sends nothing.

-- CreateEnum
CREATE TYPE "assistant_ticket_proposal_status" AS ENUM ('pending', 'confirmed', 'dismissed');

-- CreateTable
CREATE TABLE "assistant_ticket_proposals" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "conversation_id" UUID NOT NULL,
    "audience" "assistant_audience" NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "seller_id" UUID,
    "store_id" UUID,
    "impersonated_by_staff_id" UUID,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "order_id" UUID,
    "order_number" TEXT,
    "status" "assistant_ticket_proposal_status" NOT NULL DEFAULT 'pending',
    "ticket_id" UUID,
    "ticket_number" TEXT,
    "request_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ,

    CONSTRAINT "assistant_ticket_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_budget_alerts" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "month" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL,
    "spent_usd" DECIMAL(14,8) NOT NULL,
    "budget_usd" DECIMAL(14,8) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_budget_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_ticket_proposals_conversation_id_created_at_idx" ON "assistant_ticket_proposals"("conversation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_budget_alerts_month_threshold_key" ON "assistant_budget_alerts"("month", "threshold");

-- AddForeignKey
ALTER TABLE "assistant_ticket_proposals" ADD CONSTRAINT "assistant_ticket_proposals_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

