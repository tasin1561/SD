'use client';

import { Check, Eye, EyeOff } from 'lucide-react';
import { forwardRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { TextField, type TextFieldProps } from '../text-field';
import './password-field.css';

/**
 * PasswordField (u13). A text field with a show/hide toggle
 * (`aria-pressed`, named "Show password" / "Hide password") and, when
 * `criteria` are given, a four-step strength meter with a word beside it
 * and one chip per criterion that ticks as it is met. There is NO built-in
 * policy: the caller passes the rules (the server's rules are the ones that
 * count — FE-2); this only shows progress against them.
 */
export interface PasswordCriterion {
  readonly id: string;
  /** Sentence case: "At least 12 characters". */
  readonly label: string;
  readonly test: (value: string) => boolean;
}

export type PasswordFieldProps = Omit<TextFieldProps, 'type' | 'trail'> & {
  readonly criteria?: readonly PasswordCriterion[] | undefined;
  /** Show the meter above the chips (default true when criteria exist). */
  readonly showStrength?: boolean | undefined;
};

const WORDS = ['Weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;
const LEVELS = ['weak', 'weak', 'fair', 'good', 'strong'] as const;

export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  function PasswordField(
    {
      criteria,
      showStrength = true,
      value,
      defaultValue,
      onChange,
      disabled,
      autoComplete,
      variant,
      id,
      ...rest
    },
    ref,
  ): ReactElement {
    const [shown, setShown] = useState(false);
    const [own, setOwn] = useState<string>(
      defaultValue === undefined || defaultValue === null ? '' : String(defaultValue),
    );
    const text = value !== undefined && value !== null ? String(value) : own;

    function change(e: ChangeEvent<HTMLInputElement>): void {
      if (value === undefined) setOwn(e.target.value);
      onChange?.(e);
    }

    const rules = criteria ?? [];
    const met = rules.filter((c) => c.test(text)).length;
    const steps = rules.length === 0 ? 0 : Math.ceil((met / rules.length) * 4);
    const word = WORDS[steps] ?? 'Weak';
    const level = LEVELS[steps] ?? 'weak';

    const toggle = (
      <button
        type="button"
        className="sk-field__btn sk-pw__toggle"
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-controls={id}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShown((s) => !s)}
      >
        <span className="sk-pw__eye" data-shown={shown || undefined} aria-hidden>
          {shown ? <EyeOff size={18} /> : <Eye size={18} />}
        </span>
      </button>
    );

    const after =
      rules.length > 0 ? (
        <div className="sk-pw__rules" data-level={text === '' ? undefined : level}>
          {showStrength ? (
            <div className="sk-pw__meter">
              <div
                className="sk-pw__bars"
                role="meter"
                aria-label="Password strength"
                aria-valuemin={0}
                aria-valuemax={rules.length}
                aria-valuenow={met}
                aria-valuetext={text === '' ? 'Not set' : word}
              >
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="sk-pw__bar" data-on={i < steps || undefined} />
                ))}
              </div>
              <span className="sk-pw__word" aria-hidden>
                {text === '' ? '' : word}
              </span>
            </div>
          ) : null}
          <ul className="sk-pw__chips" aria-label="Password requirements">
            {rules.map((c) => {
              const ok = c.test(text);
              return (
                <li key={c.id} className="sk-pw__chip" data-met={ok || undefined}>
                  <span className="sk-pw__tick" aria-hidden>
                    <Check size={12} />
                  </span>
                  <span>{c.label}</span>
                  <span className="sk-field__sr">{ok ? ', met' : ', not met'}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null;

    return (
      <TextField
        ref={ref}
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        defaultValue={defaultValue}
        onChange={change}
        disabled={disabled}
        autoComplete={autoComplete ?? 'current-password'}
        autoCapitalize="off"
        spellCheck={false}
        trail={toggle}
        after={after}
        variant={variant ? `sk-pw ${variant}` : 'sk-pw'}
        {...rest}
      />
    );
  },
);
