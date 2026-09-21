'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { ChevronDown } from 'lucide-react';
import '../micro.css';
import '../text-field/text-field.css';
import './combo-select.css';

/**
 * 33 · Combo select (u18 cascading dropdown). A searchable select in the
 * text-field's own box — floating label, focus glow — whose list grows
 * from the field (scale + fade, transform only) and filters as you type.
 * The cascade is the caller's: pass a narrower `options` list for the
 * next level and clear its value when the level above changes. Follows
 * the combobox pattern (`aria-expanded`, `aria-activedescendant`, arrow
 * keys, Enter, Escape); `disabled` while the level above is unpicked.
 */
export function ComboSelect({
  label,
  options,
  value,
  onChange,
  helper,
  disabled,
  id: idProp,
  className,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onChange: (v: string | null) => void;
  helper?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}): ReactElement {
  const auto = useId();
  const id = idProp ?? auto;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const root = useRef<HTMLSpanElement>(null);
  const list = q.trim()
    ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent): void => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);

  const pick = (o: string): void => {
    onChange(o);
    setQ('');
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % Math.max(1, list.length));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      const o = list[hi];
      if (o) pick(o);
    } else if (e.key === 'Escape') setOpen(false);
  };
  return (
    <span
      ref={root}
      className={`mi mi-tf mi-combo ${className ?? ''}`}
      data-open={open || undefined}
      data-disabled={disabled || undefined}
    >
      <span className="mi-tf__box">
        <input
          id={id}
          className="mi-tf__input"
          role="combobox"
          autoComplete="off"
          placeholder=" "
          disabled={disabled}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && list[hi] ? `${id}-o${hi}` : undefined}
          aria-describedby={helper ? `${id}-help` : undefined}
          value={open ? q : (value ?? '')}
          onFocus={() => {
            setOpen(true);
            setHi(Math.max(0, options.indexOf(value ?? '')));
          }}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            setHi(0);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKey}
        />
        <label htmlFor={id} className="mi-tf__label">
          {label}
        </label>
        <ChevronDown size={16} className="mi-tf__chev mi-combo__chev" aria-hidden />
      </span>
      <ul id={`${id}-list`} role="listbox" className="mi-combo__list" aria-label={label}>
        {list.length === 0 ? (
          <li className="mi-combo__none" role="presentation">
            Nothing matches “{q}”
          </li>
        ) : null}
        {list.map((o, i) => (
          <li
            key={o}
            id={`${id}-o${i}`}
            role="option"
            aria-selected={o === value}
            data-hi={i === hi || undefined}
            className="mi-combo__opt"
            onPointerEnter={() => setHi(i)}
            onPointerDown={(e) => {
              e.preventDefault();
              pick(o);
            }}
          >
            {o}
          </li>
        ))}
      </ul>
      {helper ? (
        <span className="mi-tf__foot">
          <span id={`${id}-help`} className="mi-tf__help">
            {helper}
          </span>
        </span>
      ) : null}
    </span>
  );
}
