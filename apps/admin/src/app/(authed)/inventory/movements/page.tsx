import type { ReactElement } from 'react';
import { MovementsIndex } from './_components/movements-index';

/**
 * `?warehouse=<id>&bin=<id>` opens the ledger already filtered to one bin
 * — the "Movements for this bin" link on a bin's page.
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string; bin?: string }>;
}): Promise<ReactElement> {
  const sp = await searchParams;
  return <MovementsIndex initialWarehouseId={sp.warehouse ?? ''} initialBinId={sp.bin ?? ''} />;
}
