-- Phase 1B — GST-compliant tax invoices (one per delivered order).
--
-- The PDF is rendered post-commit on DELIVERED by the
-- OrderDeliveredInvoiceListener; the row carries:
--   - the unique sequential invoice number (SD/INV/<fy>/<6-digit>)
--   - an immutable payload_snapshot (JSONB) used to render the PDF
--     so a regeneration produces the same content
--   - the Spaces storage key + URL of the rendered PDF.
--
-- Numbering is drawn from a per-FY Postgres sequence under an
-- advisory lock (mirroring OrderNumberingService).

CREATE TABLE "invoices" (
  "id"                UUID NOT NULL DEFAULT uuidv7(),
  "order_id"          UUID NOT NULL,
  "seller_id"         UUID NOT NULL,
  "invoice_number"    TEXT NOT NULL,
  "invoice_date"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fiscal_year"       TEXT NOT NULL,
  "subtotal_inr"      DECIMAL(14, 2) NOT NULL,
  "gst_inr"           DECIMAL(14, 2) NOT NULL,
  "total_inr"         DECIMAL(14, 2) NOT NULL,
  "payload_snapshot"  JSONB NOT NULL,
  "pdf_storage_key"   TEXT NOT NULL,
  "pdf_url"           TEXT,
  "pdf_mime_type"     TEXT NOT NULL DEFAULT 'application/pdf',
  "pdf_size_bytes"    INTEGER,
  "status"            TEXT NOT NULL DEFAULT 'ISSUED',
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMPTZ NOT NULL,

  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_order_id_key" ON "invoices"("order_id");
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE INDEX "invoices_seller_id_invoice_date_idx" ON "invoices"("seller_id", "invoice_date");
CREATE INDEX "invoices_fiscal_year_invoice_number_idx" ON "invoices"("fiscal_year", "invoice_number");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_seller_id_fkey"
    FOREIGN KEY ("seller_id") REFERENCES "sellers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Per-FY Postgres sequences are created lazily by InvoiceNumberingService
-- under a transaction-scoped advisory lock (mirrors ORD-8). No table
-- needed — `CREATE SEQUENCE IF NOT EXISTS invoice_number_seq_<fy>`.
