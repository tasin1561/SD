'use client';

import { Copy, KeyRound } from 'lucide-react';
import { Fragment, type ReactElement, type ReactNode } from 'react';
import type { AsyncPhase } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { useToast } from '@skydrop/ui/app/toast';
import './rd.css';

/**
 * The presentational pieces shared by the reseller's setup pages (store
 * settings, my account, team, integrations) and the shell's two notices.
 * Nothing here fetches, decides a permission or computes a figure — every
 * value arrives as a prop and the pages keep their logic.
 */

/** A card with a plain sentence-case heading, an optional note and action. */
export function RdCard({
  title,
  note,
  action,
  tone,
  children,
}: {
  readonly title?: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly tone?: 'danger' | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="rd-card" data-tone={tone}>
      {title !== undefined ? <SectionHeading title={title} note={note} action={action} /> : null}
      {children}
    </section>
  );
}

/** A titled group of content on the page (replaces the legacy `Section`). */
export function RdSection({
  title,
  note,
  action,
  children,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="rd-section">
      <SectionHeading title={title} note={note} action={action} />
      {children}
    </section>
  );
}

/**
 * A boxed notice: an icon chip and the words. The tone is never the only
 * signal — the icon and the words carry it too.
 */
export function RdCallout({
  tone,
  icon,
  role,
  className,
  children,
}: {
  readonly tone?: 'critical' | 'warn' | 'info' | 'good' | undefined;
  readonly icon: ReactNode;
  readonly role?: 'alert' | 'status' | undefined;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div
      className={className === undefined ? 'rd-callout' : `rd-callout ${className}`}
      data-tone={tone}
      role={role}
    >
      <span className="rd-callout__icon" aria-hidden>
        {icon}
      </span>
      <div className="rd-callout__body">{children}</div>
    </div>
  );
}

export interface RdItem {
  readonly label: string;
  readonly value: ReactNode;
}

/** Label / value pairs (replaces the legacy `DescriptionList`). */
export function RdDl({
  items,
  columns = 1,
}: {
  readonly items: readonly RdItem[];
  readonly columns?: 1 | 2;
}): ReactElement {
  return (
    <dl className="rd-dl" data-cols={columns === 2 ? '2' : undefined}>
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * The phase a controlled AsyncButton shows for a request the page runs
 * itself: busy while it is in flight, the failure face while its verdict
 * is on screen, idle otherwise.
 */
export function phaseOf(busy: boolean, error: string | null): AsyncPhase {
  if (busy) return 'busy';
  return error !== null ? 'error' : 'idle';
}

/**
 * A secret shown ONCE (an API key, a signing secret), with a way to copy
 * it before it is gone. The value is an identifier, so it reads in mono.
 */
export function RdOneTimeSecret({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): ReactElement {
  const toast = useToast();
  return (
    <section className="rd-reveal" aria-live="polite">
      <h3 className="rd-reveal__title">
        <span className="rd-reveal__chip" aria-hidden>
          <KeyRound size={15} />
        </span>
        {label}
      </h3>
      <p className="rd-muted">
        Copy it now — it is shown only this once. We keep only a fingerprint of it.
      </p>
      <div className="rd-reveal__value">
        <code className="rd-reveal__code sk-ident">{value}</code>
        <Button
          variant="secondary"
          size="sm"
          icon={<Copy size={14} />}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => toast.success('Copied.'));
          }}
        >
          Copy
        </Button>
      </div>
    </section>
  );
}
