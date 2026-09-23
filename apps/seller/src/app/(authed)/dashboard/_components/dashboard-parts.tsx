'use client';

import Link from 'next/link';
import { ArrowRight, Check, Plus } from 'lucide-react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Money } from '@skydrop/ui/components';
import { buttonClassName } from '@skydrop/ui/app/button';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import './dashboard.css';

/**
 * The dashboard's presentational pieces. Nothing here fetches, decides
 * permissions or computes a figure — every value arrives as a prop from
 * `DashboardView`, which is where the logic stays.
 */

/** A standing fact under the page title — never an action. */
export function MetaFact({
  tone,
  dot = false,
  children,
}: {
  readonly tone?: 'good' | 'accent' | undefined;
  readonly dot?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <span className="db-fact" data-tone={tone}>
      {dot && <span className="db-fact__dot" aria-hidden />}
      {children}
    </span>
  );
}

/** The page's one primary action, drawn as the app button on a Next link. */
export function CreateOrderLink(): ReactElement {
  return (
    <Link href="/orders/new" className={buttonClassName('primary', 'md')}>
      <span className="sk-btn__fx" aria-hidden />
      <span className="sk-btn__icon" aria-hidden>
        <Plus size={15} />
      </span>
      <span className="sk-btn__label">Create order</span>
    </Link>
  );
}

/** A section title with an optional "go to the full page" link. */
export function DashSection({
  title,
  note,
  link,
  children,
}: {
  readonly title: string;
  readonly note?: ReactNode;
  readonly link?: { readonly href: string; readonly label: string } | undefined;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <section className="db-section">
      <SectionHeading
        title={title}
        note={note}
        action={
          link === undefined ? undefined : (
            <Link href={link.href} className="db-link">
              {link.label}
            </Link>
          )
        }
      />
      {children}
    </section>
  );
}

/**
 * A figure that is MOVING — money out in the world rather than money in
 * the wallet. The figure is the same `<Money amount size="md">` it always
 * was, handed to the card as a ready node so nothing re-formats it.
 */
export function MoneyTile({
  label,
  icon,
  tone = 'neutral',
  amount,
  count,
  countLabel,
  hint,
  loading,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly tone?: KpiTone;
  readonly amount: string | undefined;
  readonly count: number | undefined;
  readonly countLabel: string;
  readonly hint: string;
  readonly loading: boolean;
}): ReactElement {
  return (
    <KpiCard
      label={label}
      icon={icon}
      tone={tone}
      figure={
        loading || amount === undefined ? (
          <Skeleton className="db-figure-skel" width={112} height={24} />
        ) : (
          <Money amount={amount} size="md" />
        )
      }
      hint={hint}
      {...(count === undefined ? {} : { foot: [{ label: countLabel, value: count }] })}
    />
  );
}

export interface OnboardingStep {
  readonly done: boolean;
  readonly label: string;
  readonly href: string;
}

/** The setup checklist body: a progress bar and the steps, next one highlighted. */
export function OnboardingSteps({
  steps,
  completed,
  firstIncomplete,
}: {
  readonly steps: readonly OnboardingStep[];
  readonly completed: number;
  readonly firstIncomplete: number;
}): ReactElement {
  const fill: CSSProperties = {
    transform: `scaleX(${steps.length === 0 ? 0 : completed / steps.length})`,
  };
  return (
    <div className="db-card">
      <div className="db-progress" aria-hidden>
        <span className="db-progress__fill" style={fill} />
      </div>
      <ol className="db-steps">
        {steps.map((step, i) => (
          <li key={step.label} className="db-step" data-done={step.done ? '1' : undefined}>
            <span className="db-step__mark" aria-hidden>
              {step.done ? <Check size={13} strokeWidth={3} /> : null}
            </span>
            {step.done ? (
              <span className="db-step__done">{step.label}</span>
            ) : (
              <Link
                href={step.href}
                className="db-step__link"
                data-next={i === firstIncomplete ? '1' : undefined}
              >
                {step.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A quick action: icon chip, title, one line, and a count when known. */
export function ShortcutCard({
  href,
  icon,
  title,
  body,
  foot,
}: {
  readonly href: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
  readonly foot?: string | undefined;
}): ReactElement {
  return (
    <li>
      <Link href={href} className="db-shortcut">
        <span className="db-shortcut__chip" aria-hidden>
          {icon}
        </span>
        <span className="db-shortcut__title">{title}</span>
        <span className="db-shortcut__body">{body}</span>
        <span className="db-shortcut__foot">
          <span className="db-shortcut__foot-text sk-figure">{foot ?? ''}</span>
          <span className="db-shortcut__go">
            Go <ArrowRight size={14} aria-hidden />
          </span>
        </span>
      </Link>
    </li>
  );
}
