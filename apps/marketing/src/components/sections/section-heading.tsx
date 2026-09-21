import type { ReactElement, ReactNode } from 'react';

export type Hue = 'blue' | 'green' | 'saffron' | 'teal' | 'violet' | 'magenta' | 'red';

/**
 * The heading block every Phase 4+ section opens with: an eyebrow chip in
 * the section's hue (icon chip filled with the hue, a plain word), a
 * balanced h2 and one paragraph. Sentence case; no section numbers —
 * these are not a sequence.
 */
export function SectionHeading({
  id,
  eyebrow,
  icon,
  title,
  sub,
  hue = 'blue',
  center,
}: {
  id: string;
  eyebrow: string;
  icon: ReactNode;
  title: string;
  sub?: string;
  hue?: Hue;
  center?: boolean;
}): ReactElement {
  return (
    <div className={`sec-head ${center ? 'sec-head--center' : ''}`} data-hue={hue}>
      <span className="sec-head__eyebrow">
        <span className="sec-head__eyebrow-ico" aria-hidden>
          {icon}
        </span>
        {eyebrow}
      </span>
      <h2 id={id} className="sec-head__h2">
        {title}
      </h2>
      {sub ? <p className="sec-head__sub">{sub}</p> : null}
    </div>
  );
}
