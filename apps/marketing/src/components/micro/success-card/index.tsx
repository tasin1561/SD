import type { ReactElement, ReactNode } from 'react';
import { Check } from 'lucide-react';
import './success-card.css';

/**
 * 26 · Success card (u11). A gradient card (green to teal) with a
 * decorative corner arc, a scalloped badge whose check draws itself, a
 * title, one line of body and a white pill action. Enters with scale +
 * fade. The title is plain text so a spec can read it — the hero's
 * embedded form keeps the literal "Request received".
 */
export function SuccessCard({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: ReactNode;
  action?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={`mi mi-ok ${className ?? ''}`} role="status">
      <span className="mi-ok__arc" aria-hidden />
      <span className="mi-ok__badge" aria-hidden>
        <svg viewBox="0 0 48 48" className="mi-ok__scallop">
          <path d="M24 2l4.6 3.4 5.6-1 2.3 5.2 5.4 2 .3 5.7 4.3 3.7-2.6 5 2.6 5-4.3 3.7-.3 5.7-5.4 2-2.3 5.2-5.6-1L24 46l-4.6-3.4-5.6 1-2.3-5.2-5.4-2-.3-5.7L1.5 27l2.6-5-2.6-5 4.3-3.7.3-5.7 5.4-2 2.3-5.2 5.6 1z" />
        </svg>
        <Check size={20} strokeWidth={3} className="mi-ok__check" />
      </span>
      <p className="mi-ok__title">{title}</p>
      <p className="mi-ok__body">{body}</p>
      {action ? <div className="mi-ok__action">{action}</div> : null}
    </div>
  );
}
