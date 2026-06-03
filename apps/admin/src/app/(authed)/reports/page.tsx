import type { ReactElement } from 'react';
import { ReportsDashboard } from './_components/reports-dashboard';

/**
 * Phase 1B #3 — admin operational reports.
 *
 * Single summary view: orders, shipments, wallet.
 * Date-range filter; default = trailing 30 days (UTC).
 */
export default function ReportsPage(): ReactElement {
  return <ReportsDashboard />;
}
