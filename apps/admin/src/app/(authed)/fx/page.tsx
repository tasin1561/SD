import type { ReactElement } from 'react';
import { FxRatesIndex } from './_components/fx-rates-index';

/**
 * Phase 1B — admin FX rates + historical timeseries.
 *
 * List of current rates per (from, to) pair, Override button per
 * row that opens an edit modal, and a Timeline drawer showing the
 * append-only history for the selected pair.
 */
export default function FxPage(): ReactElement {
  return <FxRatesIndex />;
}
