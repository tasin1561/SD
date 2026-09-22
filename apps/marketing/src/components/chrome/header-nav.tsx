'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import {
  ChevronDown,
  Plane,
  Boxes,
  Store,
  PhoneCall,
  Undo2,
  Wallet,
  Users,
  Truck,
  ShoppingBag,
} from 'lucide-react';
import { platform } from '@/content/site';
import { RowLink } from '@/components/micro/list-row';

const MEGA_ICONS = [
  Plane,
  Plane,
  Boxes,
  Store,
  Truck,
  Boxes,
  PhoneCall,
  Undo2,
  Wallet,
  Users,
  ShoppingBag,
];

/**
 * The desktop nav with a SCROLL-SPY pill (u30): the section currently on
 * screen puts its item in an accent pill that slides — never blinks —
 * between items. Each item is a hash link to a section id; an
 * IntersectionObserver over those sections drives the active one, and
 * the pill is positioned from the active link's measured offset (two CSS
 * variables, one transform). With no section on screen (the hero) the
 * pill rests hidden.
 *
 * Two items carry a MEGA-MENU (u21 rows): it grows from the item on
 * hover or focus-within, closes on Escape or when the pointer leaves, and
 * the item itself stays a real link, so keyboard users can skip the panel.
 *
 * Every link here is a PLAIN <a>, not next/link: on the static export a
 * <Link> to a hash on the current path changed nothing — no hash, no scroll
 * (found on the live site, 2026-09-22). The browser's own hash navigation
 * honours `scroll-margin-top`; SiteHeader re-settles the landing afterwards.
 */
export function HeaderNav(): ReactElement {
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const closeTimer = useRef(0);

  useEffect(() => {
    const ids = platform.nav.primary
      .map((l) => l.href.split('#')[1])
      .filter((x): x is string => Boolean(x));
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (targets.length === 0) return;
    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        let best: string | null = null;
        let bestRatio = 0.08;
        for (const [id, r] of visible) if (r > bestRatio) [best, bestRatio] = [id, r];
        setActive(best);
      },
      { threshold: [0.1, 0.3, 0.6], rootMargin: '-15% 0px -45% 0px' },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const link = active ? el.querySelector<HTMLElement>(`[data-target="${active}"]`) : null;
    el.dataset.none = link ? '' : '1';
    if (link) {
      el.style.setProperty('--pill-x', `${link.offsetLeft}px`);
      el.style.setProperty('--pill-w', `${link.offsetWidth}px`);
    }
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const show = (label: string): void => {
    window.clearTimeout(closeTimer.current);
    setOpen(label);
  };
  const hide = (): void => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(null), 120);
  };

  let iconIndex = 0;
  return (
    <nav ref={root} className="hnav hidden lg:flex" aria-label="Sections" data-none="1">
      <span className="hnav__pill" aria-hidden />
      {platform.nav.primary.map((l) => {
        const id = l.href.split('#')[1] ?? '';
        const mega = (platform.nav.mega as Record<string, readonly MegaRow[] | undefined>)[l.label];
        if (!mega)
          return (
            <a
              key={l.href}
              href={l.href}
              data-target={id}
              className="hnav__link"
              aria-current={active === id ? 'location' : undefined}
            >
              {l.label}
            </a>
          );
        const isOpen = open === l.label;
        const start = iconIndex;
        iconIndex += mega.length;
        return (
          <span
            key={l.href}
            className="hnav__item"
            data-open={isOpen || undefined}
            onPointerEnter={() => show(l.label)}
            onPointerLeave={hide}
            onFocus={() => show(l.label)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(null);
            }}
          >
            <a
              href={l.href}
              data-target={id}
              className="hnav__link"
              aria-current={active === id ? 'location' : undefined}
              aria-haspopup="true"
              aria-expanded={isOpen}
              aria-controls={`mega-${id}`}
              onClick={() => setOpen(null)}
            >
              {l.label}
              <ChevronDown size={13} aria-hidden className="hnav__chev" />
            </a>
            <div
              id={`mega-${id}`}
              className="mega"
              role="group"
              aria-label={`${l.label} menu`}
              inert={!isOpen}
            >
              <div className="mega__panel">
                {mega.map((row, i) => {
                  const Icon = MEGA_ICONS[start + i] ?? Boxes;
                  return (
                    <RowLink
                      key={row.label}
                      href={row.href}
                      hue={row.hue}
                      icon={<Icon size={16} />}
                      title={row.label}
                      helper={row.helper}
                      className="mega__row"
                      style={{ '--i': i } as React.CSSProperties}
                      onClick={() => setOpen(null)}
                    />
                  );
                })}
              </div>
            </div>
          </span>
        );
      })}
    </nav>
  );
}

interface MegaRow {
  href: string;
  label: string;
  helper: string;
  hue: 'blue' | 'green' | 'saffron' | 'teal' | 'violet' | 'magenta';
}
