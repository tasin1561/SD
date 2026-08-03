'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './theme-toggle';

const LINKS = [
  // Root-relative, NOT bare fragments. A bare `#why-skydrop` only
  // resolves on the page that contains that section — from
  // /request-invite it appended a hash to the URL and moved nothing,
  // which reads as a dead button rather than a link to another page.
  { href: '/#how-it-works', label: 'Flight plan' },
  { href: '/#why-skydrop', label: 'Why Skydrop' },
  { href: 'https://track.skydrop.online', label: 'Track a parcel', external: true },
];

/**
 * Console top bar — wordmark + SYS ONLINE status, links, theme toggle,
 * invite CTA. Transparent over the hero grid; solid + hairline once
 * scrolled.
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
        'sticky top-0 z-40 transition-all duration-200',
        scrolled ? 'backdrop-blur-md border-b border-line' : 'border-b border-transparent',
      )}
      style={
        scrolled
          ? { backgroundColor: 'color-mix(in oklab, var(--surface) 82%, transparent)' }
          : undefined
      }
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <Link
          href="/#top"
          className="flex items-baseline gap-3 font-display font-semibold text-lg tracking-tight text-fg-strong"
          aria-label="Skydrop home"
        >
          Skydrop
          <span className="telemetry hidden sm:inline-flex items-center gap-1.5 text-fg-muted">
            <span aria-hidden className="status-dot inline-block h-1 w-1 rounded-full bg-green" />
            sys online
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-1">
          {LINKS.map((l) =>
            l.external ? (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noopener"
                className="px-3 py-2 text-sm text-fg-muted hover:text-fg-strong transition-colors rounded-lg"
              >
                {l.label}
              </a>
            ) : (
              <Link
                key={l.href}
                href={l.href}
                className="px-3 py-2 text-sm text-fg-muted hover:text-fg-strong transition-colors rounded-lg"
              >
                {l.label}
              </Link>
            ),
          )}
        </nav>

        <div className="hidden lg:flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/request-invite"
            className="inline-flex items-center gap-2 bg-sky text-accent-fg font-medium text-sm px-4 py-2.5 rounded-xl hover:bg-sky-deep transition-colors"
          >
            Request an invite
          </Link>
        </div>

        <div className="lg:hidden flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            className="inline-flex items-center justify-center w-11 h-11 -mr-2 text-fg-strong rounded-lg hover:bg-surface-3 transition-colors"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        </div>
      </div>

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
          className="absolute inset-0"
          style={{ backgroundColor: 'var(--scrim)' }}
          onClick={() => setOpen(false)}
        />
        <div
          className={cn(
            'absolute right-0 top-0 h-full w-full max-w-sm bg-surface border-l border-line p-6 transition-transform duration-200',
            open ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex items-center justify-between mb-10">
            <span className="text-fg-strong font-display font-semibold text-lg">Skydrop</span>
            <button
              type="button"
              className="inline-flex items-center justify-center w-11 h-11 -mr-2 text-fg-strong rounded-lg hover:bg-surface-3 transition-colors"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          <nav className="flex flex-col gap-2">
            {LINKS.map((l) =>
              l.external ? (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener"
                  onClick={() => setOpen(false)}
                  className="px-4 py-3 text-base text-fg-strong hover:bg-surface-3 rounded-xl transition-colors"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="px-4 py-3 text-base text-fg-strong hover:bg-surface-3 rounded-xl transition-colors"
                >
                  {l.label}
                </Link>
              ),
            )}
            <Link
              href="/request-invite"
              onClick={() => setOpen(false)}
              className="mt-4 inline-flex items-center justify-center gap-2 bg-sky text-accent-fg font-medium text-base px-4 py-3.5 rounded-xl hover:bg-sky-deep transition-colors"
            >
              Request an invite
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
