/**
 * Admin categories endpoint types — mirror apps/api/.../catalog-category.
 * Categories are global (not seller-scoped); admin manages the entire
 * tree. Phase 1A: SUPER_ADMIN / CATEGORY_ADMIN / PRODUCT_ADMIN may
 * manage (the controller currently allows any authenticated staff —
 * RBAC scoping deferred per phase-1a-debt).
 */
import type { PackageType } from '@skydrop/db';

export interface CategoryView {
  readonly id: string;
  readonly parentId: string | null;
  readonly slug: string;
  readonly name: string;
  readonly fullPath: string;
  readonly depth: number;
  readonly sortOrder: number;
  readonly defaultPackageType: PackageType | null;
  readonly requiresFragile: boolean;
  readonly requiresColdChain: boolean;
  readonly defaultHsCode: string | null;
  readonly defaultGstRate: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CategoryTreeNode extends CategoryView {
  readonly children: ReadonlyArray<CategoryTreeNode>;
}

export interface CreateCategoryRequest {
  readonly name: string;
  readonly slug: string;
  readonly parentId?: string;
  readonly sortOrder?: number;
  readonly defaultPackageType?: PackageType;
  readonly requiresFragile?: boolean;
  readonly requiresColdChain?: boolean;
  readonly defaultHsCode?: string;
  readonly defaultGstRate?: number;
}

export interface UpdateCategoryRequest {
  readonly name?: string;
  readonly sortOrder?: number;
  readonly defaultPackageType?: PackageType | null;
  readonly requiresFragile?: boolean;
  readonly requiresColdChain?: boolean;
  readonly defaultHsCode?: string | null;
  readonly defaultGstRate?: number | null;
}

export interface MoveCategoryRequest {
  readonly newParentId: string | null;
}
