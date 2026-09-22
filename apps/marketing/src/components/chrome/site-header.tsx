'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import {
  CircleHelp,
  Clock,
  LayoutGrid,
  Menu,
  PackageSearch,
  Phone,
  Store,
  Tag,
  Truck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { business, platform } from '@/content/site';
import { ThemeToggle } from '@/components/landing/theme-toggle';
import { ExpandingTrackField } from '@/components/micro/expanding-track-field';
import { RowLink } from '@/components/micro/list-row';
import { IconButton } from '@/components/micro/icon-button';
import { SweepLink } from '@/components/micro/sweep';
import { HeaderNav } from './header-nav';
import { ScrollProgress } from './scroll-progress';
import './chrome.css';

/**
 * The header (u30): on desktop it FLOATS as a rounded bar with a margin
 * around it and CONDENSES on scroll — lower, a stronger shadow, a
 * translucent surface (the one place `backdrop-filter` is allowed). The
 * current section's nav item sits in an accent pill that slides
 * (`HeaderNav`). Track and theme are icon-sized controls; Track still
 * expands into the waybill field. The CTA is a sweep pill.
 *
 * The drawer (u20, below `lg`): brand and close at the top, every item a
 * stacked-list row with an icon chip and a chevron that STAGGER in, the
 * active row accent-filled, the CTA and sign-ins, the hotline and hours,
 * and the theme switch at the bottom. Closed, it is `inert`, invisible and
 * clipped — a parked panel at translate-x-full still widened the document.
 */
const NAV_ICONS: Record<string, ReactElement> = {
  '/#services': <Truck size={18} />,
  '/#platform': <LayoutGrid size={18} />,
  '/#resellers': <Store size={18} />,
  '/#pricing': <Tag size={18} />,
  '/#faq': <CircleHelp size={18} />,
};
const NAV_HUES: Record<string, 'saffron' | 'teal' | 'violet' | 'blue' | 'green'> = {
  '/#services': 'saffron',
  '/#platform': 'teal',
  '/#resellers': 'violet',
  '/#pricing': 'blue',
  '/#faq': 'green',
};

export function SiteHeader(): ReactElement {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState('');

  useEffect(() => {
    const onScroll = (): void => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    const onHash = (): void => setHash(window.location.hash);
    onHash();
    window.addEventListener('hashchange', onHash);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    // Focus goes INTO the drawer (its close button) and comes back to the
    // menu button on close; Tab wraps inside while it is open. Without this
    // a keyboard or screen-reader user opened the menu and stayed on the
    // button behind it (found on the live site, 2026-09-22).
    const opener = document.activeElement as HTMLElement | null;
    const drawer = document.getElementById('site-drawer');
    const focusables = (): HTMLElement[] =>
      drawer
        ? Array.from(
            drawer.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    const raf = requestAnimationFrame(() => {
      (
        drawer?.querySelector<HTMLElement>('button[aria-label="Close menu"]') ?? focusables()[0]
      )?.focus();
    });
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'Tab') {
        const list = focusables();
        const first = list[0];
        const last = list[list.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      opener?.focus();
    };
  }, [open]);

  // After a hash navigation the target is re-scrolled into view a few times
  // while the sections above it finish rendering. The sections carry
  // `content-visibility: auto`, so a jump to a far anchor (the FAQ) landed
  // ~80 px deep as the ones in between grew from their placeholder height.
  // `scrollIntoView` honours each section's `scroll-margin-top`. A hash
  // with no element yet (`#platform-<tab>` before the tour has mounted)
  // settles on its section instead.
  useEffect(() => {
    const settle = (): void => {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      const target = (id: string): HTMLElement | null => document.getElementById(id);
      // A tour deep link settles on the SECTION (heading and tabs in view),
      // never on the stage element the tab switch creates below them.
      const el = raw.startsWith('platform-') ? target('platform') : target(raw);
      if (!el) return;
      const go = (): void => el.scrollIntoView({ block: 'start' });
      const t1 = window.setTimeout(go, 60);
      const t2 = window.setTimeout(go, 260);
      const t3 = window.setTimeout(go, 700);
      timers.current.push(t1, t2, t3);
    };
    const timers = { current: [] as number[] };
    window.addEventListener('hashchange', settle);
    if (window.location.hash) settle();
    return () => {
      window.removeEventListener('hashchange', settle);
      for (const t of timers.current) window.clearTimeout(t);
    };
  }, []);

  const track = (awb: string): void => {
    window.location.assign(`${platform.nav.track.href}?awb=${encodeURIComponent(awb)}`);
  };

  return (
    <header className="site-header" data-condensed={scrolled || undefined}>
      <div className="site-header__wrap safe-x mx-auto max-w-7xl sm:px-6">
        <div className="site-header__bar">
          <Link href="/" className="site-header__brand" aria-label="Skydrop home">
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

          <HeaderNav />

          <div className="site-header__actions">
            <span className="hidden lg:block">
              <ExpandingTrackField onSubmit={track} />
            </span>
            <span className="hidden sm:block">
              <ThemeToggle />
            </span>
            <SweepLink href={platform.nav.cta.href} className="site-header__cta">
              {platform.nav.cta.label}
            </SweepLink>
            <IconButton
              label="Open menu"
              className="site-header__menu lg:hidden"
              onClick={() => setOpen(true)}
              aria-expanded={open}
              aria-controls="site-drawer"
            >
              <Menu size={22} aria-hidden="true" />
            </IconButton>
          </div>
          <ScrollProgress />
        </div>
      </div>

      {/* Drawer (u20) */}
      <div
        id="site-drawer"
        className={cn(
          'drawer fixed inset-0 z-50 overflow-hidden lg:hidden',
          open ? 'drawer--open' : 'pointer-events-none invisible',
        )}
        aria-hidden={!open}
        inert={!open}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div className="drawer__scrim" onClick={() => setOpen(false)} />
        <div className="drawer__panel">
          <div className="drawer__top safe-x">
            <span className="site-header__brand">
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
            </span>
            <IconButton label="Close menu" onClick={() => setOpen(false)}>
              <X size={20} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="drawer__body safe-b safe-x">
            <nav className="drawer__nav" aria-label="Sections">
              {platform.nav.primary.map((l, i) => (
                <RowLink
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  icon={NAV_ICONS[l.href]}
                  title={l.label}
                  hue={NAV_HUES[l.href] ?? 'blue'}
                  active={hash !== '' && l.href.endsWith(hash)}
                  className="drawer__row"
                  style={{ '--i': i } as React.CSSProperties}
                />
              ))}
              <RowLink
                href={platform.nav.track.href}
                onClick={() => setOpen(false)}
                icon={<PackageSearch size={18} />}
                title={platform.nav.track.label}
                helper="Any waybill, no sign-in"
                className="drawer__row"
                style={{ '--i': platform.nav.primary.length } as React.CSSProperties}
              />
            </nav>
            <div className="drawer__ctas">
              <SweepLink href={platform.nav.cta.href} className="drawer__cta">
                {platform.nav.cta.label}
              </SweepLink>
              {platform.nav.signIn.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="drawer__ghost"
                >
                  {l.label}
                </a>
              ))}
            </div>
            <div className="drawer__contact">
              <a href={business.hotlineHref} className="drawer__hotline">
                <Phone size={16} aria-hidden="true" />
                <span className="tabular">{business.hotline}</span>
              </a>
              <span className="drawer__hours">
                <Clock size={16} aria-hidden="true" />
                {business.hoursDays} · {business.hoursTime} ({business.hoursZone})
              </span>
            </div>
            <div className="drawer__foot">
              <span>Theme</span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
