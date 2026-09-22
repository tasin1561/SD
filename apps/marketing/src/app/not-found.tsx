import type { ReactElement } from 'react';
import { PackageSearch } from 'lucide-react';
import { Nav } from '@/components/landing/nav';
import { SiteFooter } from '@/components/landing/site-footer';
import { FloatingContact } from '@/components/chrome/floating-contact';
import { MobileBottomBar } from '@/components/chrome/mobile-bottom-bar';
import { EmptyState } from '@/components/micro/empty-state';
import { SweepLink } from '@/components/micro/sweep';
import { platform } from '@/content/site';
import './not-found.css';

/**
 * The 404. The static host answers an unknown path with `out/404.html`,
 * so this is the page somebody actually lands on after a dead link — it
 * gets the site's own chrome rather than a bare message, and a u27 empty
 * state that offers the two things a lost visitor wants: the way home,
 * and the tracking page (most dead links into this site are a mistyped
 * or truncated tracking URL). Never a sad face and never an error code
 * as a headline: "not found" is an invitation to the next step.
 */
export default function NotFound(): ReactElement {
  return (
    <>
      <Nav />
      <main id="main" className="nf">
        <div className="nf__inner safe-x sm:px-6">
          <LostParcel />
          <EmptyState
            className="nf__card"
            tone="blue"
            title="We could not find that page"
            body="The link may be old, or the address mistyped. Nothing is lost — here are the two ways back in."
            action={
              <div className="nf__actions">
                <SweepLink href="/">Back to the home page</SweepLink>
                <a className="nf__alt" href={platform.nav.track.href}>
                  <PackageSearch size={16} aria-hidden />
                  {platform.nav.track.label}
                </a>
              </div>
            }
          />
        </div>
      </main>
      <SiteFooter />
      <MobileBottomBar />
      <FloatingContact />
    </>
  );
}

/**
 * An isometric parcel with a question-mark tag floating beside it. Drawn
 * from the theme's own `--art-face-*` trio, so it reads in both themes
 * without this file knowing which one is on; transform-only motion.
 */
function LostParcel(): ReactElement {
  return (
    <svg className="nf__art" viewBox="0 0 146 124" aria-hidden focusable="false">
      <ellipse className="nf__shadow" cx="66" cy="110" rx="38" ry="6.5" />
      <g className="nf__box">
        <path className="nf__top" d="M66 30 100 49.5 66 69 32 49.5Z" />
        <path className="nf__left" d="M32 49.5v27L66 96V76.5Z" />
        <path className="nf__right" d="M100 49.5v27L66 96V76.5Z" />
        <path className="nf__tape" d="M49 39.7 83 59.2v10.6l-6-3.4v-4L43 43.1Z" />
        <path className="nf__edge" d="M32 49.5 66 69l34-19.5M66 69v27" />
      </g>
      <g className="nf__tag">
        <path className="nf__lead" d="M103 33c8-5 13-7 18-7" />
        <rect className="nf__chip" x="106" y="6" width="32" height="32" rx="10" />
        <text className="nf__q" x="122" y="29" textAnchor="middle">
          ?
        </text>
      </g>
    </svg>
  );
}
