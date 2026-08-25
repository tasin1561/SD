-- Documents a courier PUSHES to us: proof of delivery, sorter weight
-- images, reverse-pickup QC photos.
--
-- Distinct from awb_labels, which is paperwork WE generate. This is
-- evidence THEY produce, and it is what settles a dispute — when a
-- customer says "I never received it" and the courier says delivered,
-- the EPOD decides who absorbs the loss.
--
-- Received rather than only fetched on demand: the document service can
-- pull these, but an EPOD chased six months later may simply be gone
-- from their side. Taking a copy when it exists is the only way to be
-- sure we still have it when the argument happens.

CREATE TYPE "courier_document_type" AS ENUM ('epod', 'sorter_image', 'qc_image');

CREATE TABLE "courier_documents" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "courier_code" TEXT NOT NULL,
  "doc_type" "courier_document_type" NOT NULL,
  "awb_number" TEXT NOT NULL,
  -- Nullable: a document can arrive for an AWB we cannot match. The row
  -- is kept anyway — an orphan is evidence we were sent something, and
  -- discarding it because it did not join is how evidence disappears.
  "shipment_id" UUID,
  "external_ref" TEXT,
  "spaces_key" TEXT,
  "spaces_bucket" TEXT,
  "mime_type" TEXT,
  "file_size_bytes" INTEGER,
  "store_error" TEXT,
  "webhook_id" UUID,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "courier_documents_pkey" PRIMARY KEY ("id")
);

-- One document of each kind per AWB. A courier re-sending the same EPOD
-- must not leave two rows and two files in Spaces; the second arrival
-- updates the first.
CREATE UNIQUE INDEX "courier_documents_courier_code_awb_number_doc_type_key"
  ON "courier_documents"("courier_code", "awb_number", "doc_type");

CREATE INDEX "courier_documents_shipment_id_idx" ON "courier_documents"("shipment_id");
CREATE INDEX "courier_documents_received_at_idx" ON "courier_documents"("received_at");

ALTER TABLE "courier_documents"
  ADD CONSTRAINT "courier_documents_shipment_id_fkey"
  FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "courier_documents"
  ADD CONSTRAINT "courier_documents_webhook_id_fkey"
  FOREIGN KEY ("webhook_id") REFERENCES "courier_webhooks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
