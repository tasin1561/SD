'use client';

import { motion, useInView, useMotionValue, useTransform, animate, useReducedMotion } from 'framer-motion';
import { useEffect, useRef, type ReactElement } from 'react';

interface Props {
  from?: number;
  to: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
}

/**
 * SSR-safe number counter.
 *
 * Renders the TARGET value on first paint (SEO + screenshot friendly).
 * Once mounted, if reduced-motion is not requested and the counter is
 * in view, animates from `from` up to `to`. That means:
 *   - SSR HTML shows "40%+" not "0%+"
 *   - Playwright fullPage screenshots capture the final value
 *   - Real users on scroll see the animation
 *   - Reduced-motion users see the final value with no animation
 */
export function Counter({
  from = 0,
  to,
  suffix = '',
  prefix = '',
  duration = 1.2,
  className,
}: Props): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const prefersReduced = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: '-40px' });
  // Motion value starts at the TARGET so SSR + first paint show it.
  const mv = useMotionValue(to);
  const rounded = useTransform(mv, (v) => `${prefix}${Math.round(v)}${suffix}`);

  useEffect(() => {
    if (prefersReduced) return; // Skip — mv already at target
    if (!inView) return;
    // Snap back to `from`, then animate to `to`. This gives the count-up
    // effect once we know the user is scrolling to the element.
    mv.set(from);
    const controls = animate(mv, to, {
      duration,
      ease: [0.21, 0.47, 0.32, 0.98],
    });
    return () => controls.stop();
  }, [inView, from, to, duration, mv, prefersReduced]);

  return (
    <motion.span ref={ref} className={className}>
      {rounded}
    </motion.span>
  );
}
