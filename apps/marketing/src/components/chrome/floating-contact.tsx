'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Check, Copy, Mail, MessageCircle, Phone, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { business, platform } from '@/content/site';

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

/**
 * The floating contact control — bottom-right, above the mobile bar.
 *
 * Phase 1 ships the CONTENT (WhatsApp · Call · Email · Copy hotline) as a
 * plain panel; Phase 2 turns the open/close into the radial fan pattern
 * without changing what it offers. "Copying… → Number copied" is honest
 * because the clipboard write is a real local action — the ONE place a
 * success state is allowed to play without a server (spec §8 rule 3).
 */
export function FloatingContact(): ReactElement {
  const [open, setOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('idle');
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent): void => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const copyHotline = async (): Promise<void> => {
    setCopy('copying');
    try {
      await navigator.clipboard.writeText(business.hotline);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
    window.setTimeout(() => setCopy('idle'), 1600);
  };

  const row =
    'flex min-h-11 items-center gap-3 rounded-md px-3 text-[14px] font-medium text-fg-strong hover:bg-surface-3';

  return (
    <div
      ref={root}
      className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom)+0.75rem)] right-4 z-40 flex flex-col items-end gap-2 md:bottom-6 md:right-6"
    >
      <div
        id="contact-fan"
        className={cn(
          'w-64 rounded-lg border border-line bg-surface-2 p-2 shadow-[var(--shadow-hud)] transition-[opacity,transform] duration-150',
          open ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
        aria-hidden={!open}
      >
        <a href={business.whatsappHref} className={row} target="_blank" rel="noopener">
          <MessageCircle size={18} aria-hidden="true" className="text-green-text" />
          WhatsApp
        </a>
        <a href={business.hotlineHref} className={row}>
          <Phone size={18} aria-hidden="true" className="text-blue-text" />
          Call <span className="tabular text-fg-muted">{business.hotline}</span>
        </a>
        <a href={`mailto:${platform.brand.email}`} className={row}>
          <Mail size={18} aria-hidden="true" className="text-violet-text" />
          {platform.brand.email}
        </a>
        <button
          type="button"
          onClick={() => void copyHotline()}
          className={cn(row, 'w-full text-left')}
          aria-live="polite"
          data-phase={copy}
        >
          {copy === 'copied' ? (
            <Check size={18} aria-hidden="true" className="text-green-text" />
          ) : (
            <Copy size={18} aria-hidden="true" className="text-fg-muted" />
          )}
          {copy === 'idle' && 'Copy hotline number'}
          {copy === 'copying' && 'Copying…'}
          {copy === 'copied' && 'Number copied'}
          {copy === 'failed' && 'Could not copy — long-press the number above'}
        </button>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="contact-fan"
        aria-label={open ? 'Close contact options' : 'Contact us'}
        className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-blue-fill text-blue-on-fill shadow-[var(--shadow-hud)] transition-colors hover:bg-blue-fill-hover"
      >
        {open ? <X size={22} aria-hidden="true" /> : <MessageCircle size={22} aria-hidden="true" />}
      </button>
    </div>
  );
}
