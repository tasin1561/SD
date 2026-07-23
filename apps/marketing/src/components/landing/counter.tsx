'use client';

import { motion, useInView, useMotionValue, useTransform, animate } from 'framer-motion';
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
 * Number counter that animates on scroll-into-view. Mono font per skill;
 * transform-only (opacity/textContent), never layout.
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
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const mv = useMotionValue(from);
  const rounded = useTransform(mv, (v) => `${prefix}${Math.round(v)}${suffix}`);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(mv, to, {
      duration,
      ease: [0.21, 0.47, 0.32, 0.98],
    });
    return () => controls.stop();
  }, [inView, to, duration, mv]);

  return (
    <motion.span ref={ref} className={className}>
      {rounded}
    </motion.span>
  );
}
