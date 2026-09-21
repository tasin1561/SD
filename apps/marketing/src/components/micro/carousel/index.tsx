'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Pagination } from '../pagination';
import '../micro.css';
import './carousel.css';

/**
 * 34 · Snap carousel with the u16 pager. The track is native scroll-snap
 * — a swipe on a phone, the wheel or the pager on a desktop — so the
 * browser owns the motion and reduced motion is honoured by
 * `scroll-behavior`. The pager reads the index back from the scroll
 * position, so it never disagrees with what is on screen.
 */
export function Carousel({
  items,
  label,
  className,
}: {
  items: readonly { id: string; node: ReactNode }[];
  label: string;
  className?: string;
}): ReactElement {
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    let raf = 0;
    const onScroll = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = el.firstElementChild?.getBoundingClientRect().width ?? 1;
        setIndex(Math.round(el.scrollLeft / (w + 16)));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  const go = (i: number): void => {
    const el = track.current;
    const child = el?.children[i] as HTMLElement | undefined;
    if (el && child) el.scrollTo({ left: child.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  };
  return (
    <div className={`mi mi-carousel ${className ?? ''}`}>
      <ul ref={track} className="mi-carousel__track" aria-label={label}>
        {items.map((it, i) => (
          <li
            key={it.id}
            className="mi-carousel__item"
            aria-current={i === index ? 'true' : undefined}
          >
            {it.node}
          </li>
        ))}
      </ul>
      <Pagination
        count={items.length}
        index={index}
        onChange={go}
        label={label}
        className="mi-carousel__pager"
      />
    </div>
  );
}
