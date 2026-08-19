import type { ReactElement } from 'react';
import { ProductsIndex } from './_components/products-index';

/**
 * Catalog — CP2.B pattern-setter (write-heavy: product list at top
 * level, variant-grain at the product detail, image upload via
 * drag-drop multi). The list page is URL-driven; click a product to
 * drill into its detail + variants.
 */
export default function CatalogPage(): ReactElement {
  return <ProductsIndex />;
}
