'use client';

import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Check, Info } from 'lucide-react';
import '../micro.css';
import './tooltip-card.css';

export interface TermDef {
  term: string;
  title: string;
  body: string;
  points?: readonly string[];
  icon?: ReactNode;
}

/**
 * 23 · Tooltip card (u35). A dotted-underlined term that opens a rich
 * popover on hover, focus or tap: icon chip, title, one short paragraph,
 * a tick list. Rises and fades from the trigger, points back at it with
 * an arrow, flips below when there is no room above, closes on Escape,
 * blur or tapping outside. The trigger is a real button (`aria-expanded`,
 * `aria-describedby`), so it works on a keyboard and a phone alike.
 */
export function TermTip({ def, children }: { def: TermDef; children?: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const show = (): void => {
    const r = root.current?.getBoundingClientRect();
    setBelow(!!r && r.top < 260);
    setOpen(true);
  };
  return (
    <span
      ref={root}
      className="mi mi-tip"
      data-open={open}
      data-below={below || undefined}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setOpen(false);
      }}
    >
      <button
        type="button"
        className="mi-tip__term"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onFocus={show}
        onBlur={(e) => {
          if (!root.current?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
      >
        {children ?? def.term}
        <Info size={12} aria-hidden className="mi-tip__i" />
      </button>
      <span className="mi-tip__card" role="tooltip" id={id}>
        <span className="mi-tip__arrow" aria-hidden />
        <span className="mi-tip__chip" aria-hidden>
          {def.icon ?? <Info size={16} />}
        </span>
        <span className="mi-tip__title">{def.title}</span>
        <span className="mi-tip__body">{def.body}</span>
        {def.points?.length ? (
          <span className="mi-tip__list">
            {def.points.map((p) => (
              <span key={p} className="mi-tip__point">
                <Check size={12} strokeWidth={3} aria-hidden />
                {p}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </span>
  );
}
