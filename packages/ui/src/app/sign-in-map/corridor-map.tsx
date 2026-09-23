'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { reducedMotion } from '../motion/motion';
import { BD_RINGS, GEO_NODES, LAND_RINGS, type Ring } from './map-geometry';

/**
 * CorridorMap — the calm map behind the sign-in screen: real Natural
 * Earth coastlines, Dhaka and the Indian metros at their true positions,
 * and a few parcels flying the corridor.
 *
 * Moved here from the three apps' `auth-console/corridor-console.tsx`
 * (one copy instead of three). What changed on the way:
 *   - every colour is READ from the brand `--map-*` tokens (plus `--grid`,
 *     `--saffron`, `--green`) via getComputedStyle — no colour literal
 *     anywhere; translucency comes from `globalAlpha`, not from building
 *     a colour string by hand;
 *   - it repaints on BOTH theme triggers: the `data-theme` pin (and the
 *     `data-reduced` motion pin) through a MutationObserver, and the OS
 *     `prefers-color-scheme` flipping under an unpinned page;
 *   - no mono telemetry labels — it is a background, not a readout;
 *   - reduced motion (OS or the per-user setting) draws ONE frame.
 *
 * The base layer (grid, land, routes, nodes) renders once to an offscreen
 * canvas and is blitted per frame; the loop (capped at 30fps) draws only
 * the flights and arrival rings, starts when the browser is idle, and
 * pauses off-screen and on a hidden tab.
 */

interface Node {
  readonly x: number;
  readonly y: number;
}

function geo(id: string): Node {
  const p = GEO_NODES[id] ?? [0.5, 0.5];
  return { x: p[0], y: p[1] };
}

const ORIGIN = geo('DAC');
const DESTS: readonly Node[] = [
  'DEL',
  'JAI',
  'LKO',
  'GAU',
  'PAT',
  'BBI',
  'AMD',
  'CCU',
  'NAG',
  'BOM',
  'PNQ',
  'HYD',
  'MAA',
  'BLR',
].map(geo);

function ctrl(a: Node, b: Node): Node {
  const lift = 0.14 * Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - lift - 0.03 };
}

function qPoint(a: Node, c: Node, b: Node, t: number): Node {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

interface Palette {
  grid: string;
  land: string;
  coast: string;
  bdFill: string;
  bdCoast: string;
  route: string;
  halo: string;
  trail: string;
  blip: string;
  origin: string;
  arrive: string;
}

function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string): string => cs.getPropertyValue(name).trim();
  return {
    grid: v('--grid'),
    land: v('--map-land'),
    coast: v('--map-coast'),
    bdFill: v('--map-bd-fill'),
    bdCoast: v('--map-bd-coast'),
    route: v('--map-route'),
    halo: v('--map-halo'),
    trail: v('--map-trail'),
    blip: v('--map-blip'),
    origin: v('--saffron'),
    arrive: v('--green'),
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
}

export function CorridorMap({ className }: { readonly className?: string }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    let colors = readPalette(canvas);
    let W = 0;
    let H = 0;
    let S = 0;
    let OX = 0;
    let OY = 0;
    let raf = 0;
    let running = false;
    let visible = true;
    let base: HTMLCanvasElement | null = null;

    const parcels: Parcel[] = DESTS.map((_, i) => ({
      dest: i,
      t: i % 3 === 0 ? Math.random() * 0.8 : 0,
      speed: 0.0014 + Math.random() * 0.001,
      delay: i % 3 === 0 ? 0 : 90 + Math.random() * 700,
    }));
    const pulses: Pulse[] = [];

    const px = (n: Node): Node => ({ x: OX + n.x * S, y: OY + n.y * S });

    const paint = (
      g: CanvasRenderingContext2D,
      color: string,
      alpha: number,
      fn: () => void,
    ): void => {
      if (color === '') return;
      g.globalAlpha = alpha;
      fn();
      g.globalAlpha = 1;
    };

    const trace = (g: CanvasRenderingContext2D, ring: Ring): void => {
      const first = ring[0];
      if (first === undefined) return;
      const f = px({ x: first[0], y: first[1] });
      g.beginPath();
      g.moveTo(f.x, f.y);
      for (let i = 1; i < ring.length; i += 1) {
        const pt = ring[i];
        if (pt === undefined) continue;
        const p = px({ x: pt[0], y: pt[1] });
        g.lineTo(p.x, p.y);
      }
      g.closePath();
    };

    const drawBase = (g: CanvasRenderingContext2D): void => {
      g.clearRect(0, 0, W, H);
      if (colors.grid !== '') {
        g.fillStyle = colors.grid;
        const step = 34;
        for (let gx = step / 2; gx < W; gx += step) {
          for (let gy = step / 2; gy < H; gy += step) g.fillRect(gx, gy, 1.5, 1.5);
        }
      }
      g.lineWidth = 1;
      for (const ring of LAND_RINGS) {
        trace(g, ring);
        if (colors.land !== '') {
          g.fillStyle = colors.land;
          g.fill();
        }
        if (colors.coast !== '') {
          g.strokeStyle = colors.coast;
          g.stroke();
        }
      }
      for (const ring of BD_RINGS) {
        trace(g, ring);
        if (colors.bdFill !== '') {
          g.fillStyle = colors.bdFill;
          g.fill();
        }
        if (colors.bdCoast !== '') {
          g.strokeStyle = colors.bdCoast;
          g.stroke();
        }
      }
      const o = px(ORIGIN);
      if (colors.route !== '') {
        g.strokeStyle = colors.route;
        g.setLineDash([4, 5]);
        for (const d of DESTS) {
          const c = px(ctrl(ORIGIN, d));
          const dp = px(d);
          g.beginPath();
          g.moveTo(o.x, o.y);
          g.quadraticCurveTo(c.x, c.y, dp.x, dp.y);
          g.stroke();
        }
        g.setLineDash([]);
      }
      for (const d of DESTS) {
        const dp = px(d);
        paint(g, colors.blip, 1, () => {
          g.beginPath();
          g.arc(dp.x, dp.y, 3, 0, Math.PI * 2);
          g.fillStyle = colors.blip;
          g.fill();
        });
        paint(g, colors.halo, 1, () => {
          g.beginPath();
          g.arc(dp.x, dp.y, 8, 0, Math.PI * 2);
          g.strokeStyle = colors.halo;
          g.stroke();
        });
      }
      paint(g, colors.origin, 1, () => {
        g.beginPath();
        g.arc(o.x, o.y, 4, 0, Math.PI * 2);
        g.fillStyle = colors.origin;
        g.fill();
      });
      paint(g, colors.bdCoast, 1, () => {
        g.beginPath();
        g.arc(o.x, o.y, 10, 0, Math.PI * 2);
        g.strokeStyle = colors.bdCoast;
        g.stroke();
      });
    };

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.round(rect.width);
      H = Math.round(rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      S = Math.max(Math.min(W, H) * 1.06, Math.min(W * 0.8, H * 1.35));
      OX = (W - S) / 2;
      OY = (H - S) / 2;
    };

    const renderBase = (): void => {
      if (W === 0 || H === 0) {
        base = null;
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const off = document.createElement('canvas');
      off.width = Math.round(W * dpr);
      off.height = Math.round(H * dpr);
      const bctx = off.getContext('2d');
      if (bctx === null) {
        base = null;
        return;
      }
      bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBase(bctx);
      base = off;
    };

    const drawStatic = (): void => {
      if (W === 0 || H === 0) return;
      ctx.clearRect(0, 0, W, H);
      if (base !== null) ctx.drawImage(base, 0, 0, W, H);
      else drawBase(ctx);
    };

    const drawFrame = (): void => {
      if (W === 0 || H === 0) return;
      drawStatic();
      for (const p of parcels) {
        if (p.delay > 0) {
          p.delay -= 1;
          continue;
        }
        p.t += p.speed;
        const dest = DESTS[p.dest];
        if (dest === undefined) continue;
        if (p.t >= 1) {
          const dp = px(dest);
          pulses.push({ x: dp.x, y: dp.y, r: 4, alpha: 0.7 });
          p.t = 0;
          p.delay = 260 + Math.random() * 640;
          p.speed = 0.0014 + Math.random() * 0.001;
          continue;
        }
        const c = ctrl(ORIGIN, dest);
        const pp = px(qPoint(ORIGIN, c, dest, p.t));
        const tBack = Math.max(0, p.t - 0.05);
        const bp = px(qPoint(ORIGIN, c, dest, tBack));
        const alt = Math.sin(p.t * Math.PI) * S * 0.035;
        const altBack = Math.sin(tBack * Math.PI) * S * 0.035;
        paint(ctx, colors.trail, 1, () => {
          ctx.beginPath();
          ctx.moveTo(bp.x, bp.y - altBack);
          ctx.lineTo(pp.x, pp.y - alt);
          ctx.strokeStyle = colors.trail;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.lineWidth = 1;
        });
        paint(ctx, colors.halo, 0.45, () => {
          ctx.beginPath();
          ctx.arc(pp.x, pp.y - alt, 5.5, 0, Math.PI * 2);
          ctx.fillStyle = colors.halo;
          ctx.fill();
        });
        paint(ctx, colors.blip, 1, () => {
          ctx.beginPath();
          ctx.arc(pp.x, pp.y - alt, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = colors.blip;
          ctx.fill();
        });
      }
      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        const pu = pulses[i];
        if (pu === undefined) continue;
        pu.r += 0.6;
        pu.alpha -= 0.018;
        if (pu.alpha <= 0) {
          pulses.splice(i, 1);
          continue;
        }
        paint(ctx, colors.arrive, pu.alpha, () => {
          ctx.beginPath();
          ctx.arc(pu.x, pu.y, pu.r, 0, Math.PI * 2);
          ctx.strokeStyle = colors.arrive;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.lineWidth = 1;
        });
      }
    };

    let lastT = 0;
    const loop = (t: number): void => {
      if (!running) return;
      raf = window.requestAnimationFrame(loop);
      if (t - lastT < 33) return;
      lastT = t;
      drawFrame();
    };
    const start = (): void => {
      if (running || reducedMotion() || !visible || document.hidden) return;
      running = true;
      raf = window.requestAnimationFrame(loop);
    };
    const stop = (): void => {
      running = false;
      window.cancelAnimationFrame(raf);
    };
    const repaint = (): void => {
      colors = readPalette(canvas);
      renderBase();
      drawStatic();
      if (reducedMotion()) stop();
      else start();
    };

    resize();
    renderBase();
    drawStatic();

    let idleId = 0;
    let timerId = 0;
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(() => start(), { timeout: 2500 });
    } else {
      timerId = window.setTimeout(start, 1200);
    }

    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            resize();
            renderBase();
            drawStatic();
          });
    ro?.observe(canvas);

    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              visible = entries[0]?.isIntersecting ?? false;
              if (visible) start();
              else stop();
            },
            { threshold: 0.05 },
          );
    io?.observe(canvas);

    const onVis = (): void => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVis);

    const mo = new MutationObserver(repaint);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-reduced'],
    });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    scheme.addEventListener('change', repaint);
    motion.addEventListener('change', repaint);

    return () => {
      stop();
      if (idleId !== 0 && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId);
      }
      if (timerId !== 0) window.clearTimeout(timerId);
      ro?.disconnect();
      io?.disconnect();
      mo.disconnect();
      scheme.removeEventListener('change', repaint);
      motion.removeEventListener('change', repaint);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{ display: 'block', width: '100%', height: '100%' }}
    />
  );
}
