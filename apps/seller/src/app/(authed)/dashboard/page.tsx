import type { ReactElement } from 'react';
import { DashboardView } from './_components/dashboard-view';

/**
 * Dashboard — CP2.A.6 synthesis. The shell-level chrome already
 * shows the company name + email in the topbar; this page surfaces
 * recent orders + a navigation pivot into the pattern-setter
 * features. CP2.B will add a low-stock panel + a recent-dispatches
 * summary once catalog + inventory views ship.
 */
export default function DashboardPage(): ReactElement {
  return <DashboardView />;
}
