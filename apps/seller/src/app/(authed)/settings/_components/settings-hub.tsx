'use client';

import type { ReactElement, ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import { BandBody, EmptyState, SectionBand } from '@skydrop/ui/components';
import { canSeePath } from '@/lib/page-access';

/**
 * The settings tiles, filtered to what this person can actually open.
 *
 * A client component only because the filter needs the identity from
 * AuthProvider; the page around it stays a server component. Each tile
 * is checked with the SAME `canSeePath` the route boundary uses, so a
 * tile can never lead to a page that refuses — the two cannot disagree
 * because they read one table.
 *
 * ── The tiles are NUMBERED, and the numbers are computed here ────────
 * The console design indexes a page's regions (`01 //`), and the nav
 * rail indexes its groups the same way. A settings tile is the third
 * thing of that shape: a list of destinations read in order. The index
 * is stamped on the VISIBLE list rather than on the declared one, so a
 * person who cannot open webhooks sees 01–05 rather than 01, 02, 04,
 * 06 — a gap in a sequence reads as something missing, which is
 * exactly the wrong thing to say about a permission working correctly.
 */
export type SettingsTile = {
  readonly href: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
};

export function SettingsHub({ items }: { readonly items: readonly SettingsTile[] }): ReactElement {
  const identity = useSellerIdentity();
  const visible = items.filter((item) => canSeePath(identity, item.href));

  if (visible.length === 0) {
    return (
      <EmptyState
        title="Nothing to configure"
        description="None of these settings are part of your access. An owner or admin on your team can change that."
      />
    );
  }

  return (
    <div>
      <SectionBand
        index="01"
        title="Configuration"
        note={`${visible.length} ${visible.length === 1 ? 'area' : 'areas'} open to you`}
      />
      <BandBody flush>
        {/*
         * ONE COLUMN, hairline-divided — a register, not a wall of
         * cards. Two columns would halve the width a description gets
         * and buy nothing: eight rows fit on a laptop either way, and
         * at 360px the second column collapses anyway, so the two-up
         * layout only ever existed for the widest case.
         */}
        <div className="divide-border divide-y">
          {visible.map((it, i) => (
            <Link
              key={it.href}
              href={it.href}
              className="group hover:bg-surface-hover flex items-start gap-3 px-3 py-3 transition-colors"
            >
              <span
                aria-hidden
                className="text-accent w-5 shrink-0 pt-0.5 font-mono text-[11px] tracking-[0.08em]"
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-accent mt-0.5 shrink-0">{it.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="text-text-bright block text-sm font-medium">{it.title}</span>
                <span className="text-text-muted mt-0.5 block text-xs leading-relaxed">
                  {it.description}
                </span>
              </span>
              <ChevronRight
                aria-hidden
                size={14}
                className="text-text-faint group-hover:text-accent mt-0.5 shrink-0 transition-colors"
              />
            </Link>
          ))}
        </div>
      </BandBody>
    </div>
  );
}
