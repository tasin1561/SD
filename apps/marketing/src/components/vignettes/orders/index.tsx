'use client';

import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  FileSpreadsheet,
  FileText,
  Lock,
  PhoneCall,
  Plug,
  ShieldCheck,
} from 'lucide-react';
import { tourOrders as c } from '@/content/sections/tour-orders';
import type { VignetteProps } from '../contract';
import { useBeats } from '../use-beats';
import { VignetteChecklist } from '../vignette-checklist';
import { VignetteFrame } from '../vignette-frame';
import './orders.css';

/** `--i` drives every stagger; one cast, reused. */
function step(i: number): CSSProperties {
  return { '--i': i } as CSSProperties;
}

const SOURCES: ReadonlyArray<{ icon: ReactNode; label: string; helper: string }> = [
  { icon: <FileText size={13} />, label: 'New order', helper: 'the order form' },
  { icon: <FileSpreadsheet size={13} />, label: 'CSV import', helper: 'a day at a time' },
  { icon: <Plug size={13} />, label: 'Your own system', helper: 'API key + webhooks' },
];

/** The eight milestones and their owner, exactly as `OrderJourneyService` stamps them. */
const RUNGS: ReadonlyArray<readonly [string, 'Skydrop' | 'Courier']> = [
  ['Order received', 'Skydrop'],
  ['Confirmed by phone', 'Skydrop'],
  ['Picked from shelf', 'Skydrop'],
  ['Packed', 'Skydrop'],
  ['Handed to courier', 'Skydrop'],
  ['In transit', 'Courier'],
  ['Out for delivery', 'Courier'],
  ['Delivered', 'Courier'],
];

const CALLS: ReadonlyArray<{
  tone: 'wait' | 'ok';
  outcome: string;
  time: string;
  note: string;
}> = [
  { tone: 'wait', outcome: 'No response', time: '11:02', note: 'Rang twice, nobody picked up.' },
  { tone: 'ok', outcome: 'Confirmed', time: '16:40', note: 'Asked to deliver after 6 pm.' },
];

const STATS: ReadonlyArray<readonly [string, string]> = [
  ['Orders', '24'],
  ['Delivered', '21'],
  ['RTO', '2'],
  ['Refused', '1'],
];

/**
 * 13 · Platform tour — ORDERS. Four beats in one 4:3 frame: three lanes
 * merging into the Consignment monitor; the journey ladder drawing itself
 * rung by rung with the owner of each; the call cards our agents write
 * after speaking to the customer; the customer register opening on one
 * person's history.
 *
 * Every beat's state is an attribute on the mock root — `data-beat` picks
 * the scene and re-runs its entrance, `data-reduced` switches every
 * animation off. The CSS base state IS each beat's finished frame, so
 * reduced motion lands there with no second set of rules.
 */
export default function OrdersVignette({ enabled }: VignetteProps): ReactElement {
  const beats = useBeats({ beats: c.beats, enabled });

  return (
    <div className="vg vg-ord">
      <VignetteChecklist
        items={c.checklist}
        currentBeat={beats.beat?.id}
        beatOrder={c.beats.map((b) => b.id)}
        hue={c.hue}
      />
      <VignetteFrame beats={beats} title={c.title} hue={c.hue}>
        <div className="vg-ord__mock" data-beat={beats.index} data-reduced={beats.reducedMotion}>
          {/* 1 · three lanes into one queue */}
          <div className="vg-ord__scene" data-scene="0">
            <ul className="vg-ord__srcs">
              {SOURCES.map((s, k) => (
                <li key={s.label} className="vg-ord__src" style={step(k)}>
                  <span className="vg-ord__ico">{s.icon}</span>
                  <span className="vg-ord__srct">
                    <b>{s.label}</b>
                    <i>{s.helper}</i>
                  </span>
                  <span className="vg-ord__track">
                    <span className="vg-ord__runner">
                      <span className="vg-ord__pkt" />
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="vg-ord__card">
              <p className="vg-ord__h">
                Consignment monitor <span className="vg-ord__pill">3 just in</span>
              </p>
              <ul className="vg-ord__q">
                {['318', '319', '320'].map((n, k) => (
                  <li key={n} className="vg-ord__qrow" style={step(k)}>
                    <span className="vg-ord__qdot" />
                    <span className="tabular">SD-…-{n}</span>
                    <span className="vg-ord__qs">Awaiting the call</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 2 · the journey ladder */}
          <div className="vg-ord__scene" data-scene="1">
            <p className="vg-ord__h">
              Order <span className="tabular">SD-2026-26-000318</span>
            </p>
            <ol className="vg-ord__rungs">
              {RUNGS.map(([label, owner], k) => (
                <li key={label} className="vg-ord__rung" data-owner={owner} style={step(k)}>
                  <span className="vg-ord__rdot">
                    <Check size={9} strokeWidth={4} />
                  </span>
                  <span className="vg-ord__rl">{label}</span>
                  <span className="vg-ord__own">{owner}</span>
                </li>
              ))}
            </ol>
            <p className="vg-ord__acts">
              <span className="vg-ord__btn">Edit order</span>
              <span className="vg-ord__btn">Cancel</span>
              <span className="vg-ord__locked">
                <Lock size={10} /> Locked once packed
              </span>
            </p>
          </div>

          {/* 3 · what we discussed */}
          <div className="vg-ord__scene" data-scene="2">
            <p className="vg-ord__h">What we discussed with your customer</p>
            <ul className="vg-ord__calls">
              {CALLS.map((call, k) => (
                <li
                  key={call.outcome}
                  className="vg-ord__card vg-ord__call"
                  data-tone={call.tone}
                  style={step(k)}
                >
                  <span className="vg-ord__ch">
                    <PhoneCall size={11} />
                    <b>{call.outcome}</b>
                    <i className="tabular">{call.time}</i>
                  </span>
                  <span className="vg-ord__cn">{call.note}</span>
                </li>
              ))}
            </ul>
            <p className="vg-ord__foot">Nothing leaves the shelf until this reads confirmed.</p>
          </div>

          {/* 4 · the customer register */}
          <div className="vg-ord__scene" data-scene="3">
            <p className="vg-ord__h">Customer register</p>
            <div className="vg-ord__card vg-ord__reg">
              <span className="vg-ord__regh">
                <b>Ananya R.</b>
                <i className="tabular">+91 98··· ··210</i>
              </span>
              <dl className="vg-ord__cells">
                {STATS.map(([label, value], k) => (
                  <div key={label} className="vg-ord__cell" style={step(k)}>
                    <dt>{label}</dt>
                    <dd className="tabular">{value}</dd>
                  </div>
                ))}
                <div className="vg-ord__cell" style={step(4)}>
                  <dt>Risk</dt>
                  <dd>
                    <span className="vg-ord__risk" data-level="medium">
                      <AlertTriangle size={10} /> medium
                    </span>
                  </dd>
                </div>
              </dl>
              <span className="vg-ord__hint" style={step(5)}>
                Worth a call before you ship again.
              </span>
            </div>
            <div className="vg-ord__card vg-ord__reg" data-closed>
              <span className="vg-ord__regh">
                <b>Vikram S.</b>
                <i className="tabular">+91 97··· ··184</i>
                <span className="vg-ord__risk" data-level="low">
                  <ShieldCheck size={10} /> low
                </span>
              </span>
            </div>
          </div>
        </div>
      </VignetteFrame>
    </div>
  );
}

export const __SD_VIGNETTE__ = 'orders';
