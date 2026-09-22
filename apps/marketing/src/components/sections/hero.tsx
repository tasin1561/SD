import type { ReactElement } from 'react';
import { HeroClient } from '@/components/islands/hero-client';
import { Odometer } from '@/components/micro/odometer';
import { business } from '@/content/site';
import './hero.css';

/**
 * SECTION 1 — the hero. A courier company, in three seconds: the
 * headline says which two countries and that it goes both ways, the
 * action card lets you track, quote or book without scrolling, and the
 * art is the corridor itself — the existing 2D map animation, theme-
 * reactive in dark and light (see `HeroArt`).
 *
 * On a phone (≤ 430 px) the order is headline → action card → trust row,
 * all above the fold at 360×780, with the art BEHIND the copy under a
 * scrim — never between the headline and the card. Above `lg` the art
 * takes the right half.
 */
export function Hero(): ReactElement {
  return (
    <section id="top" className="hero" aria-labelledby="hero-h1">
      <div className="hero__inner safe-x mx-auto max-w-7xl sm:px-6">
        <HeroClient
          headline={
            <div className="hero__headline">
              <h1 id="hero-h1" className="hero__h1">
                Bangladesh <span className="hero__arrows">⇄</span> India,
                <br />
                door to door.
              </h1>
              <p className="hero__sub">
                Send parcels between Bangladesh and India, door to door, in both directions. Selling
                online? We also hold your stock in India, confirm every COD order by phone and send
                your money home.
              </p>
              <p className="hero__note">
                Skydrop is invite-only while we scale the Indian warehouse. Request an invite and a
                person reads it.
              </p>
            </div>
          }
          trust={
            <dl className="hero__trust">
              {business.stats.map((s) => (
                <div key={s.label} className="hero__stat">
                  <dd className="hero__stat-n">
                    <Odometer value={s.value} />
                    {s.suffix ? <span className="hero__stat-suffix">{s.suffix}</span> : null}
                  </dd>
                  <dt className="hero__stat-k">{s.label}</dt>
                </div>
              ))}
              <div className="hero__stat">
                <dd className="hero__stat-n">
                  <Odometer value={business.trustCount} />
                  <span className="hero__stat-suffix">+</span>
                </dd>
                <dt className="hero__stat-k">{business.trustLine}</dt>
              </div>
            </dl>
          }
        />
      </div>
    </section>
  );
}
