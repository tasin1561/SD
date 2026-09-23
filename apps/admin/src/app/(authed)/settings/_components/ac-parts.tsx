'use client';

import Link from 'next/link';
import { useState, type ReactElement, type ReactNode } from 'react';
import { CircleAlert, Copy, TriangleAlert } from 'lucide-react';
import { PageHeader, SectionHeading, type Crumb } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { StatusChip, type StatusChipKind } from '@skydrop/ui/app/status-chip';
import { TextField } from '@skydrop/ui/app/text-field';
import type { AsyncPhase } from '@skydrop/ui/app/async-button';
import './ac.css';

/**
 * Display-only pieces shared by the people-and-configuration area of the
 * staff console: sellers, seller stores, reseller stores, invite
 * requests, staff, roles, account, system settings and notifications.
 *
 * Nothing here fetches, decides a permission or formats a figure — every
 * value arrives as a prop, so a money string is still the caller's own
 * `<Money>` and every refusal is the caller's `serverVerdict()` string.
 */

/** The page column: one grid, sections spaced evenly. */
export function AcPage({
  width,
  children,
}: {
  readonly width?: 'narrow' | 'wide' | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="ac-page" data-width={width}>
      {children}
    </div>
  );
}

/** The app page header with Next's Link wired in for the breadcrumbs. */
export function AcHeader({
  crumbs,
  title,
  subtitle,
  meta,
  action,
}: {
  readonly crumbs?: readonly Crumb[] | undefined;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly meta?: ReactNode;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <PageHeader
      breadcrumbs={crumbs}
      Link={Link}
      title={title}
      subtitle={subtitle}
      meta={meta}
      action={action}
    />
  );
}

/** A section: a plain-text heading over one soft card. */
export function AcSection({
  title,
  note,
  action,
  id,
  flush = false,
  bare = false,
  tone,
  children,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly id?: string | undefined;
  /** No padding inside the card — for a table. */
  readonly flush?: boolean;
  /** No card at all — the children bring their own surfaces. */
  readonly bare?: boolean;
  readonly tone?: 'critical' | 'warn' | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="ac-section">
      <SectionHeading title={title} note={note} action={action} />
      {bare ? (
        <div className="ac-stack">{children}</div>
      ) : (
        <div className="ac-card" data-flush={flush ? '1' : undefined} data-tone={tone}>
          {children}
        </div>
      )}
    </section>
  );
}

/** A card with an optional heading row of its own. */
export function AcCard({
  title,
  note,
  action,
  tone,
  flush = false,
  className,
  children,
}: {
  readonly title?: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly tone?: 'critical' | 'warn' | undefined;
  readonly flush?: boolean;
  readonly className?: string | undefined;
  readonly children?: ReactNode;
}): ReactElement {
  const head = title !== undefined || note !== undefined || action !== undefined;
  return (
    <div
      className={className === undefined ? 'ac-card' : `ac-card ${className}`}
      data-flush={flush ? '1' : undefined}
      data-tone={tone}
    >
      {head && (
        <div className="ac-card__head">
          <div className="ac-card__titles">
            {title !== undefined && <h3 className="ac-card__title">{title}</h3>}
            {note !== undefined && <div className="ac-card__note">{note}</div>}
          </div>
          {action !== undefined && action !== null && (
            <div className="ac-card__action">{action}</div>
          )}
        </div>
      )}
      {children !== undefined && children !== null && (
        <div className={head ? 'ac-card__body' : undefined}>{children}</div>
      )}
    </div>
  );
}

/** A description list: label over value on a phone, two columns wider. */
export function AcDl({
  items,
  columns = 1,
}: {
  readonly items: ReadonlyArray<{ readonly label: ReactNode; readonly value: ReactNode }>;
  readonly columns?: 1 | 2;
}): ReactElement {
  return (
    <dl className="ac-dl" data-cols={columns}>
      {items.map((it, i) => (
        <div key={i} className="ac-dl__row">
          <dt className="ac-dl__label">{it.label}</dt>
          <dd className="ac-dl__value">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * A refusal or failure shown in place — the caller's `serverVerdict()`
 * string, verbatim (FE-2). The icon carries the tone, so colour is never
 * the only signal.
 */
export function AcAlert({
  message,
  tone = 'critical',
  action,
}: {
  readonly message: ReactNode;
  readonly tone?: 'critical' | 'warn';
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <div className="ac-alert" data-tone={tone} role="alert">
      <span className="ac-alert__icon" aria-hidden>
        {tone === 'critical' ? <CircleAlert size={16} /> : <TriangleAlert size={16} />}
      </span>
      <div className="ac-alert__body">{message}</div>
      {action !== undefined && <div className="ac-alert__action">{action}</div>}
    </div>
  );
}

/** A boxed notice with an icon chip. */
export function AcCallout({
  tone,
  icon,
  title,
  children,
  role,
}: {
  readonly tone?: 'critical' | 'warn' | 'info' | 'good' | undefined;
  readonly icon: ReactNode;
  readonly title?: ReactNode;
  readonly children?: ReactNode;
  readonly role?: 'alert' | 'status' | undefined;
}): ReactElement {
  return (
    <div className="ac-callout" data-tone={tone} role={role}>
      <span className="ac-callout__icon" aria-hidden>
        {icon}
      </span>
      <div className="ac-callout__body">
        {title !== undefined && <div className="ac-callout__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export type AcTone = 'good' | 'warn' | 'bad' | 'accent' | undefined;

/** A standing fact in a pill — never an action. */
export function AcFact({
  tone,
  children,
}: {
  readonly tone?: AcTone;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="ac-fact" data-tone={tone}>
      {children}
    </span>
  );
}

/** A row of buttons; wraps on a phone. */
export function AcButtons({
  align = 'end',
  children,
}: {
  readonly align?: 'start' | 'end';
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="ac-buttons" data-align={align}>
      {children}
    </div>
  );
}

/**
 * The phase a controlled AsyncButton shows for a request the page runs
 * itself: busy while it is in flight, the failure face while its verdict
 * is on screen, idle otherwise. Wired to the real request, never faked.
 */
export function phaseOf(busy: boolean, error: string | null): AsyncPhase {
  if (busy) return 'busy';
  return error !== null ? 'error' : 'idle';
}

/** A seller account status as a chip — the same kinds the legacy badge chose. */
export function SellerStatusChip({
  status,
}: {
  readonly status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
}): ReactElement {
  const kind: StatusChipKind =
    status === 'APPROVED'
      ? 'delivered'
      : status === 'PENDING'
        ? 'pending'
        : status === 'SUSPENDED'
          ? 'rto'
          : 'failed';
  return <StatusChip kind={kind} label={status.toLowerCase()} size="sm" />;
}

/**
 * A value the server returns once (an invitation link, a decrypted
 * account number). It stays until the person dismisses it; the field
 * selects on focus for a manual copy when the clipboard is refused.
 */
export function AcRevealValue({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      // Clipboard may fail (insecure context); the field still selects.
    }
  }

  return (
    <div className="ac-reveal">
      <TextField
        readOnly
        aria-label={label}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        inputClassName="sk-ident"
      />
      <Button
        type="button"
        variant="primary"
        size="md"
        icon={<Copy size={14} />}
        onClick={() => void copy()}
      >
        {copied ? 'Copied!' : 'Copy'}
      </Button>
    </div>
  );
}
