'use client';

import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { buttonClassName, type ButtonSize, type ButtonVariant } from '@skydrop/ui/app/button';
import './af.css';

/**
 * Display-only pieces shared by the couriers, system, tickets and
 * dashboard pages of the staff console (area AF). Nothing here fetches,
 * decides or formats a figure: every value arrives as a ready node, so a
 * money string is still the caller's own `<Money>`.
 */

/** A section: a plain-text heading over its content (usually one card). */
export function AfSection({
  title,
  note,
  action,
  id,
  children,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly id?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="af-section">
      <SectionHeading title={title} note={note} action={action} />
      {children}
    </section>
  );
}

export type AfTone = 'critical' | 'warn' | 'good' | 'accent' | undefined;

/** A soft card. `flush` drops the padding for a table or list with its own. */
export function AfCard({
  flush = false,
  tone,
  className,
  children,
}: {
  readonly flush?: boolean;
  readonly tone?: AfTone;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div
      className={className === undefined ? 'af-card' : `af-card ${className}`}
      data-flush={flush ? '1' : undefined}
      data-tone={tone}
    >
      {children}
    </div>
  );
}

export type FactTone = 'accent' | 'good' | 'warn' | 'bad';

/** A standing fact beside a title — never an action. */
export function MetaFact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: FactTone | undefined;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="af-fact" data-tone={tone}>
      {dot && <span className="af-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}

/** A label / value list. Values are ready nodes; nothing is formatted here. */
export function Facts({
  items,
}: {
  readonly items: ReadonlyArray<{ readonly label: ReactNode; readonly value: ReactNode }>;
}): ReactElement {
  return (
    <dl className="af-facts">
      {items.map((it, i) => (
        <div key={i} className="af-facts__pair">
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A notice: icon + words. Colour is never the only signal (the icon differs). */
export function Notice({
  tone = 'info',
  title,
  role,
  children,
}: {
  readonly tone?: 'info' | 'warn' | 'bad' | 'good';
  readonly title?: ReactNode;
  readonly role?: 'alert' | 'status' | undefined;
  readonly children?: ReactNode;
}): ReactElement {
  const Icon = tone === 'good' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className="af-notice" data-tone={tone} role={role}>
      <Icon size={16} className="af-notice__icon" aria-hidden />
      <div className="af-notice__body">
        {title !== undefined && <p className="af-notice__title">{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** A Next link drawn as the app button. */
export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
}: {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly icon?: ReactNode;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <Link href={href} className={buttonClassName(variant, size, false, className)}>
      <span className="sk-btn__fx" aria-hidden />
      {icon !== undefined && (
        <span className="sk-btn__icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="sk-btn__label">{children}</span>
    </Link>
  );
}

/**
 * A horizontal meter. The fill is scaled on X (transform only), so a
 * refetch that moves it animates without touching layout.
 */
export function Meter({
  value,
  tone = 'accent',
  label,
}: {
  /** 0..1 */
  readonly value: number;
  readonly tone?: 'accent' | 'good' | 'warn' | 'bad';
  readonly label?: string | undefined;
}): ReactElement {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span
      className="af-meter"
      data-tone={tone}
      aria-hidden={label === undefined ? true : undefined}
    >
      <span className="af-meter__fill" style={{ transform: `scaleX(${v})` }} />
      {label !== undefined && <span className="af-sr">{label}</span>}
    </span>
  );
}
