'use client';

import { clsx } from 'clsx';
import { CircleAlert } from 'lucide-react';
import {
  useId,
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import './choice-cards.css';

/**
 * ChoiceCards (u10). A radio group drawn as cards: an icon chip, a title,
 * a description, and a mark that fills when chosen. Each card is a <label>
 * around a real (visually hidden) radio, so the arrow keys, Space, form
 * submission and `getByRole('radio')` are the browser's own. The chosen
 * card is styled from `:has(:checked)`, so uncontrolled use needs no
 * state at all.
 */
export interface ChoiceCardOption {
  readonly value: string;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly disabled?: boolean | undefined;
}

export type ChoiceCardsProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'checked' | 'defaultChecked'
> & {
  readonly options: readonly ChoiceCardOption[];
  /** The group's name, shown as its legend. */
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly help?: ReactNode;
  readonly error?: ReactNode;
  readonly value?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly onChange?: ((value: string, event: ChangeEvent<HTMLInputElement>) => void) | undefined;
  /** Grid columns from `sm` up; one column on a phone. */
  readonly columns?: 1 | 2 | 3 | undefined;
  readonly hideLegend?: boolean | undefined;
};

export function ChoiceCards({
  options,
  label,
  hint,
  help,
  error,
  value,
  defaultValue,
  onChange,
  columns = 2,
  hideLegend = false,
  name: nameProp,
  disabled,
  required,
  className,
  id: idProp,
  ...rest
}: ChoiceCardsProps): ReactElement {
  const autoId = useId();
  const id = idProp ?? `sk-cc-${autoId}`;
  const name = nameProp ?? id;
  const guidance = hint ?? help;
  const invalid = error !== undefined && error !== null && error !== false && error !== '';
  const described = [invalid ? `${id}-error` : null, guidance ? `${id}-hint` : null]
    .filter((x): x is string => x !== null)
    .join(' ');
  return (
    <fieldset
      className={clsx('sk-choices', className)}
      data-columns={columns}
      data-invalid={invalid || undefined}
      disabled={disabled}
      aria-describedby={described || undefined}
    >
      <legend className={clsx('sk-choices__legend', hideLegend && 'sk-choices__sr')}>
        {label}
        {required === true ? (
          <span className="sk-choices__req" aria-hidden>
            *
          </span>
        ) : null}
      </legend>
      <div className="sk-choices__grid">
        {options.map((o) => {
          const optId = `${id}-${o.value}`;
          return (
            <label
              key={o.value}
              className="sk-choice"
              htmlFor={optId}
              data-disabled={o.disabled === true || undefined}
            >
              <input
                id={optId}
                type="radio"
                className="sk-choice__input"
                name={name}
                value={o.value}
                required={required}
                disabled={o.disabled}
                aria-describedby={o.description !== undefined ? `${optId}-d` : undefined}
                {...(value !== undefined
                  ? { checked: value === o.value }
                  : { defaultChecked: defaultValue === o.value })}
                onChange={(e) => onChange?.(o.value, e)}
                {...rest}
              />
              {o.icon !== undefined && o.icon !== null ? (
                <span className="sk-choice__icon" aria-hidden>
                  {o.icon}
                </span>
              ) : null}
              <span className="sk-choice__text">
                <span className="sk-choice__title">{o.title}</span>
                {o.description !== undefined ? (
                  <span className="sk-choice__desc" id={`${optId}-d`}>
                    {o.description}
                  </span>
                ) : null}
              </span>
              <span className="sk-choice__mark" aria-hidden />
            </label>
          );
        })}
      </div>
      {invalid ? (
        <p className="sk-choices__msg" data-kind="error" id={`${id}-error`} aria-live="polite">
          <CircleAlert size={14} aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}
      {guidance ? (
        <p className="sk-choices__msg" id={`${id}-hint`}>
          {guidance}
        </p>
      ) : null}
    </fieldset>
  );
}
