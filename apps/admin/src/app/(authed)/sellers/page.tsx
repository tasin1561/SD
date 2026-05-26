import type { ReactElement } from 'react';
import { SellersIndex } from './_components/sellers-index';

/**
 * Sellers route — the sellers + invitations management surface. The
 * client component handles the list / filters / actions; the
 * server-component shell just sets the page chrome so the route can
 * grow.
 */
export default function SellersPage(): ReactElement {
  return <SellersIndex />;
}
