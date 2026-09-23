'use client';

import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { buttonClassName } from '@skydrop/ui/app/button';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { LabelIntoParcel } from '@skydrop/ui/app/label-into-parcel';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import './rd-dashboard.css';

/**
 * The dashboard's presentational pieces. Nothing here fetches, decides a
 * permission or computes a figure — every value arrives as a prop from
 * the page, which is where the logic stays.
 */

/** The app button's look on a Next link; takes the icon LabelIntoParcel hands it. */
function NewOrderLinkInner({ icon }: { readonly icon?: ReactNode }): ReactElement {
  return (
    <Link href="/orders/new" className={buttonClassName('primary', 'md')}>
      <span className="sk-btn__fx" aria-hidden />
      <span className="sk-btn__icon" aria-hidden>
        {icon ?? <Plus size={15} />}
      </span>
      <span className="sk-btn__label">New order</span>
    </Link>
  );
}

/**
 * The store's one primary action. Label-into-parcel on hover/focus only —
 * the link navigates at once, nothing waits for the animation.
 */
export function NewOrderLink(): ReactElement {
  return (
    <LabelIntoParcel>
      <NewOrderLinkInner />
    </LabelIntoParcel>
  );
}

/**
 * A wallet figure. The value is the same `<Money>` node the page always
 * rendered, handed in ready so nothing here re-formats it.
 */
export function PositionTile({
  label,
  icon,
  tone,
  figure,
  loading,
}: {
  readonly label: string;
  readonly icon: ReactNode;
  readonly tone: KpiTone;
  readonly figure: ReactNode;
  readonly loading: boolean;
}): ReactElement {
  return (
    <KpiCard
      label={label}
      icon={icon}
      tone={tone}
      figure={loading ? <Skeleton className="rd-db-skel" width={112} height={28} /> : figure}
    />
  );
}

/** A quick way on: icon chip, title, one line, and a "Go" that steps right. */
export function ShortcutCard({
  href,
  icon,
  title,
  body,
}: {
  readonly href: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
}): ReactElement {
  return (
    <li>
      <Link href={href} className="rd-db-shortcut">
        <span className="rd-db-shortcut__chip" aria-hidden>
          {icon}
        </span>
        <span className="rd-db-shortcut__title">{title}</span>
        <span className="rd-db-shortcut__body">{body}</span>
        <span className="rd-db-shortcut__go">
          Go <ArrowRight size={14} aria-hidden />
        </span>
      </Link>
    </li>
  );
}
