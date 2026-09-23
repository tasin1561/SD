import { clsx } from 'clsx';
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import './label-into-parcel.css';

/**
 * Label-into-parcel (storytelling 06): the hover treatment for each app's
 * ONE primary CTA. On hover or keyboard focus the parcel's flaps open, the
 * label drops into the box, the flaps close and the label is back —
 * one ≤ 350 ms play, then rest.
 *
 * It wraps a `Button` or `ButtonLink` and gives it the parcel as its
 * leading icon (the child's own `icon` is replaced). It is feedback only:
 * the click is never intercepted or delayed, so a link navigates at once.
 */
export function LabelIntoParcel({
  children,
  className,
}: {
  children: ReactElement<{ icon?: ReactNode; className?: string | undefined }>;
  className?: string | undefined;
}): ReactElement {
  if (!isValidElement(children)) return children;
  return (
    <span className={clsx('sk-lip', className)}>
      {cloneElement(children, { icon: <ParcelIcon /> })}
    </span>
  );
}

function ParcelIcon(): ReactElement {
  return (
    <svg className="sk-lip__box" viewBox="0 0 24 24" aria-hidden focusable="false">
      <path className="sk-lip__body" d="M4 10h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path className="sk-lip__tape" d="M10.5 10h3v11h-3z" />
      <path className="sk-lip__flap sk-lip__flap--l" d="M4 10h8V6.5H6.2z" />
      <path className="sk-lip__flap sk-lip__flap--r" d="M12 10h8l-2.2-3.5H12z" />
    </svg>
  );
}
