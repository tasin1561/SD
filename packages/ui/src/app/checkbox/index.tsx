'use client';

import { clsx } from 'clsx';
import { CircleAlert } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useMergedRef } from '../text-field/field-shell';
import './checkbox.css';

/**
 * Checkbox (u03). A native checkbox — every attribute, `checked` or
 * `defaultChecked`, form submission and keyboard are the browser's — with a
 * drawn box whose tick strokes itself in (`stroke-dashoffset`) and whose
 * indeterminate dash draws the same way. `indeterminate` is set on the
 * element (it has no attribute), so assistive tech reads "mixed".
 *
 * The whole row is the label, so the target is the row, never the 18px box.
 */
export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly error?: ReactNode;
  readonly indeterminate?: boolean | undefined;
  /** Keep the label for assistive tech but do not draw it (a table's select cell). */
  readonly hideLabel?: boolean | undefined;
};

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  {
    id: idProp,
    label,
    description,
    error,
    indeterminate = false,
    hideLabel = false,
    className,
    'aria-describedby': describedByProp,
    ...rest
  },
  ref,
): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sk-cb-${autoId}`;
  const [node, setRef] = useMergedRef<HTMLInputElement>(ref);
  useEffect(() => {
    if (node.current) node.current.indeterminate = indeterminate;
  }, [indeterminate, node]);
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const described =
    [
      description !== undefined && description !== null ? `${id}-d` : null,
      hasError ? `${id}-e` : null,
      describedByProp ?? null,
    ]
      .filter((x): x is string => x !== null)
      .join(' ') || undefined;
  return (
    <div className={clsx('sk-check', className)} data-invalid={hasError || undefined}>
      <label className="sk-check__row" htmlFor={id}>
        <span className="sk-check__box">
          <input
            ref={setRef}
            id={id}
            type="checkbox"
            className="sk-check__input"
            aria-describedby={described}
            aria-invalid={hasError || undefined}
            data-indeterminate={indeterminate || undefined}
            {...rest}
          />
          <svg className="sk-check__mark" viewBox="0 0 16 16" aria-hidden focusable="false">
            <path className="sk-check__tick" d="M3.5 8.5l3 3 6-7" pathLength={1} />
            <path className="sk-check__dash" d="M4 8h8" pathLength={1} />
          </svg>
        </span>
        {label !== undefined && label !== null ? (
          <span className={clsx('sk-check__text', hideLabel && 'sk-check__text--hidden')}>
            <span className="sk-check__label">{label}</span>
            {description !== undefined && description !== null ? (
              <span className="sk-check__desc" id={`${id}-d`}>
                {description}
              </span>
            ) : null}
          </span>
        ) : null}
      </label>
      {hasError ? (
        <p className="sk-check__error" id={`${id}-e`} aria-live="polite">
          <CircleAlert size={14} aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
});
