'use client';

import type { ReactElement } from 'react';
import './easy.css';

export interface FilterPill<K extends string> {
  readonly key: K;
  readonly label: string;
  /** A count shown before the label, when the page knows it. */
  readonly count?: number | undefined;
  readonly tone?: 'info' | 'warn' | 'bad' | 'good' | undefined;
}

/**
 * A row of pills that choose what a list shows — the plain replacement for
 * a filter dropdown with a handful of options. Every choice is on the
 * screen and is one press; nothing has to be opened and read first.
 *
 * Exactly one pill is chosen. They wrap onto a second line on a narrow
 * screen and never scroll sideways.
 */
export function FilterPills<K extends string>({
  label,
  options,
  value,
  onChange,
}: {
  /** Names the group for a screen reader ("Show", "Status"). */
  readonly label: string;
  readonly options: ReadonlyArray<FilterPill<K>>;
  readonly value: K;
  readonly onChange: (next: K) => void;
}): ReactElement {
  return (
    <div className="ez-pills" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className="ez-pill"
          data-tone={o.tone}
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
        >
          {o.count !== undefined && <span className="ez-pill__num">{o.count}</span>}
          <span className="ez-pill__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
