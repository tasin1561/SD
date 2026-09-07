'use client';

/*
  A CLIENT module now, and it has to be.
  
  These carry a disclosure with `useState` behind it, and a hook in a
  module a server component imports does not fail at the hook — it fails
  at the import, because what a server component receives from a client
  module is a client REFERENCE rather than the function. The same trap
  the theme init script documents. Marking the module is what puts the
  boundary in the right place; without it any page that is still a
  server component breaks at build, and the ones that are already
  `'use client'` would go on working, so the failure would look random.
*/
import { clsx } from 'clsx';
import { helpSubject, useHelpDisclosure } from './help-disclosure';
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
        tone === 'critical' ? 'border-[var(--color-critical-ring)]' : 'border-border',
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
  /**
   * `accent` gives the head a tinted band.
   *
   * Additive and opt-in — every existing call site keeps `default` and
   * looks exactly as it did. It exists because a column of white cards
   * on a near-white page is read as one long surface: the band is what
   * makes each card a THING, which is the "contrast of surface" the
   * light theme already relies on for its stat tiles.
   */
  readonly tone?: 'default' | 'critical' | 'accent';
}): ReactElement {
  // The subtitle explains what the panel is FOR — read once, then in the
  // way of the panel itself for ever after. Folded behind the (i).
  const help = useHelpDisclosure(helpSubject(title, 'this section'), subtitle);
  return (
    <div
      className={clsx(
        'flex items-start justify-between gap-4 px-4 py-3 border-b',
        tone === 'critical'
          ? 'border-[var(--color-critical-ring)]'
          : tone === 'accent'
            ? 'border-accent/20 bg-accent/[0.06]'
            : 'border-border',
      )}
    >
      <div className="min-w-0">
        <div
          className={clsx(
            'flex items-center gap-1.5 text-sm font-medium',
            tone === 'critical' ? 'text-critical' : 'text-text-bright',
          )}
        >
          {title}
          {help.trigger}
        </div>
        {help.panel && <div className="text-text-muted text-xs">{help.panel}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>): ReactElement {
  return <div className={clsx('px-4 py-3', className)} {...rest} />;
}
