'use client';

import { useMemo, useState, type ReactElement } from 'react';
import {
  BookOpen,
  Cookie,
  Cpu,
  Gem,
  Home,
  Palette,
  Shirt,
  Sparkles,
  FileText,
  Package,
  PackagePlus,
  Plane,
} from 'lucide-react';
import { ChoiceCards } from '@/components/micro/choice-cards';
import { ComboSelect } from '@/components/micro/combo-select';
import { Stepper } from '@/components/micro/stepper';
import { ChipSelect } from '@/components/micro/chip-select';
import { DrawToggle } from '@/components/micro/touches';
import { TermTip } from '@/components/micro/tooltip-card';
import { ParachuteProgress } from '@/components/micro/parachute-progress';
import { SweepLink } from '@/components/micro/sweep';
import { business, platform } from '@/content/site';
import { estimate, type Quote } from './hero-action-card';
import type { Direction } from './direction';

type ParcelType = (typeof platform.parcelTypes)[number]['id'];

/** One glyph per goods category, so a chip reads before it is picked. */
const GOODS_ICONS: Record<string, ReactElement> = {
  Apparel: <Shirt size={14} />,
  Handicrafts: <Palette size={14} />,
  Beauty: <Sparkles size={14} />,
  Snacks: <Cookie size={14} />,
  Books: <BookOpen size={14} />,
  Electronics: <Cpu size={14} />,
  Jewellery: <Gem size={14} />,
  Home: <Home size={14} />,
};

/** Volumetric weight in kg: L × W × H (cm) ÷ 5000 — the couriers' rule. */
export function volumetricKg(l: number, w: number, h: number): number {
  return Math.round(((l * w * h) / 5000) * 100) / 100;
}

export function EstimatorClient(): ReactElement {
  const [dir, setDir] = useState<Direction>('out');
  const [region, setRegion] = useState<string | null>(null);
  const [city, setCity] = useState<string | null>(null);
  const [type, setType] = useState<ParcelType>('parcel');
  const [kg, setKg] = useState(1);
  const [dims, setDims] = useState({ l: 20, w: 15, h: 10 });
  const [cod, setCod] = useState(true);
  const [goods, setGoods] = useState<string[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);

  const dest = dir === 'out' ? platform.geography.IN : platform.geography.BD;
  const regions = useMemo(() => Object.keys(dest.regions), [dest]);
  const cities = region ? ((dest.regions as Record<string, readonly string[]>)[region] ?? []) : [];
  const vol = volumetricKg(dims.l, dims.w, dims.h);
  const chargeable = Math.max(kg, vol);
  const card = dir === 'out' ? business.estimator.toIndia : business.estimator.toBangladesh;
  const maxKg = card.slabs[card.slabs.length - 1]?.upToKg ?? 5;

  const changeDir = (d: Direction): void => {
    setDir(d);
    setRegion(null);
    setCity(null);
    setQuote(null);
  };
  const bookHref = quote
    ? `${platform.nav.cta.href}?dir=${dir === 'out' ? 'BD_TO_IN' : 'IN_TO_BD'}&weight=${chargeable}&est=${quote.price}${city ? `&city=${encodeURIComponent(city)}` : ''}`
    : platform.nav.cta.href;

  return (
    <div className="est">
      <div className="est__form sec-card">
        <div>
          <span className="est__k">Direction</span>
          <ChoiceCards<Direction>
            name="est-direction"
            label="Direction"
            columns={2}
            value={dir}
            onChange={changeDir}
            options={[
              {
                value: 'out',
                title: 'Bangladesh → India',
                helper: `Rates in taka · ${business.serviceability.transitDaysIndia}`,
                hue: 'saffron',
                icon: <Plane size={16} />,
              },
              {
                value: 'in',
                title: 'India → Bangladesh',
                helper: `Rates in rupees · ${business.serviceability.transitDaysBangladesh}`,
                hue: 'green',
                icon: <Plane size={16} style={{ transform: 'scaleX(-1)' }} />,
              },
            ]}
          />
        </div>
        <div>
          <span className="est__k">Delivering to {dest.name}</span>
          <div className="est__row est__row--2">
            <ComboSelect
              id="est-region"
              label={dir === 'out' ? 'State' : 'Division'}
              options={regions}
              value={region}
              onChange={(r) => {
                setRegion(r);
                setCity(null);
              }}
            />
            <ComboSelect
              id="est-city"
              label="City"
              options={cities}
              value={city}
              onChange={setCity}
              disabled={!region}
              {...(region
                ? {}
                : { helper: `Pick a ${dir === 'out' ? 'state' : 'division'} first` })}
            />
          </div>
        </div>
        <div>
          <span className="est__k">What is it?</span>
          <ChoiceCards<ParcelType>
            name="est-type"
            label="Parcel type"
            columns={3}
            value={type}
            onChange={setType}
            options={platform.parcelTypes.map((p) => ({
              value: p.id,
              title: p.title,
              helper: p.helper,
              hue: 'blue',
              icon:
                p.id === 'document' ? (
                  <FileText size={16} />
                ) : p.id === 'bulk' ? (
                  <PackagePlus size={16} />
                ) : (
                  <Package size={16} />
                ),
            }))}
          />
        </div>
        {type !== 'bulk' ? (
          <>
            <div>
              <span className="est__k">Weight and size</span>
              <div className="est__row est__row--4">
                <div className="est__field">
                  <span className="est__field-k">Weight</span>
                  <Stepper
                    label="Weight in kilograms"
                    value={kg}
                    onChange={setKg}
                    min={0.5}
                    max={maxKg}
                    step={0.5}
                    unit="kg"
                    format={(v) => v.toFixed(1)}
                  />
                </div>
                {(['l', 'w', 'h'] as const).map((k) => (
                  <div key={k} className="est__field">
                    <span className="est__field-k">
                      {k === 'l' ? 'Length' : k === 'w' ? 'Width' : 'Height'}
                    </span>
                    <Stepper
                      label={`${k === 'l' ? 'Length' : k === 'w' ? 'Width' : 'Height'} in centimetres`}
                      value={dims[k]}
                      onChange={(v) => setDims({ ...dims, [k]: v })}
                      min={1}
                      max={120}
                      step={1}
                      unit="cm"
                    />
                  </div>
                ))}
              </div>
              <p className="est__vol" style={{ marginTop: '0.75rem' }}>
                <TermTip def={platform.glossary.volumetric}>Volumetric weight</TermTip>{' '}
                {vol.toFixed(2)} kg · charged on <b>{chargeable.toFixed(1)} kg</b>, whichever is
                greater.
              </p>
            </div>
            <div className="est__row est__row--2">
              <DrawToggle
                label="Cash on delivery (COD)"
                checked={cod}
                onChange={(e) => setCod(e.currentTarget.checked)}
              />
            </div>
            <div>
              <span className="est__k">What are you sending? (optional)</span>
              <ChipSelect
                label="Goods categories"
                multiple
                hue="violet"
                value={goods}
                onChange={setGoods}
                chips={platform.goodsCategories.map((g) => ({
                  id: g,
                  label: g,
                  icon: GOODS_ICONS[g],
                }))}
              />
            </div>
            <div className="est__go">
              <ParachuteProgress<Quote>
                label="Estimate"
                settleMs={Infinity}
                task={async () => {
                  const q = estimate(dir, chargeable);
                  if (!q) throw new Error('over');
                  return q;
                }}
                successLabel={(q) => `≈ ${q.symbol}${q.price}`}
                errorLabel={`Over ${maxKg} kg — ask for a consignment quote`}
                onSettled={(r) => setQuote(r.ok ? r.value : null)}
              />
            </div>
          </>
        ) : (
          <p className="est__empty">
            A consignment is stock for our Indian warehouse. It is counted at the intake and billed
            per kilo or per piece at a rate we agree with you by phone before it flies — ask us for
            one.
          </p>
        )}
      </div>

      <aside className="est__result sec-card" aria-live="polite" aria-label="Your estimate">
        <span className="est__result-k">Your estimate</span>
        {type === 'bulk' ? (
          <p className="est__empty">
            Consignment freight is quoted per shipment. Book and we call you back with the rate.
          </p>
        ) : quote ? (
          <>
            <div className="est__price">
              ≈ {quote.symbol}
              {quote.price} <small>{card.currency}</small>
            </div>
            <ul className="est__lines">
              <li className="est__line">
                <span>Route</span>
                <b>
                  {dir === 'out' ? 'Bangladesh → India' : 'India → Bangladesh'}
                  {city ? ` · ${city}` : ''}
                </b>
              </li>
              <li className="est__line">
                <span>Charged weight</span>
                <b>up to {quote.slabKg} kg</b>
              </li>
              <li className="est__line">
                <span>Transit</span>
                <b>{quote.transit}</b>
              </li>
              <li className="est__line">
                <span>COD handling</span>
                <b>
                  {cod
                    ? `${business.estimator.codFeePercent}% of the amount collected`
                    : 'None (prepaid)'}
                </b>
              </li>
              {goods.length ? (
                <li className="est__line">
                  <span>Goods</span>
                  <b>{goods.join(', ')}</b>
                </li>
              ) : null}
            </ul>
          </>
        ) : (
          <p className="est__empty">
            Fill in the parcel and press Estimate. The figure is indicative; your quote is agreed
            before anything ships.
          </p>
        )}
        <SweepLink
          href={bookHref}
          tone={dir === 'out' ? 'saffron' : 'green'}
          aria-disabled={type !== 'bulk' && !quote ? true : undefined}
          tabIndex={type !== 'bulk' && !quote ? -1 : undefined}
          onClick={(e) => {
            if (type !== 'bulk' && !quote) e.preventDefault();
          }}
        >
          {type !== 'bulk' && !quote
            ? 'Estimate first, then request an invite'
            : 'Request an invite'}
        </SweepLink>
        <p className="sec-note">{business.estimator.note}</p>
      </aside>
    </div>
  );
}
