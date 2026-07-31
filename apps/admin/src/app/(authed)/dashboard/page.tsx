import type { ReactElement } from 'react';
import { DashboardView } from './_components/dashboard-view';

/**
 * The admin landing page. See `_components/dashboard-view` for what it
 * shows and why — this file is the route, the view is a client
 * component because every tile is a live query.
 */
export default function DashboardPage(): ReactElement {
  return <DashboardView />;
}
