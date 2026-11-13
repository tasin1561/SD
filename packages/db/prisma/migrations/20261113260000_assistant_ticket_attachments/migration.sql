-- In-app AI assistant, Batch A: photos that went with a ticket.
--
-- One new table, purely additive: nothing existing is altered, so it can be
-- rolled out (and left in place by a rollback of the code) without a data step.
--
-- `assistant_ticket_attachments` links a ticket to the assistant attachments
-- (photos / PDFs) the person had already sent in the conversation that raised
-- it. `ticket_id` is a soft reference (no FK), like `assistant_ticket_proposals`;
-- the FK to the attachment is ON DELETE RESTRICT. UNIQUE (ticket_id,
-- attachment_id) makes a replayed confirm link nothing twice.

-- CreateTable
CREATE TABLE "assistant_ticket_attachments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "ticket_id" UUID NOT NULL,
    "attachment_id" UUID NOT NULL,
    "proposal_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_ticket_attachments_ticket_id_attachment_id_key" ON "assistant_ticket_attachments"("ticket_id", "attachment_id");

-- CreateIndex
CREATE INDEX "assistant_ticket_attachments_ticket_id_idx" ON "assistant_ticket_attachments"("ticket_id");

-- CreateIndex
CREATE INDEX "assistant_ticket_attachments_attachment_id_idx" ON "assistant_ticket_attachments"("attachment_id");

-- AddForeignKey
ALTER TABLE "assistant_ticket_attachments" ADD CONSTRAINT "assistant_ticket_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "assistant_attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
