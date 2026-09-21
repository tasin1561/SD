'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { reducedMotion } from '../motion';
import '../micro.css';
import './odometer.css';

/**
 * 12 · Odometer. Formats `value` with en-IN grouping and rolls each digit
 * column from 0 to its figure once the element is on screen; separators
 * stay put. Reduced motion shows the final figure at once. Tabular digits
 * keep the columns from jittering as they roll.
 */
export function Odometer({
  value,
  className,
}: {
  value: number;
  className?: string;
}): ReactElement {
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      setArmed(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setArmed(true);
          io.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const text = new Intl.NumberFormat('en-IN').format(value);
  const chars = Array.from(text);
  let digitIndex = 0;
  return (
    <span
      ref={ref}
      className={`mi mi-odo ${className ?? ''}`}
      data-armed={armed}
      role="img"
      aria-label={text}
    >
      {chars.map((c, i) => {
        if (!/\d/.test(c))
          return (
            <span key={i} aria-hidden>
              {c}
            </span>
          );
        const n = Number(c);
        const style = {
          '--n': armed ? n : 0,
          '--i': chars.length - 1 - digitIndex++,
        } as CSSProperties;
        return (
          <span key={i} className="mi-odo__col" aria-hidden>
            <span className="mi-odo__strip" style={style}>
              {Array.from({ length: 10 }, (_, k) => (
                <span key={k}>{k}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
