'use client';

import { clsx } from 'clsx';
import {
  forwardRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import './switch.css';

/**
 * Switch (u08). A `role="switch"` button with `aria-checked`; the track
 * carries "On" and "Off" inside it (so the state is a word, not only a
 * colour) and the thumb slides between them on a spring. The label is a
 * real <label> for the button, so clicking the words toggles it too.
 *
 * Controlled (`checked` + `onCheckedChange`) or uncontrolled
 * (`defaultChecked`). With `name`, a hidden input submits `value` (default
 * "on") while it is on, as a checkbox would.
 */
export type SwitchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'value' | 'type'
> & {
  readonly label?: ReactNode;
  readonly description?: ReactNode;
  readonly checked?: boolean | undefined;
  readonly defaultChecked?: boolean | undefined;
  readonly onCheckedChange?: ((checked: boolean) => void) | undefined;
  readonly value?: string | undefined;
  readonly onText?: string | undefined;
  readonly offText?: string | undefined;
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  {
    id: idProp,
    label,
    description,
    checked,
    defaultChecked = false,
    onCheckedChange,
    name,
    value = 'on',
    onText = 'On',
    offText = 'Off',
    className,
    onClick,
    'aria-describedby': describedByProp,
    ...rest
  },
  ref,
): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sk-sw-${autoId}`;
  const [own, setOwn] = useState(defaultChecked);
  const on = checked ?? own;
  const hasDesc = description !== undefined && description !== null;
  const described = [hasDesc ? `${id}-d` : null, describedByProp ?? null]
    .filter((x): x is string => x !== null)
    .join(' ');

  function toggle(e: MouseEvent<HTMLButtonElement>): void {
    onClick?.(e);
    if (e.defaultPrevented) return;
    const next = !on;
    if (checked === undefined) setOwn(next);
    onCheckedChange?.(next);
  }

  return (
    <div className={clsx('sk-switch', className)} data-on={on || undefined}>
      <button
        ref={ref}
        id={id}
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={described || undefined}
        className="sk-switch__track"
        onClick={toggle}
        {...rest}
      >
        <span className="sk-switch__word sk-switch__word--on" aria-hidden>
          {onText}
        </span>
        <span className="sk-switch__word sk-switch__word--off" aria-hidden>
          {offText}
        </span>
        <span className="sk-switch__thumb" aria-hidden />
      </button>
      {label !== undefined && label !== null ? (
        <span className="sk-switch__text">
          <label className="sk-switch__label" htmlFor={id}>
            {label}
          </label>
          {hasDesc ? (
            <span className="sk-switch__desc" id={`${id}-d`}>
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
      {name !== undefined && on ? <input type="hidden" name={name} value={value} /> : null}
    </div>
  );
});
