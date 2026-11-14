'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useT } from '@/i18n/client';

/**
 * A long list on a phone: the first six cards (or three), then "Show all 43".
 *
 * On a phone every table row is a card, so a log of forty rows is forty
 * cards and whatever sits below it is a long way down. This wraps a
 * table and, on a phone only, shows the first six rows until the worker
 * asks for the rest. Nothing is removed: the button says how many there
 * are and opens them all, and a wide screen always shows the whole table.
 *
 * The rows are counted from the table itself, so the wrapper needs no
 * knowledge of the data. The hiding is a CSS rule in `easy.css`
 * (`.ez-fold:not([data-open])`), so before this script runs the list is
 * simply folded with no button, never broken.
 */
export function PhoneFold({
  className,
  children,
  first = 6,
}: {
  readonly className?: string | undefined;
  /** How many cards show before the button. Three for a log that is rarely read. */
  readonly first?: 3 | 6;
  readonly children: ReactNode;
}): ReactElement {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const read = (): void => setCount(root.querySelectorAll('.sd-table-cards > tbody > tr').length);
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className === undefined ? 'ez-fold' : `ez-fold ${className}`}
      data-open={open ? '' : undefined}
      data-first={first}
    >
      {children}
      {count > first && (
        <button
          type="button"
          className="ez-fold__more"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('easy.showFewer') : t('easy.showAll', { n: count })}
        </button>
      )}
    </div>
  );
}
