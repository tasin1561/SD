'use client';

import { useEffect, useRef, type ReactElement, type ReactNode } from 'react';
import { Tabs } from '@skydrop/ui/app/tabs';
import '../../_components/benches.css';
import { useT } from '@/i18n/client';
import { InfoButton } from '@/components/easy/info-button';
import '@/components/easy/easy.css';

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
  const t = useT();
  const shown = (n: number): number | undefined => (n > 0 ? n : undefined);
  // Only "At our door" is urgent: these parcels are here, and every hour
  // is an hour a seller is being told their goods are still moving.
  const doorUrgent = counts.door > 0;

  // On a phone the four tabs do not fit and the strip scrolls sideways.
  // The open tab is brought into view, so somebody who lands on the last
  // one can see which tab they are on without hunting for it.
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = (): void => {
      const on = wrap.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      on?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    };
    show();
    // Again once the counts and the web font have settled the tab widths.
    const later = window.setTimeout(show, 400);
    return () => window.clearTimeout(later);
  }, [active, counts.door, counts.transit, counts.bench]);

  return (
    <div ref={wrap} className="wh-rto-tabs" data-door-urgent={doorUrgent ? '1' : undefined}>
      <Tabs
        label={t('warehouseRtoRtoTabs.rtoViews')}
        value={active}
        onChange={(id) => onChange(id as RtoTab)}
        items={[
          { id: 'door', label: t('warehouseRtoRtoTabs.atOurDoor'), count: shown(counts.door) },
          {
            id: 'transit',
            label: t('warehouseRtoRtoTabs.stillWithTheCourier'),
            count: shown(counts.transit),
          },
          { id: 'bench', label: t('warehouseRtoRtoTabs.onTheBench'), count: shown(counts.bench) },
          { id: 'receive', label: t('warehouseRtoRtoTabs.receiveInspect') },
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
  const t = useT();
  return (
    <div role="tabpanel" className="wh-rto-panel">
      {/* The explanation is one press away rather than above every list. */}
      <p className="wh-faint ez-titled">
        {t('easy.aboutThisList')}
        <InfoButton title={t('easy.aboutThisList')} text={subtitle} />
      </p>
      {children}
    </div>
  );
}
