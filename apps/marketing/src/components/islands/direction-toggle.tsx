'use client';

import type { ReactElement } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Direction } from './direction';

/**
 * Two `aria-pressed` buttons. The colour is the direction's meaning —
 * saffron is Send to India, green is Send to Bangladesh — and the label
 * says the same thing in words, so the state is never colour alone.
 */
export function DirectionToggle({
  value,
  onChange,
}: {
  value: Direction;
  onChange: (d: Direction) => void;
}): ReactElement {
  return (
    <div className="hero-dir" role="group" aria-label="Shipping direction">
      <button
        type="button"
        aria-pressed={value === 'out'}
        data-hue="saffron"
        onClick={() => onChange('out')}
        className="hero-dir__btn"
      >
        <span>Bangladesh</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span>India</span>
      </button>
      <button
        type="button"
        aria-pressed={value === 'in'}
        data-hue="green"
        onClick={() => onChange('in')}
        className="hero-dir__btn"
      >
        <span>India</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span>Bangladesh</span>
      </button>
    </div>
  );
}
