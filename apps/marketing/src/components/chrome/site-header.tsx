'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { platform } from '@/content/site';
import { ThemeToggle } from '@/components/landing/theme-toggle';
import { ScrollProgress } from './scroll-progress';

/**
 * The header. Logo + wordmark, five section links on `lg`, ONE filled CTA
 * that survives on every width beside the hamburger (Shiprocket does this;
 * CarryBee's three header CTAs are the anti-pattern), the theme toggle,
 * and a drawer below `lg` carrying the links, the sign-ins and Track.
 *
 * Sticky, with a backdrop blur only once scrolled — a blur at rest over the
 * hero costs paint for nothing. The corridor-gradient progress line sits
 * on its bottom edge (`ScrollProgress` writes the variable it reads).
 */
export function SiteHeader(): ReactElement {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const linkClass =
    'rounded-md px-3 py-2 text-[14px] font-medium text-fg-body transition-colors hover:bg-surface-3 hover:text-fg-strong';

  return (
    <header
      data-site-header
      className={cn(
        // z-50: the drawer is a descendant, so it can never paint above a
        // sibling with a higher z — the mobile bottom bar (z-40) sat over
        // the drawer's sign-in buttons until the header itself outranked it.
        'sticky top-0 z-50 border-b transition-colors duration-200',
        scrolled ? 'border-line backdrop-blur-md' : 'border-line/60',
      )}
      style={{
        backgroundColor: scrolled
          ? 'color-mix(in srgb, var(--surface-2) 90%, transparent)'
          : 'var(--surface-2)',
      }}
    >
      <div className="safe-x relative mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-[18px] font-bold tracking-tight text-fg-strong"
          aria-label="Skydrop home"
        >
          {/* A plain <img>: static export, a 24px SVG — the optimiser has nothing to do. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/skydrop-icon.svg"
            alt=""
            aria-hidden="true"
            width={53}
            height={26}
            className="h-6 w-auto shrink-0 select-none"
            draggable={false}
          />
          {platform.brand.name}
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Sections">
          {platform.nav.primary.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          {/* Wrapped rather than `hidden sm:inline-flex` on the toggle: it
              carries its own `inline-flex`, and two display utilities on one
              element resolve by source order, not by breakpoint. */}
          <span className="hidden sm:block">
            <ThemeToggle />
          </span>
          <Link
            href={platform.nav.cta.href}
            className="inline-flex h-11 items-center whitespace-nowrap rounded-md bg-blue-fill px-3 text-[13px] font-semibold text-blue-on-fill transition-colors hover:bg-blue-fill-hover sm:px-4 sm:text-[14px]"
          >
            {platform.nav.cta.label}
          </Link>
          <button
            type="button"
            className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-strong transition-colors hover:bg-surface-3 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            aria-expanded={open}
            aria-controls="site-drawer"
          >
            <Menu size={22} aria-hidden="true" />
          </button>
        </div>
        <ScrollProgress />
      </div>

      {/* Drawer */}
      <div
        id="site-drawer"
        className={cn(
          'fixed inset-0 z-50 transition-opacity duration-200 lg:hidden',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden={!open}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div
          className="absolute inset-0"
          style={{ backgroundColor: 'var(--scrim)' }}
          onClick={() => setOpen(false)}
        />
        <div
          className={cn(
            'absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-line bg-surface-2 transition-transform duration-200',
            open ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="safe-x flex h-16 items-center justify-between border-b border-line">
            <span className="text-[13px] font-medium uppercase tracking-[0.08em] text-fg-muted">
              Menu
            </span>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <button
                type="button"
                className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-md text-fg-strong hover:bg-surface-3"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
              >
                <X size={22} aria-hidden="true" />
              </button>
            </div>
          </div>
          <nav className="flex flex-col divide-y divide-line" aria-label="Sections">
            {platform.nav.primary.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="safe-x flex min-h-12 items-center text-[16px] font-medium text-fg-strong hover:bg-surface-3"
              >
                {l.label}
              </Link>
            ))}
            <a
              href={platform.nav.track.href}
              onClick={() => setOpen(false)}
              className="safe-x flex min-h-12 items-center text-[16px] font-medium text-fg-strong hover:bg-surface-3"
            >
              {platform.nav.track.label}
            </a>
          </nav>
          <div className="safe-x safe-b mt-auto flex flex-col gap-2.5 border-t border-line py-5">
            {platform.nav.signIn.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border-control px-4 text-[15px] font-medium text-fg-strong hover:bg-surface-3"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
