import type { AnchorHTMLAttributes, ReactElement } from 'react';
import '../micro.css';
import './label-into-parcel.css';

/**
 * 6 · Label-into-parcel. A LINK (mailto / WhatsApp) whose label drops into
 * a parcel on hover and is replaced by the "packed" word. Hover feedback
 * only — a link navigates at once and never fakes a busy or success state.
 */
export function LabelIntoParcel({
  label,
  packedLabel = 'Packed — opening…',
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  label: string;
  packedLabel?: string;
}): ReactElement {
  return (
    <a className="mi mi-lip" {...rest}>
      <svg className="mi-lip__box" viewBox="0 0 26 26" aria-hidden>
        <path d="M3 10h20v13H3z" fill="var(--saffron-fill)" />
        <path d="M3 10h20l-2-4H5z" className="mi-lip__flap" fill="var(--saffron-500)" />
        <path d="M11 10h4v13h-4z" fill="var(--saffron-on-fill)" opacity=".25" />
      </svg>
      <span className="mi-lip__label">{label}</span>
      <span className="mi-lip__ghost" aria-hidden>
        {packedLabel}
      </span>
    </a>
  );
}
