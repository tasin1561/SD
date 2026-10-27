import type { SellerMe } from '@skydrop/api-client';
import type { MenuAction } from '@skydrop/ui/components';
import { PackagePlus, Boxes } from 'lucide-react';
import { can } from './page-access';
import { makeTranslator, type Translate } from '@skydrop/ui/app/i18n';
import { CATALOGS, type MessageKey } from '@/i18n/catalog';

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
  translate?: Translate<MessageKey>,
): readonly MenuAction[] {
  // No translator: the English catalogue, so a caller that does not care
  // about the UI language (and the unit spec) sees the words as before.
  const t: Translate<MessageKey> =
    translate ?? makeTranslator<MessageKey>(CATALOGS.en, CATALOGS.en);
  const actions: MenuAction[] = [];

  if (can(identity, 'orders.create')) {
    actions.push({
      href: '/orders/new',
      label: t('quickActions.newOrder'),
      hint: t('quickActions.enterOneOrderManually'),
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
      href: '/products/new',
      label: t('quickActions.newProduct'),
      hint: t('quickActions.addAProductAndItsVariants'),
      // The nav's Products icon, so the menu entry and the page it opens
      // read as the same thing.
      icon: <Boxes size={15} />,
    });
  }

  return actions;
}
