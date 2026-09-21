import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import './sweep.css';

/**
 * 21 · Button sweep (u28) — the DEFAULT primary-button hover across the
 * site: a gradient fill sweeps in from the left (a pseudo-element on
 * transform), the arrow nudges right, a soft coloured shadow lifts it.
 * CSS only; the two components exist so a link and a button share one
 * class and one arrow. Hover / press feedback only — a link navigates at
 * once, never after an animation.
 */
export function SweepLink({
  children,
  arrow = true,
  tone = 'blue',
  className,
  ...a
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  arrow?: boolean;
  tone?: 'blue' | 'green' | 'saffron' | 'ink';
  children: ReactNode;
}): ReactElement {
  return (
    <a className={`btn-sweep ${className ?? ''}`} data-tone={tone} {...a}>
      <span className="btn-sweep__label">{children}</span>
      {arrow ? <ArrowRight size={16} aria-hidden className="btn-sweep__arrow" /> : null}
    </a>
  );
}

export function SweepButton({
  children,
  arrow = true,
  tone = 'blue',
  className,
  ...b
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  arrow?: boolean;
  tone?: 'blue' | 'green' | 'saffron' | 'ink';
  children: ReactNode;
}): ReactElement {
  return (
    <button type="button" className={`btn-sweep ${className ?? ''}`} data-tone={tone} {...b}>
      <span className="btn-sweep__label">{children}</span>
      {arrow ? <ArrowRight size={16} aria-hidden className="btn-sweep__arrow" /> : null}
    </button>
  );
}
