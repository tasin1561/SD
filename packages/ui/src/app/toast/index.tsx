'use client';

import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { reducedMotion } from '../motion/motion';
import './toast.css';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastOptions {
  /** A bold first line; the message becomes the body under it. */
  title?: string | undefined;
  /** One action button ("Undo", "View order"). Clicking it also dismisses. */
  action?: { label: string; onClick: () => void } | undefined;
  /** ms before auto-dismiss; 0 keeps it until closed. Default 4.5 s, errors 8 s. */
  duration?: number | undefined;
}

/** Same call signature as the legacy `useToast()`, plus an optional second argument. */
export interface ToastApi {
  readonly success: (message: string, opts?: ToastOptions) => void;
  readonly error: (message: string, opts?: ToastOptions) => void;
  readonly info: (message: string, opts?: ToastOptions) => void;
  readonly dismiss: (id: number) => void;
}

interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  readonly title: string | undefined;
  readonly action: ToastOptions['action'];
  readonly duration: number;
}

const MAX_VISIBLE = 4;
const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(ToastCtx);
  if (v === null) {
    throw new Error(
      '@skydrop/ui/app/toast: useToast called without <ToastProvider> in the layout.',
    );
  }
  return v;
}

/**
 * Toast (u32). Mount `<ToastProvider>` once at the layout root; call
 * `useToast().success('Invitation resent')` anywhere below it.
 *
 * Each toast is a small designed object: an icon badge in its tone, a bold
 * title, a body line, a close control, a soft glow, and a thin bar that
 * drains until auto-dismiss — and the bar AND the timer pause while the
 * pointer is over the toast or focus is inside it. At most four show,
 * newest on top; the oldest is dropped. Announced through one polite live
 * region; a toast never takes focus. Colour is never the only signal (the
 * icon differs per kind).
 */
export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number): void => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string, opts?: ToastOptions): void => {
    counter.current += 1;
    const id = counter.current;
    const duration = opts?.duration ?? (kind === 'error' ? 8000 : 4500);
    setItems((prev) =>
      [{ id, kind, message, title: opts?.title, action: opts?.action, duration }, ...prev].slice(
        0,
        MAX_VISIBLE,
      ),
    );
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m, o) => push('success', m, o),
      error: (m, o) => push('error', m, o),
      info: (m, o) => push('info', m, o),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="sk-toasts" aria-live="polite" aria-relevant="additions">
        {items.map((t) => (
          <ToastView key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Drop-in name for the legacy provider. */
export const Toaster = ToastProvider;

/**
 * A pausable countdown: runs `onEnd` after `duration` ms of UNPAUSED time.
 * Returns the pause setter; 0 never ends.
 */
function usePausableTimer(duration: number, onEnd: () => void): (paused: boolean) => void {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(duration);
  const end = useRef(onEnd);
  end.current = onEnd;

  useEffect(() => {
    if (duration <= 0 || paused) return;
    const started = Date.now();
    const t = window.setTimeout(() => end.current(), remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [duration, paused]);

  return setPaused;
}

const ICON: Record<ToastKind, typeof Info> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }): ReactElement {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const setPaused = usePausableTimer(item.duration, onDismiss);
  const paused = hover || focus;
  useEffect(() => setPaused(paused), [paused, setPaused]);
  const [showBar] = useState(() => item.duration > 0 && !reducedMotion());
  const Icon = ICON[item.kind];
  const heading = item.title ?? item.message;
  const body = item.title === undefined ? undefined : item.message;

  return (
    <div
      className="sk-toast"
      data-kind={item.kind}
      data-paused={paused || undefined}
      style={{ '--toast-life': `${item.duration}ms` } as CSSProperties}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <span className="sk-toast__badge" aria-hidden>
        <Icon size={18} strokeWidth={2.4} />
      </span>
      <div className="sk-toast__text">
        <p className="sk-toast__title">{heading}</p>
        {body !== undefined ? <p className="sk-toast__body">{body}</p> : null}
      </div>
      {item.action ? (
        <button
          type="button"
          className="sk-toast__action"
          onClick={() => {
            item.action?.onClick();
            onDismiss();
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button type="button" className="sk-toast__close" aria-label="Dismiss" onClick={onDismiss}>
        <X size={15} aria-hidden />
      </button>
      {showBar ? <span className="sk-toast__bar" aria-hidden /> : null}
    </div>
  );
}
