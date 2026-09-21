'use client';

import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Check, Info, TriangleAlert, X } from 'lucide-react';
import '../micro.css';
import './toast.css';

export interface ToastInput {
  title: string;
  body?: ReactNode;
  tone?: 'success' | 'info' | 'warning' | 'error';
  /** A snackbar (u22) carries an action; a toast (u32) does not. */
  action?: { label: string; onClick: () => void };
  /** ms; 0 = sticky */
  duration?: number;
}
interface ToastItem extends ToastInput {
  id: number;
  duration: number;
}

// ── Module store: `toast()` from anywhere, one <ToastHost> in the layout.
let seq = 0;
let items: ToastItem[] = [];
const subs = new Set<() => void>();
const emit = (): void => subs.forEach((f) => f());
export function toast(input: ToastInput): number {
  const id = ++seq;
  items = [...items, { id, duration: input.action ? 6000 : 4000, ...input }];
  emit();
  return id;
}
export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

/**
 * 27 · Toast (u32) and snackbar (u22). A rounded surface with an icon
 * badge, a bold title and a body line, a close control, a coloured glow,
 * and a thin progress bar along the bottom that drains until auto-dismiss
 * (paused while hovered). A snackbar adds an action button. Announced
 * through `aria-live=polite`; never steals focus.
 */
export function ToastHost(): ReactElement {
  const [list, setList] = useState<ToastItem[]>([]);
  useEffect(() => {
    const f = (): void => setList(items);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return (
    <div className="mi-toasts" aria-live="polite" aria-atomic="false">
      {list.map((t) => (
        <ToastView key={t.id} item={t} />
      ))}
    </div>
  );
}

function ToastView({ item }: { item: ToastItem }): ReactElement {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (item.duration === 0 || paused) return;
    const t = window.setTimeout(() => dismissToast(item.id), item.duration);
    return () => window.clearTimeout(t);
  }, [item, paused]);
  const tone = item.tone ?? 'success';
  const Icon = tone === 'success' ? Check : tone === 'info' ? Info : TriangleAlert;
  return (
    <div
      className={`mi mi-toast ${item.action ? 'mi-toast--snack' : ''}`}
      data-tone={tone}
      data-paused={paused || undefined}
      style={{ '--dur': `${item.duration}ms` } as React.CSSProperties}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
    >
      <span className="mi-toast__badge" aria-hidden>
        <Icon size={16} strokeWidth={2.6} />
      </span>
      <span className="mi-toast__text">
        <span className="mi-toast__title">{item.title}</span>
        {item.body ? <span className="mi-toast__body">{item.body}</span> : null}
      </span>
      {item.action ? (
        <button
          type="button"
          className="mi-toast__action"
          onClick={() => {
            item.action?.onClick();
            dismissToast(item.id);
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className="mi-toast__close"
        aria-label="Dismiss"
        onClick={() => dismissToast(item.id)}
      >
        <X size={14} />
      </button>
      {item.duration > 0 ? <span className="mi-toast__bar" aria-hidden /> : null}
    </div>
  );
}
