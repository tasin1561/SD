'use client';

import { useState, type ReactElement } from 'react';
import { Calculator, MessageCircle, PackageSearch, Send } from 'lucide-react';
import { LiquidBead } from '@/components/micro/liquid-bead';
import { ContactFan } from '@/components/micro/contact-fan';
import { requestHeroTab, useBarTab, type HeroTab } from '@/lib/hero-tab';
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
  // The bead FOLLOWS the hero card's open tab (Track / Quote / Book are the
  // same three tabs) and rests on nothing once the hero has scrolled away;
  // Contact lights while its fan is open.
  const heroTab = useBarTab();
  const [contactOpen, setContactOpen] = useState(false);
  const active = contactOpen ? 'contact' : heroTab;
  const tabs = [
    {
      id: 'track',
      label: 'Track',
      hue: 'blue',
      icon: <PackageSearch size={20} aria-hidden="true" />,
    },
    {
      id: 'quote',
      label: 'Quote',
      hue: 'saffron',
      icon: <Calculator size={20} aria-hidden="true" />,
    },
    {
      id: 'book',
      label: 'Invite',
      hue: 'green',
      icon: <Send size={20} aria-hidden="true" />,
    },
    {
      id: 'contact',
      label: 'Contact',
      hue: 'violet',
      icon: <MessageCircle size={20} aria-hidden="true" />,
    },
  ];
  const onChange = (id: string): void => {
    if (id === 'contact') {
      setContactOpen((v) => !v);
      return;
    }
    setContactOpen(false);
    requestHeroTab(id as HeroTab);
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
            onOpenChange={setContactOpen}
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
