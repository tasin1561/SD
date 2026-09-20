'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './theme-toggle';
import { LiveDot } from './chrome';

const LINKS = [
  // Root-relative, NOT bare fragments. A bare `#why-skydrop` only
  // resolves on the page that contains that section — from
  // /request-invite it appended a hash to the URL and moved nothing,
  // which reads as a dead button rather than a link to another page.
  { href: '/#diagnostics', label: 'The problem' },
  { href: '/#how-it-works', label: 'How it works' },
  { href: '/#why-skydrop', label: 'Why Skydrop' },
  { href: '/#manifest', label: 'Compare' },
  { href: 'https://track.skydrop.online', label: 'Track a parcel', external: true },
];

/**
 * The console top bar: a thin status rail over a dense nav.
 *
 * The rail is not decoration — it carries the two facts a first-time
 * visitor needs before anything else (which corridor we run, and that
 * we are invite-only), so neither has to be spent on inside the
 * headline. It is `hidden sm:flex`: at 360px it would wrap to two lines
 * and push the fold down for no gain.
 */
export function Nav(): ReactElement {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 16);
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
    <header className="sticky top-0 z-40">
      {/* Status rail */}
      <div className="hidden border-b border-line bg-surface-band sm:block">
        <div className="mx-auto flex h-8 max-w-7xl items-center justify-between gap-4 px-5 sm:px-6">
          <span className="mono-caps flex items-center gap-2 text-fg-muted">
            <LiveDot />
            <span className="text-fg-strong">corridor BD &rarr; IN</span>
            <span aria-hidden className="text-fg-faint">
              {'//'}
            </span>
            <span>operational</span>
          </span>
          <span className="mono-caps hidden items-center gap-4 text-fg-faint lg:flex">
            <span>warehouse: india</span>
            <span aria-hidden>·</span>
            <span>couriers: delhivery + shiprocket</span>
            <span aria-hidden>·</span>
            <span className="text-fg-muted">invite-only beta</span>
          </span>
          <span className="mono-caps text-fg-faint lg:hidden">invite-only beta</span>
        </div>
      </div>

      {/* Main bar */}
      <div
        className={cn(
          'border-b transition-colors duration-200',
          scrolled ? 'border-line backdrop-blur-md' : 'border-line/60',
        )}
        style={{
          backgroundColor: scrolled
            ? 'color-mix(in srgb, var(--surface-2) 88%, transparent)'
            : 'var(--surface-2)',
        }}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-5 sm:px-6">
          <Link
            href="/#top"
            className="flex items-center gap-2.5 text-[17px] font-bold tracking-tight text-fg-strong"
            aria-label="Skydrop home"
          >
            {/* Decorative: the wordmark beside it already names the brand,
                so announcing the logo too would read it twice.

                A plain <img>, not next/image: this app is `output: 'export'`
                and the mark is a 24px SVG, so the optimiser has nothing to
                optimise and would only add a loader to the critical path. */}
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
            Skydrop
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {LINKS.map((l) =>
              l.external ? (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener"
                  className="rounded-sm px-2.5 py-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg-strong"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-sm px-2.5 py-2 text-[13px] font-medium text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg-strong"
                >
                  {l.label}
                </Link>
              ),
            )}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <ThemeToggle />
            <a
              href="https://app.skydrop.online/login"
              target="_blank"
              rel="noopener"
              className="rounded-sm border border-line-strong px-3 py-2 text-[13px] font-medium text-fg-strong transition-colors hover:bg-surface-3"
            >
              Seller sign-in
            </a>
            <Link
              href="/request-invite"
              className="rounded-sm bg-accent-fill px-3.5 py-2 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-fill-hover"
            >
              Request an invite
            </Link>
          </div>

          <div className="flex items-center gap-1 lg:hidden">
            <ThemeToggle />
            <button
              type="button"
              className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-sm text-fg-strong transition-colors hover:bg-surface-3"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
              aria-expanded={open}
            >
              <Menu size={20} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Drawer */}
      <div
        className={cn(
          'fixed inset-0 z-50 transition-opacity duration-200 lg:hidden',
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
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
            'absolute right-0 top-0 h-full w-full max-w-sm border-l border-line bg-surface-2 transition-transform duration-200',
            open ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <span className="mono-caps text-fg-muted">navigation</span>
            <button
              type="button"
              className="-mr-2 inline-flex h-11 w-11 items-center justify-center rounded-sm text-fg-strong transition-colors hover:bg-surface-3"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
          <nav className="flex flex-col divide-y divide-line">
            {LINKS.map((l) =>
              l.external ? (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener"
                  onClick={() => setOpen(false)}
                  className="flex items-center px-5 py-3.5 text-[15px] font-medium text-fg-strong transition-colors hover:bg-surface-3"
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center px-5 py-3.5 text-[15px] font-medium text-fg-strong transition-colors hover:bg-surface-3"
                >
                  {l.label}
                </Link>
              ),
            )}
          </nav>
          <div className="flex flex-col gap-2.5 p-5">
            <Link
              href="/request-invite"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-sm bg-accent-fill px-4 py-3 text-[15px] font-semibold text-accent-fg"
            >
              Request an invite
            </Link>
            <a
              href="https://app.skydrop.online/login"
              target="_blank"
              rel="noopener"
              onClick={() => setOpen(false)}
              className="inline-flex items-center justify-center rounded-sm border border-line-strong px-4 py-3 text-[15px] font-medium text-fg-strong"
            >
              Seller sign-in
            </a>
          </div>
        </div>
      </div>
    </header>
  );
}
