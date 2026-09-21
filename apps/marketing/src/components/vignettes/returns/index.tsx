'use client';

import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { AlertTriangle, Ban, Check, Ticket, Truck, Undo2, Wallet, Warehouse } from 'lucide-react';
import { tourReturns as c } from '@/content/sections/tour-returns';
import type { VignetteProps } from '../contract';
import { useBeats } from '../use-beats';
import { VignetteChecklist } from '../vignette-checklist';
import { VignetteFrame } from '../vignette-frame';
import './returns.css';

/** `--i` drives every stagger; one cast, reused. */
function step(i: number): CSSProperties {
  return { '--i': i } as CSSProperties;
}

/**
 * The three courier statuses a refused parcel passes through, and where
 * it is standing at each. The last one is the warehouse's own word — the
 * courier's scan says it is coming, ours says it arrived.
 */
const STOPS: ReadonlyArray<{ icon: ReactNode; where: string; status: string }> = [
  { icon: <Undo2 size={12} />, where: 'Refused at the door', status: 'RTO initiated' },
  { icon: <Truck size={12} />, where: 'On its way back', status: 'RTO in transit' },
  {
    icon: <Warehouse size={12} />,
    where: 'Opened and counted',
    status: 'Received at our warehouse',
  },
];

/** The three choices the inspector is given, per unit, in the app's own words. */
const TRAYS: ReadonlyArray<{
  icon: ReactNode;
  label: string;
  tone: 'good' | 'aside' | 'off';
  units: string;
}> = [
  {
    icon: <Check size={11} strokeWidth={3} />,
    label: 'Put back in stock',
    tone: 'good',
    units: '1 unit',
  },
  {
    icon: <AlertTriangle size={11} />,
    label: 'Keep aside (damaged)',
    tone: 'aside',
    units: '1 unit',
  },
  { icon: <Ban size={11} />, label: 'Write off (not sellable)', tone: 'off', units: '' },
];

/**
 * The ticket's own lines. "What we are doing" is the sentence the scrap
 * ticket opens with, which is why the seller never has to ask.
 */
const TICKET: ReadonlyArray<readonly [string, string]> = [
  ['Product', 'Kurti, blue, M'],
  ['What we found', '1 of 2 arrived damaged'],
  ['What we are doing', 'We are keeping it aside for you'],
];

/**
 * 13 · Platform tour — RETURNS. Three beats in one 4:3 frame: the parcel
 * tracking back along its three statuses to our warehouse; one line of
 * two identical units split across the three disposition trays, because
 * the inspection is by QUANTITY; and the ticket that opens itself with a
 * damage settlement landing in the wallet ledger.
 *
 * Every beat's state is an attribute on the mock root — `data-beat` picks
 * the scene and re-runs its entrance, `data-reduced` switches every
 * animation off. The CSS base state IS each beat's finished frame, so
 * reduced motion lands there with no second set of rules.
 *
 * The one rupee figure is an illustrative constant rather than a
 * `dummy()`: it is a single settlement on a single sample ticket inside
 * the frame's `aria-hidden` box, not a rate or an average the owner has
 * to supply — the same judgement the Orders vignette's sample counts got.
 */
export default function ReturnsVignette({ enabled }: VignetteProps): ReactElement {
  const beats = useBeats({ beats: c.beats, enabled });

  return (
    <div className="vg vg-ret">
      <VignetteChecklist
        items={c.checklist}
        currentBeat={beats.beat?.id}
        beatOrder={c.beats.map((b) => b.id)}
        hue={c.hue}
      />
      <VignetteFrame beats={beats} title={c.title} hue={c.hue}>
        <div className="vg-ret__mock" data-beat={beats.index} data-reduced={beats.reducedMotion}>
          {/* 1 · the parcel tracks back */}
          <div className="vg-ret__scene" data-scene="0">
            <p className="vg-ret__h">
              Parcel <span className="tabular">3806···7620</span> is coming back
            </p>
            <div className="vg-ret__route">
              <span className="vg-ret__rail">
                <span className="vg-ret__runner">
                  <span className="vg-ret__pkt" />
                </span>
              </span>
              {STOPS.map((s, k) => (
                <div
                  key={s.status}
                  className="vg-ret__stop"
                  style={step(k)}
                  data-here={k === STOPS.length - 1}
                >
                  <span className="vg-ret__node">{s.icon}</span>
                  <b className="vg-ret__where">{s.where}</b>
                  <span className="vg-ret__chip">{s.status}</span>
                </div>
              ))}
            </div>
            <p className="vg-ret__foot">
              The courier’s scan says it is on the way. Ours says it arrived.
            </p>
          </div>

          {/* 2 · two units of one line, judged separately */}
          <div className="vg-ret__scene" data-scene="1">
            <p className="vg-ret__h">
              <span className="tabular">2 ×</span> Kurti, blue, M
              <span className="vg-ret__pill">Inspected by quantity</span>
            </p>
            <ul className="vg-ret__trays">
              {TRAYS.map((t, k) => (
                <li
                  key={t.label}
                  className="vg-ret__card vg-ret__tray"
                  data-tone={t.tone}
                  style={step(k)}
                >
                  <span className="vg-ret__th">
                    <span className="vg-ret__ico">{t.icon}</span>
                    <b>{t.label}</b>
                  </span>
                  <span className="vg-ret__slot">
                    {t.units === '' ? (
                      <i className="vg-ret__none">nothing</i>
                    ) : (
                      <span className="vg-ret__unit">{t.units}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="vg-ret__foot">
              1 of 2 is in good condition, 1 of 2 arrived damaged — so the two go different ways.
            </p>
          </div>

          {/* 3 · the ticket, and the settlement */}
          <div className="vg-ret__scene" data-scene="2">
            <div className="vg-ret__card vg-ret__tkt">
              <span className="vg-ret__th">
                <span className="vg-ret__ico">
                  <Ticket size={11} />
                </span>
                <b>Damaged in return</b>
                <i className="tabular">TK-2026-000418</i>
              </span>
              <dl className="vg-ret__rows">
                {TICKET.map(([label, value], k) => (
                  <div key={label} className="vg-ret__row" style={step(k)}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="vg-ret__card vg-ret__led">
              <span className="vg-ret__th">
                <span className="vg-ret__ico">
                  <Wallet size={11} />
                </span>
                <b>Wallet</b>
              </span>
              <span className="vg-ret__lrow">
                <span>Damage settlement</span>
                <span className="vg-ret__amt tabular">+ ₹1,240</span>
              </span>
            </div>
            <p className="vg-ret__foot">
              You did not raise it — we opened it when we opened the box.
            </p>
          </div>
        </div>
      </VignetteFrame>
    </div>
  );
}

export const __SD_VIGNETTE__ = 'returns';
