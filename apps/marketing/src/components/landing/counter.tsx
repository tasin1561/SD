'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';

/**
 * Hand-rolled count-up (no framer-motion). SSR + first paint show the
 * TARGET value; once scrolled into view (and motion allowed) it snaps
 * to `from` and counts up over `duration`s with the boot ease.
 */
export function Counter({
  from = 0,
  to,
  suffix = '',
  prefix = '',
  duration = 1.2,
  className,
}: {
  from?: number;
  to: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
}): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(to);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const ms = duration * 1000;
        const ease = (x: number): number => 1 - Math.pow(1 - x, 3);
        const tick = (t: number): void => {
          const p = Math.min(1, (t - t0) / ms);
          setValue(Math.round(from + (to - from) * ease(p)));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { rootMargin: '-40px 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [from, to, duration]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {value}
      {suffix}
    </span>
  );
}
