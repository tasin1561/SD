import type { ReactElement } from 'react';
import {
  Landmark,
  PackageSearch,
  PhoneCall,
  ScanLine,
  ScrollText,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { Reveal } from '@/lib/reveal';
import { trust } from '@/content/sections/trust';
import { SectionHeading } from './section-heading';
import './sections.css';
import './trust.css';

const BADGE_ICONS = {
  licence: ScrollText,
  association: Users,
  entity: Landmark,
} as const;

const ASSURANCE_ICONS = {
  call: PhoneCall,
  scan: ScanLine,
  inspect: PackageSearch,
  wallet: Wallet,
} as const;

/**
 * SECTION — Credentials & trust. Small, and deliberately two-part: the
 * paperwork above, what happens to every parcel below.
 *
 * NEITHER half is interactive, and that is a decision rather than an
 * omission. A badge could link to a scanned certificate and an assurance
 * to the tour beat that shows it — but the certificates are placeholders
 * (see `content/sections/trust.ts`) and a row that goes somewhere invites
 * a click the page cannot honour. So both are drawn with the chrome of
 * the u21 row — icon chip, title, one line — and none of its affordances:
 * no chevron, no pointer, no focus ring, nothing in the tab order. The
 * contact section's office block took the same decision for the same
 * reason.
 *
 * The badges still LIFT on hover, which a static element may do: it is
 * the card acknowledging the pointer, not a promise that pressing it does
 * something. The assurance rows do not move at all — four rows lifting in
 * sequence under a drifting cursor reads as a menu.
 *
 * Every row's hue sits on the row itself; `[data-hue]` in `sections.css`
 * re-scopes `--h*` for that subtree, so one attribute colours the chip.
 * Server-rendered.
 */
export function Trust(): ReactElement {
  const { badges, assurances } = trust;

  return (
    <section id="trust" className="sec" aria-labelledby="trust-h2">
      <div className="sec__inner safe-x sm:px-6">
        <SectionHeading
          id="trust-h2"
          hue="green"
          eyebrow={trust.eyebrow}
          icon={<ShieldCheck size={14} />}
          title={trust.title}
          sub={trust.sub}
        />

        <div className="tr">
          <section className="tr__block" aria-labelledby="trust-badges">
            <h3 id="trust-badges" className="tr__h3">
              {badges.heading}
            </h3>
            <ul className="tr__badges">
              {badges.items.map((b, i) => {
                const Icon = BADGE_ICONS[b.icon];
                return (
                  <Reveal as="li" key={b.id} delay={i * 60} className="tr__badge" data-hue={b.hue}>
                    <span className="tr__chip" aria-hidden>
                      <Icon size={18} />
                    </span>
                    <span className="tr__text">
                      <span className="tr__name">{b.name}</span>
                      <span className="tr__line">{b.line}</span>
                    </span>
                  </Reveal>
                );
              })}
            </ul>
          </section>

          <section className="tr__block" aria-labelledby="trust-assurances">
            <h3 id="trust-assurances" className="tr__h3">
              {assurances.heading}
            </h3>
            <ul className="tr__rows">
              {assurances.items.map((a, i) => {
                const Icon = ASSURANCE_ICONS[a.icon];
                return (
                  <Reveal as="li" key={a.id} delay={i * 60} className="tr__row" data-hue={a.hue}>
                    <span className="tr__chip tr__chip--lg" aria-hidden>
                      <Icon size={18} />
                    </span>
                    <span className="tr__text">
                      <span className="tr__title">{a.title}</span>
                      <span className="tr__line">{a.line}</span>
                    </span>
                  </Reveal>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </section>
  );
}
