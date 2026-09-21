'use client';

import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { platform } from '@/content/site';

/**
 * The desktop nav with a SCROLL-SPY pill (u30): the section currently on
 * screen puts its item in an accent pill that slides — never blinks —
 * between items. Each item is a hash link to a section id; an
 * IntersectionObserver over those sections drives the active one, and
 * the pill is positioned from the active link's measured offset (two CSS
 * variables, one transform). With no section on screen (the hero) the
 * pill rests hidden.
 */
export function HeaderNav(): ReactElement {
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);

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

  return (
    <nav ref={root} className="hnav hidden lg:flex" aria-label="Sections" data-none="1">
      <span className="hnav__pill" aria-hidden />
      {platform.nav.primary.map((l) => {
        const id = l.href.split('#')[1] ?? '';
        return (
          <Link
            key={l.href}
            href={l.href}
            data-target={id}
            className="hnav__link"
            aria-current={active === id ? 'location' : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
