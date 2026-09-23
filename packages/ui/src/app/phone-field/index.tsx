'use client';

import { ChevronDown } from 'lucide-react';
import { forwardRef, useId, useState, type ChangeEvent, type ReactElement } from 'react';
import { TextField, type TextFieldProps } from '../text-field';
import './phone-field.css';

/**
 * PhoneField (u02). A text field with the country prefix as a chip at its
 * start. The chip is a NATIVE <select> laid invisibly over the drawn chip,
 * so the picker, the keyboard and a test's `selectOptions` all behave as a
 * select does, while the field shows only "+91".
 *
 * Nothing is formatted: the value the parent receives is exactly what was
 * typed (`inputMode="tel"`, `autoComplete="tel-national"`). Pass
 * `countryName` to submit the prefix with a form.
 */
export interface PhoneCountry {
  /** The dial prefix, which is also the select's value: "+91". */
  readonly dial: string;
  /** Read by the picker and by assistive tech: "India". */
  readonly name: string;
}

export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { dial: '+91', name: 'India' },
  { dial: '+880', name: 'Bangladesh' },
];

export type PhoneFieldProps = Omit<TextFieldProps, 'type' | 'lead' | 'floatLabel'> & {
  readonly countries?: readonly PhoneCountry[] | undefined;
  /** Controlled prefix. */
  readonly country?: string | undefined;
  readonly defaultCountry?: string | undefined;
  readonly onCountryChange?: ((dial: string) => void) | undefined;
  /** Submits the prefix under this name with a form. */
  readonly countryName?: string | undefined;
  /** The prefix picker's accessible name. */
  readonly countryLabel?: string | undefined;
};

export const PhoneField = forwardRef<HTMLInputElement, PhoneFieldProps>(function PhoneField(
  {
    countries = PHONE_COUNTRIES,
    country,
    defaultCountry,
    onCountryChange,
    countryName,
    countryLabel = 'Country code',
    disabled,
    inputMode = 'tel',
    autoComplete = 'tel-national',
    variant,
    ...rest
  },
  ref,
): ReactElement {
  const ccId = useId();
  const first = countries[0]?.dial ?? '';
  const [own, setOwn] = useState<string>(defaultCountry ?? first);
  const dial = country ?? own;

  function pick(e: ChangeEvent<HTMLSelectElement>): void {
    if (country === undefined) setOwn(e.target.value);
    onCountryChange?.(e.target.value);
  }

  const lead = (
    <span className="sk-phone__cc" data-disabled={disabled === true || undefined}>
      <span className="sk-phone__dial sk-figure" aria-hidden>
        {dial}
      </span>
      <ChevronDown size={14} aria-hidden className="sk-phone__chev" />
      <select
        id={`sk-cc-${ccId}`}
        className="sk-phone__select"
        value={dial}
        onChange={pick}
        disabled={disabled}
        name={countryName}
        aria-label={countryLabel}
      >
        {countries.map((c) => (
          <option key={c.dial} value={c.dial}>
            {c.name} ({c.dial})
          </option>
        ))}
      </select>
    </span>
  );

  return (
    <TextField
      ref={ref}
      type="tel"
      inputMode={inputMode}
      autoComplete={autoComplete}
      disabled={disabled}
      lead={lead}
      floatLabel
      variant={variant ? `sk-phone ${variant}` : 'sk-phone'}
      {...rest}
    />
  );
});
