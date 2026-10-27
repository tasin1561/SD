'use client';

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { useSellerIdentity } from '@skydrop/auth/client';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { ListRow, ListRows } from '@skydrop/ui/app/list-row';
import { EmptyState } from '@skydrop/ui/app/empty-state';
import { MotionSwitch } from '@skydrop/ui/app/motion-switch';
import { canSeePath } from '@/lib/page-access';
import './settings.css';
import { useT } from '@/i18n/client';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

/**
 * The settings tiles, filtered to what this person can actually open.
 *
 * A client component only because the filter needs the identity from
 * AuthProvider; the page around it stays a server component. Each tile
 * is checked with the SAME `canSeePath` the route boundary uses, so a
 * tile can never lead to a page that refuses — the two cannot disagree
 * because they read one table.
 *
 * The tiles are grouped by what they are about and drawn as rows, one
 * column. The old numbered register ("01 //") is gone with the rest of
 * the console chrome; grouping says the same thing — a reading order —
 * without a sequence that could show a gap where a permission hides a
 * tile.
 *
 * The one setting that lives HERE rather than behind a tile is motion:
 * it is a preference of this browser, stored in this browser, and it
 * needs no page of its own.
 */
export type SettingsGroup = 'account' | 'defaults' | 'money' | 'integrations' | 'notifications';

export type SettingsTile = {
  readonly href: string;
  readonly group: SettingsGroup;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
};

const groupsOf = (
  t: Translate<MessageKey>,
): ReadonlyArray<{ readonly id: SettingsGroup; readonly title: string }> => [
  { id: 'account', title: t('settingsHub.account') },
  { id: 'defaults', title: t('settingsHub.orderAndStockDefaults') },
  { id: 'money', title: t('settingsHub.money') },
  { id: 'notifications', title: t('settingsHub.notifications') },
  { id: 'integrations', title: t('settingsHub.integrations') },
];

export function SettingsHub({ items }: { readonly items: readonly SettingsTile[] }): ReactElement {
  const t = useT();
  const identity = useSellerIdentity();
  const visible = items.filter((item) => canSeePath(identity, item.href));

  const preferences = (
    <section className="set-section">
      <SectionHeading
        title={t('settingsHub.thisBrowser')}
        note={t('settingsHub.howTheConsoleMoves')}
      />
      <div className="set-card">
        <MotionSwitch />
      </div>
    </section>
  );

  if (visible.length === 0) {
    return (
      <div className="set-hub">
        <EmptyState
          title={t('settingsHub.nothingToConfigure')}
          description={t('settingsHub.noneOfTheseSettings')}
        />
        {preferences}
      </div>
    );
  }

  return (
    <div className="set-hub">
      {groupsOf(t).map((group, index) => {
        const rows = visible.filter((it) => it.group === group.id);
        if (rows.length === 0) return null;
        return (
          <div key={group.id} className="set-stack">
            <section className="set-section">
              <SectionHeading
                title={group.title}
                note={t(
                  rows.length === 1 ? 'settingsHub.areaOpenOne' : 'settingsHub.areaOpenMany',
                  {
                    count: rows.length,
                  },
                )}
              />
              <ListRows label={group.title}>
                {rows.map((it) => (
                  <ListRow
                    key={it.href}
                    href={it.href}
                    Link={Link}
                    icon={it.icon}
                    title={it.title}
                    description={it.description}
                  />
                ))}
              </ListRows>
            </section>
            {/* The browser preference sits with the account-level ones. */}
            {index === 0 && group.id === 'account' && preferences}
          </div>
        );
      })}
      {visible.every((it) => it.group !== 'account') && preferences}
    </div>
  );
}
