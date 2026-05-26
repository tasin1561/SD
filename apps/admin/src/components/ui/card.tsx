import { clsx } from 'clsx';
import type { HTMLAttributes, ReactElement, ReactNode } from 'react';

/**
 * Card — the panel primitive. Quiet surface (var(--color-surface))
 * with a hairline border. NO accent on default; consumers pass tone
 * for emphasis (e.g., 'critical' for god-mode panels).
 */
export function Card({
  className,
  tone = 'default',
  ...rest
}: HTMLAttributes<HTMLDivElement> & { readonly tone?: 'default' | 'critical' }): ReactElement {
  return (
    <div
      className={clsx(
        'rounded-[7px] border bg-surface',
        tone === 'critical'
          ? 'border-[var(--color-critical-ring)]'
          : 'border-border',
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  tone = 'default',
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly action?: ReactNode;
  readonly tone?: 'default' | 'critical';
}): ReactElement {
  return (
    <div
      className={clsx(
        'flex items-start justify-between gap-4 px-4 py-3 border-b',
        tone === 'critical' ? 'border-[var(--color-critical-ring)]' : 'border-border',
      )}
    >
      <div className="min-w-0">
        <div
          className={clsx(
            'text-sm font-medium',
            tone === 'critical' ? 'text-critical' : 'text-text-bright',
          )}
        >
          {title}
        </div>
        {subtitle && (
          <div className="text-text-muted text-xs mt-0.5">{subtitle}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={clsx('px-4 py-3', className)} {...rest} />;
}
