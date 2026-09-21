'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import '../micro.css';
import './expanding-track-field.css';

/**
 * 7 · Expanding track field. Closed it is a 44px search button; open it is
 * a pill input for a waybill. Submit is a NAVIGATION to the tracking page
 * — `onSubmit(awb)` fires at once; no busy state is faked.
 */
export function ExpandingTrackField({
  onSubmit,
  placeholder = 'Waybill number',
  defaultOpen = false,
}: {
  onSubmit: (awb: string) => void;
  placeholder?: string;
  defaultOpen?: boolean;
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const [awb, setAwb] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const clean = awb.trim();
    if (clean) onSubmit(clean);
  };
  return (
    <form
      className="mi mi-etf"
      data-open={open}
      onSubmit={submit}
      role="search"
      aria-label="Track a parcel"
    >
      <button
        type="button"
        className="mi-etf__toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close tracking field' : 'Track a parcel'}
      >
        {open ? <X size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
      </button>
      <input
        ref={input}
        className="mi-etf__input"
        value={awb}
        onChange={(e) => setAwb(e.target.value)}
        placeholder={placeholder}
        aria-label="Waybill number"
        autoComplete="off"
        tabIndex={open ? 0 : -1}
      />
      <button type="submit" className="mi-etf__go" aria-label="Track" tabIndex={open ? 0 : -1}>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
