'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { BD_RINGS, LAND_RINGS, GEO_NODES, type Ring } from './map-geometry';
import { readTokens, subscribeThemeTokens } from '@/lib/theme-tokens';

/**
 * The corridor map — the hero's art, and the site's oldest animation.
 *
 * Real Natural Earth coastlines from `map-geometry.ts`, Dhaka and the
 * Indian metros at their true positions, route arcs drawn in the corridor
 * gradient (Bangladesh's green to India's saffron), parcels flying the
 * arcs at altitude — saffron when they are bound for India, green when
 * they are bound for Bangladesh — and a pulse at every landing. Six cities
 * carry a NAME in the UI face (Dhaka, Kolkata, Delhi, Mumbai, Bengaluru,
 * Chennai); the other lanes are dots. No panel, no border, no grid: it
 * blends into the hero (owner, Phase 3 review — "stop looking like a
 * console").
 *
 * Every colour is read off the theme tokens (`--map-*`, `--scene-arc-*`)
 * and re-read on BOTH theme triggers — the toggle and the OS preference.
 * The first frame and the loop wait for `requestIdleCallback`; the loop
 * pauses off-screen and when the tab is hidden; reduced motion draws one
 * frame. `direction` reverses the flow (parcels fly TO Dhaka, the pulses
 * land there); `labels={false}` is the phone, where the map sits behind
 * the copy and a name showing through a headline is noise.
 */

export type MapDirection = 'out' | 'in';

interface NodeDef {
  id: string;
  x: number;
  y: number;
  /** Sentence-case city name; only the six named cities carry one. */
  name?: string;
  /** Label anchor relative to the dot. */
  anchor?: 'left' | 'right';
  dy?: number;
}

function geo(id: string): readonly [number, number] {
  return GEO_NODES[id] ?? [0.5, 0.5];
}
function node(id: string, extra: Omit<NodeDef, 'id' | 'x' | 'y'> = {}): NodeDef {
  const [x, y] = geo(id);
  return { id, x, y, ...extra };
}

const ORIGIN: NodeDef = node('DAC', { name: 'Dhaka', anchor: 'right', dy: -8 });

/** Pan-India destination set — Delhivery covers all of these lanes. */
const DESTS: NodeDef[] = [
  node('DEL', { name: 'Delhi', anchor: 'left', dy: -6 }),
  node('JAI'),
  node('LKO'),
  node('GAU'),
  node('PAT'),
  node('BBI'),
  node('AMD'),
  node('CCU', { name: 'Kolkata', anchor: 'left', dy: 14 }),
  node('NAG'),
  node('BOM', { name: 'Mumbai', anchor: 'left', dy: 2 }),
  node('PNQ'),
  node('HYD'),
  node('MAA', { name: 'Chennai', anchor: 'right', dy: 4 }),
  node('BLR', { name: 'Bengaluru', anchor: 'left', dy: 12 }),
];

function ctrl(a: NodeDef, b: NodeDef): { x: number; y: number } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const lift = 0.14 * Math.hypot(b.x - a.x, b.y - a.y);
  return { x: mx, y: my - lift - 0.03 };
}

function qPoint(
  a: { x: number; y: number },
  c: { x: number; y: number },
  b: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

interface Parcel {
  dest: number;
  t: number;
  speed: number;
  delay: number;
}
interface Pulse {
  x: number;
  y: number;
  r: number;
  alpha: number;
  color: string;
}

const TOKENS = [
  '--map-land',
  '--map-coast',
  '--map-bd-fill',
  '--map-bd-coast',
  '--map-halo',
  '--map-blip',
  '--fg-muted',
  '--fg-strong',
  '--scene-arc-out',
  '--scene-arc-in',
  '--font-sans-face',
] as const;
type Token = (typeof TOKENS)[number];
const FALLBACK: Record<Token, string> = {
  '--map-land': 'rgba(180,197,255,0.05)',
  '--map-coast': 'rgba(180,197,255,0.30)',
  '--map-bd-fill': 'rgba(251,191,36,0.10)',
  '--map-bd-coast': 'rgba(251,191,36,0.50)',
  '--map-halo': 'rgba(180,197,255,0.34)',
  '--map-blip': '#b4c5ff',
  '--fg-muted': '#8296b0',
  '--fg-strong': '#f1f5ff',
  '--scene-arc-out': '#fbbf24',
  '--scene-arc-in': '#34d399',
  '--font-sans-face': 'system-ui',
};

/** `#rrggbb` (or `#rrggbbaa`) → `rgba(r,g,b,a)` at the given alpha. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex.trim());
  if (!m) return hex;
  return `rgba(${parseInt(m[1] ?? '0', 16)},${parseInt(m[2] ?? '0', 16)},${parseInt(m[3] ?? '0', 16)},${alpha})`;
}

export function CorridorConsole({
  direction = 'out',
  labels = true,
}: {
  direction?: MapDirection;
  labels?: boolean;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dirRef = useRef<MapDirection>(direction);
  const labelsRef = useRef(labels);
  /** Set by the mount effect; the prop effects call it. */
  const redraw = useRef<((resetFlights: boolean) => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0;
    let H = 0;
    let S = 0;
    let OX = 0;
    let OY = 0;
    let raf = 0;
    let running = false;
    let tokens = readTokens(TOKENS, FALLBACK);

    // With 14 lanes, keep ~4 parcels airborne at once — the rest wait on
    // staggered delays so traffic reads alive, not swarmed.
    const parcels: Parcel[] = DESTS.map((_, i) => ({
      dest: i,
      t: i % 3 === 0 ? Math.random() * 0.8 : 0,
      speed: 0.0016 + Math.random() * 0.0012,
      delay: i % 3 === 0 ? 0 : 90 + Math.random() * 700,
    }));
    const pulses: Pulse[] = [];
    let beat = 0;

    const resize = (): void => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.round(rect.width);
      H = Math.round(rect.height);
      canvas.width = Math.max(1, Math.round(W * dpr));
      canvas.height = Math.max(1, Math.round(H * dpr));
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The [0..1]² map fits the box's height generously; coastlines may
      // bleed past the sides, which reads as a viewport, not a stamp.
      S = Math.max(Math.min(W, H) * 1.06, Math.min(W * 0.8, H * 1.35));
      OX = (W - S) / 2;
      OY = (H - S) / 2;
    };

    const px = (n: { x: number; y: number }): { x: number; y: number } => ({
      x: OX + n.x * S,
      y: OY + n.y * S,
    });

    const tracePath = (g: CanvasRenderingContext2D, ring: Ring): void => {
      const first = ring[0];
      if (!first) return;
      const f = px({ x: first[0], y: first[1] });
      g.beginPath();
      g.moveTo(f.x, f.y);
      for (let i = 1; i < ring.length; i++) {
        const pt = ring[i];
        if (!pt) continue;
        const p = px({ x: pt[0], y: pt[1] });
        g.lineTo(p.x, p.y);
      }
      g.closePath();
    };

    const font = (weight: number, size: number): string =>
      `${weight} ${size}px ${tokens['--font-sans-face']}, system-ui, sans-serif`;

    /** The corridor gradient along one arc, dominant colour by direction. */
    const arcGradient = (
      o: { x: number; y: number },
      d: { x: number; y: number },
    ): CanvasGradient => {
      const out = dirRef.current === 'out';
      const g = ctx.createLinearGradient(o.x, o.y, d.x, d.y);
      const green = tokens['--scene-arc-in'];
      const saffron = tokens['--scene-arc-out'];
      if (out) {
        g.addColorStop(0, withAlpha(green, 0.7));
        g.addColorStop(0.45, withAlpha(saffron, 0.6));
        g.addColorStop(1, withAlpha(saffron, 0.35));
      } else {
        g.addColorStop(0, withAlpha(saffron, 0.35));
        g.addColorStop(0.55, withAlpha(green, 0.6));
        g.addColorStop(1, withAlpha(green, 0.7));
      }
      return g;
    };

    // The static layer (land, arcs, pins, names) is painted once into an
    // offscreen canvas and blitted each frame; it is rebuilt on resize,
    // theme change and direction change.
    let base: HTMLCanvasElement | null = null;
    const drawBase = (g: CanvasRenderingContext2D): void => {
      g.clearRect(0, 0, W, H);
      g.lineWidth = 1;
      for (const ring of LAND_RINGS) {
        tracePath(g, ring);
        g.fillStyle = tokens['--map-land'];
        g.fill();
        g.strokeStyle = tokens['--map-coast'];
        g.stroke();
      }
      for (const ring of BD_RINGS) {
        tracePath(g, ring);
        g.fillStyle = tokens['--map-bd-fill'];
        g.fill();
        g.strokeStyle = tokens['--map-bd-coast'];
        g.stroke();
      }
      // Routes — the corridor gradient, solid and thin.
      const o = px(ORIGIN);
      for (const d of DESTS) {
        const cp = px(ctrl(ORIGIN, d));
        const dp = px(d);
        g.beginPath();
        g.moveTo(o.x, o.y);
        g.quadraticCurveTo(cp.x, cp.y, dp.x, dp.y);
        g.strokeStyle = arcGradient(o, dp);
        g.lineWidth = 1.25;
        g.stroke();
      }
      // Destination dots (+ halo), names for the six.
      g.font = font(600, 12);
      g.textBaseline = 'middle';
      for (const d of DESTS) {
        const dp = px(d);
        g.beginPath();
        g.arc(dp.x, dp.y, 3, 0, Math.PI * 2);
        g.fillStyle = tokens['--map-blip'];
        g.fill();
        g.beginPath();
        g.arc(dp.x, dp.y, 7, 0, Math.PI * 2);
        g.strokeStyle = tokens['--map-halo'];
        g.lineWidth = 1;
        g.stroke();
        if (labelsRef.current && d.name) {
          g.fillStyle = tokens['--fg-strong'];
          g.textAlign = d.anchor === 'left' ? 'right' : 'left';
          const dx = d.anchor === 'left' ? -11 : 11;
          g.fillText(d.name, dp.x + dx, dp.y + (d.dy ?? 0));
        }
      }
      // Dhaka — the origin, in saffron; its pulse is drawn per frame.
      g.beginPath();
      g.arc(o.x, o.y, 4, 0, Math.PI * 2);
      g.fillStyle = tokens['--scene-arc-out'];
      g.fill();
      if (labelsRef.current && ORIGIN.name) {
        g.fillStyle = tokens['--fg-strong'];
        g.font = font(700, 13);
        g.textAlign = 'left';
        g.fillText(ORIGIN.name, o.x + 12, o.y + (ORIGIN.dy ?? 0));
      }
      g.textAlign = 'start';
    };
    const renderBase = (): void => {
      if (W === 0 || H === 0) {
        base = null;
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      base = document.createElement('canvas');
      base.width = Math.round(W * dpr);
      base.height = Math.round(H * dpr);
      const bctx = base.getContext('2d');
      if (!bctx) return;
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBase(bctx);
    };
    const drawStatic = (): void => {
      if (W === 0 || H === 0) return;
      // The FULL canvas, every frame — a stale strip after a resize is
      // exactly the artefact the Phase 3 review found.
      ctx.clearRect(0, 0, W, H);
      if (base) ctx.drawImage(base, 0, 0, W, H);
      else drawBase(ctx);
    };

    const drawFrame = (): void => {
      if (W === 0 || H === 0) return;
      drawStatic();
      const out = dirRef.current === 'out';
      const flight = out ? tokens['--scene-arc-out'] : tokens['--scene-arc-in'];
      const o = px(ORIGIN);
      beat += 1;

      // Dhaka pulses — a ring every ~1.6 s, fading as it grows.
      const period = 48;
      for (let k = 0; k < 2; k++) {
        const ph = ((beat + k * (period / 2)) % period) / period;
        ctx.beginPath();
        ctx.arc(o.x, o.y, 5 + ph * 16, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(tokens['--scene-arc-out'], 0.55 * (1 - ph));
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      for (const p of parcels) {
        if (p.delay > 0) {
          p.delay -= 1;
          continue;
        }
        p.t += p.speed;
        const dest = DESTS[p.dest];
        if (!dest) continue;
        if (p.t >= 1) {
          const land = out ? px(dest) : o;
          pulses.push({ x: land.x, y: land.y, r: 4, alpha: 0.7, color: flight });
          p.t = 0;
          p.delay = 260 + Math.random() * 640;
          p.speed = 0.0016 + Math.random() * 0.0012;
          continue;
        }
        // Direction 'in' flies the same arc backwards: metro → Dhaka.
        const from = out ? ORIGIN : dest;
        const to = out ? dest : ORIGIN;
        const c = ctrl(ORIGIN, dest);
        const pos = qPoint(from, c, to, p.t);
        const pp = px(pos);
        const tBack = Math.max(0, p.t - 0.05);
        const bp = px(qPoint(from, c, to, tBack));
        // Altitude — parcels FLY above the route; a faint ground marker
        // on the arc below sells the third dimension without 3D.
        const alt = Math.sin(p.t * Math.PI) * S * 0.035;
        const altBack = Math.sin(tBack * Math.PI) * S * 0.035;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 1.3, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(flight, 0.45);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(pp.x, pp.y);
        ctx.lineTo(pp.x, pp.y - alt);
        ctx.strokeStyle = withAlpha(flight, 0.35);
        ctx.lineWidth = 0.75;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(bp.x, bp.y - altBack);
        ctx.lineTo(pp.x, pp.y - alt);
        ctx.strokeStyle = withAlpha(flight, 0.75);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // Glow: concentric fills — no shadowBlur (kills software rendering).
        ctx.beginPath();
        ctx.arc(pp.x, pp.y - alt, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(flight, 0.2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pp.x, pp.y - alt, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = flight;
        ctx.fill();
      }

      for (let i = pulses.length - 1; i >= 0; i--) {
        const pu = pulses[i];
        if (!pu) continue;
        pu.r += 0.65;
        pu.alpha -= 0.018;
        if (pu.alpha <= 0) {
          pulses.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
        ctx.strokeStyle = withAlpha(pu.color, pu.alpha);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    };

    let lastT = 0;
    const loop = (t: number): void => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (t - lastT < 33) return;
      lastT = t;
      drawFrame();
    };
    const start = (): void => {
      if (running || reduced) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = (): void => {
      running = false;
      cancelAnimationFrame(raf);
    };

    redraw.current = (resetFlights) => {
      if (resetFlights) {
        parcels.forEach((p, i) => {
          p.t = 0;
          p.delay = (i % 4) * 40;
        });
        pulses.length = 0;
      }
      renderBase();
      if (running) drawFrame();
      else drawStatic();
    };

    resize();
    // The FIRST frame is deferred past hydration too, not only the loop:
    // the base-map render (a thousand-point coastline at device pixel
    // ratio) used to run inside the hydration task and was ~80 ms of
    // Total Blocking Time on a 4×-throttled phone. The canvas is text-free
    // to the page (its names are paint), so nothing measurable waits.
    let idleId = 0;
    const ric: (cb: () => void) => number =
      'requestIdleCallback' in window
        ? (cb) => window.requestIdleCallback(cb, { timeout: 2500 })
        : (cb) => window.setTimeout(cb, 1200) as unknown as number;
    idleId = ric(() => {
      renderBase();
      drawStatic();
      if (!reduced) start();
    });

    const ro = new ResizeObserver(() => {
      resize();
      renderBase();
      drawStatic();
    });
    ro.observe(host);

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? false;
        if (reduced) return;
        if (visible) start();
        else stop();
      },
      { threshold: 0.05 },
    );
    io.observe(host);

    const onVis = (): void => {
      if (reduced) return;
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVis);

    // Both theme triggers: the toggle's data-theme AND the OS preference
    // flipping under an unpinned page (the second was missed for months —
    // the map stayed dark while the page went light).
    const unsubTheme = subscribeThemeTokens(() => {
      tokens = readTokens(TOKENS, FALLBACK);
      renderBase();
      drawStatic();
    });

    return () => {
      stop();
      redraw.current = null;
      if (idleId && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
      ro.disconnect();
      io.disconnect();
      unsubTheme();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    if (dirRef.current === direction && labelsRef.current === labels) return;
    const flip = dirRef.current !== direction;
    dirRef.current = direction;
    labelsRef.current = labels;
    redraw.current?.(flip);
  }, [direction, labels]);

  return (
    <div className="relative h-full min-h-[280px] w-full">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block"
        role="img"
        aria-label={
          direction === 'out'
            ? 'Map of South Asia: parcels flying from Dhaka to Delhi, Kolkata, Mumbai, Bengaluru, Chennai and other Indian cities'
            : 'Map of South Asia: parcels flying from Indian cities to Dhaka'
        }
      />
    </div>
  );
}
