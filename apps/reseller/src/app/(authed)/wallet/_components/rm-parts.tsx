import type { CSSProperties, ReactElement, ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  FilePen,
  OctagonX,
  PackageCheck,
  PauseCircle,
  Truck,
  Undo2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { StatusKind } from '@skydrop/ui/status';
import './rm.css';

/**
 * The money + catalogue area's presentational pieces (wallet, expenses,
 * reports, terms, catalogue). Nothing here fetches, decides a permission
 * or computes a figure — every value arrives as a prop, and every amount
 * arrives as the caller's own `<Money>` node.
 */

/** A section: a heading row (the caller's `SectionHeading`) and its body. */
export function RmSection({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <section className={className ? `rm-section ${className}` : 'rm-section'}>{children}</section>
  );
}

/**
 * A refusal or failure, read out as it happens. The words are the
 * caller's — the server's own `[CODE] message` (FE-2) — with an icon so
 * the colour is never the only signal.
 */
export function RmAlert({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <div className="rm-callout rm-form__full" data-tone="critical" role="alert">
      <span className="rm-callout__icon" aria-hidden>
        <OctagonX size={16} />
      </span>
      <div className="rm-callout__body">{children}</div>
    </div>
  );
}

/** A boxed notice: an icon, an optional bold line and the body. */
export function RmCallout({
  tone,
  icon,
  title,
  children,
  role,
}: {
  readonly tone?: 'critical' | 'warn' | 'info' | undefined;
  readonly icon: ReactNode;
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly role?: 'alert' | 'status' | undefined;
}): ReactElement {
  return (
    <div className="rm-callout" data-tone={tone} role={role}>
      <span className="rm-callout__icon" aria-hidden>
        {icon}
      </span>
      <div className="rm-callout__body">
        {title !== undefined && <div className="rm-callout__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** The arrow chip beside a ledger line: which way the money went. */
export function RmDir({ credit }: { readonly credit: boolean }): ReactElement {
  return (
    <span className="rm-dir" data-dir={credit ? 'credit' : 'debit'} aria-hidden>
      {credit ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
    </span>
  );
}

const STATE_ICONS: Record<StatusKind | 'held' | 'neutral', LucideIcon> = {
  draft: FilePen,
  pending: Clock,
  confirmed: CheckCircle2,
  'in-transit': Truck,
  delivered: PackageCheck,
  rto: Undo2,
  failed: XCircle,
  cancelled: Ban,
  held: PauseCircle,
  neutral: Circle,
};

/**
 * A state chip (colour + icon + word) that shows the words EXACTLY as
 * given. `StatusChip` sentence-cases its label, which would turn a
 * sentence naming Skydrop into "skydrop"; the top-up words are a local
 * vocabulary that already reads as a sentence.
 */
export function RmStateChip({
  kind,
  children,
}: {
  readonly kind: StatusKind | 'held' | 'neutral';
  readonly children: ReactNode;
}): ReactElement {
  const Icon = STATE_ICONS[kind];
  const style = {
    '--rm-state-fg': `var(--st-${kind}-fg)`,
    '--rm-state-bg': `var(--st-${kind}-bg)`,
    '--rm-state-line': `var(--st-${kind}-line)`,
  } as CSSProperties;
  return (
    <span className="rm-state" data-status-kind={kind} style={style}>
      <Icon className="rm-state__icon" size={12} strokeWidth={2.2} aria-hidden />
      <span>{children}</span>
    </span>
  );
}
