import type { ReactElement } from 'react';
import { ArrowRight, Building2, Store, UserRound, type LucideIcon } from 'lucide-react';

/**
 * The CONSOLE DIRECTORY — the one place that knows which Skydrop
 * consoles a person can sign in to, what each is called, and who
 * belongs there.
 *
 * WHY IT IS SHARED. Every console's sign-in screen already carried a
 * hand-written link to one other console, written three times in three
 * apps — so the mesh was partial by accident rather than by decision:
 * client offered member, member offered client, associate offered
 * member. An associate who landed on client (a forwarded link, a
 * bookmark from a colleague) could reach member and then only client
 * again, and never their own portal. One list fixes that by
 * construction: `OtherPortals` renders every console except the one
 * the visitor is standing in, so a console cannot be left out of
 * somebody else's page by omission. CON-1 renamed all three hostnames
 * in a single day; the next rename, or a fourth console, is one edit
 * here instead of six scattered literals.
 *
 * WHY THE LINKS ARE CONSTANTS AND NOT ENV. These are our own public
 * hostnames: a fixed, finite set we control, and the same argument
 * CON-1 made for hard-coding `LEGACY_CONSOLE_ORIGINS` applies — a
 * closed set is not a knob somebody should be able to point anywhere.
 * What the API GENERATES (invitations, resets, the impersonation
 * handoff) still comes from `SELLER_APP_URL` / `RESELLER_APP_URL` /
 * `ASSOCIATE_APP_URL`, because those addresses are chosen per
 * environment and land in somebody's inbox. A link a visitor clicks on
 * a sign-in page is a different thing and may be a literal.
 *
 * CONSEQUENCE, STATED: in local development these links leave
 * localhost for production. That is deliberate and matches the
 * behaviour they replace — there is no local copy of another console
 * unless the developer happens to have started one, and a link to
 * `localhost:3005` that refuses the connection is worse than one that
 * works.
 *
 * ADMIN IS DELIBERATELY ABSENT. `admin.skydrop.global` is Skydrop's own
 * operations console; nobody arrives at a customer portal looking for
 * it, and advertising its address on three public sign-in pages is
 * noise for every real visitor and a hint for anybody else. Staff know
 * where they work.
 *
 * THE WORDS. `portal` is what the person will see written at the top
 * of the screen when they arrive, so the link and the destination
 * agree; `who` describes the READER rather than the product, because
 * somebody in the wrong place does not know they are in the wrong
 * place — they only know who they are.
 */
interface ConsoleEntry {
  readonly key: ConsoleKey;
  /** Origin, no trailing slash. */
  readonly origin: string;
  /** Exactly the `portal` line that console's `SignInFrame` renders. */
  readonly portal: string;
  /** Who signs in there, in the second person. */
  readonly who: string;
  readonly Icon: LucideIcon;
}

export type ConsoleKey = 'client' | 'store' | 'associate';

/** Ordered along the chain the goods travel: client → member store → its sales people. */
export const CONSOLES: readonly ConsoleEntry[] = [
  {
    key: 'client',
    origin: 'https://client.skydrop.global',
    portal: 'Client portal',
    who: 'You send your own stock to India',
    Icon: Building2,
  },
  {
    key: 'store',
    origin: 'https://member.skydrop.global',
    portal: 'Store portal',
    who: "You sell a client's stock under your own name",
    Icon: Store,
  },
  {
    key: 'associate',
    origin: 'https://associate.skydrop.global',
    portal: 'Sales portal',
    who: 'You sell for a store',
    Icon: UserRound,
  },
];

/**
 * The other consoles, as a chooser under a sign-in or sign-up card.
 *
 * `self` is the console rendering it and is EXCLUDED — pass it from the
 * page, never infer it from the hostname: these screens are
 * server-rendered and the request's host is not the browser's idea of
 * where it is.
 *
 * `path` sends the visitor to the equivalent page rather than always to
 * a login: somebody reading "how do I get an account" who realises they
 * are in the wrong portal wants that portal's answer to the same
 * question, not its sign-in form.
 *
 * Each row is a real 44px touch target (FE-7) rather than a bare inline
 * link. The responsive sweep exempts an `<a>` whose `display` is
 * `inline` — a link in a sentence, which WCAG 2.5.8 exempts too — and
 * these are standalone navigation, so they take the floor properly
 * instead of hiding behind that exemption.
 */
export function OtherPortals({
  self,
  path = '/login',
  title = 'Not the right sign-in?',
}: {
  readonly self: ConsoleKey;
  readonly path?: '/login' | '/sign-up';
  readonly title?: string;
}): ReactElement {
  const others = CONSOLES.filter((c) => c.key !== self);
  return (
    <nav className="sk-signin__portals" aria-label="Other Skydrop portals">
      <p className="sk-signin__portals-head">{title}</p>
      <ul className="sk-signin__portals-list">
        {others.map(({ key, origin, portal, who, Icon }) => (
          <li key={key}>
            {/*
              SAME TAB, no `target="_blank"`: they are going there to sign
              in, not to consult something, and a new tab would leave a
              dead login behind them. (`rel="noopener"` does nothing
              without a target, so it is not cargo-culted in.) Every
              console's /login bounces an already-authenticated visitor
              to their own landing page, so this is safe in any direction
              and needs no query string.
            */}
            <a className="sk-signin__portal" href={`${origin}${path}`}>
              <span className="sk-signin__portal-icon" aria-hidden>
                <Icon size={16} />
              </span>
              <span className="sk-signin__portal-text">
                <span className="sk-signin__portal-name">{portal}</span>
                <span className="sk-signin__portal-who">{who}</span>
              </span>
              <ArrowRight className="sk-signin__portal-go" size={15} aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
