'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { MessageCircle, X } from 'lucide-react';
import '../micro.css';
import './radial-contact-fan.css';

export interface FanItem {
  id: string;
  icon: ReactNode;
  label: string;
  href?: string;
  external?: boolean;
  /** A real local action (the clipboard write); the returned promise decides the "done" label. */
  action?: () => Promise<void>;
  doneLabel?: string;
  failLabel?: string;
}

/**
 * 9 · Radial contact fan. Items fan out along a quarter-arc up-and-left of
 * the toggle (bottom-right placement), staggered 40 ms each. A link item
 * navigates at once; an ACTION item may show "…ing → done ✓" because the
 * clipboard write is real and local.
 */
export function RadialContactFan({
  items,
  label = 'Contact us',
}: {
  items: readonly FanItem[];
  label?: string;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Record<string, 'idle' | 'busy' | 'copied' | 'failed'>>({});
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const radius = 92;
  const n = items.length;
  return (
    <div ref={root} className="mi mi-fan" data-open={open}>
      {items.map((it, i) => {
        // Arc from straight up (90°) to straight left (180°) — up-and-LEFT of
        // a bottom-right toggle, so no item ever leaves a phone's viewport.
        const a = Math.PI / 2 + (n === 1 ? 0 : (i / (n - 1)) * (Math.PI / 2));
        const style = {
          '--fx': `${(Math.cos(a) * radius).toFixed(1)}px`,
          '--fy': `${(-Math.sin(a) * radius).toFixed(1)}px`,
          '--i': i,
        } as CSSProperties;
        const p = phase[it.id] ?? 'idle';
        const text =
          p === 'busy'
            ? `${it.label}…`
            : p === 'copied'
              ? (it.doneLabel ?? 'Done')
              : p === 'failed'
                ? (it.failLabel ?? 'Could not')
                : it.label;
        const inner = (
          <>
            {it.icon}
            <span className="mi-fan__label">{text}</span>
          </>
        );
        if (it.action) {
          const run = async (): Promise<void> => {
            const act = it.action;
            if (!act) return;
            setPhase((s) => ({ ...s, [it.id]: 'busy' }));
            try {
              await act();
              setPhase((s) => ({ ...s, [it.id]: 'copied' }));
            } catch {
              setPhase((s) => ({ ...s, [it.id]: 'failed' }));
            }
            window.setTimeout(() => setPhase((s) => ({ ...s, [it.id]: 'idle' })), 1600);
          };
          return (
            <button
              key={it.id}
              type="button"
              className="mi-fan__item"
              style={style}
              data-phase={p}
              onClick={() => void run()}
              aria-label={text}
              tabIndex={open ? 0 : -1}
              aria-live="polite"
            >
              {inner}
            </button>
          );
        }
        return (
          <a
            key={it.id}
            className="mi-fan__item"
            style={style}
            data-phase="idle"
            href={it.href}
            aria-label={it.label}
            tabIndex={open ? 0 : -1}
            {...(it.external ? { target: '_blank', rel: 'noopener' } : {})}
            onClick={() => setOpen(false)}
          >
            {inner}
          </a>
        );
      })}
      <button
        type="button"
        className="mi-fan__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close contact options' : label}
      >
        {open ? <X size={22} aria-hidden="true" /> : <MessageCircle size={22} aria-hidden="true" />}
      </button>
    </div>
  );
}
