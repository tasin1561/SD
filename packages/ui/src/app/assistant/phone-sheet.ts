import { useEffect, useState, type KeyboardEvent, type RefObject } from 'react';

/**
 * On a phone (<640px) the chat panel is a bottom sheet (about 85% of the
 * screen) over a dimmed backdrop, so it is MODAL: `aria-modal`, Tab trapped
 * inside, the page behind it inert. The desktop side panel is deliberately
 * NOT modal: the page beside it stays usable.
 * Kept in its own file so the two behaviours do not tangle with the chat.
 */
export const PHONE_QUERY = '(max-width: 640px)';

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(PHONE_QUERY);
    setPhone(mq.matches);
    const on = (e: { matches: boolean }): void => setPhone(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/**
 * While `active`, marks every sibling of the panel (and of each of its
 * ancestors up to <body>) `inert`, so nothing behind the sheet can take
 * focus or be read by a screen reader. Restores exactly what it changed.
 */
export function useInertBackground(panel: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    const el = panel.current;
    if (!active || el === null) return undefined;
    const changed: HTMLElement[] = [];
    let node: HTMLElement = el;
    while (node.parentElement !== null) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling === node || !(sibling instanceof HTMLElement)) continue;
        if (sibling.hasAttribute('inert')) continue;
        // The sheet's own backdrop sits beside it and must stay clickable.
        if (sibling.hasAttribute('data-sk-ai-keep')) continue;
        sibling.setAttribute('inert', '');
        changed.push(sibling);
      }
      node = node.parentElement;
      if (node === document.body) break;
    }
    return () => {
      for (const s of changed) s.removeAttribute('inert');
    };
  }, [panel, active]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside `panel`. Returns true when it handled the key. */
export function trapTab(e: KeyboardEvent<HTMLElement>, panel: HTMLElement | null): boolean {
  if (e.key !== 'Tab' || panel === null) return false;
  const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
  const first = items[0];
  const last = items[items.length - 1];
  if (first === undefined || last === undefined) return false;
  const active = document.activeElement;
  const inside = active !== null && panel.contains(active);
  if (!inside) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return true;
  }
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
