'use client';

import dynamic from 'next/dynamic';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Search } from 'lucide-react';
import { LiquidBead } from '@/components/micro/liquid-bead';
import { RollingLabelButton } from '@/components/micro/rolling-label-button';
import { ParachuteProgress } from '@/components/micro/parachute-progress';
import { business, platform } from '@/content/site';
import type { Direction } from './direction';
import { DirectionToggle } from './direction-toggle';

/**
 * Track · Get a quote · Book a shipment — the three things a visitor
 * came to do, reachable without scrolling on a 360×780 phone.
 *
 * Track is a NAVIGATION to the tracking page: the label rolls to
 * "Finding…" as ≤350 ms press feedback and the page changes; there is no
 * "found" because we never learn the result. The quote is pure local
 * arithmetic over the (placeholder) slabs — the parachute descends while
 * it "runs" and the landing is the figure, labelled Estimated. Book
 * embeds the real invite form, fetched only when its tab is chosen or
 * hovered, so the form's code is not in the hero's first load.
 */
const InviteForm = dynamic(
  () => import('@/components/landing/invite-form').then((m) => m.InviteForm),
  { ssr: false, loading: () => <p className="text-[14px] text-fg-muted">Loading the form…</p> },
);
const warmForm = (): void => void import('@/components/landing/invite-form');

const TABS = [
  { id: 'track', label: 'Track', hue: 'blue' },
  { id: 'quote', label: 'Get a quote', hue: 'saffron' },
  { id: 'book', label: 'Book a shipment', hue: 'green' },
] as const;

function estimate(kg: number): { price: number; slab: number } | null {
  const slabs = business.estimator.slabs;
  for (const s of slabs) if (kg <= s.upToKg) return { price: s.price, slab: s.upToKg };
  return null;
}

export function HeroActionCard({
  direction,
  onDirectionChange,
}: {
  direction: Direction;
  onDirectionChange: (d: Direction) => void;
}): ReactElement {
  const [tab, setTab] = useState<string>('track');
  const [awb, setAwb] = useState('');
  const [phase, setPhase] = useState<'idle' | 'busy'>('idle');
  const [kg, setKg] = useState('1');

  const track = (e: FormEvent): void => {
    e.preventDefault();
    const clean = awb.trim();
    if (!clean) return;
    setPhase('busy');
    window.location.assign(`${platform.nav.track.href}?awb=${encodeURIComponent(clean)}`);
  };

  return (
    <div className="hero-card" data-tab={tab}>
      <LiquidBead
        tabs={TABS}
        value={tab}
        onChange={(id) => {
          if (id === 'book') warmForm();
          setTab(id);
        }}
        label="What would you like to do?"
        variant="pill"
        className="hero-card__tabs"
      />
      <div className="hero-card__panel">
        {tab === 'track' ? (
          <form
            onSubmit={track}
            role="search"
            aria-label="Track a parcel"
            className="hero-card__row"
          >
            <label htmlFor="hero-awb" className="sr-only">
              Waybill number
            </label>
            <div className="hero-card__field">
              <Search size={16} aria-hidden="true" />
              <input
                id="hero-awb"
                value={awb}
                onChange={(e) => setAwb(e.target.value)}
                placeholder="Waybill number"
                autoComplete="off"
                inputMode="text"
                className="tabular"
              />
            </div>
            {/* Wrapped, not given a className: the button spreads its rest
                props LAST, so a className here would replace `mi mi-roll`
                and unroll the label strip. */}
            <div className="hero-card__go">
              <RollingLabelButton
                type="submit"
                phase={phase}
                labels={{ idle: 'Track', busy: 'Finding…', success: 'Found', error: 'Try again' }}
              />
            </div>
          </form>
        ) : null}
        {tab === 'quote' ? (
          <div className="hero-card__row">
            <div className="hero-card__span">
              <DirectionToggle value={direction} onChange={onDirectionChange} />
            </div>
            <label htmlFor="hero-kg" className="sr-only">
              Parcel weight in kilograms
            </label>
            <div className="hero-card__field">
              <input
                id="hero-kg"
                type="number"
                min="0.1"
                max="30"
                step="0.1"
                inputMode="decimal"
                value={kg}
                onChange={(e) => setKg(e.target.value)}
                className="tabular"
                aria-describedby="hero-kg-note"
              />
              <span className="hero-card__unit">kg</span>
            </div>
            <ParachuteProgress
              label={direction === 'out' ? 'Quote to India' : 'Quote to Bangladesh'}
              task={async () => {
                const n = Number(kg);
                if (!Number.isFinite(n) || n <= 0) throw new Error('weight');
                const e = estimate(n);
                if (!e) throw new Error('slab');
                return e;
              }}
              successLabel={(e) => (
                <span className="tabular">
                  ≈ {business.estimator.currency} {e.price.toLocaleString('en-IN')}
                </span>
              )}
              errorLabel="Over 5 kg — ask us for a quote"
              settleMs={Infinity}
              className="hero-card__go"
            />
            <p id="hero-kg-note" className="hero-card__note">
              {business.estimator.note} Priced by weight slab (up to{' '}
              {business.estimator.slabs.map((sl) => sl.upToKg).join(' / ')} kg).
            </p>
          </div>
        ) : null}
        {tab === 'book' ? (
          <div className="hero-card__form" onPointerEnter={warmForm}>
            <InviteForm variant="embedded" direction={direction} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
