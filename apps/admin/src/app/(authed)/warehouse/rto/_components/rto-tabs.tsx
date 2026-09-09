'use client';

import type { ReactElement, ReactNode } from 'react';

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
  const tabs: ReadonlyArray<{ key: RtoTab; label: string; count?: number; urgent?: boolean }> = [
    // Only this one is urgent: these parcels are here, and every hour
    // is an hour a seller is being told their goods are still moving.
    { key: 'door', label: 'At our door', count: counts.door, urgent: counts.door > 0 },
    { key: 'transit', label: 'Still with the courier', count: counts.transit },
    { key: 'bench', label: 'On the bench', count: counts.bench },
    { key: 'receive', label: 'Receive & inspect' },
  ];

  return (
    <div role="tablist" aria-label="RTO views" className="border-border mb-4 flex gap-1 border-b">
      {tabs.map((t) => {
        const isActive = t.key === active;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={
              isActive
                ? 'border-accent text-text-body -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium'
                : 'text-text-muted hover:text-text-body -mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-2 text-sm'
            }
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span
                className={
                  t.urgent === true
                    ? 'bg-[var(--color-critical-tint)] text-critical rounded-full px-1.5 py-0.5 text-[11px] tabular-nums'
                    : 'bg-surface-raised text-text-muted rounded-full px-1.5 py-0.5 text-[11px] tabular-nums'
                }
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
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
    <div role="tabpanel">
      <p className="text-text-muted mb-3 text-xs">{subtitle}</p>
      {children}
    </div>
  );
}
