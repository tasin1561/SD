'use client';

import dynamic from 'next/dynamic';
import { useState, type FormEvent, type ReactElement } from 'react';
import { ArrowRight, PackageSearch, Plane } from 'lucide-react';
import { TextField } from '@/components/micro/text-field';
import { Stepper } from '@/components/micro/stepper';
import { TrackingCard, type TrackingStep } from '@/components/micro/tracking-card';
import { LiquidBead } from '@/components/micro/liquid-bead';
import { RollingLabelButton } from '@/components/micro/rolling-label-button';
import { ParachuteProgress } from '@/components/micro/parachute-progress';
import { business, platform } from '@/content/site';
import { setHeroTab, useHeroTab, type HeroTab } from '@/lib/hero-tab';
import type { Direction } from './direction';
import { ChoiceCards } from '@/components/micro/choice-cards';

/**
 * Track · Get a quote · Book a shipment — the three things a visitor came
 * to do, reachable without scrolling on a 360×780 phone.
 *
 * Track is a NAVIGATION to the tracking page: the label rolls to
 * "Finding…" as ≤350 ms press feedback and the page changes; there is no
 * "found" because we never learn the result. The quote is local
 * arithmetic over the direction's (placeholder) rate card — taka from
 * Bangladesh, rupees from India — with the parachute descending while it
 * runs; the RESULT lives on its own row under the input with the slab,
 * the transit estimate and a link that carries the quote into the Book
 * tab, and the button stays available for another weight. Book embeds
 * the real invite form, fetched only when its tab is chosen or hovered.
 *
 * The open tab is shared through `hero-tab.ts` so the phone's bottom bar
 * can follow it.
 */
const InviteForm = dynamic(
  () => import('@/components/landing/invite-form').then((m) => m.InviteForm),
  { ssr: false, loading: () => <p className="text-[14px] text-fg-muted">Loading the form…</p> },
);
const warmForm = (): void => void import('@/components/landing/invite-form');

const TABS = [
  { id: 'track', label: <TabLabel long="Track" short="Track" />, hue: 'blue' },
  { id: 'quote', label: <TabLabel long="Get a quote" short="Quote" />, hue: 'saffron' },
  { id: 'book', label: <TabLabel long="Book a shipment" short="Book" />, hue: 'green' },
] as const;

/** Two spellings; CSS shows the short one at ≤ 400 px. */
function TabLabel({ long, short }: { long: string; short: string }): ReactElement {
  return (
    <>
      <span className="hero-card__tab-long">{long}</span>
      <span className="hero-card__tab-short" aria-hidden>
        {short}
      </span>
    </>
  );
}

interface Quote {
  direction: Direction;
  kg: number;
  price: number;
  symbol: string;
  slabKg: number;
  transit: string;
}

function estimate(direction: Direction, kg: number): Quote | null {
  const card = direction === 'out' ? business.estimator.toIndia : business.estimator.toBangladesh;
  const transit =
    direction === 'out'
      ? business.serviceability.transitDaysIndia
      : business.serviceability.transitDaysBangladesh;
  for (const s of card.slabs) {
    if (kg <= s.upToKg)
      return { direction, kg, price: s.price, symbol: card.symbol, slabKg: s.upToKg, transit };
  }
  return null;
}

/** The ILLUSTRATIVE tracking card (u17) — every figure a placeholder, labelled "Sample". */
export function HeroSampleCard({ className }: { className?: string }): ReactElement {
  return (
    <TrackingCard
      className={className}
      badge="Sample"
      orderId={business.sampleTracking.orderId}
      status={business.sampleTracking.status}
      steps={business.sampleTracking.steps as readonly TrackingStep[]}
      progress={business.sampleTracking.progress}
      progressLabel="On the way"
      expectedDay={business.sampleTracking.expectedDay}
      expectedTime={business.sampleTracking.expectedTime}
    />
  );
}

export function quoteLine(q: Quote): string {
  const route = q.direction === 'out' ? 'Bangladesh → India' : 'India → Bangladesh';
  return `Quote: ${route}, ${q.kg} kg, est. ${q.symbol}${q.price.toLocaleString('en-IN')} (${q.transit})`;
}

export function HeroActionCard({
  direction,
  onDirectionChange,
}: {
  direction: Direction;
  onDirectionChange: (d: Direction) => void;
}): ReactElement {
  const tab = useHeroTab();
  const [awb, setAwb] = useState('');
  const [phase, setPhase] = useState<'idle' | 'busy'>('idle');
  const [kg, setKg] = useState(1);
  const [quote, setQuote] = useState<Quote | null>(null);

  const track = (e: FormEvent): void => {
    e.preventDefault();
    const clean = awb.trim();
    if (!clean) return;
    setPhase('busy');
    window.location.assign(`${platform.nav.track.href}?awb=${encodeURIComponent(clean)}`);
  };
  const choose = (id: HeroTab): void => {
    if (id === 'book') warmForm();
    setHeroTab(id);
  };
  const maxKg = Math.max(...business.estimator.toIndia.slabs.map((s) => s.upToKg));

  return (
    <div className="hero-card" data-tab={tab}>
      <LiquidBead
        tabs={TABS}
        value={tab}
        onChange={(id) => choose(id as HeroTab)}
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
            <TextField
              id="hero-awb"
              label="Waybill number"
              icon={<PackageSearch size={16} />}
              value={awb}
              onChange={(e) => setAwb(e.currentTarget.value)}
              autoComplete="off"
              inputMode="text"
              className="tabular hero-card__awb"
            />
            {/* Wrapped, not given a className: the button spreads its rest
                props LAST, so a className here would replace `mi mi-roll`
                and unroll the label strip. */}
            <div className="hero-card__go">
              <RollingLabelButton
                type="submit"
                phase={phase}
                icon={<PackageSearch size={16} />}
                labels={{ idle: 'Track', busy: 'Finding…', success: 'Found', error: 'Try again' }}
              />
            </div>
          </form>
        ) : null}
        {tab === 'track' ? (
          // On a phone the sample folds away so the trust row stays above the
          // fold; from lg it sits over the map instead (HeroClient).
          <details className="hero-card__sample lg:hidden">
            <summary className="hero-card__sample-toggle">See a sample tracking card</summary>
            <HeroSampleCard />
          </details>
        ) : null}
        {tab === 'quote' ? (
          <div className="hero-card__quote">
            <ChoiceCards<Direction>
              name="hero-direction"
              label="Shipping direction"
              value={direction}
              onChange={(d) => {
                onDirectionChange(d);
                setQuote(null);
              }}
              options={[
                {
                  value: 'out',
                  title: 'Bangladesh → India',
                  helper: `${business.serviceability.transitDaysIndia} · taka rates`,
                  icon: <Plane size={15} />,
                  hue: 'saffron',
                },
                {
                  value: 'in',
                  title: 'India → Bangladesh',
                  helper: `${business.serviceability.transitDaysBangladesh} · rupee rates`,
                  icon: <Plane size={15} style={{ transform: 'scaleX(-1)' }} />,
                  hue: 'green',
                },
              ]}
            />
            <div className="hero-card__row">
              <Stepper
                label="Parcel weight"
                value={kg}
                onChange={setKg}
                min={0.5}
                max={maxKg}
                step={0.5}
                unit="kg"
                format={(v) => v.toFixed(1)}
                className="hero-card__kg"
              />
              <ParachuteProgress
                label="Calculate"
                task={async () => {
                  const q = estimate(direction, kg);
                  if (!q) throw new Error('slab');
                  return q;
                }}
                onSettled={(r) => {
                  if (r.ok) setQuote(r.value);
                }}
                successLabel={() => 'Estimated'}
                errorLabel={`Over ${maxKg} kg — ask us for a quote`}
                settleMs={1600}
                className="hero-card__go"
              />
            </div>
            {quote ? (
              <div className="hero-card__result" role="status" aria-live="polite">
                <span className="hero-card__price tabular">
                  ≈ {quote.symbol}
                  {quote.price.toLocaleString('en-IN')}
                </span>
                <span className="hero-card__meta">
                  up to {quote.slabKg} kg · {quote.transit} ·{' '}
                  {quote.direction === 'out' ? 'Bangladesh → India' : 'India → Bangladesh'}
                </span>
                <button type="button" className="hero-card__link" onClick={() => choose('book')}>
                  Book this shipment
                  <ArrowRight size={14} aria-hidden="true" />
                </button>
              </div>
            ) : null}
            <p id="hero-kg-note" className="hero-card__note">
              {business.estimator.note} {direction === 'out' ? 'Taka' : 'Rupee'} rates, priced by
              weight slab.
            </p>
          </div>
        ) : null}
        {tab === 'book' ? (
          <div className="hero-card__form" onPointerEnter={warmForm}>
            <InviteForm
              variant="embedded"
              direction={direction}
              quote={quote ? quoteLine(quote) : undefined}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
