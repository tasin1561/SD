import type { AnchorHTMLAttributes, ReactElement } from 'react';
import '../micro.css';
import './door-hover.css';

/**
 * 14 · Door hover. A sign-in LINK: on hover the door swings open and the
 * figure walks through. Navigation, so nothing is delayed or faked.
 */
export function DoorLink({
  label,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { label: string }): ReactElement {
  return (
    <a className="mi mi-door" {...rest}>
      <svg className="mi-door__svg" viewBox="0 0 28 24" aria-hidden>
        <rect
          x="14"
          y="2"
          width="12"
          height="20"
          rx="1"
          fill="var(--surface-3)"
          stroke="var(--line-strong)"
        />
        <rect
          className="mi-door__leaf"
          x="14"
          y="2"
          width="12"
          height="20"
          rx="1"
          fill="var(--blue-fill)"
        />
        <g className="mi-door__figure" fill="var(--fg-strong)">
          <circle cx="6" cy="8" r="2.5" />
          <path d="M3.5 12h5l1 6h-2l-.5-3-.5 3h-2z" />
        </g>
      </svg>
      {label}
    </a>
  );
}
