'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { useT } from '@/i18n/client';

const KEY = 'sd-seller-order-card:';

/**
 * Open/closed state of a card, remembered in localStorage. Read AFTER mount
 * (the server render and the first client render agree on "open"), and every
 * access is in a try/catch: private mode and blocked site data must never
 * break the page.
 */
export function useCardOpen(
  id: string | undefined,
  initial = true,
): readonly [boolean, (next: boolean) => void] {
  const [open, setOpen] = useState(initial);
  useEffect(() => {
    if (id === undefined) return;
    try {
      const saved = window.localStorage.getItem(KEY + id);
      if (saved === '0') setOpen(false);
      else if (saved === '1') setOpen(true);
    } catch {
      /* storage unavailable: stay at the default */
    }
  }, [id]);
  const set = (next: boolean): void => {
    setOpen(next);
    if (id === undefined) return;
    try {
      window.localStorage.setItem(KEY + id, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };
  return [open, set];
}

/**
 * One card of the order page: a leading icon, a 16px title, ONE visible muted
 * note line under it (never a tooltip), optional header actions, and a
 * collapse toggle. The body opens by grid rows 0fr to 1fr, and a closed body is
 * `inert` so its controls leave the tab order.
 */
export function DetailCard({
  id,
  title,
  titleText,
  icon,
  note,
  actions,
  tone,
  defaultOpen = true,
  forceOpen = false,
  className,
  children,
}: {
  readonly id: string;
  readonly title: ReactNode;
  /** Plain text of the title, for the toggle's accessible name. */
  readonly titleText: string;
  readonly icon: ReactNode;
  readonly note?: ReactNode;
  readonly actions?: ReactNode;
  readonly tone?: 'warn' | undefined;
  readonly defaultOpen?: boolean;
  /** Flip to true to open the card (e.g. Edit pressed while it is collapsed). */
  readonly forceOpen?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const t = useT();
  const uid = useId();
  const [open, setOpen] = useCardOpen(id, defaultOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceOpen]);
  const titleId = `${uid}-t`;
  const bodyId = `${uid}-b`;
  return (
    <section
      id={id}
      className={className === undefined ? 'cod-card' : `cod-card ${className}`}
      data-tone={tone}
      data-open={open ? '1' : '0'}
      aria-labelledby={titleId}
    >
      <header className="cod-card__head">
        <span className="cod-card__icon" aria-hidden>
          {icon}
        </span>
        <div className="cod-card__titles">
          <h2 className="cod-card__title" id={titleId}>
            {title}
          </h2>
          {note !== undefined ? <p className="cod-card__note">{note}</p> : null}
        </div>
        {actions !== undefined ? <div className="cod-card__actions">{actions}</div> : null}
        <button
          type="button"
          className="cod-card__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={t(open ? 'orderPage.collapse' : 'orderPage.expand', { title: titleText })}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={18} aria-hidden />
        </button>
      </header>
      <div className="cod-card__wrap" id={bodyId} data-open={open ? '1' : '0'}>
        <div className="cod-card__inner" {...(open ? {} : { inert: true })}>
          <div className="cod-card__body">{children}</div>
        </div>
      </div>
    </section>
  );
}

/** A small disclosure inside a card ("How we read this address (7)"). */
export function Disclosure({
  title,
  children,
}: {
  readonly title: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  const uid = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className="cod-disc" data-open={open ? '1' : '0'}>
      <button
        type="button"
        className="cod-disc__btn"
        aria-expanded={open}
        aria-controls={`${uid}-d`}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={16} aria-hidden />
        {title}
      </button>
      <div className="cod-card__wrap" id={`${uid}-d`} data-open={open ? '1' : '0'}>
        <div className="cod-card__inner" {...(open ? {} : { inert: true })}>
          {children}
        </div>
      </div>
    </div>
  );
}
