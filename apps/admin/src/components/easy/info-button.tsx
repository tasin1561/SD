'use client';

import { Info, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import type { Locale } from '@skydrop/ui/app/i18n';
import { useT } from '@/i18n/client';
import { ListenButton } from './listen-button';
import './easy.css';

export interface InfoFact {
  readonly label: string;
  readonly value: string;
}

/**
 * The "i" button. One small circle beside a title, a label or a number;
 * a press opens a bubble that says, in plain words, what the thing is.
 * The explanations live here so the page itself can stay light.
 *
 * It opens on a PRESS — mouse, finger, Enter or Space — and stays until it
 * is closed (the X, Escape, a press anywhere else). Not on hover: a bubble
 * that vanishes when the pointer slips cannot be read slowly, and the
 * Listen button inside it could never be reached.
 *
 * On a phone it is a sheet along the bottom of the screen.
 *
 * NEVER put a warning or something the person must act on in here — that
 * belongs on the page. This is for "what is this?", not "do this now".
 */
export function InfoButton({
  title,
  text,
  facts,
  speechLang,
  className,
}: {
  /** What the bubble is about — also names the button for a screen reader. */
  readonly title: string;
  /** The explanation, as plain text (it is also what Listen reads). */
  readonly text?: string | undefined;
  /** Small label / value pairs, for details moved off the page. */
  readonly facts?: readonly InfoFact[] | undefined;
  /** Language Listen reads in, when the text is not in the console language. */
  readonly speechLang?: Locale | undefined;
  readonly className?: string | undefined;
}): ReactElement {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus: boolean): void => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);

  // Place the bubble by the button, flipped and clamped to stay on screen.
  useLayoutEffect(() => {
    if (!open) return;
    const b = trigger.current?.getBoundingClientRect();
    const el = bubble.current;
    if (b === undefined || el === null) return;
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(b.left + b.width / 2 - w / 2, 8), Math.max(8, vw - 8 - w));
    const below = b.bottom + 8 + h <= vh - 8 || b.top - 8 - h < 8;
    setPos({
      left: Math.round(left),
      top: Math.round(below ? Math.min(b.bottom + 8, Math.max(8, vh - 8 - h)) : b.top - 8 - h),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (bubble.current?.contains(target) === true) return;
      if (trigger.current?.contains(target) === true) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);
      }
    };
    // The bubble does not follow the page, so a scroll or resize closes it.
    const onMove = (e: Event): void => {
      if (e.target instanceof Node && bubble.current?.contains(e.target) === true) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
    };
  }, [open, close]);

  const spoken = [title, text ?? '', ...(facts ?? []).map((f) => `${f.label}: ${f.value}`)]
    .filter((s) => s.trim() !== '')
    .join('. ');

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={className === undefined ? 'ez-info' : `ez-info ${className}`}
        aria-label={t('easy.about', { title })}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setPos(null);
          setOpen((v) => !v);
        }}
      >
        <Info size={14} aria-hidden />
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={bubble}
              id={id}
              className="ez-bubble"
              role="dialog"
              aria-label={title}
              // Rendered off-screen for one frame so it can be measured, then placed.
              style={pos ?? { left: 0, top: 0, visibility: 'hidden' }}
            >
              <div className="ez-bubble__head">
                <p className="ez-bubble__title">{title}</p>
                <button
                  type="button"
                  className="ez-bubble__close"
                  aria-label={t('easy.close')}
                  onClick={() => close(true)}
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
              {text !== undefined && text !== '' && <p className="ez-bubble__text">{text}</p>}
              {facts !== undefined && facts.length > 0 && (
                <dl className="ez-bubble__facts">
                  {facts.map((f) => (
                    <div key={f.label} style={{ display: 'contents' }}>
                      <dt>{f.label}</dt>
                      <dd>{f.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <ListenButton text={spoken} lang={speechLang} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
