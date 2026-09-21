'use client';

import {
  AlertTriangle,
  Boxes,
  Check,
  FileSpreadsheet,
  ImagePlus,
  ScanLine,
  Tags,
  X,
} from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';
import { DrawToggle } from '@/components/micro/touches';
import { tourCatalogue as c } from '@/content/sections/tour-catalogue';
import type { VignetteProps } from '../contract';
import { useBeats } from '../use-beats';
import { VignetteChecklist } from '../vignette-checklist';
import { VignetteFrame } from '../vignette-frame';
import './catalogue.css';

export const __SD_VIGNETTE__ = 'catalogue';

const ORDER = c.beats.map((b) => b.id);

/** A child's place in its stagger; the delay arithmetic is in the CSS. */
const at = (k: number): CSSProperties => ({ '--k': k }) as CSSProperties;

/** The four states `/products` badges on every picture it takes in. */
const UPLOAD_STATES = ['queued', 'uploading', 'registering', 'done'] as const;

const VARIANTS = ['Size M', 'Size L', 'Colour · Indigo'] as const;

/** Exactly the columns `/inventory` shows a seller — no bin, no batch.
    Widths are fixed so a header wrapping to two lines cannot resize a
    column and desync the row highlight that steps down the table. */
const COLS = [
  ['SKU', '16%'],
  ['Variant', '14%'],
  ['India stock', '13%'],
  ['Reserved', '13%'],
  ['Available', '20%'],
  ['In transit', '13%'],
  ['Low-stock', '11%'],
] as const;

/** Mock furniture: illustrative counts, no price and no rate anywhere. */
const ROWS = [
  { sku: 'KRT-41', variant: 'M', india: 24, held: 6, free: 18, transit: 12, bar: 0.82, mark: 22 },
  { sku: 'KRT-41', variant: 'L', india: 15, held: 2, free: 13, transit: 0, bar: 0.6, mark: 22 },
  {
    sku: 'SCF-08',
    variant: 'One size',
    india: 5,
    held: 3,
    free: 2,
    transit: 40,
    bar: 0.14,
    mark: 34,
    low: true,
  },
] as const;

const UNITS = [
  { sn: 'SN-8814-021' },
  { sn: 'SN-8814-022' },
  { sn: 'SN-8814-023' },
  { sn: 'SN-8814-024', bad: true },
] as const;

/**
 * 13b · Catalogue & inventory. Three beats on one mock: the product card
 * taking pictures in, the live stock register, and STRICT mode scanning
 * units at pick and pack. Every state is spelled out in words beside its
 * colour, the beat index drives the whole picture through `data-beat`
 * (so there is no per-element React state), and under reduced motion the
 * mock is already in each beat's finished frame.
 */
export default function CatalogueVignette({ enabled }: VignetteProps): ReactElement {
  const beats = useBeats({ beats: c.beats, enabled });
  return (
    <div className="vg vg-cat">
      <VignetteChecklist
        items={c.checklist}
        currentBeat={beats.beat?.id}
        beatOrder={ORDER}
        hue={c.hue}
      />
      <VignetteFrame beats={beats} title={c.title} hue={c.hue}>
        <div className="vg-cat__mock" data-beat={beats.index} data-reduced={beats.reducedMotion}>
          <div className="vg-cat__scale">
            {/* 1 — the product card */}
            <div className="vg-cat__panel vg-cat__p1" data-on={beats.index === 0 || undefined}>
              <p className="vg-cat__bar">
                <span className="vg-cat__ico">
                  <ImagePlus size={11} strokeWidth={2.5} />
                </span>
                <b>Silk kurta</b>
                <code>SD-KRT-41</code>
              </p>
              <div className="vg-cat__two">
                <div className="vg-cat__drop">
                  <span className="vg-cat__tiles">
                    <i className="vg-cat__tile" style={at(0)} />
                    <i className="vg-cat__tile" style={at(1)} />
                    <i className="vg-cat__tile" style={at(2)} />
                  </span>
                  <span className="vg-cat__dim">Drop pictures here</span>
                </div>
                <div className="vg-cat__states">
                  <i className="vg-cat__pill" />
                  {UPLOAD_STATES.map((w, k) => (
                    <span key={w} className="vg-cat__state" style={at(k)}>
                      {w}
                      {k === UPLOAD_STATES.length - 1 ? <Check size={10} strokeWidth={3} /> : null}
                    </span>
                  ))}
                </div>
              </div>
              <p className="vg-cat__vars">
                <span className="vg-cat__dim">
                  <Tags size={10} strokeWidth={2.5} /> Variants
                </span>
                {VARIANTS.map((v, k) => (
                  <span key={v} className="vg-cat__chip" style={at(k)}>
                    {v}
                  </span>
                ))}
              </p>
              <p className="vg-cat__csv">
                <span className="vg-cat__dim">
                  <FileSpreadsheet size={10} strokeWidth={2.5} /> Catalogue register
                </span>
                <span className="vg-cat__ghost">Choose CSV…</span>
                <span className="vg-cat__go">Upload and check</span>
                <i className="vg-cat__feed" style={at(0)} />
                <i className="vg-cat__feed" style={at(1)} />
              </p>
            </div>

            {/* 2 — the stock register */}
            <div className="vg-cat__panel vg-cat__p2" data-on={beats.index === 1 || undefined}>
              <p className="vg-cat__bar">
                <span className="vg-cat__ico">
                  <Boxes size={11} strokeWidth={2.5} />
                </span>
                <b>Stock register</b>
                <code>India · live</code>
              </p>
              <div className="vg-cat__tw">
                <i className="vg-cat__scan" />
                <table className="vg-cat__tbl">
                  <colgroup>
                    {COLS.map(([h, w]) => (
                      <col key={h} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      {COLS.map(([h]) => (
                        <th key={h} scope="col">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((r, k) => (
                      <tr key={r.sku + r.variant}>
                        <td>{r.sku}</td>
                        <td>{r.variant}</td>
                        <td className="vg-cat__n">{r.india}</td>
                        <td className="vg-cat__n">{r.held}</td>
                        <td className="vg-cat__n">
                          {r.free}
                          <i className="vg-cat__meter">
                            <i
                              className="vg-cat__fill"
                              style={{ ...at(k), transform: `scaleX(${r.bar})` }}
                            />
                            <i className="vg-cat__mark" style={{ left: `${r.mark}%` }} />
                          </i>
                        </td>
                        <td className="vg-cat__n">{r.transit}</td>
                        <td>
                          {'low' in r ? (
                            <span className="vg-cat__low">
                              <AlertTriangle size={9} strokeWidth={3} /> Low
                            </span>
                          ) : (
                            <span className="vg-cat__ok">OK</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="vg-cat__foot">
                <span className="vg-cat__mark vg-cat__key" /> Low-stock alert at 5
              </p>
              <p className="vg-cat__foot">
                <b>In transit</b> — In Dhaka or in the air — not sellable yet.
              </p>
            </div>

            {/* 3 — STRICT mode */}
            <div className="vg-cat__panel vg-cat__p3" data-on={beats.index === 2 || undefined}>
              <p className="vg-cat__bar vg-cat__toggle">
                <span className="vg-cat__ico">
                  <ScanLine size={11} strokeWidth={2.5} />
                </span>
                <DrawToggle label="STRICT mode" checked readOnly tabIndex={-1} />
              </p>
              <p className="vg-cat__gates">
                <span className="vg-cat__gate" style={at(0)}>
                  PICK
                </span>
                <span className="vg-cat__gate" style={at(1)}>
                  PACK
                </span>
              </p>
              <div className="vg-cat__units">
                <i className="vg-cat__sweep" />
                {UNITS.map((u, k) => (
                  <span
                    key={u.sn}
                    className="vg-cat__unit"
                    style={at(k)}
                    data-bad={'bad' in u || undefined}
                  >
                    {'bad' in u ? (
                      <X size={9} strokeWidth={3} />
                    ) : (
                      <Check size={9} strokeWidth={3} />
                    )}
                    {u.sn}
                  </span>
                ))}
              </div>
              <div className="vg-cat__disc">
                <span className="vg-cat__dischead">
                  <AlertTriangle size={10} strokeWidth={2.5} /> Unit discrepancies
                </span>
                <span className="vg-cat__mismatch">Count mismatches · 1</span>
                <span className="vg-cat__note">
                  Reported, never auto-corrected — that would erase the evidence.
                </span>
              </div>
            </div>
          </div>
        </div>
      </VignetteFrame>
    </div>
  );
}
