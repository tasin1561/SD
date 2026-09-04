import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

export interface BellItem {
  readonly id: string;
  readonly title: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

/**
 * The bell, and the short list behind it.
 *
 * PRESENTATIONAL ONLY — it fetches nothing and knows no routes. Both
 * apps pass their own data and callbacks, which is what lets one
 * component serve a seller's inbox and a staff member's without either
 * app's data layer leaking into `@skydrop/ui` (FE-6).
 *
 * The count is capped at 9+ on purpose: past a handful the exact number
 * stops being information and starts being a wall somebody ignores.
 */
export function NotificationBell({
  unread,
  items,
  loading = false,
  onOpen,
  onMarkRead,
  onMarkAllRead,
  viewAllHref,
  Link,
}: {
  readonly unread: number;
  readonly items: readonly BellItem[];
  readonly loading?: boolean;
  /** Called when the panel opens — the moment to fetch. */
  readonly onOpen?: () => void;
  readonly onMarkRead?: (id: string) => void;
  readonly onMarkAllRead?: () => void;
  readonly viewAllHref: string;
  readonly Link: (props: {
    href: string;
    className?: string;
    children: ReactNode;
    onClick?: () => void;
  }) => ReactElement;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);

  // Close on an outside click or Escape. Without the keyboard half this
  // is a panel a keyboard user can open and not dismiss.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent): void {
      if (wrap.current !== null && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="text-text-muted hover:text-text relative inline-flex h-11 w-11 items-center justify-center rounded-md"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onOpen?.();
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {unread > 0 && (
          <span className="bg-status-failed-fg absolute right-1.5 top-1.5 min-w-[16px] rounded-full px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="border-border bg-surface absolute right-0 z-50 mt-1 w-[min(360px,calc(100vw-2rem))] rounded-md border shadow-lg"
        >
          <div className="border-border-subtle flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && onMarkAllRead !== undefined && (
              <button
                type="button"
                className="text-text-faint hover:text-text text-xs underline"
                onClick={() => onMarkAllRead()}
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <p className="text-text-muted px-3 py-6 text-center text-sm">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-text-muted px-3 py-6 text-center text-sm">
                Nothing yet. This is where anything needing you will appear.
              </p>
            ) : (
              <ul className="divide-border-subtle divide-y">
                {items.map((n) => (
                  <li key={n.id} className={n.readAt === null ? 'bg-surface-raised/40' : ''}>
                    <button
                      type="button"
                      className="block w-full px-3 py-2 text-left"
                      onClick={() => {
                        if (n.readAt === null) onMarkRead?.(n.id);
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {n.readAt === null && (
                          <span
                            aria-hidden="true"
                            className="bg-accent mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                          />
                        )}
                        <div className="min-w-0">
                          {n.title !== null && (
                            <div className="truncate text-sm font-medium">{n.title}</div>
                          )}
                          <div className="text-text-muted line-clamp-2 text-xs">{n.body}</div>
                          <div className="text-text-faint mt-0.5 text-[11px] tabular-nums">
                            {new Date(n.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-border-subtle border-t px-3 py-2">
            <Link
              href={viewAllHref}
              className="text-text-muted hover:text-text text-xs underline"
              onClick={() => setOpen(false)}
            >
              See everything
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
