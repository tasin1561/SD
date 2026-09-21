'use client';

import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react';
import '../micro.css';
import './glow-field.css';

/**
 * 4 · Glow field. The wrapper glows on focus; `valid` (the caller decides
 * what valid means) turns the ring green and is what the partner button
 * reads to enable itself. Pure CSS — nothing to animate in JS.
 */
export function GlowField({
  valid,
  action,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & { valid: boolean; action?: ReactNode }): ReactElement {
  return (
    <span className="mi mi-glow" data-valid={valid}>
      <input className="mi-glow__input" {...input} />
      {action}
    </span>
  );
}
