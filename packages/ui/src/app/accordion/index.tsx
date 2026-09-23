'use client';

import { clsx } from 'clsx';
import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import './accordion.css';

interface AccordionCtx {
  isOpen: (value: string) => boolean;
  toggle: (value: string) => void;
}

const Ctx = createContext<AccordionCtx | null>(null);

type SingleProps = {
  type?: 'single' | undefined;
  value?: string | null | undefined;
  defaultValue?: string | null | undefined;
  onValueChange?: ((value: string | null) => void) | undefined;
};

type MultipleProps = {
  type: 'multiple';
  value?: readonly string[] | undefined;
  defaultValue?: readonly string[] | undefined;
  onValueChange?: ((value: string[]) => void) | undefined;
};

export type AccordionProps = (SingleProps | MultipleProps) & {
  children: ReactNode;
  className?: string | undefined;
};

function toList(v: string | null | undefined | readonly string[]): string[] {
  if (v === null || v === undefined) return [];
  return typeof v === 'string' ? [v] : [...v];
}

/**
 * Accordion (u19). Each item is an elevated card with an icon chip; open,
 * the chip fills with the accent, the title takes the accent colour, the
 * plus morphs into a minus inside a round accent button, and the answer
 * sits in an inset well that opens with grid rows 0fr → 1fr (no height
 * animation). `single` keeps one open (click again to close); `multiple`
 * lets several stay open. Controlled (`value`) or not (`defaultValue`).
 *
 * ARIA: each header is a button with `aria-expanded` / `aria-controls`;
 * each panel is a region labelled by its header, `inert` while closed so
 * its links cannot be tabbed into.
 */
export function Accordion(props: AccordionProps): ReactElement {
  const multiple = props.type === 'multiple';
  const [inner, setInner] = useState<string[]>(() => toList(props.defaultValue));
  const controlled = props.value !== undefined;
  const open = controlled ? toList(props.value) : inner;

  const toggle = (value: string): void => {
    const next = open.includes(value)
      ? open.filter((v) => v !== value)
      : multiple
        ? [...open, value]
        : [value];
    if (!controlled) setInner(next);
    if (props.type === 'multiple') props.onValueChange?.(next);
    else props.onValueChange?.(next[0] ?? null);
  };

  return (
    <Ctx.Provider value={{ isOpen: (v) => open.includes(v), toggle }}>
      <div className={clsx('sk-acc', props.className)}>{props.children}</div>
    </Ctx.Provider>
  );
}

export interface AccordionItemProps {
  value: string;
  title: ReactNode;
  /** Icon in the chip. */
  icon?: ReactNode;
  /** A small right-aligned note in the header (a count, a status chip). */
  meta?: ReactNode;
  children: ReactNode;
  disabled?: boolean | undefined;
}

export function AccordionItem({
  value,
  title,
  icon,
  meta,
  children,
  disabled = false,
}: AccordionItemProps): ReactElement {
  const ctx = useContext(Ctx);
  const id = useId();
  if (ctx === null)
    throw new Error('@skydrop/ui/app/accordion: AccordionItem outside <Accordion>.');
  const open = ctx.isOpen(value);
  const headId = `${id}-h`;
  const panelId = `${id}-p`;

  return (
    <div className="sk-acc__item" data-open={open || undefined}>
      <h3 className="sk-acc__heading">
        <button
          type="button"
          id={headId}
          className="sk-acc__trigger"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={disabled}
          onClick={() => ctx.toggle(value)}
        >
          {icon ? (
            <span className="sk-acc__chip" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span className="sk-acc__title">{title}</span>
          {meta ? <span className="sk-acc__meta">{meta}</span> : null}
          <span className="sk-acc__pm" aria-hidden>
            <span className="sk-acc__bar" />
            <span className="sk-acc__bar sk-acc__bar--v" />
          </span>
        </button>
      </h3>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headId}
        className="sk-acc__panel"
        inert={!open}
      >
        <div className="sk-acc__clip">
          <div className="sk-acc__well">{children}</div>
        </div>
      </div>
    </div>
  );
}
