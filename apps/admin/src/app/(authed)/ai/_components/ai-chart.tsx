'use client';

import { useState, type ReactElement } from 'react';

export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  /** A theme token, e.g. `var(--blue-fill)`: light and dark are the theme's own steps. */
  readonly color: string;
}
export interface ChartColumn {
  readonly id: string;
  readonly label: string;
  /** One value per series, same order as `series`. */
  readonly values: readonly number[];
}

const W = 720;
const H = 230;
const PAD = { l: 52, r: 8, t: 10, b: 26 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

/**
 * Stacked columns, inline SVG. Thin marks, a 2px surface gap between stacked
 * fills, recessive grid, ONE axis. Identity is never colour alone: the legend
 * is always present and the page also carries the same numbers as a table.
 * Hover (or tap) a column for its exact figures; the grow-in is transform
 * only and is skipped for reduced motion (see ai.css).
 */
export function StackedColumns({
  columns,
  series,
  ariaLabel,
  format,
  unitLabel,
}: {
  readonly columns: readonly ChartColumn[];
  readonly series: readonly ChartSeries[];
  readonly ariaLabel: string;
  readonly format: (n: number) => string;
  readonly unitLabel?: string;
}): ReactElement {
  const [hover, setHover] = useState<number | null>(null);
  const totals = columns.map((c) => c.values.reduce((a, b) => a + b, 0));
  const max = niceMax(Math.max(0, ...totals));
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const slot = columns.length === 0 ? iw : iw / columns.length;
  const bw = Math.max(Math.min(slot * 0.62, 34), 3);
  const y = (v: number): number => PAD.t + ih - (v / max) * ih;
  const every = Math.max(1, Math.ceil(columns.length / 12));
  const hovered = hover === null ? null : columns[hover];

  return (
    <figure className="ai-chart">
      <div className="ai-chart__legend" aria-label={unitLabel}>
        {series.map((s) => (
          <span key={s.key} className="ai-chart__key">
            <i style={{ background: s.color }} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>
      <div className="ai-chart__plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line
                x1={PAD.l}
                x2={W - PAD.r}
                y1={y(max * f)}
                y2={y(max * f)}
                className={f === 0 ? 'ai-chart__base' : 'ai-chart__grid'}
              />
              <text x={PAD.l - 6} y={y(max * f) + 4} textAnchor="end" className="ai-chart__tick">
                {format(max * f)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const x = PAD.l + slot * i + (slot - bw) / 2;
            let acc = 0;
            return (
              <g key={c.id} data-dim={hover !== null && hover !== i ? '1' : undefined}>
                {c.values.map((v, si) => {
                  if (v <= 0) return null;
                  const top = y(acc + v);
                  const h = y(acc) - top;
                  acc += v;
                  return (
                    <rect
                      key={series[si]?.key ?? si}
                      className="ai-chart__bar"
                      x={x}
                      y={top}
                      width={bw}
                      height={Math.max(h, 1)}
                      rx={2}
                      fill={series[si]?.color}
                    />
                  );
                })}
                {i % every === 0 && (
                  <text x={x + bw / 2} y={H - 8} textAnchor="middle" className="ai-chart__tick">
                    {c.label}
                  </text>
                )}
                <rect
                  x={PAD.l + slot * i}
                  y={PAD.t}
                  width={slot}
                  height={ih}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => setHover(hover === i ? null : i)}
                />
              </g>
            );
          })}
        </svg>
        {hovered !== undefined && hovered !== null && hover !== null && (
          <div
            className="ai-chart__tip"
            style={{
              left: `${((PAD.l + slot * (hover + 0.5)) / W) * 100}%`,
            }}
            role="status"
          >
            <strong>{hovered.label}</strong>
            {series.map((s, si) => (
              <span key={s.key}>
                <i style={{ background: s.color }} aria-hidden />
                {s.label}
                <b>{format(hovered.values[si] ?? 0)}</b>
              </span>
            ))}
            <span className="ai-chart__tip-total">
              <b>{format(totals[hover] ?? 0)}</b>
            </span>
          </div>
        )}
      </div>
    </figure>
  );
}
