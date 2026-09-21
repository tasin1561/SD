'use client';

import type { ReactElement, ReactNode } from 'react';
import { Check } from 'lucide-react';
import '../micro.css';
import './choice-cards.css';

export interface ChoiceOption<V extends string> {
  value: V;
  title: ReactNode;
  /** One helper line under the title — a transit time, a price, a consequence. */
  helper?: ReactNode;
  icon?: ReactNode;
  /** Token hue for the selected state; default blue. */
  hue?: string;
}

/**
 * 16 · Choice cards (u10). Options as cards with a title and a helper
 * line; the selected card takes the hue's border, tint and glow and a
 * drawn check. A real radio group underneath: arrow keys move, the label
 * IS the card, so it is keyboard-operable with no script. Controlled.
 */
export function ChoiceCards<V extends string>({
  name,
  options,
  value,
  onChange,
  label,
  columns = 2,
  className,
}: {
  name: string;
  options: readonly ChoiceOption<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
  columns?: 1 | 2 | 3;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`mi mi-choice ${className ?? ''}`}
      role="radiogroup"
      aria-label={label}
      style={{ '--cols': columns } as React.CSSProperties}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <label
            key={o.value}
            className="mi-choice__card"
            data-selected={selected}
            style={{ '--hue': o.hue ?? 'blue' } as React.CSSProperties}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={selected}
              onChange={() => onChange(o.value)}
              className="mi-choice__input"
            />
            {o.icon ? (
              <span className="mi-choice__icon" aria-hidden>
                {o.icon}
              </span>
            ) : null}
            <span className="mi-choice__text">
              <span className="mi-choice__title">{o.title}</span>
              {o.helper ? <span className="mi-choice__helper">{o.helper}</span> : null}
            </span>
            <span className="mi-choice__check" aria-hidden>
              <Check size={12} strokeWidth={3} />
            </span>
          </label>
        );
      })}
    </div>
  );
}
