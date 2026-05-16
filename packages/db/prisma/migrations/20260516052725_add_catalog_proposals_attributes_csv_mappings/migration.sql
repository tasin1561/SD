-- CreateEnum
CREATE TYPE "category_proposal_status" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "attribute_value_type" AS ENUM ('string', 'number', 'boolean', 'enum');

-- CreateEnum
CREATE TYPE "csv_import_type" AS ENUM ('product_variant');

-- CreateTable
CREATE TABLE "category_proposals" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "proposed_name" TEXT NOT NULL,
    "proposed_parent_id" UUID,
    "proposed_slug" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "category_proposal_status" NOT NULL DEFAULT 'pending',
    "reviewed_by_staff_id" UUID,
    "reviewed_at" TIMESTAMPTZ,
    "decision_note" TEXT,
    "resulting_category_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "category_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attribute_definitions" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "category_id" UUID NOT NULL,
    "attribute_key" TEXT NOT NULL,
    "display_label" TEXT NOT NULL,
    "value_type" "attribute_value_type" NOT NULL,
    "allowed_values" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "category_attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_csv_mappings" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "import_type" "csv_import_type" NOT NULL,
    "column_map" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "last_used_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "seller_csv_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bulk_product_uploads" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "seller_id" UUID NOT NULL,
    "mapping_id" UUID,
    "file_name" TEXT NOT NULL,
    "spaces_key" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "row_count" INTEGER,
    "status" "bulk_upload_status" NOT NULL DEFAULT 'pending',
    "error_report_key" TEXT,
    "products_created" INTEGER NOT NULL DEFAULT 0,
    "products_updated" INTEGER NOT NULL DEFAULT 0,
    "variants_created" INTEGER NOT NULL DEFAULT 0,
    "variants_updated" INTEGER NOT NULL DEFAULT 0,
    "rows_failed" INTEGER NOT NULL DEFAULT 0,
    "rows_skipped" INTEGER NOT NULL DEFAULT 0,
    "job_id" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "uploaded_by_seller_id" UUID,
    "uploaded_by_staff_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bulk_product_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_proposals_seller_id_status_idx" ON "category_proposals"("seller_id", "status");

-- CreateIndex
CREATE INDEX "category_proposals_status_idx" ON "category_proposals"("status");

-- CreateIndex
CREATE INDEX "category_proposals_proposed_parent_id_idx" ON "category_proposals"("proposed_parent_id");

-- CreateIndex
CREATE INDEX "category_proposals_deleted_at_idx" ON "category_proposals"("deleted_at");

-- CreateIndex
CREATE INDEX "category_attribute_definitions_category_id_idx" ON "category_attribute_definitions"("category_id");

-- CreateIndex
CREATE INDEX "category_attribute_definitions_deleted_at_idx" ON "category_attribute_definitions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "category_attribute_definitions_category_id_attribute_key_key" ON "category_attribute_definitions"("category_id", "attribute_key");

-- CreateIndex
CREATE INDEX "seller_csv_mappings_seller_id_import_type_idx" ON "seller_csv_mappings"("seller_id", "import_type");

-- CreateIndex
CREATE INDEX "seller_csv_mappings_seller_id_is_default_idx" ON "seller_csv_mappings"("seller_id", "is_default");

-- CreateIndex
CREATE INDEX "seller_csv_mappings_deleted_at_idx" ON "seller_csv_mappings"("deleted_at");

-- CreateIndex
CREATE INDEX "bulk_product_uploads_seller_id_idx" ON "bulk_product_uploads"("seller_id");

-- CreateIndex
CREATE INDEX "bulk_product_uploads_status_idx" ON "bulk_product_uploads"("status");

-- CreateIndex
CREATE INDEX "bulk_product_uploads_created_at_idx" ON "bulk_product_uploads"("created_at");

-- AddForeignKey
ALTER TABLE "category_proposals" ADD CONSTRAINT "category_proposals_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_proposals" ADD CONSTRAINT "category_proposals_resulting_category_id_fkey" FOREIGN KEY ("resulting_category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attribute_definitions" ADD CONSTRAINT "category_attribute_definitions_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_csv_mappings" ADD CONSTRAINT "seller_csv_mappings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_product_uploads" ADD CONSTRAINT "bulk_product_uploads_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
