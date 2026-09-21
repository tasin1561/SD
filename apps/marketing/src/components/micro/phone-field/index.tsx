'use client';

import { useId, useState, type ReactElement } from 'react';
import { Check, ChevronDown, TriangleAlert } from 'lucide-react';
import '../micro.css';
import '../text-field/text-field.css';
import './phone-field.css';

export type PhoneCountry = 'BD' | 'IN';

const COUNTRIES: Record<
  PhoneCountry,
  { code: string; name: string; groups: readonly number[]; digits: number }
> = {
  BD: { code: '+880', name: 'Bangladesh', groups: [4, 6], digits: 10 },
  IN: { code: '+91', name: 'India', groups: [5, 5], digits: 10 },
};

/** Digits only, grouped for the country: 1712345678 → "1712 345678". */
export function formatNational(country: PhoneCountry, raw: string): string {
  const c = COUNTRIES[country];
  const d = raw.replace(/\D/g, '').replace(/^0+/, '').slice(0, c.digits);
  const out: string[] = [];
  let i = 0;
  for (const g of c.groups) {
    if (i >= d.length) break;
    out.push(d.slice(i, i + g));
    i += g;
  }
  return out.join(' ');
}

function Flag({ country }: { country: PhoneCountry }): ReactElement {
  return country === 'BD' ? (
    <svg viewBox="0 0 20 14" width="20" height="14" aria-hidden>
      <rect width="20" height="14" rx="2" fill="#006a4e" />
      <circle cx="9" cy="7" r="4.2" fill="#f42a41" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 14" width="20" height="14" aria-hidden>
      <rect width="20" height="14" rx="2" fill="#fff" />
      <path d="M0 2a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2.7H0z" fill="#ff9933" />
      <path d="M0 9.3h20V12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2z" fill="#138808" />
      <circle cx="10" cy="7" r="1.6" fill="none" stroke="#000080" strokeWidth=".7" />
    </svg>
  );
}

/**
 * 19 · Phone field (u02). A +880 / +91 country selector with its flag, the
 * national number auto-grouped as it is typed, a floating label, and an
 * inline status icon — a warning while the number is short, a green check
 * once it is complete. The field NAMED `name` carries the full value with
 * the country code ("+880 1712 345678"), so the form submits what a person
 * would write, never a bare local number. Not format-validated beyond the
 * digit count: losing a real lead to a regex costs more than an operator
 * retyping a number.
 */
export function PhoneField({
  name,
  label = 'Phone or WhatsApp',
  helper,
  defaultCountry = 'BD',
  required,
  className,
  id: idProp,
}: {
  name: string;
  label?: string;
  helper?: string;
  defaultCountry?: PhoneCountry;
  required?: boolean;
  className?: string;
  id?: string;
}): ReactElement {
  const auto = useId();
  const id = idProp ?? auto;
  const [country, setCountry] = useState<PhoneCountry>(defaultCountry);
  const [national, setNational] = useState('');
  const c = COUNTRIES[country];
  const digits = national.replace(/\D/g, '').length;
  const status = digits === 0 ? 'idle' : digits >= c.digits ? 'success' : 'error';
  const full = national ? `${c.code} ${national}` : '';
  return (
    <span className={`mi mi-tf mi-phone ${className ?? ''}`} data-status={status}>
      <span className="mi-tf__box mi-phone__box">
        <span className="mi-phone__country">
          <Flag country={country} />
          <select
            aria-label="Country code"
            value={country}
            onChange={(e) => {
              setCountry(e.currentTarget.value as PhoneCountry);
              setNational((n) => formatNational(e.currentTarget.value as PhoneCountry, n));
            }}
            className="mi-phone__select"
          >
            {(Object.keys(COUNTRIES) as PhoneCountry[]).map((k) => (
              <option key={k} value={k}>
                {COUNTRIES[k].name} ({COUNTRIES[k].code})
              </option>
            ))}
          </select>
          <ChevronDown size={12} aria-hidden />
          <span className="mi-phone__code tabular">{c.code}</span>
        </span>
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          className="mi-tf__input mi-phone__input tabular"
          placeholder=" "
          value={national}
          onChange={(e) => setNational(formatNational(country, e.currentTarget.value))}
          aria-invalid={status === 'error' || undefined}
          aria-describedby={`${id}-help`}
          required={required}
        />
        {/* The submitted value: code + grouped national number. */}
        <input type="hidden" name={name} value={full} />
        <label htmlFor={id} className="mi-tf__label mi-phone__label">
          {label}
          {required ? ' *' : ''}
        </label>
        <span className="mi-tf__status" aria-hidden>
          {status === 'error' ? <TriangleAlert size={15} /> : null}
          {status === 'success' ? <Check size={15} strokeWidth={3} /> : null}
        </span>
      </span>
      <span className="mi-tf__foot">
        <span id={`${id}-help`} className="mi-tf__help">
          {status === 'error'
            ? `${c.digits - digits} more digit${c.digits - digits === 1 ? '' : 's'}`
            : (helper ?? 'However you write it is fine.')}
        </span>
      </span>
    </span>
  );
}
