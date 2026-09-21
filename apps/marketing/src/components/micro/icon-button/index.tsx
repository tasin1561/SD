import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import './icon-button.css';

/**
 * 22 · Icon button (u31). A soft rounded surface around one icon; hover
 * fills it with the accent and lifts it; an optional count badge or a
 * status dot. The accessible name is REQUIRED — an icon alone names
 * nothing.
 */
interface IconButtonExtras {
  label: string;
  children: ReactNode;
  badge?: number | string;
  dot?: 'green' | 'saffron' | 'red';
  size?: 'md' | 'lg';
  className?: string;
}

export function IconButton({
  label,
  children,
  badge,
  dot,
  size = 'md',
  className,
  ...b
}: IconButtonExtras & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>): ReactElement {
  return (
    <button
      type="button"
      className={`icon-btn ${className ?? ''}`}
      data-size={size}
      aria-label={label}
      title={label}
      {...b}
    >
      {children}
      {badge !== undefined ? <span className="icon-btn__badge tabular">{badge}</span> : null}
      {dot ? <span className="icon-btn__dot" data-dot={dot} aria-hidden /> : null}
    </button>
  );
}

export function IconLink({
  label,
  children,
  badge,
  dot,
  size = 'md',
  className,
  ...a
}: IconButtonExtras & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'>): ReactElement {
  return (
    <a
      className={`icon-btn ${className ?? ''}`}
      data-size={size}
      aria-label={label}
      title={label}
      {...a}
    >
      {children}
      {badge !== undefined ? <span className="icon-btn__badge tabular">{badge}</span> : null}
      {dot ? <span className="icon-btn__dot" data-dot={dot} aria-hidden /> : null}
    </a>
  );
}
