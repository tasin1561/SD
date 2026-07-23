'use client';

import { useEffect, useState, type ReactElement } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';

const LINKS = [
  { href: '#how-it-works', label: 'How it works' },
  { href: '#why-skydrop', label: 'Why Skydrop' },
  { href: 'https://track.skydrop.online', label: 'Track a parcel', external: true },
];

/**
 * Sticky nav — starts transparent over the ink hero, gains an ink/blur
 * backdrop once the user has scrolled past ~24px. Mobile: full-screen sheet
 * with a fade + slide-in animation (transform + opacity only per skill).
 */
export function Nav(): ReactElement {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock body scroll when the mobile sheet is open.
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors duration-200',
        scrolled
          ? 'bg-ink/80 backdrop-blur border-b border-[var(--border-dark)]'
          : 'bg-transparent border-b border-transparent',
      )}
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <a
          href="#top"
          className="text-white font-display font-semibold text-lg tracking-tight"
          aria-label="Skydrop home"
        >
          Skydrop
        </a>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
              className="px-3 py-2 text-sm text-[var(--muted-dark)] hover:text-white transition-colors rounded-lg"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden lg:block">
          <a
            href="mailto:hello@skydrop.online?subject=Skydrop%20invite%20request"
            className="inline-flex items-center gap-2 bg-sky text-ink font-medium text-sm px-4 py-2.5 rounded-xl hover:bg-white transition-colors"
          >
            Request an invite
          </a>
        </div>

        {/* Mobile trigger */}
        <button
          type="button"
          className="lg:hidden inline-flex items-center justify-center w-11 h-11 -mr-2 text-white rounded-lg hover:bg-white/10 transition-colors"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
        >
          <Menu size={22} aria-hidden="true" />
        </button>
      </div>

      {/* Mobile sheet */}
      <div
        className={cn(
          'lg:hidden fixed inset-0 z-50 transition-opacity duration-200',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        aria-hidden={!open}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="absolute inset-0 bg-ink/85"
          onClick={() => setOpen(false)}
        />
        <div
          className={cn(
            'absolute right-0 top-0 h-full w-full max-w-sm bg-ink border-l border-[var(--border-dark)] p-6 transition-transform duration-200',
            open ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex items-center justify-between mb-10">
            <span className="text-white font-display font-semibold text-lg">Skydrop</span>
            <button
              type="button"
              className="inline-flex items-center justify-center w-11 h-11 -mr-2 text-white rounded-lg hover:bg-white/10 transition-colors"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          <nav className="flex flex-col gap-2">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                {...(l.external ? { target: '_blank', rel: 'noopener' } : {})}
                onClick={() => setOpen(false)}
                className="px-4 py-3 text-base text-white hover:bg-white/5 rounded-xl transition-colors"
              >
                {l.label}
              </a>
            ))}
            <a
              href="mailto:hello@skydrop.online?subject=Skydrop%20invite%20request"
              onClick={() => setOpen(false)}
              className="mt-4 inline-flex items-center justify-center gap-2 bg-sky text-ink font-medium text-base px-4 py-3.5 rounded-xl hover:bg-white transition-colors"
            >
              Request an invite
            </a>
          </nav>
        </div>
      </div>
    </header>
  );
}
