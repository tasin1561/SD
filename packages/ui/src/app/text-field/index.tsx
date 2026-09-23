'use client';

import {
  forwardRef,
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import {
  FieldShell,
  describedBy,
  hasContent,
  useFieldText,
  useMergedRef,
  type FieldMessages,
  type FieldStatus,
} from './field-shell';

export {
  FieldShell,
  describedBy,
  fieldIds,
  hasContent,
  useFieldText,
  useMergedRef,
  type FieldMessages,
  type FieldShellProps,
  type FieldStatus,
} from './field-shell';

/**
 * TextField (u33). The label rests inside the field and floats up into a
 * notch in the border on focus or once there is a value; the leading icon
 * sits in a chip that takes the accent tint while focused; the helper line
 * carries the hint, a notice or the error (with its icon, announced, and
 * wired through `aria-describedby`); `showCount` with a `maxLength` adds a
 * "21/30" counter; `status` adds an inline valid/invalid icon.
 *
 * Every native attribute reaches the <input>. `className` styles the
 * wrapper (layout); `inputClassName` the input itself. Controlled
 * (`value` + `onChange`) and uncontrolled (`defaultValue`) both work.
 */
interface FieldExtras extends FieldMessages {
  /** Show "n / max" under the field, enforcing `maxLength` (the browser stops typing). */
  readonly showCount?: boolean | undefined;
  /**
   * Show "n / countMax" under the field WITHOUT enforcing it — display only.
   * For a limit the server enforces and the form never did: nothing is
   * blocked client-side that was not blocked before (owner's rule).
   */
  readonly countMax?: number | undefined;
  /** An inline valid/invalid icon at the end of the field. */
  readonly status?: FieldStatus | undefined;
  /** Keep the label floated even when empty. */
  readonly floatLabel?: boolean | undefined;
  /** Before the input, after the icon chip. */
  readonly lead?: ReactNode;
  /** After the input (a button, a unit). */
  readonly trail?: ReactNode;
  /** Under the helper line. */
  readonly after?: ReactNode;
  /** A class on the root, for a variant's own CSS. */
  readonly variant?: string | undefined;
  readonly inputClassName?: string | undefined;
}

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & FieldExtras;

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  {
    id: idProp,
    label,
    hint,
    help,
    notice,
    error,
    icon,
    showCount = false,
    countMax,
    status,
    floatLabel = false,
    lead,
    trail,
    after,
    variant,
    className,
    inputClassName,
    value,
    defaultValue,
    onChange,
    placeholder,
    required,
    disabled,
    maxLength,
    'aria-describedby': describedByProp,
    'aria-invalid': ariaInvalid,
    ...rest
  },
  ref,
): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sk-f-${autoId}`;
  const [node, setRef] = useMergedRef<HTMLInputElement>(ref);
  const { text, track } = useFieldText(value, defaultValue, node);
  const counting = (showCount && maxLength !== undefined) || countMax !== undefined;
  const countLimit = showCount && maxLength !== undefined ? maxLength : countMax;
  const guidance = hint ?? help;
  const invalid = hasContent(error) || status === 'invalid';

  function change(e: ChangeEvent<HTMLInputElement>): void {
    track(e.target.value);
    onChange?.(e);
  }

  return (
    <FieldShell
      id={id}
      label={label}
      hint={guidance}
      notice={notice}
      error={error}
      icon={icon}
      required={required}
      disabled={disabled}
      float={floatLabel || placeholder !== undefined || text !== ''}
      status={status}
      counter={
        counting && countLimit !== undefined ? { count: text.length, max: countLimit } : undefined
      }
      lead={lead}
      trail={trail}
      after={after}
      variant={variant}
      className={className}
    >
      <input
        ref={setRef}
        id={id}
        className={inputClassName ? `sk-field__input ${inputClassName}` : 'sk-field__input'}
        value={value}
        defaultValue={defaultValue}
        onChange={change}
        placeholder={placeholder ?? ' '}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={invalid ? true : ariaInvalid}
        aria-describedby={describedBy(id, {
          hint: guidance,
          notice,
          error,
          counter: counting,
          extra: describedByProp,
        })}
        {...rest}
      />
    </FieldShell>
  );
});

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  Omit<FieldExtras, 'lead' | 'trail' | 'status'>;

/** The same field, multi-line. The label floats to the border the same way. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  {
    id: idProp,
    label,
    hint,
    help,
    notice,
    error,
    icon,
    showCount = false,
    countMax,
    floatLabel = false,
    after,
    variant,
    className,
    inputClassName,
    value,
    defaultValue,
    onChange,
    placeholder,
    required,
    disabled,
    maxLength,
    rows = 3,
    'aria-describedby': describedByProp,
    'aria-invalid': ariaInvalid,
    ...rest
  },
  ref,
): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sk-f-${autoId}`;
  const [node, setRef] = useMergedRef<HTMLTextAreaElement>(ref);
  const { text, track } = useFieldText(value, defaultValue, node);
  const counting = (showCount && maxLength !== undefined) || countMax !== undefined;
  const countLimit = showCount && maxLength !== undefined ? maxLength : countMax;
  const guidance = hint ?? help;

  function change(e: ChangeEvent<HTMLTextAreaElement>): void {
    track(e.target.value);
    onChange?.(e);
  }

  return (
    <FieldShell
      id={id}
      label={label}
      hint={guidance}
      notice={notice}
      error={error}
      icon={icon}
      required={required}
      disabled={disabled}
      float={floatLabel || placeholder !== undefined || text !== ''}
      counter={
        counting && countLimit !== undefined ? { count: text.length, max: countLimit } : undefined
      }
      after={after}
      multiline
      variant={variant}
      className={className}
    >
      <textarea
        ref={setRef}
        id={id}
        className={inputClassName ? `sk-field__input ${inputClassName}` : 'sk-field__input'}
        value={value}
        defaultValue={defaultValue}
        onChange={change}
        placeholder={placeholder ?? ' '}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        rows={rows}
        aria-invalid={hasContent(error) ? true : ariaInvalid}
        aria-describedby={describedBy(id, {
          hint: guidance,
          notice,
          error,
          counter: counting,
          extra: describedByProp,
        })}
        {...rest}
      />
    </FieldShell>
  );
});
