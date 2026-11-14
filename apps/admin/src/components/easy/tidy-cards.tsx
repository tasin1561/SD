'use client';

import { useEffect, useRef, type ReactElement } from 'react';

/**
 * Marks table cells that hold nothing, so a phone card can leave them out.
 *
 * On a phone each table row is a card with one line per column. A line
 * that only says "—" is a line the worker reads and learns nothing from,
 * and on a money screen half a card can be such lines. This marks a cell
 * whose whole text is empty or a dash with `data-ez-empty`, and the phone
 * card rule in `easy.css` hides it. A wide screen ignores the mark, so
 * the table there is unchanged, and a real value ("₹0.00", "0") is never
 * a dash and always stays.
 *
 * Renders nothing itself. Put it anywhere inside the page's `ez-phone` (or `ez-cards`)
 * wrapper.
 */
export function TidyCards(): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const root = ref.current?.closest('.ez-phone, .ez-cards');
    if (root === null || root === undefined) return;
    const mark = (): void => {
      for (const cell of root.querySelectorAll('.sd-table-cards tbody > tr > td')) {
        const text = (cell.textContent ?? '').trim();
        const empty =
          (text === '' || text === '—' || text === '–' || text === '-') &&
          cell.querySelector('button, a, input, select, img, svg') === null;
        if (empty) cell.setAttribute('data-ez-empty', '');
        else cell.removeAttribute('data-ez-empty');
      }
    };
    mark();
    const observer = new MutationObserver(mark);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  return <span ref={ref} hidden />;
}
