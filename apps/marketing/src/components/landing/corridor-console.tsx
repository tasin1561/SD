'use client';

import { useEffect, useRef, type ReactElement } from 'react';

/**
 * THE SIGNATURE MOMENT (docs/design-direction.md §5).
 *
 * Hand-built canvas 2D: a long-range phosphor map of the BD → IN
 * corridor. Dhaka origin, four Indian destination nodes, parcels flying
 * the arcs with fading trails, arrival pulses, and a periodic scan
 * sweep. Zero libraries (~6KB), DPR-aware (≤2), rAF pauses when the
 * canvas leaves the viewport or the tab hides.
 *
 * Reduced-motion: renders ONE static frame (routes + nodes, no parcels
 * in flight, no sweep) and never animates.
 *
 * Geography note: stylized, not literal — flow reads left (BD) → right
 * (IN) because forward motion reads LTR; the label set is real.
 */

interface Node {
  x: number;
  y: number;
  label: string;
  origin?: boolean;
}

const ORIGIN: Node = { x: 0.10, y: 0.58, label: 'DAC', origin: true };
const DESTS: Node[] = [
  { x: 0.58, y: 0.20, label: 'DEL' },
  { x: 0.46, y: 0.52, label: 'CCU' },
  { x: 0.74, y: 0.74, label: 'BOM' },
  { x: 0.90, y: 0.44, label: 'BLR' },
];

// Quadratic-bezier control point for each arc — lifts the route.
function ctrl(a: Node, b: Node): { x: number; y: number } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  // Perpendicular lift, sign chosen to arc "up" mostly
  const lift = 0.16 * (b.x - a.x);
  return { x: mx, y: my - Math.abs(lift) - 0.06 };
}

function qPoint(a: Node, c: { x: number; y: number }, b: Node, t: number): { x: number; y: number } {
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
  delay: number; // frames to wait before (re)launch
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
    let raf = 0;
    let running = false;

    const colors = {
      sky: '#38BDF8',
      saffron: '#F59E0B',
      green: '#34D399',
      muted: '#8296AE',
      grid: 'rgba(56,189,248,0.06)',
      // Theme-tuned stroke alphas — DAY OPS needs deeper ink than the
      // phosphor look; these are re-derived on theme change.
      route: 'rgba(56,189,248,0.16)',
      halo: 'rgba(56,189,248,0.35)',
      trail: 'rgba(56,189,248,0.5)',
      sweepTint: '56,189,248',
      blip: '#38BDF8',
    };
    const readColors = (): void => {
      const cs = getComputedStyle(document.documentElement);
      colors.sky = cs.getPropertyValue('--sky').trim() || colors.sky;
      colors.saffron = cs.getPropertyValue('--saffron').trim() || colors.saffron;
      colors.green = cs.getPropertyValue('--green').trim() || colors.green;
      colors.muted = cs.getPropertyValue('--fg-muted').trim() || colors.muted;
      colors.grid = cs.getPropertyValue('--grid').trim() || colors.grid;
      const light = cs.colorScheme.includes('light');
      colors.route = light ? 'rgba(2,132,199,0.30)' : 'rgba(56,189,248,0.16)';
      colors.halo = light ? 'rgba(2,132,199,0.45)' : 'rgba(56,189,248,0.35)';
      colors.trail = light ? 'rgba(2,132,199,0.60)' : 'rgba(56,189,248,0.5)';
      colors.sweepTint = light ? '2,132,199' : '56,189,248';
      colors.blip = light ? '#0284C7' : colors.sky;
    };
    readColors();

    const parcels: Parcel[] = DESTS.map((_, i) => ({
      dest: i,
      t: Math.random() * 0.9,
      speed: 0.0016 + Math.random() * 0.0012,
      delay: 0,
    }));
    const pulses: Pulse[] = [];
    let sweep = -0.2; // sweep x position in normalized units

    const resize = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.round(rect.width);
      H = Math.round(rect.height);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const px = (n: { x: number; y: number }): { x: number; y: number } => ({
      x: n.x * W,
      y: n.y * H,
    });

    // Offscreen cache for the static base layer (grid + routes + nodes).
    // Software-rendered environments choke on hundreds of fillRects per
    // frame; blitting one cached bitmap keeps frames ~1ms.
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

      // Dot grid
      g.fillStyle = colors.grid;
      const step = 34;
      for (let gx = step / 2; gx < W; gx += step) {
        for (let gy = step / 2; gy < H; gy += step) {
          g.fillRect(gx, gy, 1.5, 1.5);
        }
      }

      // Routes
      const o = px(ORIGIN);
      for (const d of DESTS) {
        const c = ctrl(ORIGIN, d);
        const cp = px({ label: '', ...c } as Node);
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
      g.font = '10px var(--font-jetbrains), monospace';
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
        g.fillText(d.label, dp.x + 12, dp.y + 3);
      }

      // Origin node — saffron (the one saffron use in the hero viewport)
      g.beginPath();
      g.arc(o.x, o.y, 4, 0, Math.PI * 2);
      g.fillStyle = colors.saffron;
      g.fill();
      g.beginPath();
      g.arc(o.x, o.y, 10, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(245,158,11,0.4)';
      g.stroke();
      g.fillStyle = colors.muted;
      g.fillText(ORIGIN.label, o.x - 4, o.y + 24);
    };

    const drawFrame = (): void => {
      drawStatic();

      // Scan sweep — a vertical soft band gliding across
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
        const pp = px({ label: '', ...pos } as Node);
        // Tail
        const back = qPoint(ORIGIN, c, dest, Math.max(0, p.t - 0.05));
        const bp = px({ label: '', ...back } as Node);
        ctx.beginPath();
        ctx.moveTo(bp.x, bp.y);
        ctx.lineTo(pp.x, pp.y);
        ctx.strokeStyle = colors.trail;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // Blip
        // Glow: two concentric fills — no shadowBlur (kills software rendering)
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = colors.trail.replace(/[\d.]+\)$/, '0.18)');
        ctx.fill();
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, 2.6, 0, Math.PI * 2);
        ctx.fillStyle = colors.blip;
        ctx.fill();
      }

      // Arrival pulses — expanding green rings (delivered)
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
      // 30fps cap — half the work, visually identical for slow blips
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
      if (reduced) drawStatic();
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
      if (reduced) drawStatic();
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
        aria-label="Live corridor map: parcels moving from Dhaka to Delhi, Kolkata, Mumbai, and Bangalore with delivery confirmations"
      />
    </div>
  );
}
