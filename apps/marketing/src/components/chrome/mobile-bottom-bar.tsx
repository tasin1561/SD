'use client';

import { useState, type ReactElement } from 'react';
import { Calculator, MessageCircle, PackageSearch, Send } from 'lucide-react';
import { LiquidBead } from '@/components/micro/liquid-bead';
import { ContactFan } from '@/components/micro/contact-fan';
import { platform } from '@/content/site';
import { contactItems } from './contact-items';

/**
 * Four thumb-reachable actions on a phone — Track · Quote · Book · Contact —
 * as the ICON variant of the liquid bead: the active item's icon lifts out
 * of the bar on a rising bead in its accent. Track, Quote and Book are
 * navigations and fire at once; Contact opens the SAME labelled contact fan
 * the desktop floating button uses, anchored above the bar. Fixed below
 * `md` inside the safe area; `body` reserves its height in globals.css.
 */
export function MobileBottomBar(): ReactElement {
  const [active, setActive] = useState('track');
  const [contactOpen, setContactOpen] = useState(false);
  const tabs = [
    {
      id: 'track',
      label: 'Track',
      hue: 'blue',
      icon: <PackageSearch size={20} aria-hidden="true" />,
      href: platform.nav.track.href,
    },
    {
      id: 'quote',
      label: 'Quote',
      hue: 'saffron',
      icon: <Calculator size={20} aria-hidden="true" />,
      href: '/#quote',
    },
    {
      id: 'book',
      label: 'Book',
      hue: 'green',
      icon: <Send size={20} aria-hidden="true" />,
      href: platform.nav.cta.href,
    },
    {
      id: 'contact',
      label: 'Contact',
      hue: 'violet',
      icon: <MessageCircle size={20} aria-hidden="true" />,
    },
  ];
  const onChange = (id: string): void => {
    setActive(id);
    if (id === 'contact') setContactOpen((v) => !v);
    else setContactOpen(false);
  };
  return (
    <nav
      aria-label="Quick actions"
      className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-2/95 backdrop-blur-md md:hidden"
    >
      <div className="safe-x relative">
        <div className="absolute right-4 top-0">
          <ContactFan
            items={contactItems()}
            anchor="bar"
            open={contactOpen}
            onOpenChange={(v) => {
              setContactOpen(v);
              if (!v && active === 'contact') setActive('track');
            }}
            label="Contact options"
          />
        </div>
        <LiquidBead
          variant="icon"
          tabs={tabs}
          value={active}
          onChange={onChange}
          label="Quick actions"
        />
      </div>
    </nav>
  );
}
