import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import './list-row.css';

interface RowContent {
  icon?: ReactNode;
  title: ReactNode;
  helper?: ReactNode;
  /** A status chip or count on the right. */
  meta?: ReactNode;
  active?: boolean;
  hue?: 'blue' | 'green' | 'saffron' | 'teal' | 'violet' | 'magenta';
  chevron?: boolean | undefined;
  className?: string;
}

function Inner({ icon, title, helper, meta, chevron }: RowContent): ReactElement {
  return (
    <>
      <span className="row__bar" aria-hidden />
      {icon ? (
        <span className="row__chip" aria-hidden>
          {icon}
        </span>
      ) : null}
      <span className="row__text">
        <span className="row__title">{title}</span>
        {helper ? <span className="row__helper">{helper}</span> : null}
      </span>
      {meta ? <span className="row__meta">{meta}</span> : null}
      {chevron !== false ? <ChevronRight size={16} aria-hidden className="row__chev" /> : null}
    </>
  );
}

/**
 * 28 · Stacked-list row (u21). Icon chip, title, one helper line, a
 * trailing chip and chevron; on hover the row lifts, tints, grows a left
 * accent bar and the chevron nudges; the ACTIVE row is accent-filled.
 * A link or a button — same look.
 */
export function RowLink({
  icon,
  title,
  helper,
  meta,
  active,
  hue = 'blue',
  chevron,
  className,
  ...a
}: RowContent & AnchorHTMLAttributes<HTMLAnchorElement>): ReactElement {
  return (
    <a
      className={`row ${className ?? ''}`}
      data-hue={hue}
      data-active={active || undefined}
      aria-current={active ? 'true' : undefined}
      {...a}
    >
      <Inner icon={icon} title={title} helper={helper} meta={meta} chevron={chevron} />
    </a>
  );
}

export function RowButton({
  icon,
  title,
  helper,
  meta,
  active,
  hue = 'blue',
  chevron,
  className,
  ...b
}: RowContent & ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  return (
    <button
      type="button"
      className={`row ${className ?? ''}`}
      data-hue={hue}
      data-active={active || undefined}
      {...b}
    >
      <Inner icon={icon} title={title} helper={helper} meta={meta} chevron={chevron} />
    </button>
  );
}
