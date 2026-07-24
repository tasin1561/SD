'use client';

import { useEffect, useRef, type ReactElement } from 'react';
import { BD_RINGS, LAND_RINGS, GEO_NODES, type Ring } from './map-geometry';

/**
 * THE SIGNATURE MOMENT (docs/design-direction.md §5) — v2 with REAL
 * cartography. Natural Earth 50m coastlines (simplified + projected at
 * build time into map-geometry.ts) drawn as a phosphor basemap; corridor
 * nodes pinned to true lat/lon — Dhaka east, Indian metros west, so
 * flights read geographically correctly (right → left).
 *
 * Still zero libraries. Base layer (map + grid + routes + nodes) is
 * rendered ONCE to an offscreen canvas and blitted per frame; the rAF
 * loop (30fps cap) only draws flights, pulses, and the scan sweep.
 * Starts on requestIdleCallback; pauses off-viewport + tab-hidden;
 * reduced-motion renders a single static frame.
 */

interface NodeDef {
  id: string;
  x: number;
  y: number;
  label: string;
  labelDx: number;
  labelDy: number;
  origin?: boolean;
}

function geo(id: string): readonly [number, number] {
  return GEO_NODES[id] ?? [0.5, 0.5];
}

const ORIGIN: NodeDef = {
  id: 'DAC', x: geo('DAC')[0], y: geo('DAC')[1],
  label: 'DAC', labelDx: 12, labelDy: -10, origin: true,
};
const DESTS: NodeDef[] = [
  { id: 'DEL', x: geo('DEL')[0], y: geo('DEL')[1], label: 'DEL', labelDx: -34, labelDy: -8 },
  { id: 'CCU', x: geo('CCU')[0], y: geo('CCU')[1], label: 'CCU', labelDx: -36, labelDy: 18 },
  { id: 'BOM', x: geo('BOM')[0], y: geo('BOM')[1], label: 'BOM', labelDx: -38, labelDy: 4 },
  { id: 'BLR', x: geo('BLR')[0], y: geo('BLR')[1], label: 'BLR', labelDx: 12, labelDy: 12 },
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
}

export function CorridorConsole(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let W = 0;
    let H = 0;
    // Aspect-preserving map fit: normalized [0..1]² region → centered
    // square of side S with offsets (OX, OY). Margins show the dot grid.
    let S = 0;
    let OX = 0;
    let OY = 0;
    let raf = 0;
    let running = false;

    const colors = {
      saffron: '#F59E0B',
      muted: '#8296AE',
      grid: 'rgba(56,189,248,0.06)',
      land: 'rgba(56,189,248,0.04)',
      coast: 'rgba(116,166,220,0.35)',
      bdFill: 'rgba(245,158,11,0.08)',
      bdCoast: 'rgba(245,158,11,0.45)',
      route: 'rgba(56,189,248,0.16)',
      halo: 'rgba(56,189,248,0.35)',
      trail: 'rgba(56,189,248,0.5)',
      sweepTint: '56,189,248',
      blip: '#38BDF8',
    };
    const readColors = (): void => {
      const cs = getComputedStyle(document.documentElement);
      colors.saffron = cs.getPropertyValue('--saffron').trim() || colors.saffron;
      colors.muted = cs.getPropertyValue('--fg-muted').trim() || colors.muted;
      colors.grid = cs.getPropertyValue('--grid').trim() || colors.grid;
      const light = cs.colorScheme.includes('light');
      colors.land = light ? 'rgba(2,132,199,0.05)' : 'rgba(56,189,248,0.04)';
      colors.coast = light ? 'rgba(2,110,170,0.45)' : 'rgba(116,166,220,0.35)';
      colors.bdFill = light ? 'rgba(217,119,6,0.10)' : 'rgba(245,158,11,0.08)';
      colors.bdCoast = light ? 'rgba(217,119,6,0.55)' : 'rgba(245,158,11,0.45)';
      colors.route = light ? 'rgba(2,132,199,0.30)' : 'rgba(56,189,248,0.16)';
      colors.halo = light ? 'rgba(2,132,199,0.45)' : 'rgba(56,189,248,0.35)';
      colors.trail = light ? 'rgba(2,132,199,0.60)' : 'rgba(56,189,248,0.5)';
      colors.sweepTint = light ? '2,132,199' : '56,189,248';
      colors.blip = light ? '#0284C7' : '#38BDF8';
    };
    readColors();

    const parcels: Parcel[] = DESTS.map((_, i) => ({
      dest: i,
      t: Math.random() * 0.9,
      speed: 0.0016 + Math.random() * 0.0012,
      delay: 0,
    }));
    const pulses: Pulse[] = [];
    let sweep = -0.2;

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.round(rect.width);
      H = Math.round(rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Map region is square-ish; scale it to fill the panel's height
      // generously — coastlines may bleed past the sides, which reads
      // as a real console viewport, not a shrunken postage stamp.
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

    let base: HTMLCanvasElement | null = null;
    const renderBase = (): void => {
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
      ctx.clearRect(0, 0, W, H);
      if (base) {
        ctx.drawImage(base, 0, 0, W, H);
        return;
      }
      drawBase(ctx);
    };

    const drawBase = (g: CanvasRenderingContext2D): void => {
      g.clearRect(0, 0, W, H);

      // Dot grid across the whole panel
      g.fillStyle = colors.grid;
      const step = 34;
      for (let gx = step / 2; gx < W; gx += step) {
        for (let gy = step / 2; gy < H; gy += step) {
          g.fillRect(gx, gy, 1.5, 1.5);
        }
      }

      // Landmass — real Natural Earth coastlines
      g.lineWidth = 1;
      for (const ring of LAND_RINGS) {
        tracePath(g, ring);
        g.fillStyle = colors.land;
        g.fill();
        g.strokeStyle = colors.coast;
        g.stroke();
      }
      // Bangladesh — origin country, warmer
      for (const ring of BD_RINGS) {
        tracePath(g, ring);
        g.fillStyle = colors.bdFill;
        g.fill();
        g.strokeStyle = colors.bdCoast;
        g.stroke();
      }

      // Routes
      const o = px(ORIGIN);
      for (const d of DESTS) {
        const c = ctrl(ORIGIN, d);
        const cp = px(c);
        const dp = px(d);
        g.beginPath();
        g.moveTo(o.x, o.y);
        g.quadraticCurveTo(cp.x, cp.y, dp.x, dp.y);
        g.strokeStyle = colors.route;
        g.lineWidth = 1;
        g.setLineDash([4, 5]);
        g.stroke();
        g.setLineDash([]);
      }

      // Destination nodes
      g.font = '10px ui-monospace, monospace';
      for (const d of DESTS) {
        const dp = px(d);
        g.beginPath();
        g.arc(dp.x, dp.y, 3.2, 0, Math.PI * 2);
        g.fillStyle = colors.blip;
        g.fill();
        g.beginPath();
        g.arc(dp.x, dp.y, 8, 0, Math.PI * 2);
        g.strokeStyle = colors.halo;
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = colors.muted;
        g.fillText(d.label, dp.x + d.labelDx, dp.y + d.labelDy);
      }

      // Origin — saffron
      g.beginPath();
      g.arc(o.x, o.y, 4, 0, Math.PI * 2);
      g.fillStyle = colors.saffron;
      g.fill();
      g.beginPath();
      g.arc(o.x, o.y, 10, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(245,158,11,0.4)';
      g.stroke();
      g.fillStyle = colors.muted;
      g.fillText(ORIGIN.label, o.x + ORIGIN.labelDx, o.y + ORIGIN.labelDy);
    };

    const drawFrame = (): void => {
      drawStatic();

      // Scan sweep
      sweep += 0.0016;
      if (sweep > 1.25) sweep = -0.25;
      const sx = sweep * W;
      const grad = ctx.createLinearGradient(sx - 70, 0, sx + 8, 0);
      grad.addColorStop(0, `rgba(${colors.sweepTint},0)`);
      grad.addColorStop(1, `rgba(${colors.sweepTint},0.07)`);
      ctx.fillStyle = grad;
      ctx.fillRect(sx - 70, 0, 78, H);

      // Parcels
      for (const p of parcels) {
        if (p.delay > 0) {
          p.delay -= 1;
          continue;
        }
        p.t += p.speed;
        const dest = DESTS[p.dest];
        if (!dest) continue;
        if (p.t >= 1) {
          const dp = px(dest);
          pulses.push({ x: dp.x, y: dp.y, r: 4, alpha: 0.7 });
          p.t = 0;
          p.delay = 120 + Math.random() * 260;
          p.speed = 0.0016 + Math.random() * 0.0012;
          continue;
        }
        const c = ctrl(ORIGIN, dest);
        const pos = qPoint(ORIGIN, c, dest, p.t);
        const pp = px(pos);
        const back = qPoint(ORIGIN, c, dest, Math.max(0, p.t - 0.05));
        const bp = px(back);
        ctx.beginPath();
        ctx.moveTo(bp.x, bp.y);
        ctx.lineTo(pp.x, pp.y);
        ctx.strokeStyle = colors.trail;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // Glow: concentric fills — no shadowBlur (kills software rendering)
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = colors.trail.replace(/[\d.]+\)$/, '0.18)');
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = colors.blip;
        ctx.fill();
      }

      // Arrival pulses
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
        ctx.strokeStyle = `rgba(52,211,153,${pu.alpha.toFixed(3)})`;
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

    resize();
    renderBase();
    drawStatic();
    // Defer the animation loop past hydration/TTI — the static frame is
    // already on screen; flights begin when the main thread is idle.
    let idleId = 0;
    if (!reduced) {
      const ric: (cb: () => void) => number =
        'requestIdleCallback' in window
          ? (cb) => window.requestIdleCallback(cb, { timeout: 2500 })
          : (cb) => window.setTimeout(cb, 1200) as unknown as number;
      idleId = ric(() => start());
    }

    const ro = new ResizeObserver(() => {
      resize();
      renderBase();
      drawStatic();
    });
    ro.observe(canvas);

    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? false;
        if (reduced) return;
        if (visible) start();
        else stop();
      },
      { threshold: 0.05 },
    );
    io.observe(canvas);

    const onVis = (): void => {
      if (reduced) return;
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener('visibilitychange', onVis);

    const mo = new MutationObserver(() => {
      readColors();
      renderBase();
      drawStatic();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      stop();
      if (idleId && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <div className="relative w-full h-full min-h-[280px]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        role="img"
        aria-label="Live corridor map of South Asia: parcels moving from Dhaka to Delhi, Kolkata, Mumbai, and Bangalore with delivery confirmations"
      />
    </div>
  );
}
