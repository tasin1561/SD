'use client';

import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { Check, ChevronDown, TriangleAlert } from 'lucide-react';
import '../micro.css';
import './text-field.css';

export type FieldStatus = 'idle' | 'error' | 'success';

interface Shared {
  label: string;
  /** Helper line under the field; an error message replaces it. */
  helper?: ReactNode;
  error?: ReactNode;
  status?: FieldStatus;
  /** Leading icon in a tinted chip. */
  icon?: ReactNode;
  /** Live counter against `maxLength`. */
  counter?: boolean;
  className?: string;
}

/**
 * 17 · Text field (u33). The placeholder floats up into the border as the
 * label on focus or once filled; accent border + soft glow on focus; helper
 * text lives UNDER the field, never only in the placeholder; an optional
 * live counter ("21/30") that warms near the limit; an inline status icon
 * (warning / check) beside the value. Colour is never the only signal — the
 * error text and the icon say it too.
 */
export function TextField({
  label,
  helper,
  error,
  status = error ? 'error' : 'idle',
  icon,
  counter,
  className,
  id: idProp,
  maxLength,
  onChange,
  defaultValue,
  value,
  ...input
}: Shared & InputHTMLAttributes<HTMLInputElement>): ReactElement {
  const auto = useId();
  const id = idProp ?? auto;
  const [len, setLen] = useState(String(value ?? defaultValue ?? '').length);
  const near = maxLength !== undefined && len >= maxLength * 0.85;
  return (
    <span
      className={`mi mi-tf ${className ?? ''}`}
      data-status={status}
      data-icon={icon ? '1' : undefined}
    >
      <span className="mi-tf__box">
        {icon ? (
          <span className="mi-tf__icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        <input
          id={id}
          className="mi-tf__input"
          placeholder=" "
          aria-invalid={status === 'error' || undefined}
          aria-describedby={helper || error ? `${id}-help` : undefined}
          {...(maxLength !== undefined ? { maxLength } : {})}
          {...(value !== undefined ? { value } : {})}
          {...(defaultValue !== undefined ? { defaultValue } : {})}
          onChange={(e) => {
            setLen(e.currentTarget.value.length);
            onChange?.(e);
          }}
          {...input}
        />
        <label htmlFor={id} className="mi-tf__label">
          {label}
        </label>
        <span className="mi-tf__status" aria-hidden>
          {status === 'error' ? <TriangleAlert size={15} /> : null}
          {status === 'success' ? <Check size={15} strokeWidth={3} /> : null}
        </span>
      </span>
      {helper || error || (counter && maxLength) ? (
        <span className="mi-tf__foot">
          <span id={`${id}-help`} className="mi-tf__help" role={error ? 'alert' : undefined}>
            {error ?? helper}
          </span>
          {counter && maxLength ? (
            <span className="mi-tf__count tabular" data-near={near || undefined}>
              {len}/{maxLength}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/** Same field, many lines. */
export function TextArea({
  label,
  helper,
  error,
  status = error ? 'error' : 'idle',
  counter,
  className,
  id: idProp,
  maxLength,
  onChange,
  defaultValue,
  value,
  ...ta
}: Omit<Shared, 'icon'> & TextareaHTMLAttributes<HTMLTextAreaElement>): ReactElement {
  const auto = useId();
  const id = idProp ?? auto;
  const [len, setLen] = useState(String(value ?? defaultValue ?? '').length);
  const near = maxLength !== undefined && len >= maxLength * 0.85;
  return (
    <span className={`mi mi-tf mi-tf--area ${className ?? ''}`} data-status={status}>
      <span className="mi-tf__box">
        <textarea
          id={id}
          className="mi-tf__input"
          placeholder=" "
          aria-invalid={status === 'error' || undefined}
          aria-describedby={helper || error ? `${id}-help` : undefined}
          {...(maxLength !== undefined ? { maxLength } : {})}
          {...(value !== undefined ? { value } : {})}
          {...(defaultValue !== undefined ? { defaultValue } : {})}
          onChange={(e) => {
            setLen(e.currentTarget.value.length);
            onChange?.(e);
          }}
          {...ta}
        />
        <label htmlFor={id} className="mi-tf__label">
          {label}
        </label>
      </span>
      {helper || error || (counter && maxLength) ? (
        <span className="mi-tf__foot">
          <span id={`${id}-help`} className="mi-tf__help" role={error ? 'alert' : undefined}>
            {error ?? helper}
          </span>
          {counter && maxLength ? (
            <span className="mi-tf__count tabular" data-near={near || undefined}>
              {len}/{maxLength}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 18 · Select (u05). A styled trigger — icon chip, floating label always
 * up, chevron that rotates while the menu is open — over a NATIVE select,
 * so the phone gets its own picker and the keyboard works untouched. The
 * searchable, cascading variant (u18) is the quote estimator's.
 */
export function SelectField({
  label,
  helper,
  error,
  status = error ? 'error' : 'idle',
  icon,
  className,
  id: idProp,
  children,
  ...select
}: Omit<Shared, 'counter'> & SelectHTMLAttributes<HTMLSelectElement>): ReactElement {
  const auto = useId();
  const id = idProp ?? auto;
  return (
    <span
      className={`mi mi-tf mi-tf--select ${className ?? ''}`}
      data-status={status}
      data-icon={icon ? '1' : undefined}
    >
      <span className="mi-tf__box">
        {icon ? (
          <span className="mi-tf__icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        <select
          id={id}
          className="mi-tf__input"
          aria-invalid={status === 'error' || undefined}
          aria-describedby={helper || error ? `${id}-help` : undefined}
          {...select}
        >
          {children}
        </select>
        <label htmlFor={id} className="mi-tf__label">
          {label}
        </label>
        <span className="mi-tf__chev" aria-hidden>
          <ChevronDown size={16} />
        </span>
      </span>
      {helper || error ? (
        <span className="mi-tf__foot">
          <span id={`${id}-help`} className="mi-tf__help" role={error ? 'alert' : undefined}>
            {error ?? helper}
          </span>
        </span>
      ) : null}
    </span>
  );
}
