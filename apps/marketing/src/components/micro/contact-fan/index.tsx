'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Check, MessageCircle, X } from 'lucide-react';
import '../micro.css';
import './contact-fan.css';

export interface FanItem {
  id: string;
  icon: ReactNode;
  /** The hue token the icon takes (`--{hue}-text`). */
  hue: string;
  label: string;
  /** A second, quieter line — the number, the address. */
  detail?: string;
  href?: string;
  external?: boolean;
  /** A real local action (the clipboard write); its promise decides "done". */
  action?: () => Promise<void>;
  busyLabel?: string;
  doneLabel?: string;
  failLabel?: string;
}

export interface ContactFanProps {
  items: readonly FanItem[];
  /** Controlled open state (the mobile bar owns it); omit for the built-in toggle. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 'floating' renders its own round toggle; 'bar' renders only the list, anchored to a bar item. */
  anchor?: 'floating' | 'bar';
  label?: string;
}

/**
 * 9 · Contact fan. LABELLED rows — WhatsApp · Call <number> · Email
 * <address> · Copy hotline number — stagger out from the button along a
 * slight arc (40 ms apart) and collapse back in reverse. A link row
 * navigates at once. The copy row is the ONE honest success state:
 * "Copying…" → "Number copied ✓" follows a real clipboard write.
 */
export function ContactFan({
  items,
  open: openProp,
  onOpenChange,
  anchor = 'floating',
  label = 'Contact us',
}: ContactFanProps): ReactElement {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean): void => {
    setOpenState(v);
    onOpenChange?.(v);
  };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const n = items.length;
  return (
    <div
      ref={root}
      className={`mi mi-fan ${anchor === 'bar' ? 'mi-fan--bar' : ''}`}
      data-open={open}
    >
      <ul className="mi-fan__list" aria-label={label} aria-hidden={!open}>
        {items.map((it, i) => {
          // a slight arc: the middle rows sit a few px further left
          const fx = -Math.sin((i / Math.max(1, n - 1)) * Math.PI) * 10;
          const style = {
            '--i': i,
            '--n': n,
            '--fx': `${fx.toFixed(1)}px`,
            '--icon': `var(--${it.hue}-text)`,
          } as CSSProperties;
          const p = phase[it.id] ?? 'idle';
          const text =
            p === 'busy'
              ? (it.busyLabel ?? `${it.label}…`)
              : p === 'copied'
                ? (it.doneLabel ?? 'Done')
                : p === 'failed'
                  ? (it.failLabel ?? 'Could not')
                  : it.label;
          const body = (
            <>
              <span className="mi-fan__icon" aria-hidden>
                {p === 'copied' ? <Check size={15} /> : it.icon}
              </span>
              <span>
                {text}
                {it.detail && p === 'idle' ? (
                  <span className="mi-fan__sub"> {it.detail}</span>
                ) : null}
              </span>
            </>
          );
          if (it.action) {
            const act = it.action;
            const run = async (): Promise<void> => {
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
              <li key={it.id}>
                <button
                  type="button"
                  className="mi-fan__item"
                  style={style}
                  data-phase={p}
                  onClick={() => void run()}
                  tabIndex={open ? 0 : -1}
                  aria-live="polite"
                >
                  {body}
                </button>
              </li>
            );
          }
          return (
            <li key={it.id}>
              <a
                className="mi-fan__item"
                style={style}
                data-phase="idle"
                href={it.href}
                tabIndex={open ? 0 : -1}
                {...(it.external ? { target: '_blank', rel: 'noopener' } : {})}
                onClick={() => setOpen(false)}
              >
                {body}
              </a>
            </li>
          );
        })}
      </ul>
      {anchor === 'floating' ? (
        <button
          type="button"
          className="mi-fan__toggle"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? 'Close contact options' : label}
        >
          {open ? (
            <X size={22} aria-hidden="true" />
          ) : (
            <MessageCircle size={22} aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
}
