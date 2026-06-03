import type { ReactElement } from 'react';
import { RemittancesIndex } from './_components/remittances-index';

/**
 * Phase 1B M23 — admin remittances (UI from #1 audit batch).
 *
 * List of all recorded remittances + Record button that opens the
 * remittance form modal. Linked from the sellers detail page too
 * (where the form is pre-filled with the seller's id).
 */
export default function RemittancesPage(): ReactElement {
  return <RemittancesIndex />;
}
