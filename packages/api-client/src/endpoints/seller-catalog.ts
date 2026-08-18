/**
 * Seller catalog surface (M4 seller-facing endpoints).
 *
 * The CP2.B "Catalog" pattern-setter uses:
 *   GET    /seller/products                            (list — pagination + filters)
 *   GET    /seller/products/:id                        (product detail)
 *   PATCH  /seller/products/:id                        (update product)
 *   POST   /seller/products/:id/archive                (archive/unarchive)
 *   GET    /seller/products/:productId/variants        (list variants under product)
 *   GET    /seller/products/:productId/variants/:variantId  (variant detail)
 *   PATCH  /seller/products/:productId/variants/:variantId  (update variant)
 *   POST   /seller/images/presign                      (S3 presigned URL request)
 *   POST   /seller/images                              (register after upload)
 *   GET    /seller/images                              (list)
 *   DELETE /seller/images/:imageId                     (soft-delete)
 *
 * Phase-1A scope keeps the catalog grain at PRODUCTS for the list
 * (backend serves /seller/products paginated); variant-grain UI lives
 * at the product detail level (variants are listed per-product via
 * /seller/products/:id/variants).
 */
import type { ProductStatus, VariantStatus } from '@skydrop/db';

export interface ListSellerProductsQuery {
  readonly status?: ProductStatus;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export interface SellerProductView {
  readonly id: string;
  readonly sellerId: string;
  readonly name: string;
  readonly description: string | null;
  readonly externalRef: string | null;
  readonly defaultWeightGrams: number | null;
  readonly defaultLengthCm: string | null;
  readonly defaultWidthCm: string | null;
  readonly defaultHeightCm: string | null;
  readonly defaultDeclaredValueInr: string | null;
  readonly status: ProductStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SellerProductListResponse {
  readonly items: readonly SellerProductView[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Creating a product. Mirrors CreateProductDto: `name` is the only
 * required field — everything else is a DEFAULT the variants inherit
 * when they do not state their own (the M4 inheritance chain:
 * variant → product.default* → system setting for GST).
 */
export interface CreateSellerProductRequest {
  readonly name: string;
  readonly description?: string;
  readonly externalRef?: string;
  readonly defaultWeightGrams?: number;
  readonly defaultLengthCm?: number;
  readonly defaultWidthCm?: number;
  readonly defaultHeightCm?: number;
  readonly defaultDeclaredValueInr?: number;
}

/**
 * Creating a variant. Mirrors CreateVariantDto: `skuCode` is the only
 * required field, and it is UNIQUE PER SELLER and immutable once set.
 */
export interface CreateSellerVariantRequest {
  readonly skuCode: string;
  readonly variantLabel?: string;
  readonly weightGrams?: number;
  readonly lengthCm?: number;
  readonly widthCm?: number;
  readonly heightCm?: number;
  readonly declaredValueInr?: number;
  readonly gstRate?: number;
  readonly barcode?: string;
  readonly attributes?: Record<string, unknown>;
}

export interface UpdateSellerProductRequest {
  readonly name?: string;
  readonly description?: string | null;
  readonly externalRef?: string | null;
  readonly defaultWeightGrams?: number | null;
  readonly defaultLengthCm?: number | null;
  readonly defaultWidthCm?: number | null;
  readonly defaultHeightCm?: number | null;
  readonly defaultDeclaredValueInr?: number | null;
}

export interface SellerVariantView {
  readonly id: string;
  /**
   * One thumbnail for the list, presigned per request. Set by the LIST
   * endpoint only — a detail read does not carry it, because that page
   * loads the full image set anyway.
   */
  readonly primaryImageUrl?: string | null;
  readonly productId: string;
  readonly sellerId: string;
  readonly skuCode: string;
  readonly attributes: Record<string, unknown> | null;
  readonly variantLabel: string | null;
  readonly weightGrams: number | null;
  readonly lengthCm: string | null;
  readonly widthCm: string | null;
  readonly heightCm: string | null;
  readonly declaredValueInr: string | null;
  readonly gstRate: string | null;
  readonly barcode: string | null;
  readonly status: VariantStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpdateSellerVariantRequest {
  readonly variantLabel?: string | null;
  readonly weightGrams?: number | null;
  readonly lengthCm?: number | null;
  readonly widthCm?: number | null;
  readonly heightCm?: number | null;
  readonly declaredValueInr?: number | null;
  readonly gstRate?: number | null;
  readonly barcode?: string | null;
  readonly attributes?: Record<string, unknown>;
}

/** Image presign request — the FE asks the API for an S3 presigned
 *  URL keyed to the seller's variant. */
/**
 * Presign body. `variantId` is a PATH segment, not a field — the API
 * runs `forbidNonWhitelisted`, so sending it in the body is a 400.
 */
export interface PresignVariantImageRequest {
  readonly mimeType: string;
}

export interface PresignVariantImageResponse {
  readonly uploadUrl: string;
  readonly spacesKey: string;
  readonly expiresInSeconds: number;
}

export interface RegisterVariantImageRequest {
  readonly spacesKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly altText?: string;
  readonly isPrimary?: boolean;
  readonly displayOrder?: number;
}

export interface SellerVariantImageView {
  readonly id: string;
  readonly variantId: string;
  readonly spacesKey: string;
  readonly thumbnailSpacesKey: string | null;
  readonly displayUrl: string;
  readonly thumbnailUrl: string | null;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly altText: string | null;
  readonly sortOrder: number;
  readonly createdAt: string;
}
