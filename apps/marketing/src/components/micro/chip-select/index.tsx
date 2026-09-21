'use client';

import type { ReactElement, ReactNode } from 'react';
import { Check } from 'lucide-react';
import '../micro.css';
import './chip-select.css';

export interface Chip<V extends string> {
  id: V;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
}

/**
 * 32 · Chip select — u04 filter bar (`multiple` off: one chip active) and
 * u24 multi-select (`multiple` on: any number). Pills with an icon chip
 * that fills with the accent when active, a drawn check in multi mode, a
 * count badge, and a row that scrolls sideways on a phone with no
 * scrollbar. Colour is never the only signal: `aria-pressed` plus the
 * check or the filled icon chip say it too.
 */
export function ChipSelect<V extends string>({
  chips,
  value,
  onChange,
  label,
  multiple = false,
  hue = 'blue',
  className,
}: {
  chips: readonly Chip<V>[];
  value: readonly V[];
  onChange: (next: V[]) => void;
  label: string;
  multiple?: boolean;
  hue?: 'blue' | 'green' | 'saffron' | 'teal' | 'violet' | 'magenta';
  className?: string;
}): ReactElement {
  const toggle = (id: V): void => {
    if (!multiple) return onChange([id]);
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  return (
    <div
      className={`mi mi-chips ${className ?? ''}`}
      role="group"
      aria-label={label}
      data-hue={hue}
    >
      {chips.map((c) => {
        const on = value.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            className="mi-chips__chip"
            aria-pressed={on}
            onClick={() => toggle(c.id)}
          >
            {c.icon || multiple ? (
              <span className="mi-chips__ico" aria-hidden>
                {multiple ? (
                  <>
                    <span className="mi-chips__ico-i">{c.icon}</span>
                    <Check size={13} strokeWidth={3} className="mi-chips__check" />
                  </>
                ) : (
                  c.icon
                )}
              </span>
            ) : null}
            <span>{c.label}</span>
            {c.count !== undefined ? (
              <span className="mi-chips__count tabular">{c.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
