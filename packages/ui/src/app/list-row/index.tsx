import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import {
  Children,
  isValidElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';
import './list-row.css';

/**
 * ListRow (u21) — each row its own card. A leading icon chip, the title
 * and one helper line, an optional small tag after the title, the status
 * chip on the right, an age chip ("2h"), and a chevron revealed on hover.
 * On hover or focus the card lifts and a left accent bar grows.
 *
 * `severity` paints a permanent left stripe for prioritised queues. It is
 * never the only signal: the severity is also announced (`severityLabel`,
 * default the word itself), and a queue should put the reason in the
 * helper line.
 *
 * Renders a link (`href`, through `Link` when given — pass next/link),
 * a button (`onClick`), or a plain card (neither).
 */
export type ListRowSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ListRowLink = ComponentType<{
  href: string;
  className: string;
  children: ReactNode;
}>;

export interface ListRowProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  /** A small inline tag after the title — a role, a courier, a type. */
  readonly tag?: ReactNode;
  /** A `StatusChip`, on the right. */
  readonly status?: ReactNode;
  /** An age or time, on the right ("2h", "Last seen 3d"). */
  readonly age?: ReactNode;
  /** Anything else for the right edge — a count, a money figure. */
  readonly meta?: ReactNode;
  readonly href?: string | undefined;
  readonly onClick?: (() => void) | undefined;
  readonly Link?: ListRowLink | undefined;
  readonly severity?: ListRowSeverity | undefined;
  readonly severityLabel?: string | undefined;
  /** Default: shown whenever the row is actionable. */
  readonly chevron?: boolean | undefined;
  readonly selected?: boolean | undefined;
  readonly className?: string | undefined;
}

const SEVERITY_WORD: Record<ListRowSeverity, string> = {
  critical: 'Critical',
  high: 'High priority',
  medium: 'Medium priority',
  low: 'Low priority',
  info: 'For information',
};

export function ListRow({
  title,
  description,
  icon,
  tag,
  status,
  age,
  meta,
  href,
  onClick,
  Link,
  severity,
  severityLabel,
  chevron,
  selected = false,
  className,
}: ListRowProps): ReactElement {
  const actionable = href !== undefined || onClick !== undefined;
  const showChevron = chevron ?? actionable;
  const cls = clsx('sk-lrow', className);
  const body = (
    <>
      <span className="sk-lrow__bar" aria-hidden />
      {severity !== undefined && (
        <span className="sk-lrow__sr">{`${severityLabel ?? SEVERITY_WORD[severity]}. `}</span>
      )}
      {icon !== undefined && (
        <span className="sk-lrow__chip" aria-hidden>
          {icon}
        </span>
      )}
      <span className="sk-lrow__text">
        <span className="sk-lrow__head">
          <span className="sk-lrow__title">{title}</span>
          {tag !== undefined && <span className="sk-lrow__tag">{tag}</span>}
        </span>
        {description !== undefined && <span className="sk-lrow__desc">{description}</span>}
      </span>
      {(status !== undefined || age !== undefined || meta !== undefined) && (
        <span className="sk-lrow__side">
          {meta !== undefined && <span className="sk-lrow__meta">{meta}</span>}
          {status}
          {age !== undefined && <span className="sk-lrow__age sk-figure">{age}</span>}
        </span>
      )}
      {showChevron && <ChevronRight size={16} className="sk-lrow__chev" aria-hidden />}
    </>
  );
  const data = {
    'data-severity': severity,
    'data-selected': selected ? '1' : undefined,
    'data-actionable': actionable ? '1' : undefined,
  };
  if (href !== undefined) {
    if (Link !== undefined) {
      return (
        <span className="sk-lrow-wrap" {...data}>
          <Link href={href} className={cls}>
            {body}
          </Link>
        </span>
      );
    }
    return (
      <a href={href} className={cls} {...data} aria-current={selected ? 'true' : undefined}>
        {body}
      </a>
    );
  }
  if (onClick !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cls}
        {...data}
        aria-pressed={selected ? true : undefined}
      >
        {body}
      </button>
    );
  }
  return (
    <div className={cls} {...data}>
      {body}
    </div>
  );
}

/** A labelled list of rows; each child is wrapped in an `<li>`. */
export function ListRows({
  label,
  children,
  className,
}: {
  readonly label?: string | undefined;
  readonly children: ReactNode;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <ul className={clsx('sk-lrows', className)} aria-label={label}>
      {Children.map(children, (child, i) =>
        child === null || child === undefined || child === false ? null : (
          <li key={isValidElement(child) && child.key !== null ? child.key : i}>{child}</li>
        ),
      )}
    </ul>
  );
}
