-- Variants a seller has starred, so they come to the top of a picker.
--
-- Per SELLER, not per seller-user: the catalogue belongs to the company,
-- and two people packing the same orders want the same shortlist.
--
-- The UNIQUE is the idempotency. Starring twice upserts rather than
-- making a second row, so a double tap on a phone cannot leave a variant
-- favourited-twice and un-unstarrable.
CREATE TABLE "seller_favourite_variants" (
  "id"         UUID NOT NULL DEFAULT uuidv7(),
  "seller_id"  UUID NOT NULL,
  "variant_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "seller_favourite_variants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "seller_favourite_variants_seller_id_variant_id_key"
  ON "seller_favourite_variants"("seller_id", "variant_id");
CREATE INDEX "seller_favourite_variants_seller_id_idx"
  ON "seller_favourite_variants"("seller_id");
CREATE INDEX "seller_favourite_variants_variant_id_idx"
  ON "seller_favourite_variants"("variant_id");
ALTER TABLE "seller_favourite_variants" ADD CONSTRAINT "seller_favourite_variants_seller_id_fkey"
  FOREIGN KEY ("seller_id") REFERENCES "sellers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "seller_favourite_variants" ADD CONSTRAINT "seller_favourite_variants_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
