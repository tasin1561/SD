'use client';

import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

/**
 * Toast primitive — fire-and-forget success/error notifications.
 *
 * Usage:
 *   1. Mount <Toaster /> once at the route-group layout root.
 *   2. Call useToast() from any client component:
 *        const toast = useToast();
 *        toast.success('Invitation resent');
 *
 * Token-driven (FE-6), extraction-ready. No external deps beyond
 * lucide-react which is already used everywhere.
 */

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

interface ToastApi {
  readonly success: (message: string) => void;
  readonly error: (message: string) => void;
  readonly info: (message: string) => void;
}

const TOAST_TTL_MS = 3500;
const ToastCtx = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const v = useContext(ToastCtx);
  if (v === null) {
    throw new Error(
      '@skydrop/ui: useToast called without <Toaster /> mounted in the layout.',
    );
  }
  return v;
}

export function Toaster({ children }: { readonly children: ReactNode }): ReactElement {
  const [items, setItems] = useState<readonly ToastItem[]>([]);
  const counterRef = useRef(0);

  const push = useCallback((kind: ToastKind, message: string): void => {
    counterRef.current += 1;
    const id = counterRef.current;
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none"
      >
        {items.map((t) => (
          <ToastRow
            key={t.id}
            item={t}
            onDismiss={() =>
              setItems((prev) => prev.filter((x) => x.id !== t.id))
            }
          />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

interface ToastRowProps {
  readonly item: ToastItem;
  readonly onDismiss: () => void;
}

function ToastRow({ item, onDismiss }: ToastRowProps): ReactElement {
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 10);
    return () => clearTimeout(t);
  }, []);

  const tone =
    item.kind === 'success'
      ? {
          border: 'var(--color-accent-ring)',
          bg: 'var(--color-surface-raised)',
          icon: <CheckCircle2 size={16} className="text-accent shrink-0" />,
        }
      : item.kind === 'error'
        ? {
            border: 'var(--color-critical-ring)',
            bg: 'var(--color-surface-raised)',
            icon: <AlertCircle size={16} className="text-critical shrink-0" />,
          }
        : {
            border: 'var(--color-border)',
            bg: 'var(--color-surface-raised)',
            icon: <Info size={16} className="text-text-muted shrink-0" />,
          };

  return (
    <div
      role="status"
      className="pointer-events-auto flex items-start gap-2 min-w-[260px] max-w-[380px] px-3 py-2 rounded-[6px] border shadow-[var(--shadow-3)] transition-all"
      style={{
        background: tone.bg,
        borderColor: tone.border,
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(8px)',
      }}
    >
      {tone.icon}
      <div className="text-text-bright text-sm leading-snug flex-1">
        {item.message}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-text-muted hover:text-text-body transition-colors -mr-1 -mt-0.5"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export type { ToastApi };
