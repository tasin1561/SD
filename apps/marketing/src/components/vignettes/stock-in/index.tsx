'use client';

import type { CSSProperties, ReactElement } from 'react';
import { AlertTriangle, Package, Plane, Plus, Ticket, Undo2, Warehouse } from 'lucide-react';
import { ChoiceCards } from '@/components/micro/choice-cards';
import { LiquidBead } from '@/components/micro/liquid-bead';
import { DrawToggle } from '@/components/micro/touches';
import { stockInMock as m, tourStockIn as c } from '@/content/sections/tour-stock-in';
import type { VignetteProps } from '../contract';
import { useBeats } from '../use-beats';
import { VignetteChecklist } from '../vignette-checklist';
import { VignetteFrame } from '../vignette-frame';
import './stock-in.css';

export const __SD_VIGNETTE__ = 'stock-in';

/**
 * The mock is a PICTURE made of DOM: `inert` on its root takes every
 * control in it out of the tab order and the accessibility tree, which
 * is what lets it reuse the real primitives (a radio group, a tablist,
 * a switch) without offering a keyboard user four panels of dead
 * controls inside an `aria-hidden` box. The same words are in the
 * caption strip and the checklist beside it.
 *
 * Consequence to keep in view: nothing inside the mock answers hover —
 * an inert subtree does not hit-test — so the vignette's hover feedback
 * lives on the checklist and the frame's play/pause, which are real.
 */
const noop = (): void => {};

const BEAT_ORDER = c.beats.map((b) => b.id);

const ROUTES = [
  {
    value: 'direct',
    title: 'Straight to India',
    helper: 'You ship it there yourself',
    icon: <Warehouse size={13} aria-hidden />,
  },
  {
    value: 'via-bd',
    title: 'Via our Bangladesh warehouse',
    helper: 'We move it on, and bill the freight',
    icon: <Plane size={13} aria-hidden />,
  },
] as const;

/** The three timeline event words, in the order the seller sees them. */
const STOPS = [
  { badge: 'Counted in Bangladesh', icon: <Warehouse size={12} aria-hidden /> },
  { badge: 'Left for India', icon: <Plane size={12} aria-hidden /> },
  { badge: 'Arrived in India', icon: <Warehouse size={12} aria-hidden /> },
];

/** Hoisted: `LiquidBead` re-measures on every change of `tabs`. */
const FREIGHT_TABS = m.modes.map((x) => ({ id: x.id, label: x.label, hue: 'teal' }));

export default function StockInVignette({ enabled }: VignetteProps): ReactElement {
  const beats = useBeats({ beats: c.beats, enabled });
  const i = beats.index;

  return (
    <div className="vg vg-si">
      <VignetteChecklist
        items={c.checklist}
        currentBeat={beats.beat?.id}
        beatOrder={BEAT_ORDER}
        hue={c.hue}
      />
      <VignetteFrame beats={beats} title={c.title} hue={c.hue}>
        <div className="vg-si__mock" data-reduced={beats.reducedMotion} inert>
          {/* 1 · The route chooser, and what the two legs are called. */}
          <div className="vg-si__p" data-on={i === 0}>
            <ChoiceCards
              className="vg-si__choice"
              name="vg-si-route"
              label="Route into India"
              columns={1}
              value="via-bd"
              onChange={noop}
              options={ROUTES}
            />
            <div className="vg-si__route">
              <span className="vg-si__rail" />
              <span className="vg-si__railfill" />
              {STOPS.map((s, k) => (
                <div key={s.badge} className="vg-si__stop" style={{ '--k': k } as CSSProperties}>
                  <span className="vg-si__dot">{s.icon}</span>
                  <span className="vg-si__badge">{s.badge}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 2 · A variance is a NUMBER on the record — CNS-3, in a table. */}
          <div className="vg-si__p" data-on={i === 1}>
            <div className="vg-si__surf vg-si__card">
              <table className="vg-si__tbl">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Declared</th>
                    <th>Counted</th>
                    <th>Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {m.legs.map((l, k) => {
                    const d = l.counted - l.declared;
                    return (
                      <tr key={l.product} style={{ '--k': k } as CSSProperties}>
                        <td className="vg-si__prod">{l.product}</td>
                        <td className="tabular">{l.declared}</td>
                        <td className="tabular">{l.counted}</td>
                        <td>
                          <span className="vg-si__diff" data-sign={d < 0 ? 'short' : 'over'}>
                            {d < 0 ? (
                              <AlertTriangle size={11} aria-hidden />
                            ) : (
                              <Plus size={11} aria-hidden />
                            )}
                            <span className="tabular">{d < 0 ? `−${-d}` : `+${d}`}</span>
                            {d < 0 ? 'short' : 'surplus'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="vg-si__ticket">
              <span className="vg-si__ticon">
                <Ticket size={13} aria-hidden />
              </span>
              <span className="vg-si__tk">
                <b>{m.ticket.title}</b>
                <span>{m.ticket.leg}</span>
              </span>
            </div>
            <p className="vg-si__calm">
              Nothing is blocked by it — your stock is what was counted.
            </p>
          </div>

          {/* 3 · CNS-6 — the window closes at dispatch, and cancelling RETURNS. */}
          <div className="vg-si__p" data-on={i === 2}>
            <div className="vg-si__surf vg-si__dialog">
              <b>Cancel consignment</b>
              <span>Only possible before the consignment leaves for India.</span>
            </div>
            <div className="vg-si__lane">
              <span className="vg-si__rail" />
              <span className="vg-si__runner vg-si__runner--back">
                <span className="vg-si__parcel">
                  <Package size={12} aria-hidden />
                </span>
              </span>
              <span className="vg-si__ends">
                <span>Dhaka</span>
                <span>India</span>
              </span>
            </div>
            <span className="vg-si__stamp">
              <Undo2 size={11} aria-hidden />
              Returned — not written off
            </span>
            <div className="vg-si__surf vg-si__snack">
              <span>
                {m.cancel.ref} cancelled — {m.cancel.units} units returned to you
              </span>
              <span className="vg-si__snack-a">View</span>
            </div>
          </div>

          {/* 4 · FRT-5 — which stop carries the bill, and in whose currency. */}
          <div className="vg-si__p" data-on={i === 3}>
            <LiquidBead
              className="vg-si__bead"
              tabs={FREIGHT_TABS}
              value={m.chosen.id}
              onChange={noop}
              label="How the freight is billed"
            />
            <p className="vg-si__ex">{m.chosen.explainer}</p>
            <div className="vg-si__time">
              <span className="vg-si__rail" />
              <span className="vg-si__runner" style={{ '--at': m.chosen.at } as CSSProperties}>
                <span className="vg-si__mark" />
              </span>
              <span className="vg-si__tstops">
                <span>Dhaka</span>
                <span>In the air</span>
                <span>India</span>
              </span>
            </div>
            <div className="vg-si__row">
              <span className="vg-si__sword">Per seller</span>
              <DrawToggle label="Per consignment" checked readOnly />
            </div>
            <div className="vg-si__row" style={{ '--k': 1 } as CSSProperties}>
              <span className="vg-si__coin">
                <span className="vg-si__face">৳</span>
                <span className="vg-si__face vg-si__face--b">₹</span>
              </span>
              <span className="vg-si__conv">
                {m.freight.bdt} → {m.freight.inr} · converted at the moment you&rsquo;re charged
              </span>
            </div>
          </div>
        </div>
      </VignetteFrame>
    </div>
  );
}
