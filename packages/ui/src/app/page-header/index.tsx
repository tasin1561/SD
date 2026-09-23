'use client';

import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import './page-header.css';

export interface Crumb {
  readonly label: string;
  /** Omit on the current page (the last crumb). */
  readonly href?: string | undefined;
}

/** next/link, passed in so the package takes no Next dependency. */
export type CrumbLink = ComponentType<{ href: string; className: string; children: ReactNode }>;

/**
 * Breadcrumbs — a real `nav aria-label="Breadcrumb"` with an ordered
 * list; the last crumb carries `aria-current="page"`. Sentence case,
 * app font — no mono, no uppercase.
 */
export function Breadcrumbs({
  items,
  Link,
  className,
}: {
  readonly items: readonly Crumb[];
  readonly Link?: CrumbLink | undefined;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <nav aria-label="Breadcrumb" className={clsx('sk-crumbs', className)}>
      <ol>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`}>
              {last || c.href === undefined ? (
                <span aria-current={last ? 'page' : undefined} className="sk-crumbs__here">
                  {c.label}
                </span>
              ) : Link !== undefined ? (
                <Link href={c.href} className="sk-crumbs__link">
                  {c.label}
                </Link>
              ) : (
                <a href={c.href} className="sk-crumbs__link">
                  {c.label}
                </a>
              )}
              {!last && <ChevronRight size={13} className="sk-crumbs__sep" aria-hidden />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * PageHeader — breadcrumb, title, subtitle, meta chips and the primary
 * action slot.
 *
 * `sticky` (u30): the TITLE BAR sticks under the shell's top bar and
 * condenses once the page scrolls — a surface and shadow fade in and the
 * title scales down (transform + opacity only). Breadcrumb, meta and
 * subtitle scroll away normally, so the stuck part is only as tall as
 * the title row. The stick offset is `--sk-sticky-top` (the shell sets it
 * to its header height).
 *
 * `breadcrumbs` takes crumb data; `breadcrumb` takes a ready node (the
 * legacy prop) — pass one. The subtitle renders in a `<div>`, never a
 * `<p>`: a block inside a `<p>` is invalid HTML and breaks hydration.
 */
export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  breadcrumb,
  meta,
  action,
  sticky = false,
  Link,
  className,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly breadcrumbs?: readonly Crumb[] | undefined;
  readonly breadcrumb?: ReactNode;
  /** Standing facts under the title — chips. Facts, never actions. */
  readonly meta?: ReactNode;
  readonly action?: ReactNode;
  readonly sticky?: boolean;
  readonly Link?: CrumbLink | undefined;
  readonly className?: string | undefined;
}): ReactElement {
  const sentinel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    if (!sticky) return;
    const s = sentinel.current;
    const b = bar.current;
    if (s === null || b === null || typeof IntersectionObserver === 'undefined') return;
    const top = Number.parseFloat(getComputedStyle(b).top) || 0;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (e !== undefined) setCondensed(!e.isIntersecting && e.boundingClientRect.top < top + 1);
      },
      { rootMargin: `-${Math.round(top) + 1}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(s);
    return () => io.disconnect();
  }, [sticky]);

  const crumbs =
    breadcrumbs !== undefined && breadcrumbs.length > 0 ? (
      <Breadcrumbs items={breadcrumbs} Link={Link} />
    ) : (
      breadcrumb
    );

  return (
    <div className={clsx('sk-ph', className)} data-sticky={sticky ? '1' : undefined}>
      {crumbs !== undefined && crumbs !== null && <div className="sk-ph__crumbs">{crumbs}</div>}
      {sticky && <div ref={sentinel} className="sk-ph__sentinel" aria-hidden />}
      <div ref={bar} className="sk-ph__bar" data-condensed={condensed ? '1' : undefined}>
        <span className="sk-ph__backdrop" aria-hidden />
        <h1 className="sk-ph__title">{title}</h1>
        {action !== undefined && action !== null && action !== false && (
          <div className="sk-ph__action">{action}</div>
        )}
      </div>
      {meta !== undefined && <div className="sk-ph__meta">{meta}</div>}
      {subtitle !== undefined && <div className="sk-ph__subtitle">{subtitle}</div>}
    </div>
  );
}

/**
 * SectionHeading — a plain text title, an optional one-line note and an
 * action. No index numbers, no "//" eyebrows, sentence case.
 */
export function SectionHeading({
  title,
  note,
  action,
  as: Tag = 'h2',
  id,
  className,
}: {
  readonly title: ReactNode;
  readonly note?: ReactNode;
  readonly action?: ReactNode;
  readonly as?: 'h2' | 'h3';
  readonly id?: string | undefined;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <div className={clsx('sk-sh', className)}>
      <div className="sk-sh__text">
        <Tag id={id} className="sk-sh__title">
          {title}
        </Tag>
        {note !== undefined && <div className="sk-sh__note">{note}</div>}
      </div>
      {action !== undefined && <div className="sk-sh__action">{action}</div>}
    </div>
  );
}
