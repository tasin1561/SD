import type { ReactElement } from 'react';
import { InventoryView } from './_components/inventory-view';

/**
 * Read-only inventory view for the seller.
 *
 * Why read-only: the physical "receive" action is the warehouse
 * staff's responsibility (M5 admin/staff endpoint) — the seller
 * doesn't put stock on a shelf, they ship a parcel TO our Indian
 * warehouse and our team logs the receipt. The seller's role here
 * is observation: how much of each SKU is on hand / reserved /
 * available.
 */
export default function InventoryPage(): ReactElement {
  return <InventoryView />;
}
