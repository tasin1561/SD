'use client';

/**
 * 3D interaction primitives — hand-rolled, transform-only, ~1KB.
 *
 * TiltPanel: perspective tilt that follows the pointer (max `max` deg),
 * springs back on leave. Also exposes --px/--py (0..1 pointer position)
 * so children can render pointer-tracking glows.
 *
 * Gating: only active for (hover:hover) + (pointer:fine) and when
 * prefers-reduced-motion is NOT set. Touch devices get the plain panel.
 */

import { useEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';

function interactive(): boolean {
  return (
    window.matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function TiltPanel({
  children,
  max = 5,
  className,
  style,
}: {
  children: ReactNode;
  max?: number;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive()) return;

    let raf = 0;
    let targetRx = 0;
    let targetRy = 0;
    let rx = 0;
    let ry = 0;
    let hovering = false;

    const apply = (): void => {
      raf = 0;
      // Lerp toward target — cheap spring feel without a physics lib.
      rx += (targetRx - rx) * 0.18;
      ry += (targetRy - ry) * 0.18;
      el.style.transform = `perspective(1100px) rotateX(${rx.toFixed(3)}deg) rotateY(${ry.toFixed(3)}deg)`;
      if (Math.abs(targetRx - rx) > 0.01 || Math.abs(targetRy - ry) > 0.01 || hovering) {
        raf = requestAnimationFrame(apply);
      } else {
        el.style.transform = '';
      }
    };

    const onMove = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width; // 0..1
      const ny = (e.clientY - r.top) / r.height; // 0..1
      targetRy = (nx - 0.5) * 2 * max;
      targetRx = -(ny - 0.5) * 2 * max;
      el.style.setProperty('--px', `${(nx * 100).toFixed(1)}%`);
      el.style.setProperty('--py', `${(ny * 100).toFixed(1)}%`);
      hovering = true;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    const onLeave = (): void => {
      hovering = false;
      targetRx = 0;
      targetRy = 0;
      if (!raf) raf = requestAnimationFrame(apply);
    };

    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [max]);

  return (
    <div ref={ref} className={className} style={{ ...style, willChange: 'transform' }}>
      {children}
    </div>
  );
}

/** Magnetic pull — the element leans toward the pointer (≤ `range` px). */
export function Magnetic({
  children,
  range = 7,
  className,
}: {
  children: ReactNode;
  range?: number;
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive()) return;

    const onMove = (e: PointerEvent): void => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      el.style.transform = `translate(${(dx * range).toFixed(1)}px, ${(dy * range).toFixed(1)}px)`;
    };
    const onLeave = (): void => {
      el.style.transition = 'transform 260ms cubic-bezier(0.22,0.68,0.34,1)';
      el.style.transform = '';
      window.setTimeout(() => {
        el.style.transition = '';
      }, 280);
    };

    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [range]);

  return (
    <div
      ref={ref}
      className={className}
      style={{ display: 'inline-flex', willChange: 'transform' }}
    >
      {children}
    </div>
  );
}
