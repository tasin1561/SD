'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { reducedMotion } from '../motion';
import '../micro.css';
import './connector-draw.css';

/**
 * 15b · Connector draw. A rail with `steps` nodes; when it scrolls into
 * view the ink grows left to right and the nodes light in sequence. Built
 * from HTML boxes rather than a stretched SVG, so the nodes are circles at
 * every width. Reduced motion: drawn at once.
 */
export function ConnectorDraw({
  steps,
  className,
}: {
  steps: number;
  className?: string;
}): ReactElement {
  const [drawn, setDrawn] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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
  // Nodes sit at the centre of `steps` equal columns, so they line up with
  // a `grid-cols-{steps}` of labels underneath.
  const pct = (i: number): string => `${(((i + 0.5) / steps) * 100).toFixed(3)}%`;
  const edge = `${((0.5 / steps) * 100).toFixed(3)}%`;
  return (
    <div
      ref={ref}
      className={`mi mi-conn ${className ?? ''}`}
      data-drawn={drawn}
      aria-hidden
      style={{ '--x0': edge, '--x1': edge } as CSSProperties}
    >
      <span className="mi-conn__line" />
      <span className="mi-conn__ink" />
      {Array.from({ length: steps }, (_, i) => (
        <span
          key={i}
          className="mi-conn__node"
          style={{ '--x': pct(i), '--i': i } as CSSProperties}
        />
      ))}
    </div>
  );
}
