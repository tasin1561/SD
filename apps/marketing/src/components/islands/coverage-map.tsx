'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { BD_RINGS, GEO_NODES, LAND_RINGS, type Ring } from '@/components/landing/map-geometry';
import './coverage-map.css';

/**
 * COVERAGE MAP — the 2.5D tilted ground plane under the PIN checker.
 *
 * Real Natural Earth coastlines (`map-geometry.ts`, the corridor console's
 * own geometry — never redrawn here), laid flat and tipped back with a CSS
 * 3D transform. Pins RISE out of the plane when the map scrolls into view
 * and route arcs draw themselves in the corridor gradient (Bangladesh's
 * green in the east to India's saffron in the west). A checked code lifts
 * its region's pin, names it, pulses a ring and brightens its arc.
 *
 * The tilt is ONE pair of custom properties (`--tilt` / `--spin`); each pin
 * counter-rotates by exactly their inverse, which is what makes a pin stand
 * UP out of a plane that is lying down without a line of projection maths.
 *
 * Every colour is a token. Nothing here is a serviceability claim — the
 * checker beside it answers that; this is the geography behind the answer.
 */

export type MapDirection = 'in' | 'bd';

/** The crop of the [0..1]² map, in per-mille units — India plus Bangladesh. */
const VB = { x: 120, y: 120, w: 760, h: 680 } as const;

/**
 * FIRST-DIGIT APPROXIMATION of the public postal zones — India's PIN zones
 * and Bangladesh's postcode ranges — NOT a statement about serviceability.
 * A first digit names a region; the pin is that region's best-known city and
 * nothing more. Bengaluru carries a pin without owning a digit: it is one of
 * the six named lanes (`platform.coverageCities`) and belongs on the map.
 */
const IN_ZONES: Record<string, string> = {
  '1': 'DEL',
  '2': 'LKO',
  '3': 'JAI',
  '4': 'BOM',
  '5': 'HYD',
  '6': 'MAA',
  '7': 'CCU',
  '8': 'PAT',
};
const BD_ZONES: Record<string, string> = {
  '1': 'DAC',
  '2': 'MYM',
  '3': 'ZYL',
  '4': 'CGP',
  '5': 'RGP',
  '6': 'RJH',
  '7': 'KHL',
  '8': 'BZL',
  '9': 'KHL',
};

/** The pin a code lights, from its first digit. `null` when nothing matches. */
export function regionForCode(direction: MapDirection, code: string): string | null {
  const first = code.trim().charAt(0);
  return (direction === 'in' ? IN_ZONES : BD_ZONES)[first] ?? null;
}

/**
 * The Bangladeshi divisional cities the console never needed, converted with
 * the same equirectangular formula the geometry file is built on:
 * `x = (lon - 66) / 33`, `y = (34.5 - lat) / 30`.
 */
const GEO: Record<string, readonly [number, number]> = {
  ...GEO_NODES,
  MYM: [0.7394, 0.325],
  ZYL: [0.7839, 0.32],
  CGP: [0.7812, 0.4047],
  RGP: [0.7045, 0.2917],
  RJH: [0.6848, 0.3377],
  KHL: [0.7139, 0.3897],
  BZL: [0.7385, 0.3933],
};

interface Pin {
  id: string;
  name: string;
  x: number;
  y: number;
  /** In Bangladesh — decides which set is prominent per direction. */
  bd: boolean;
  /** One of the six named lanes: its label shows without being picked. */
  named: boolean;
}

function pin(id: string, name: string, bd: boolean, named = false): Pin {
  const g = GEO[id] ?? ([0.5, 0.5] as const);
  return { id, name, x: g[0], y: g[1], bd, named };
}

const ORIGIN = pin('DAC', 'Dhaka', true, true);

const PINS: readonly Pin[] = [
  ORIGIN,
  pin('DEL', 'Delhi', false, true),
  pin('CCU', 'Kolkata', false, true),
  pin('BOM', 'Mumbai', false, true),
  pin('BLR', 'Bengaluru', false, true),
  pin('MAA', 'Chennai', false, true),
  pin('LKO', 'Lucknow', false),
  pin('JAI', 'Jaipur', false),
  pin('HYD', 'Hyderabad', false),
  pin('PAT', 'Patna', false),
  pin('CGP', 'Chattogram', true),
  pin('ZYL', 'Sylhet', true),
  pin('KHL', 'Khulna', true),
  pin('RJH', 'Rajshahi', true),
  pin('RGP', 'Rangpur', true),
  pin('MYM', 'Mymensingh', true),
  pin('BZL', 'Barishal', true),
];

/** `[0..1]` map space → the per-mille viewBox, as a path coordinate pair. */
const P = (x: number, y: number): string => `${Math.round(x * 1000)} ${Math.round(y * 1000)}`;

/**
 * Closed rings → one path. `step` decimates: the coastline is 1,298 points
 * at full precision and every one of them ships inside the static export, so
 * India is thinned by half (invisible at this size, ~6 KB of HTML saved) and
 * Bangladesh is kept whole — it is small, it is the origin, and it is the
 * shape a Bangladeshi reader will check first.
 */
function ringsPath(rings: readonly Ring[], step: number): string {
  let d = '';
  for (const ring of rings) {
    if (ring.length < 6) continue;
    let head = true;
    for (let i = 0; i < ring.length; i += step) {
      const p = ring[i];
      if (!p) continue;
      d += (head ? 'M' : 'L') + P(p[0], p[1]);
      head = false;
    }
    d += 'Z';
  }
  return d;
}

const LAND_D = ringsPath(LAND_RINGS, 2);
const BD_D = ringsPath(BD_RINGS, 1);

const GRID_D = ((): string => {
  let d = '';
  for (let x = VB.x + 80; x < VB.x + VB.w; x += 80) d += `M${x} ${VB.y}V${VB.y + VB.h}`;
  for (let y = VB.y + 80; y < VB.y + VB.h; y += 80) d += `M${VB.x} ${y}H${VB.x + VB.w}`;
  return d;
})();

/** Dhaka ↔ a pin, lifted into an arc; `back` reverses only the DRAW order. */
interface Arc {
  id: string;
  out: string;
  back: string;
}

const ARCS: readonly Arc[] = PINS.filter((p) => p.id !== ORIGIN.id).map((t) => {
  const lift = 0.13 * Math.hypot(t.x - ORIGIN.x, t.y - ORIGIN.y) + 0.02;
  const c = P((ORIGIN.x + t.x) / 2, (ORIGIN.y + t.y) / 2 - lift);
  const a = P(ORIGIN.x, ORIGIN.y);
  const b = P(t.x, t.y);
  return { id: t.id, out: `M${a}Q${c} ${b}`, back: `M${b}Q${c} ${a}` };
});

const pct = (v: number, min: number, span: number): string =>
  `${(((v * 1000 - min) / span) * 100).toFixed(2)}%`;

export function CoverageMap({
  direction,
  code,
}: {
  direction: MapDirection;
  code: string | null;
}): ReactElement {
  // React 19's `useId` returns a non-ASCII id (`«r0»`); it is legal in an
  // `id` attribute but this one is dereferenced through `url(#…)`, so it is
  // stripped to word characters rather than trusted to every engine's
  // fragment parser. Nothing here can be tested in a browser from the file.
  const gid = `cm${useId().replace(/\W/g, '')}`;
  const host = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  // The ONE timer-free trigger: rise on first sight, then stop watching.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setLive(true);
        io.disconnect();
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const active = code === null ? null : regionForCode(direction, code);
  const lit = PINS.find((p) => p.id === active) ?? null;
  const bdSide = direction === 'bd';

  return (
    <div ref={host} className="covmap" data-live={live ? '1' : '0'} data-dir={direction}>
      <div className="covmap__stage" aria-hidden>
        <svg className="covmap__svg" viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`} focusable="false">
          <defs>
            <linearGradient id={gid} x1="1" y1="0" x2="0" y2="0">
              <stop offset="0" stopColor="var(--green-500)" />
              <stop offset="1" stopColor="var(--saffron-400)" />
            </linearGradient>
          </defs>
          <path className="covmap__grid" d={GRID_D} />
          <path className="covmap__land" d={LAND_D} />
          <path className="covmap__bd" d={BD_D} />
          <g stroke={`url(#${gid})`} fill="none">
            {ARCS.map((a, i) => (
              <path
                key={a.id}
                className="covmap__arc"
                d={bdSide ? a.back : a.out}
                pathLength={1}
                data-on={active === a.id ? '1' : undefined}
                style={{ '--i': i } as CSSProperties}
              />
            ))}
          </g>
        </svg>
        {PINS.map((p, i) => (
          <span
            key={p.id}
            className="covmap__pin"
            data-on={active === p.id ? '1' : undefined}
            data-named={p.named ? '1' : undefined}
            data-far={p.id !== ORIGIN.id && p.bd !== bdSide ? '1' : undefined}
            data-side={p.x > 0.62 ? 'l' : 'r'}
            style={
              {
                '--x': pct(p.x, VB.x, VB.w),
                '--y': pct(p.y, VB.y, VB.h),
                '--i': i,
              } as CSSProperties
            }
          >
            <i className="covmap__stalk" />
            <i className="covmap__ring" />
            <i className="covmap__head" />
            <b className="covmap__name">{p.name}</b>
          </span>
        ))}
      </div>
      <p className="sr-only">
        {lit
          ? `Map of the corridor: ${lit.name} is highlighted.`
          : direction === 'in'
            ? 'Map of the corridor from Bangladesh into India. Type a PIN code to highlight its region.'
            : 'Map of Bangladesh and India. Type a postcode to highlight its region.'}
      </p>
    </div>
  );
}
