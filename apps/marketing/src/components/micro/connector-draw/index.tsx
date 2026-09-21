'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { reducedMotion } from '../motion';
import '../micro.css';
import './connector-draw.css';

/**
 * 15 · Connector draw. A horizontal SVG rail with `steps` nodes; when the
 * element scrolls into view the ink line draws left to right and the
 * nodes light in sequence. `pathLength="1"` makes the dash math width-
 * independent. Reduced motion: drawn at once.
 */
export function ConnectorDraw({
  steps,
  className,
}: {
  steps: number;
  className?: string;
}): ReactElement {
  const [drawn, setDrawn] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) {
      setDrawn(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const w = 100;
  const xs = Array.from({ length: steps }, (_, i) =>
    steps === 1 ? w / 2 : (i / (steps - 1)) * (w - 8) + 4,
  );
  return (
    <svg
      ref={ref}
      className={`mi mi-conn ${className ?? ''}`}
      data-drawn={drawn}
      viewBox={`0 0 ${w} 12`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <line className="mi-conn__line" x1={xs[0] ?? 0} x2={xs[xs.length - 1] ?? w} y1="6" y2="6" />
      <line
        className="mi-conn__ink"
        x1={xs[0] ?? 0}
        x2={xs[xs.length - 1] ?? w}
        y1="6"
        y2="6"
        pathLength={1}
      />
      {xs.map((x, i) => (
        <circle
          key={i}
          className="mi-conn__node"
          cx={x}
          cy="6"
          r="3.5"
          style={{ '--i': i } as CSSProperties}
        />
      ))}
    </svg>
  );
}
