import type { ReactElement } from 'react';
import { redirect } from 'next/navigation';

/**
 * /inventory has no landing of its own — the four screens under it are
 * different jobs, and adjustments is the only one that is a QUEUE
 * someone is expected to clear. Sending people there beats a hub page
 * that exists only to be clicked through.
 */
export default function InventoryPage(): ReactElement {
  redirect('/inventory/adjustments');
}
