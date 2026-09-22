import type { CSSProperties, ReactElement } from 'react';
import { MessageCircle } from 'lucide-react';
import { platform } from '@/content/site';
import { cta } from '@/content/sections/cta';
import { SweepLink } from '@/components/micro/sweep';
import './sections.css';
import './final-cta.css';

/**
 * SECTION — CLEARANCE. The closing ask, on the CORRIDOR GRADIENT.
 *
 * MKT-1: text on that gradient is ALWAYS slate-950, in both themes — it
 * clears 7.95 at the green end, 12.08 over the gold and 9.39 at the
 * saffron end, where white is 1.67 over the gold and unreadable. So the
 * primary button is the sweep's `ink` tone (a slate-950 fill carrying
 * white) and everything else that needs a lighter ground is a white
 * SURFACE CARD — the two shapes theme.css sanctions. The slate steps are
 * read raw and deliberately: the gradient is theme-invariant, so a
 * theme-aware token on it would change the contrast under the toggle.
 *
 * The band carries no eyebrow chip. The gradient IS the emphasis, and a
 * second one competing with it is what makes a closing band read as one
 * more section rather than the end of the page.
 */
export function FinalCta(): ReactElement {
  return (
    <section id="clearance" className="sec cta" aria-labelledby="cta-h2">
      <ParcelMesh />
      <div className="sec__inner safe-x sm:px-6 cta__inner">
        <h2 id="cta-h2" className="cta__h2">
          {cta.title}
        </h2>
        <p className="cta__lead">{cta.lead}</p>

        <div className="cta__actions">
          <SweepLink className="cta__go" href={platform.nav.cta.href} tone="ink">
            {platform.nav.cta.label}
          </SweepLink>
          <a className="cta__talk" href={cta.secondary.href}>
            <MessageCircle size={16} aria-hidden />
            {cta.secondary.label}
          </a>
        </div>

        <dl className="cta__readouts">
          {cta.readouts.map((r) => (
            <div key={r.id} className="cta__readout">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * Isometric parcels drifting across the band, 20–30 s each, transform
 * only. ONE `<symbol>` is defined and nine `<use>` elements place it, so
 * the whole mesh is about a kilobyte of markup rather than nine copies
 * of the same three paths. Placement is a PERCENTAGE of the band (a
 * single stretched `<svg>` would either distort the parcels or, under
 * `slice`, blow them up on a narrow screen); the container clips, so a
 * glyph overhanging the right edge never widens the document.
 */
const PARCELS = [
  { id: 'a', x: 4, y: 12, s: 2 },
  { id: 'b', x: 17, y: 68, s: 1.3 },
  { id: 'c', x: 29, y: 8, s: 1 },
  { id: 'd', x: 40, y: 82, s: 1.6 },
  { id: 'e', x: 55, y: 6, s: 1.1 },
  { id: 'f', x: 68, y: 74, s: 2.1 },
  { id: 'g', x: 79, y: 14, s: 1.4 },
  { id: 'h', x: 90, y: 60, s: 1.8 },
  { id: 'i', x: 95, y: 26, s: 1 },
] as const;

function ParcelMesh(): ReactElement {
  return (
    <div aria-hidden className="cta__mesh">
      <svg className="cta__sprite" focusable="false">
        <symbol id="cta-parcel" viewBox="0 0 24 24">
          <path d="M12 1 23 7 12 13 1 7Z" />
          <path d="M1 7v10l11 6V13Z" opacity=".72" />
          <path d="M23 7v10l-11 6V13Z" opacity=".45" />
        </symbol>
      </svg>
      {PARCELS.map((p, i) => (
        <svg
          key={p.id}
          className="cta__parcel"
          viewBox="0 0 24 24"
          focusable="false"
          style={{ '--x': p.x, '--y': p.y, '--s': p.s, '--i': i } as CSSProperties}
        >
          <use href="#cta-parcel" />
        </svg>
      ))}
    </div>
  );
}
