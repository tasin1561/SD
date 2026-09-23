'use client';

import type { ReactElement, ReactNode } from 'react';
import { Tabs } from '@skydrop/ui/app/tabs';
import '../../_components/benches.css';

export type RtoTab = 'door' | 'transit' | 'bench' | 'receive';

/**
 * The four faces of the returns bench.
 *
 * ── WHY THE COUNTS ARE ON THE TABS ───────────────────────────────────
 * Tabs hide things, and hiding a worklist is how a worklist stops being
 * worked. Without a number on the label, finding out whether there is
 * anything to do means clicking all four — so the counts are the whole
 * reason this is safe to tab at all. Zero renders no badge rather than a
 * grey "0": an empty tab should be quiet, and a row of zeroes trains
 * people to stop reading them.
 *
 * ── THE ORDER IS THE ORDER OF THE WORK ───────────────────────────────
 * At our door → still coming → on the bench → the station. A supervisor
 * reads left to right and that is the sequence a parcel actually moves
 * through, which is also why the station is last: it is where you land
 * from a row, rather than somewhere you start.
 *
 * The bar is the shared liquid-bead `Tabs` (a real tablist: roving
 * tabindex, arrow keys). It carries no panels — the station keeps its
 * own, because the Receive panel stays MOUNTED while hidden so an
 * inspection half-typed survives a look at another tab.
 */
export function RtoTabs({
  active,
  onChange,
  counts,
}: {
  readonly active: RtoTab;
  readonly onChange: (tab: RtoTab) => void;
  readonly counts: Readonly<Record<Exclude<RtoTab, 'receive'>, number>>;
}): ReactElement {
  const shown = (n: number): number | undefined => (n > 0 ? n : undefined);
  // Only "At our door" is urgent: these parcels are here, and every hour
  // is an hour a seller is being told their goods are still moving.
  const doorUrgent = counts.door > 0;

  return (
    <div className="wh-rto-tabs" data-door-urgent={doorUrgent ? '1' : undefined}>
      <Tabs
        label="RTO views"
        value={active}
        onChange={(id) => onChange(id as RtoTab)}
        items={[
          { id: 'door', label: 'At our door', count: shown(counts.door) },
          { id: 'transit', label: 'Still with the courier', count: shown(counts.transit) },
          { id: 'bench', label: 'On the bench', count: shown(counts.bench) },
          { id: 'receive', label: 'Receive & inspect' },
        ]}
      />
    </div>
  );
}

/** The panel a tab reveals, with its own one-line explanation — the
 *  subtitle that used to sit under each section heading. */
export function RtoTabPanel({
  subtitle,
  children,
}: {
  readonly subtitle: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div role="tabpanel" className="wh-rto-panel">
      <p className="wh-note">{subtitle}</p>
      {children}
    </div>
  );
}
