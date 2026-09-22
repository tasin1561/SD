import type { ReactElement, ReactNode } from 'react';
import { Reveal } from '@/lib/reveal';
import {
  BadgeCheck,
  EyeOff,
  ListChecks,
  Percent,
  Scale,
  ShieldAlert,
  ShoppingCart,
  Store,
  Wallet,
} from 'lucide-react';
import { ResellerStoresLoader } from '@/components/islands/loaders/reseller-stores-loader';
import { reseller } from '@/content/sections/reseller';
import { SectionHeading } from './section-heading';
import './sections.css';
import './reseller-stores.css';

/**
 * SECTION 14 — Reseller stores (`#resellers`). Two parties colour the
 * whole section: the SELLER is blue, the STORE is violet, and Skydrop's
 * own wallet — where it appears at all — is neutral and locked aside.
 *
 * The four cards are server-rendered and say the thing in words; the
 * two-party demo under them is an island that never reaches first-load
 * JS. Nothing here is conveyed by colour alone: every party is named.
 */
const ICONS: Record<string, ReactNode> = {
  terms: <Percent size={15} strokeWidth={2.5} />,
  sees: <EyeOff size={15} strokeWidth={2.5} />,
  does: <ListChecks size={15} strokeWidth={2.5} />,
  disputes: <Scale size={15} strokeWidth={2.5} />,
  brand: <BadgeCheck size={15} strokeWidth={2.5} />,
  orders: <ShoppingCart size={15} strokeWidth={2.5} />,
  wallet: <Wallet size={15} strokeWidth={2.5} />,
  guard: <ShieldAlert size={15} strokeWidth={2.5} />,
};

/** Cards about the store take the violet; the seller's decisions take the blue. */
const HUES: Record<string, string> = {
  terms: 'blue',
  sees: 'blue',
  does: 'violet',
  disputes: 'violet',
  brand: 'violet',
  orders: 'violet',
  wallet: 'violet',
  guard: 'blue',
};

export function ResellerStores(): ReactElement {
  return (
    <section id="resellers" className="sec sec--band" aria-labelledby="resellers-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="resellers-h2"
          hue="violet"
          eyebrow="Reseller stores"
          icon={<Store size={14} />}
          title="Your stock, their shopfront, your terms"
          sub={reseller.promise}
        />

        <ul className="rs__cards">
          {reseller.cards.map((c, i) => (
            <Reveal
              as="li"
              key={c.id}
              delay={i * 60}
              className="rs__card"
              data-hue={HUES[c.id] ?? 'violet'}
            >
              <span className="rs__cardIco" aria-hidden>
                {ICONS[c.id]}
              </span>
              <h3 className="rs__cardT">{c.title}</h3>
              <p className="rs__cardL">{c.line}</p>
            </Reveal>
          ))}
        </ul>

        <ResellerStoresLoader />
      </div>
    </section>
  );
}
