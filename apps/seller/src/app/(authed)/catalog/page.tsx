import type { ReactElement } from 'react';
import { PageHeader, EmptyState } from '@skydrop/ui/components';

/**
 * Catalog — CP2.B pattern-setter (write-heavy: products list at
 * variant grain, variant detail edit, product edit, image upload
 * drag-drop multi). This is the seller's onboarding workflow start
 * — no products → no orders.
 */
export default function CatalogPage(): ReactElement {
  return (
    <>
      <PageHeader title="Catalog" subtitle="Products, variants, images." />
      <EmptyState
        title="Catalog coming in CP2.B"
        description="Write-heavy pattern-setter: variant-grain list, edit forms, image upload presign + register. Exercises the form/modal/upload primitives for every seller write to mirror."
      />
    </>
  );
}
