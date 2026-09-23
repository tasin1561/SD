'use client';

import { ChevronDown } from 'lucide-react';
import { forwardRef, useId, type ReactElement, type SelectHTMLAttributes } from 'react';
import { FieldShell, describedBy, hasContent, type FieldMessages } from '../text-field';
import './select.css';

/**
 * Select (u05, native). A styled NATIVE <select>: the phone's own picker on
 * touch, type-to-jump on a keyboard, and `selectOptions` in tests all keep
 * working. The label is always floated — a select always shows a choice —
 * and the chevron turns while the control is focused. Options are the
 * caller's `<option>` children, exactly as with the legacy `Select`.
 *
 * `className` styles the wrapper; `selectClassName` the <select>.
 */
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> &
  FieldMessages & {
    readonly selectClassName?: string | undefined;
    /** The required asterisk without the native `required` (see TextField). */
    readonly requiredMark?: boolean | undefined;
  };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    id: idProp,
    label,
    hint,
    help,
    notice,
    error,
    icon,
    className,
    selectClassName,
    required,
    requiredMark = false,
    disabled,
    children,
    'aria-describedby': describedByProp,
    'aria-invalid': ariaInvalid,
    ...rest
  },
  ref,
): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sk-f-${autoId}`;
  const guidance = hint ?? help;
  return (
    <FieldShell
      id={id}
      label={label}
      hint={guidance}
      notice={notice}
      error={error}
      icon={icon}
      required={required === true || requiredMark}
      disabled={disabled}
      float
      variant="sk-select"
      className={className}
      trail={
        <span className="sk-field__trail sk-select__chev" aria-hidden>
          <ChevronDown size={18} />
        </span>
      }
    >
      <select
        ref={ref}
        id={id}
        className={
          selectClassName
            ? `sk-field__input sk-select__native ${selectClassName}`
            : 'sk-field__input sk-select__native'
        }
        required={required}
        disabled={disabled}
        aria-invalid={hasContent(error) ? true : ariaInvalid}
        aria-describedby={describedBy(id, {
          hint: guidance,
          notice,
          error,
          extra: describedByProp,
        })}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});
