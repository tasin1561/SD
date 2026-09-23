import type { ReactElement, ReactNode } from 'react';
import { OctagonX } from 'lucide-react';
import { InboundFreightStatus, TopupRequestStatus, WithdrawalRequestStatus } from '@skydrop/db';
import {
  inboundFreightStatusKind,
  statusLabel,
  topupStatusKind,
  topupStatusLabel,
  withdrawalStatusKind,
  withdrawalStatusLabel,
} from '@skydrop/ui/status';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import './money-kit.css';

/**
 * The sellers'-money area's presentational pieces, shared by the ten
 * money screens (seller wallets, top-ups, withdrawals, remittances,
 * settlements, bank changes, wallet transfers, freight, FX, reseller
 * store wallets). Nothing here fetches, decides a permission or computes
 * a figure — every value arrives as a prop, and every amount arrives as
 * the caller's own `<Money>` node.
 */

/** A section: a heading row (the caller's `SectionHeading`) and its body. */
export function MkSection({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <section className={className ? `mk-section ${className}` : 'mk-section'}>{children}</section>
  );
}

/** A card with an optional head (icon chip, title, subtitle, aside). */
export function MkCard({
  title,
  subtitle,
  icon,
  aside,
  flush = false,
  children,
  className,
}: {
  readonly title?: ReactNode;
  readonly subtitle?: ReactNode;
  readonly icon?: ReactNode;
  readonly aside?: ReactNode;
  /** No padding: for a table that runs to the card's edges. */
  readonly flush?: boolean;
  readonly children?: ReactNode;
  readonly className?: string | undefined;
}): ReactElement {
  const hasHead = title !== undefined || aside !== undefined;
  return (
    <div
      className={['mk-card', flush ? 'mk-card--flush' : '', className ?? '']
        .filter((c) => c !== '')
        .join(' ')}
    >
      {hasHead && (
        <div className="mk-card__head">
          {icon !== undefined && (
            <span className="mk-card__chip" aria-hidden>
              {icon}
            </span>
          )}
          <div className="mk-card__titles">
            {title !== undefined && <h2 className="mk-card__title">{title}</h2>}
            {subtitle !== undefined && <div className="mk-card__sub">{subtitle}</div>}
          </div>
          {aside !== undefined && <div className="mk-card__aside">{aside}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

/**
 * A refusal or failure, read out as it happens. The words are the
 * caller's — the server's own `[CODE] message` (FE-2) — with an icon so
 * the colour is never the only signal.
 */
export function MkAlert({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <div
      className={className ? `mk-callout ${className}` : 'mk-callout'}
      data-tone="critical"
      role="alert"
    >
      <span className="mk-callout__icon" aria-hidden>
        <OctagonX size={16} />
      </span>
      <div className="mk-callout__body">{children}</div>
    </div>
  );
}

/** A boxed notice: an icon, an optional bold line and the body. */
export function MkCallout({
  tone,
  icon,
  title,
  children,
  role,
}: {
  readonly tone?: 'critical' | 'warn' | 'info' | 'good' | undefined;
  readonly icon: ReactNode;
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly role?: 'alert' | 'status' | undefined;
}): ReactElement {
  return (
    <div className="mk-callout" data-tone={tone} role={role}>
      <span className="mk-callout__icon" aria-hidden>
        {icon}
      </span>
      <div className="mk-callout__body">
        {title !== undefined && <div className="mk-callout__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

/** Label / value pairs (replaces the legacy `DescriptionList`). */
export function MkDl({
  items,
  grid = false,
  className,
}: {
  readonly items: ReadonlyArray<{ readonly label: ReactNode; readonly value: ReactNode }>;
  readonly grid?: boolean;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <dl
      className={['mk-dl', grid ? 'mk-dl--grid' : '', className ?? '']
        .filter((c) => c !== '')
        .join(' ')}
    >
      {items.map((item, i) => (
        <div key={i} className="mk-dl__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The staff vocabulary for a seller withdrawal request, as a chip. */
export function WithdrawalChip({
  status,
  size = 'sm',
}: {
  readonly status: WithdrawalRequestStatus;
  readonly size?: 'sm' | 'md';
}): ReactElement {
  return (
    <StatusChip
      kind={withdrawalStatusKind(status)}
      label={withdrawalStatusLabel(status, 'staff')}
      size={size}
    />
  );
}

const TOPUP_VALUES = new Set<string>(Object.values(TopupRequestStatus));

/**
 * A top-up claim status, as a chip. A value the vocabulary does not know
 * is printed as it came rather than guessed at — a render that throws
 * takes the whole queue with it.
 */
export function TopupChip({ status }: { readonly status: string }): ReactElement {
  if (!TOPUP_VALUES.has(status)) return <span className="mk-small">{status}</span>;
  const s = status as TopupRequestStatus;
  return <StatusChip kind={topupStatusKind(s)} label={topupStatusLabel(s, 'staff')} size="sm" />;
}

/** An inbound freight bill status, as a chip. */
export function FreightChip({ status }: { readonly status: InboundFreightStatus }): ReactElement {
  return (
    <StatusChip kind={inboundFreightStatusKind(status)} label={statusLabel(status)} size="sm" />
  );
}
