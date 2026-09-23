'use client';

import { clsx } from 'clsx';
import { Check, Info } from 'lucide-react';
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import './tooltip-card.css';

export interface TooltipCardProps {
  /** The trigger — a focusable element (a button or link). It gets aria-describedby / aria-expanded. */
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  title: string;
  description: ReactNode;
  /** Icon in the chip; defaults to an info mark. */
  icon?: ReactNode;
  /** A short tick list. */
  points?: readonly string[] | undefined;
  /** One action (a link to the full explanation). Keyboard reachable: Tab from the trigger. */
  action?: ReactNode;
  className?: string | undefined;
}

/**
 * Tooltip card (u35). Hover OR keyboard focus opens a rich card — icon
 * chip, title, one short paragraph, an optional tick list and an optional
 * action — that fades and rises from the trigger with a pointer arrow.
 * Flips below when there is no room above. Escape closes it; so does
 * leaving with the pointer, moving focus out, or tapping elsewhere. On a
 * touch screen a tap on the trigger toggles it.
 *
 * With no action it is a `tooltip` (described-by); with an action it is a
 * labelled group the person can Tab into, since a tooltip may not hold
 * interactive content.
 */
export function TooltipCard({
  children,
  title,
  description,
  icon,
  points,
  action,
  className,
}: TooltipCardProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [below, setBelow] = useState(false);
  const [dx, setDx] = useState(0);
  const root = useRef<HTMLSpanElement>(null);
  const wasOpen = useRef(false);
  const id = useId();
  const interactive = action !== undefined && action !== null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
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
    setBelow(r !== undefined && r.top < 240);
    if (r !== undefined) {
      // The card is centred on the trigger; shift it sideways (and the
      // arrow back) just enough to stay 8px inside the viewport.
      const vw = document.documentElement.clientWidth;
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const cw = Math.min(18 * rem, vw * 0.8);
      const left = r.left + r.width / 2 - cw / 2;
      const clamped = Math.min(Math.max(left, 8), vw - 8 - cw);
      setDx(Math.round(clamped - left));
    }
    setOpen(true);
  };

  const trigger = cloneElement(children, {
    'aria-describedby': open && !interactive ? id : children.props['aria-describedby'],
    'aria-expanded': interactive ? open : children.props['aria-expanded'],
    ...(interactive ? { 'aria-controls': id } : {}),
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      children.props.onPointerDown?.(e);
      wasOpen.current = open;
    },
    // A tap (not a mouse, not the keyboard) toggles. The focus that a tap
    // also fires has already opened it, so "toggle" reads the state from
    // BEFORE the tap.
    onClick: (e: ReactMouseEvent<HTMLElement>) => {
      children.props.onClick?.(e);
      const type = (e.nativeEvent as Partial<PointerEvent>).pointerType;
      if (e.detail === 0 || type === 'mouse') return;
      if (wasOpen.current) setOpen(false);
      else show();
    },
  });

  return (
    <span
      ref={root}
      className={clsx('sk-tipcard', className)}
      data-open={open || undefined}
      data-below={below || undefined}
      style={{ '--tip-dx': `${dx}px` } as CSSProperties}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') show();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') setOpen(false);
      }}
      onFocus={(e) => {
        if (e.target === root.current?.firstElementChild) show();
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {trigger}
      <span
        className="sk-tipcard__card"
        id={id}
        role={interactive ? 'group' : 'tooltip'}
        aria-label={interactive ? title : undefined}
      >
        <span className="sk-tipcard__arrow" aria-hidden />
        <span className="sk-tipcard__top">
          <span className="sk-tipcard__chip" aria-hidden>
            {icon ?? <Info size={16} />}
          </span>
          <span className="sk-tipcard__title">{title}</span>
        </span>
        <span className="sk-tipcard__desc">{description}</span>
        {points && points.length > 0 ? (
          <span className="sk-tipcard__list">
            {points.map((p) => (
              <span key={p} className="sk-tipcard__point">
                <Check size={13} strokeWidth={3} aria-hidden />
                {p}
              </span>
            ))}
          </span>
        ) : null}
        {interactive ? <span className="sk-tipcard__action">{action}</span> : null}
      </span>
    </span>
  );
}

export interface GlossaryTermProps extends Omit<TooltipCardProps, 'children'> {
  /** The word as it appears in the sentence: "RTO", "Instant Pay". */
  children: ReactNode;
}

/**
 * A term in running text with a dotted underline that opens its
 * TooltipCard — for RTO, Instant Pay, volumetric weight, STRICT mode,
 * hidden share. The trigger is a real button (inline, with a full-height
 * tap target that does not grow the line).
 */
export function GlossaryTerm({ children, ...card }: GlossaryTermProps): ReactElement {
  return (
    <TooltipCard {...card}>
      <button type="button" className="sk-glossary">
        {children}
      </button>
    </TooltipCard>
  );
}
