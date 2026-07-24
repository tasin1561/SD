'use client';

/**
 * Hand-rolled reveal system — replaces framer-motion for the landing
 * page (saves ~40KB gzip + ~700ms of mobile eval time).
 *
 * Mechanics: a shared IntersectionObserver flips `data-shown` on the
 * wrapper once (never re-hides). CSS in globals.css does the actual
 * motion: translateY(10px) → 0 over 220ms. Opacity NEVER animates from
 * 0 — SSR HTML stays fully visible (direction doc §4).
 *
 * Stagger: pass `delay` (ms) — applied as transition-delay.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

let sharedObserver: IntersectionObserver | null = null;
const shownCallbacks = new WeakMap<Element, () => void>();

function getObserver(): IntersectionObserver | null {
  if (typeof window === 'undefined') return null;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            shownCallbacks.get(e.target)?.();
            sharedObserver?.unobserve(e.target);
            shownCallbacks.delete(e.target);
          }
        }
      },
      { rootMargin: '-60px 0px' },
    );
  }
  return sharedObserver;
}

/** Group context so nested Reveals inherit a base stagger offset. */
const GroupDelay = createContext(0);

export function Reveal({
  children,
  delay = 0,
  as: Tag = 'div',
  className,
  style,
}: {
  children: ReactNode;
  delay?: number;
  as?: 'div' | 'li' | 'section' | 'span';
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const base = useContext(GroupDelay);
  const total = base + delay;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = getObserver();
    if (!obs) {
      // Reduced motion or SSR: show immediately.
      el.setAttribute('data-shown', '');
      return;
    }
    shownCallbacks.set(el, () => el.setAttribute('data-shown', ''));
    obs.observe(el);
    return () => {
      obs.unobserve(el);
      shownCallbacks.delete(el);
    };
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<HTMLDivElement> & React.Ref<HTMLLIElement>}
      className={`reveal${className ? ` ${className}` : ''}`}
      style={total ? { ...style, transitionDelay: `${total}ms` } : style}
    >
      {children}
    </Tag>
  );
}

/** Provides a base delay to child Reveals — cheap stagger groups. */
export function RevealGroup({
  children,
  step = 60,
  count,
}: {
  children: (delayFor: (i: number) => number) => ReactNode;
  step?: number;
  count?: number;
}): ReactElement {
  void count;
  return <>{children((i) => i * step)}</>;
}

/** matchMedia hook for reduced motion (replaces framer's useReducedMotion). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}
