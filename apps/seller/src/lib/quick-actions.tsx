import type { SellerMe } from '@skydrop/api-client';
import type { MenuAction } from '@skydrop/ui/components';
import { PackagePlus } from 'lucide-react';
import { can } from './page-access';

/**
 * What sits behind "Quick actions" in the top bar.
 *
 * One entry today; the shape is a list because more are coming. It
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

  return actions;
}
