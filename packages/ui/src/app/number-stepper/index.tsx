'use client';

import { clsx } from 'clsx';
import { CircleAlert, Minus, Plus } from 'lucide-react';
import {
  forwardRef,
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useFieldText, useMergedRef } from '../text-field/field-shell';
import './number-stepper.css';

/**
 * NumberStepper (u12). A native `type="number"` input between − and +
 * buttons ("Decrease quantity" / "Increase quantity"). The buttons step by
 * `step` and clamp to `min`/`max`, disabling themselves at the ends; the
 * input stays typeable. A button press sets the value through the native
 * setter and fires a real `input` event, so a controlled parent's
 * `onChange` receives it exactly as if it had been typed.
 */
export type NumberStepperProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** The field's name, also used to name the buttons. */
  readonly label: string;
  readonly hideLabel?: boolean | undefined;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
};

function num(v: string | number | undefined, fallback: number): number {
  if (v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** "Quantity" → "quantity", but "AWB count" stays as written. */
function inSentence(label: string): string {
  const second = label.charAt(1);
  if (second !== '' && second === second.toUpperCase() && second !== second.toLowerCase())
    return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function decimals(n: number): number {
  const s = String(n);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

export const NumberStepper = forwardRef<HTMLInputElement, NumberStepperProps>(
  function NumberStepper(
    {
      id: idProp,
      label,
      hideLabel = false,
      hint,
      error,
      min,
      max,
      step,
      value,
      defaultValue,
      onChange,
      disabled,
      className,
      'aria-describedby': describedByProp,
      ...rest
    },
    ref,
  ): ReactElement {
    const autoId = useId();
    const id = idProp ?? `sk-ns-${autoId}`;
    const [node, setRef] = useMergedRef<HTMLInputElement>(ref);
    const { text, track } = useFieldText(value, defaultValue, node);
    const lo = num(min, Number.NEGATIVE_INFINITY);
    const hi = num(max, Number.POSITIVE_INFINITY);
    const by = step === 'any' ? 1 : num(step, 1);
    const current = text === '' ? null : Number.parseFloat(text);
    const hasError = error !== undefined && error !== null && error !== false && error !== '';
    const hasHint = hint !== undefined && hint !== null && hint !== false && hint !== '';
    const described =
      [hasError ? `${id}-e` : null, hasHint ? `${id}-h` : null, describedByProp ?? null]
        .filter((x): x is string => x !== null)
        .join(' ') || undefined;

    function bump(dir: 1 | -1): void {
      const el = node.current;
      if (!el) return;
      const base =
        current !== null && Number.isFinite(current) ? current : Number.isFinite(lo) ? lo : 0;
      const places = Math.max(decimals(by), decimals(base));
      let next = current === null && dir === 1 && Number.isFinite(lo) ? lo : base + dir * by;
      next = Math.min(hi, Math.max(lo, next));
      const nextText = next.toFixed(places);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, nextText);
      else el.value = nextText;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function change(e: ChangeEvent<HTMLInputElement>): void {
      track(e.target.value);
      onChange?.(e);
    }

    const atLow = current !== null && current <= lo;
    const atHigh = current !== null && current >= hi;

    return (
      <div className={clsx('sk-stepper', className)} data-invalid={hasError || undefined}>
        <label className={clsx('sk-stepper__label', hideLabel && 'sk-stepper__sr')} htmlFor={id}>
          {label}
        </label>
        <div className="sk-stepper__row">
          <button
            type="button"
            className="sk-stepper__btn"
            aria-label={`Decrease ${inSentence(label)}`}
            aria-controls={id}
            disabled={disabled === true || atLow}
            onClick={() => bump(-1)}
          >
            <Minus size={16} aria-hidden />
          </button>
          <input
            ref={setRef}
            id={id}
            type="number"
            className="sk-stepper__input sk-figure"
            min={min}
            max={max}
            step={step}
            value={value}
            defaultValue={defaultValue}
            onChange={change}
            disabled={disabled}
            inputMode={by % 1 === 0 && lo >= 0 ? 'numeric' : 'decimal'}
            aria-invalid={hasError || undefined}
            aria-describedby={described}
            {...rest}
          />
          <button
            type="button"
            className="sk-stepper__btn"
            aria-label={`Increase ${inSentence(label)}`}
            aria-controls={id}
            disabled={disabled === true || atHigh}
            onClick={() => bump(1)}
          >
            <Plus size={16} aria-hidden />
          </button>
        </div>
        {hasError ? (
          <p className="sk-stepper__msg" data-kind="error" id={`${id}-e`} aria-live="polite">
            <CircleAlert size={14} aria-hidden />
            <span>{error}</span>
          </p>
        ) : null}
        {hasHint ? (
          <p className="sk-stepper__msg" id={`${id}-h`}>
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
