'use client';

import { clsx } from 'clsx';
import { Bell, X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { reducedMotion } from '../motion/motion';
import './snackbar.css';

export interface SnackbarProps {
  open: boolean;
  /** Called by the close control, the action, and the auto-dismiss. */
  onClose: () => void;
  title: string;
  /** The supporting line under the title. */
  body?: ReactNode;
  /** Defaults to a bell. */
  icon?: ReactNode;
  /** ONE action ("Review", "Learn more"); clicking it also closes. */
  action?: { label: string; onClick: () => void } | undefined;
  /** ms of unpaused time before auto-dismiss; 0 keeps it open. Default 7 s. */
  duration?: number | undefined;
  /** Render in flow instead of fixed at the bottom of the screen (gallery, a panel). */
  inline?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Snackbar (u22) — a system message that needs one decision: an icon block
 * in the accent gradient, a title and a supporting line, one accent action,
 * a close control, and an auto-dismiss line along the bottom edge that
 * pauses while hovered or focused. Polite status; never takes focus.
 */
export function Snackbar({
  open,
  onClose,
  title,
  body,
  icon,
  action,
  duration = 7000,
  inline = false,
  className,
}: SnackbarProps): ReactElement | null {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const paused = hover || focus;
  const remaining = useRef(duration);
  const close = useRef(onClose);
  close.current = onClose;
  // Read after mount: the server cannot know the motion preference.
  const [still, setStill] = useState(false);
  useEffect(() => setStill(reducedMotion()), []);

  // Reset the clock each time it opens.
  useEffect(() => {
    if (open) remaining.current = duration;
  }, [open, duration]);

  useEffect(() => {
    if (!open || duration <= 0 || paused) return;
    const started = Date.now();
    const t = window.setTimeout(() => close.current(), remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [open, duration, paused]);

  if (!open) return null;
  const showBar = duration > 0 && !still;

  return (
    <div
      className={clsx('sk-snack', inline && 'sk-snack--inline', className)}
      role="status"
      aria-live="polite"
      data-paused={paused || undefined}
      style={{ '--snack-life': `${duration}ms` } as CSSProperties}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <span className="sk-snack__icon" aria-hidden>
        {icon ?? <Bell size={20} />}
      </span>
      <div className="sk-snack__text">
        <p className="sk-snack__title">{title}</p>
        {body ? <p className="sk-snack__body">{body}</p> : null}
      </div>
      {action ? (
        <button
          type="button"
          className="sk-snack__action"
          onClick={() => {
            action.onClick();
            onClose();
          }}
        >
          {action.label}
        </button>
      ) : null}
      <button type="button" className="sk-snack__close" aria-label="Dismiss" onClick={onClose}>
        <X size={15} aria-hidden />
      </button>
      {showBar ? <span className="sk-snack__bar" aria-hidden /> : null}
    </div>
  );
}
