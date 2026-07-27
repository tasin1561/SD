import { clsx } from 'clsx';
import type { ReactElement, ReactNode } from 'react';

/**
 * Page-level chrome. A consistent header (title / subtitle / action
 * slot) + section dividers. Every admin page composes this.
 */
export function PageHeader({
  title,
  subtitle,
  action,
  className,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}): ReactElement {
  return (
    <div className={clsx('flex items-start justify-between gap-4 mb-6', className)}>
      <div className="min-w-0">
        <h1 className="text-text-bright text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="text-text-muted text-sm mt-1">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  readonly title?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}): ReactElement {
  return (
    <section className={clsx('mb-6', className)}>
      {(title || action) && (
        <div className="flex items-baseline justify-between gap-4 mb-2">
          {title && (
            <h2 className="text-text-bright text-sm font-medium tracking-tight">
              {title}
            </h2>
          )}
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function LoadingState({ label = 'Loading…' }: { readonly label?: string }): ReactElement {
  return (
    <div className="rounded-[7px] border border-border bg-surface px-4 py-8 text-center text-text-muted text-sm">
      {label}
    </div>
  );
}

export function ErrorState({ message }: { readonly message: string }): ReactElement {
  return (
    <div className="rounded-[7px] border border-[var(--color-critical-ring)] bg-[var(--color-critical-tint)] px-4 py-3 text-critical text-sm">
      {message}
    </div>
  );
}

/**
 * The empty state.
 *
 * "No results" is a dead end. An empty table in an ops console is one
 * of three things — nothing exists yet, a filter hid everything, or a
 * fetch failed — and each wants a different next move, so `description`
 * should say which and `action` should offer the way out.
 *
 * `bare` drops the card chrome for use INSIDE an existing bordered
 * table, where a second border reads as a rendering bug.
 */
export function EmptyState({
  title,
  description,
  action,
  icon,
  bare = false,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
  readonly bare?: boolean;
}): ReactElement {
  return (
    <div
      className={
        bare
          ? 'px-4 py-10 text-center'
          : 'rounded-[7px] border border-border bg-surface px-4 py-10 text-center'
      }
    >
      {icon && <div className="text-text-faint mb-2 flex justify-center">{icon}</div>}
      <div className="text-text-body text-sm font-medium">{title}</div>
      {description && (
        <div className="text-text-muted text-xs mt-1 max-w-md mx-auto leading-relaxed">
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * Permanent badge for orders with `hasAdminOverride === true`. The
 * flag is set-once-never-cleared on the server (ORD-2 invariant); the
 * UI surfaces it on EVERY view of the order to convey the order's
 * history was touched by god mode. This is information, not an alarm
 * — quiet but unmissable.
 */
export function HasOverrideBadge(): ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] text-[11px] font-medium uppercase tracking-wide"
      style={{
        background: 'var(--color-critical-tint)',
        color: 'var(--color-critical)',
        border: '1px solid var(--color-critical-ring)',
      }}
      title="This order was modified via god-mode (ORD-2). The flag is set-once and never cleared — it permanently records that admin override was used."
    >
      Override
    </span>
  );
}
