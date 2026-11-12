-- In-app AI assistant: image + PDF attachments.
--
-- One table and one enum, purely additive: nothing existing is altered.
-- `assistant_attachments` holds the metadata of a file the assistant
-- accepted; the bytes themselves (the REBUILT copy, never the upload) live
-- in the private bucket at `storage_key`.
--
-- Owner columns mirror `assistant_conversations` and carry no FK to
-- people, for the same reason that table has none. The two FKs are to
-- the conversation and to the message that carries the file, both
-- ON DELETE RESTRICT (nothing deletes either). `message_id` is NULL until
-- the question is sent; it is set once, by a guarded UPDATE, and the row
-- is never changed again.

-- CreateEnum
CREATE TYPE "assistant_attachment_kind" AS ENUM ('image', 'pdf');

-- CreateTable
CREATE TABLE "assistant_attachments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "audience" "assistant_audience" NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "seller_id" UUID,
    "store_id" UUID,
    "impersonated_by_staff_id" UUID,
    "kind" "assistant_attachment_kind" NOT NULL,
    "media_type" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "pages" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assistant_attachments_conversation_id_created_at_idx" ON "assistant_attachments"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_attachments_message_id_idx" ON "assistant_attachments"("message_id");

-- AddForeignKey
ALTER TABLE "assistant_attachments" ADD CONSTRAINT "assistant_attachments_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_attachments" ADD CONSTRAINT "assistant_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "assistant_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

