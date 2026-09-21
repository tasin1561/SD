'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { Clock, Menu, Phone, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { business, platform } from '@/content/site';
import { ThemeToggle } from '@/components/landing/theme-toggle';
import { ExpandingTrackField } from '@/components/micro/expanding-track-field';
import { ScrollProgress } from './scroll-progress';

/**
 * The header. Logo + wordmark, five section links on `lg`, the expanding
 * TRACK field beside the theme toggle (a courier site tracks from the
 * header — the utility bar's text link is the secondary), ONE filled CTA
 * that survives on every width beside the hamburger, and a drawer below
 * `lg`: rows ≥ 48 px, the CTA, the sign-ins, the hotline and hours, in a
 * body that SCROLLS inside the safe area so nothing is cut at 320×568.
 *
 * Sticky, blurred only once scrolled; the corridor-gradient progress line
 * sits on its bottom edge (`ScrollProgress` writes the variable it reads).
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

  const track = (awb: string): void => {
    window.location.assign(`${platform.nav.track.href}?awb=${encodeURIComponent(awb)}`);
  };

  const linkClass =
    'rounded-md px-3 py-2 text-[14px] font-medium text-fg-body transition-colors hover:bg-surface-3 hover:text-fg-strong';
  // Rows ≥ 48 px with 18 px type — a drawer is a thumb surface (u20).
  const drawerRow =
    'drawer-row safe-x flex items-center text-[18px] font-medium text-fg-strong hover:bg-surface-3';

  return (
    <header
      data-site-header
      className={cn(
        // z-50: the drawer is a descendant, so it can never paint above a
        // sibling with a higher z — the mobile bottom bar (z-40).
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/skydrop-icon@2x.webp"
            srcSet="/brand/skydrop-icon@1x.webp 1x, /brand/skydrop-icon@2x.webp 2x, /brand/skydrop-icon@3x.webp 3x"
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
          <span className="hidden lg:block">
            <ExpandingTrackField onSubmit={track} />
          </span>
          <span className="hidden sm:block">
            <ThemeToggle />
          </span>
          <Link
            href={platform.nav.cta.href}
            prefetch={false}
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
          // `overflow-hidden` + `invisible` when closed: the panel parks at
          // translate-x-full, and a fixed box's overflow still widens the
          // document — a 360 px phone scrolled sideways to an empty 720.
          'fixed inset-0 z-50 overflow-hidden transition-[opacity,visibility] duration-200 lg:hidden',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none invisible opacity-0',
        )}
        aria-hidden={!open}
        // `inert` as well: aria-hidden alone leaves the drawer's links in the
        // tab order while it is closed (axe: aria-hidden-focus).
        inert={!open}
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
          <div className="safe-x flex h-16 shrink-0 items-center justify-between border-b border-line">
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
          {/* Everything below the bar scrolls, and ends inside the safe area. */}
          <div className="safe-b min-h-0 flex-1 overflow-y-auto pb-6">
            <nav
              className="flex flex-col divide-y divide-line border-b border-line"
              aria-label="Sections"
            >
              {platform.nav.primary.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className={drawerRow}
                >
                  {l.label}
                </Link>
              ))}
              <a
                href={platform.nav.track.href}
                onClick={() => setOpen(false)}
                className={drawerRow}
              >
                {platform.nav.track.label}
              </a>
            </nav>
            <div className="safe-x flex flex-col gap-3 py-5">
              <Link
                href={platform.nav.cta.href}
                prefetch={false}
                onClick={() => setOpen(false)}
                className="drawer-btn inline-flex items-center justify-center rounded-md bg-blue-fill px-4 text-[17px] font-semibold text-blue-on-fill"
              >
                {platform.nav.cta.label}
              </Link>
              {platform.nav.signIn.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="drawer-btn inline-flex items-center justify-center rounded-md border border-border-control px-4 text-[17px] font-medium text-fg-strong hover:bg-surface-3"
                >
                  {l.label}
                </a>
              ))}
            </div>
            <div className="safe-x flex flex-col gap-2 border-t border-line py-4 text-[15px] text-fg-body">
              <a
                href={business.hotlineHref}
                className="drawer-btn inline-flex items-center gap-2 font-medium text-fg-strong"
              >
                <Phone size={16} aria-hidden="true" className="text-blue-text" />
                <span className="tabular">{business.hotline}</span>
              </a>
              <span className="inline-flex items-center gap-2 text-fg-muted">
                <Clock size={16} aria-hidden="true" />
                {business.hoursDays} · {business.hoursTime} ({business.hoursZone})
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
