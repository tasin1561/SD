'use client';

import Link from 'next/link';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Copy } from 'lucide-react';
import { PageHeader, type Crumb } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { TextField } from '@skydrop/ui/app/text-field';
import type { AsyncPhase } from '@skydrop/ui/app/async-button';
import './settings.css';

/**
 * The presentational pieces shared by Settings, Team, Notifications and
 * Profile. Nothing here fetches, decides a permission or computes a
 * figure — every value arrives as a prop, and the pages keep their logic.
 */

export type SetTone = 'good' | 'warn' | 'bad' | 'accent' | undefined;

/** A standing fact under the page title — never an action. */
export function SetFact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: SetTone;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="set-fact" data-tone={tone}>
      {dot && <span className="set-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * The app page header with Next's Link wired in, so a server page can
 * hand it plain data (a component reference cannot cross from a server
 * component into a client one as a prop).
 */
export function SetPageHeader({
  crumbs,
  title,
  subtitle,
  meta,
  action,
}: {
  readonly crumbs: readonly Crumb[];
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

/**
 * A boxed notice: an icon chip, an optional bold line and the body. The
 * tone is never the only signal — the icon and the words carry it too.
 */
export function SetCallout({
  tone,
  icon,
  title,
  children,
  action,
  role,
}: {
  readonly tone?: 'critical' | 'warn' | 'info' | 'good' | undefined;
  readonly icon: ReactNode;
  readonly title?: ReactNode;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
  readonly role?: 'alert' | 'status' | undefined;
}): ReactElement {
  return (
    <div className="set-callout" data-tone={tone} role={role}>
      <span className="set-callout__icon" aria-hidden>
        {icon}
      </span>
      <div className="set-callout__body">
        {title !== undefined && <div className="set-callout__title">{title}</div>}
        {children}
        {action !== undefined && (
          <div className="set-buttons" data-align="start">
            {action}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The phase a controlled AsyncButton shows for a request the page runs
 * itself (a form submit, a request whose success closes a dialog).
 * Wired to the real request: busy while it is in flight, the failure
 * face while its verdict is on screen, idle otherwise.
 */
export function phaseOf(busy: boolean, error: string | null): AsyncPhase {
  if (busy) return 'busy';
  return error !== null ? 'error' : 'idle';
}

/**
 * The one-time reveal: a value the server returns ONCE (an API key, a
 * webhook secret, an invitation link). It stays until the person says
 * they have it. The value is an identifier, so it reads in mono.
 */
export function RevealCard({
  icon,
  title,
  note,
  body,
  value,
  valueLabel,
  dismissLabel,
  onDismiss,
}: {
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly body: ReactNode;
  readonly value: string;
  readonly valueLabel: string;
  readonly dismissLabel: string;
  readonly onDismiss: () => void;
}): ReactElement {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      // Clipboard write can fail (insecure context, permission); the
      // field below still selects on focus for a manual copy.
    }
  }

  return (
    <section className="set-reveal" aria-live="polite">
      <div className="set-reveal__head">
        <div>
          <h2 className="set-reveal__title">
            <span className="set-reveal__chip" aria-hidden>
              {icon}
            </span>
            {title}
          </h2>
          {note !== undefined && <p className="set-reveal__note">{note}</p>}
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </div>
      <p className="set-muted">{body}</p>
      <div className="set-reveal__value">
        <TextField
          readOnly
          aria-label={valueLabel}
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
    </section>
  );
}
