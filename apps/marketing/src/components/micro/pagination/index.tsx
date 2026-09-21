'use client';

import { useLayoutEffect, useRef, type ReactElement } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../micro.css';
import './pagination.css';

/**
 * 31 · Pagination (u16). Round prev / next buttons and page numbers with
 * an accent bubble that MOVES to the active page (one transform), never
 * blinks. Used as the carousel's pager; `label` names what it pages.
 */
export function Pagination({
  count,
  index,
  onChange,
  label,
  className,
}: {
  count: number;
  index: number;
  onChange: (i: number) => void;
  label: string;
  className?: string;
}): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = root.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!el || !active) return;
    el.style.setProperty('--bub-x', `${active.offsetLeft}px`);
  }, [index, count]);
  return (
    <nav ref={root} className={`mi mi-pg ${className ?? ''}`} aria-label={label}>
      <button
        type="button"
        className="mi-pg__arrow"
        onClick={() => onChange((index - 1 + count) % count)}
        aria-label="Previous"
      >
        <ChevronLeft size={16} />
      </button>
      <span className="mi-pg__pages">
        <span className="mi-pg__bubble" aria-hidden />
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            className="mi-pg__page tabular"
            aria-current={i === index ? 'true' : undefined}
            aria-label={`${label} ${i + 1} of ${count}`}
            onClick={() => onChange(i)}
          >
            {i + 1}
          </button>
        ))}
      </span>
      <button
        type="button"
        className="mi-pg__arrow"
        onClick={() => onChange((index + 1) % count)}
        aria-label="Next"
      >
        <ChevronRight size={16} />
      </button>
    </nav>
  );
}
