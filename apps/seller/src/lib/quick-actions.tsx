import type { SellerMe } from '@skydrop/api-client';
import type { MenuAction } from '@skydrop/ui/components';
import { PackagePlus, Boxes } from 'lucide-react';
import { can } from './page-access';

/**
 * What sits behind "Quick actions" in the top bar.
 *
 * Two entries; the shape is a list because more are coming. It
 * lives here rather than inline in the shell so the permission gating
 * is testable without mounting the whole chrome.
 *
 * Each entry is gated on the permission the SERVER enforces for that
 * action, not on the one that opens the page it lives under. For a new
 * order those differ — the /orders prefix resolves to `orders.view`,
 * while POST /seller/orders requires `orders.create` — and using the
 * looser one would put an action in the menu that always 403s.
 * Cosmetic either way (FE-2): the server remains the boundary, this
 * only decides whether offering the action is honest.
 */
export function quickActionsFor(
  identity: Pick<SellerMe, 'permissions'> | null,
): readonly MenuAction[] {
  const actions: MenuAction[] = [];

  if (can(identity, 'orders.create')) {
    actions.push({
      href: '/orders/new',
      label: 'New order',
      hint: 'Enter one order manually',
      icon: <PackagePlus size={15} />,
    });
  }

  // After the order, deliberately: the menu is ordered by how often a
  // seller reaches for it, and a catalogue is built once and added to
  // occasionally while orders come in every day.
  //
  // Gated on catalog.manage, the permission POST /seller/products
  // enforces — NOT the catalog.view that opens the page. Offering an
  // action that always 403s is worse than not offering it.
  if (can(identity, 'catalog.manage')) {
    actions.push({
      href: '/catalog/new',
      label: 'New product',
      hint: 'Add a product and its variants',
      // The nav's Products icon, so the menu entry and the page it opens
      // read as the same thing.
      icon: <Boxes size={15} />,
    });
  }

  return actions;
}
