'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Minus, Plus } from 'lucide-react';
import { ms, reducedMotion } from '../motion';
import '../micro.css';
import './stepper.css';

/**
 * 20 · Number stepper (u12). One pill; round − and + buttons, each with
 * its own glow and press feedback; the value ROLLS on change (old value
 * slides out, new one slides in, direction following the sign) and is
 * zero-padded when `pad` is set. `role="spinbutton"` with the arrow keys
 * and Home/End; the value is also a real input for the form.
 */
export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  unit,
  pad = 0,
  label,
  name,
  format,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  pad?: number;
  label: string;
  name?: string;
  format?: (v: number) => string;
  className?: string;
}): ReactElement {
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  const prev = useRef(value);
  useEffect(() => {
    if (prev.current === value) return;
    setDir(value > prev.current ? 'up' : 'down');
    prev.current = value;
    if (reducedMotion()) return;
    const t = window.setTimeout(() => setDir(null), ms(260));
    return () => window.clearTimeout(t);
  }, [value]);
  const clamp = (v: number): number => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  const set = (v: number): void => {
    const c = clamp(v);
    if (c !== value) onChange(c);
  };
  const text = format ? format(value) : pad ? String(value).padStart(pad, '0') : String(value);
  return (
    <span className={`mi mi-step ${className ?? ''}`}>
      <button
        type="button"
        className="mi-step__btn mi-step__btn--minus"
        onClick={() => set(value - step)}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
      >
        <Minus size={16} strokeWidth={2.5} />
      </button>
      <span
        className="mi-step__value"
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={`${text}${unit ? ` ${unit}` : ''}`}
        data-dir={dir ?? undefined}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(value + step);
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(value - step);
          else if (e.key === 'Home') set(min);
          else if (e.key === 'End') set(max);
          else return;
          e.preventDefault();
        }}
      >
        <span key={value} className="mi-step__num tabular">
          {text}
        </span>
        {unit ? <span className="mi-step__unit">{unit}</span> : null}
      </span>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        type="button"
        className="mi-step__btn mi-step__btn--plus"
        onClick={() => set(value + step)}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
      >
        <Plus size={16} strokeWidth={2.5} />
      </button>
    </span>
  );
}
