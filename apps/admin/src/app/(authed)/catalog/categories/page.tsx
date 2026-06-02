import type { ReactElement } from 'react';
import { CategoriesIndex } from './_components/categories-index';

/**
 * Admin category management — global category tree.
 *
 * Categories are not seller-scoped; managing them is a global op.
 * Phase 1A RBAC is open to any authenticated staff (per backend
 * AdminCategoryController; tracked in phase-1a-debt for tightening).
 *
 * The page renders the FLAT list (depth/sortOrder ordered) so an
 * admin can scan parent→child relationships quickly. Each row has
 * inline edit / move / delete actions. Tree-rendering with
 * expand/collapse can layer on top later — for ~50 categories the
 * flat list is more usable than a deep tree.
 */
export default function CategoriesPage(): ReactElement {
  return <CategoriesIndex />;
}
