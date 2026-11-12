'use client';

import { ChevronDown } from 'lucide-react';
import { useId, type ReactElement, type ReactNode } from 'react';
import { useT } from '@/i18n/client';

/**
 * One card of the order detail: a 40px header row (title, inline meta,
 * right-aligned actions, collapse toggle) over a body that opens and
 * closes by grid rows 0fr → 1fr, so nothing animates height directly.
 *
 * The closed body is `inert`: its controls leave the tab order and the
 * accessibility tree, which a merely clipped body would not. The toggle
 * carries `aria-expanded` / `aria-controls`.
 */
export function DetailCard({
  id,
  title,
  titleText,
  meta,
  badge,
  actions,
  open,
  onOpenChange,
  tone,
  className,
  children,
}: {
  readonly id?: string | undefined;
  readonly title: ReactNode;
  /** Plain text of the title, for the toggle's accessible name. */
  readonly titleText: string;
  readonly meta?: ReactNode;
  readonly badge?: ReactNode;
  readonly actions?: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly tone?: 'warn' | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const t = useT();
  const uid = useId();
  const titleId = `${uid}-t`;
  const bodyId = `${uid}-b`;
  return (
    <section
      id={id}
      className={className === undefined ? 'od-card' : `od-card ${className}`}
      data-tone={tone}
      data-open={open ? '1' : '0'}
      aria-labelledby={titleId}
    >
      <header className="od-card__head">
        <h2 className="od-card__title" id={titleId}>
          {title}
        </h2>
        {meta !== undefined ? <span className="od-card__meta">{meta}</span> : null}
        {badge}
        <div className="od-card__actions">{actions}</div>
        <button
          type="button"
          className="od-card__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${open ? t('common.collapse') : t('common.expand')}: ${titleText}`}
          onClick={() => onOpenChange(!open)}
        >
          <ChevronDown size={16} aria-hidden />
        </button>
      </header>
      <div className="od-card__wrap" id={bodyId} data-open={open ? '1' : '0'}>
        <div className="od-card__inner" {...(open ? {} : { inert: true })}>
          <div className="od-card__body">{children}</div>
        </div>
      </div>
    </section>
  );
}

/**
 * A small disclosure inside a card ("Parsed fields (7)"): a text button
 * with a rotating chevron over a body that opens by grid rows 0fr → 1fr.
 * `aria-expanded` / `aria-controls`, Enter and Space via the native
 * button; a closed body is `inert`.
 */
export function Disclosure({
  title,
  open,
  onOpenChange,
  children,
}: {
  readonly title: ReactNode;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly children: ReactNode;
}): ReactElement {
  const uid = useId();
  return (
    <div className="od-disc" data-open={open ? '1' : '0'}>
      <button
        type="button"
        className="od-disc__btn"
        aria-expanded={open}
        aria-controls={`${uid}-d`}
        onClick={() => onOpenChange(!open)}
      >
        <ChevronDown size={14} aria-hidden />
        {title}
      </button>
      <div className="od-card__wrap" id={`${uid}-d`} data-open={open ? '1' : '0'}>
        <div className="od-card__inner" {...(open ? {} : { inert: true })}>
          {children}
        </div>
      </div>
    </div>
  );
}
