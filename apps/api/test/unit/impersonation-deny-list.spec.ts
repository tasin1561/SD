import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  FORBIDDEN_WHILE_IMPERSONATING,
  refusalFor,
} from '../../src/common/impersonation/forbidden-while-impersonating';

/**
 * The deny list has to name the routes that actually exist.
 *
 * ── WHY A SOURCE TEST, AND WHY THIS FILE BY NAME ─────────────────────
 * `forbidden-while-impersonating.ts` says, in its own docblock, that
 * matching on routes is the right design because "a new route is refused
 * until somebody has thought about it, because the list is allow-nothing
 * by shape: it names what is blocked, and `impersonation-deny-list.spec
 * .ts` fails when a seller or store route appears that matches none of
 * the safe shapes and is not named here."
 *
 * That file did not exist. The claim in the docblock was the only thing
 * holding the list to reality, and a claim in a comment is not a check.
 *
 * ── WHAT GOES WRONG WITHOUT IT ───────────────────────────────────────
 * `refusalFor` is a string prefix match, so an entry that names a path
 * nobody serves is not an error — it is silence. The unit tests on
 * `refusalFor` all pass against a prefix that matches nothing, because
 * they feed it the prefix itself. The only way to catch a prefix that
 * has drifted from the route is to go and look at the routes, which is
 * what this file does.
 *
 * ── THE TWO THINGS IT ASKS ───────────────────────────────────────────
 *   1. Every prefix on the list matches a real route (or is on the
 *      small, commented list of entries that are deliberately ahead of
 *      the code).
 *   2. Every real route in the two categories an audit row cannot undo
 *      — lasting access, and money that has moved — is refused even
 *      with `mayWrite: true`.
 *
 * Both questions are about the rest of the codebase, which is why they
 * are here and not in `forbidden-while-impersonating.spec.ts`.
 */

const MODULES_DIR = join(__dirname, '../../src/modules');

interface Route {
  readonly method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
}

/** Controller bases a support session can reach at all. */
const IN_SCOPE_BASE = /^(seller|store|auth\/seller|auth\/store)(\/|$)/;

function controllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) controllerFiles(full, out);
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

/**
 * Every mutating seller/store/auth route in the app, read out of the
 * decorators.
 *
 * A static scan rather than booting Nest: this has to run as a unit
 * test, and the question — "what paths does the app serve?" — is
 * answerable from the source. The cost is that a controller written in
 * an unusual style is missed, which the sanity check below is for.
 */
function mutatingRoutes(): Route[] {
  const routes: Route[] = [];
  for (const file of controllerFiles(MODULES_DIR)) {
    const src = readFileSync(file, 'utf8');

    // ONE FILE MAY DECLARE SEVERAL CONTROLLERS, and taking only the
    // first does not merely miss the later ones — it attributes their
    // methods to the FIRST prefix, so the inventory gains routes nobody
    // serves and loses the ones that exist. Each method belongs to the
    // nearest `@Controller` ABOVE it.
    const bases: { readonly at: number; readonly base: string }[] = [];
    const controller = /@Controller\(\s*'([^']*)'/g;
    let found: RegExpExecArray | null;
    while ((found = controller.exec(src)) !== null) {
      bases.push({ at: found.index, base: found[1] ?? '' });
    }
    if (bases.length === 0) continue;

    const decorator = /@(Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?\s*\)/g;
    let hit: RegExpExecArray | null;
    while ((hit = decorator.exec(src)) !== null) {
      let base = '';
      for (const b of bases) {
        if (b.at < hit.index) base = b.base;
        else break;
      }
      if (!IN_SCOPE_BASE.test(base)) continue;
      const sub = hit[2] ?? '';
      routes.push({
        method: hit[1]!.toUpperCase() as Route['method'],
        path: `/${[base, sub].filter(Boolean).join('/')}`,
      });
    }
  }
  return routes;
}

/**
 * Entries that are deliberately AHEAD of the code.
 *
 * Each one blocks a route that does not exist yet, so that the route
 * arrives already refused rather than arriving safe-by-default. That is
 * the right way round, and it is not the same mistake as a prefix that
 * has drifted — so each is listed here, by hand, with the reason it is
 * allowed to match nothing. Anything NOT on this list that matches
 * nothing is a typo, and a typo here is an open door.
 */
const DELIBERATELY_AHEAD_OF_THE_CODE: ReadonlyArray<readonly [string, string]> = [
  [
    '/seller/profile/email',
    'There is no seller email-change endpoint yet. When one is added it must land already refused.',
  ],
  [
    '/seller/bank-change-requests',
    'Only the admin side of bank-change requests exists (`/admin/bank-change-requests`). The seller-facing one is expected.',
  ],
];

/**
 * Real, live routes in the two categories the list exists to protect.
 *
 * Read off the controllers (the inventory above prints them), and every
 * one is checked against the deny list below. The reason is spelled out
 * for each because "is this lasting access or money?" is the only
 * question that decides whether a route belongs here.
 */
const MUST_BE_REFUSED: ReadonlyArray<{
  readonly method: Route['method'];
  readonly path: string;
  readonly why: string;
}> = [
  // ── Lasting access ────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/seller/api-keys',
    why: 'A key that outlives the session, under their name.',
  },
  {
    method: 'POST',
    path: '/store/api-keys',
    why: 'A key that outlives the session, under their name.',
  },
  {
    method: 'POST',
    path: '/seller/webhook-endpoints',
    why: 'An endpoint added here keeps receiving their data after the session ends.',
  },
  {
    method: 'POST',
    path: '/seller/webhook-endpoints/:id/rotate-secret',
    why: 'Rotating the secret hands whoever holds the new one their event stream.',
  },
  {
    method: 'PATCH',
    path: '/seller/webhook-endpoints/:id',
    why: 'Re-pointing an existing endpoint redirects their data without adding anything.',
  },
  {
    method: 'POST',
    path: '/store/webhook-endpoints',
    why: 'An endpoint added here keeps receiving their data after the session ends.',
  },
  {
    method: 'POST',
    path: '/seller/team/invitations',
    why: 'Inviting somebody grants standing access that outlasts the session.',
  },
  {
    method: 'PATCH',
    path: '/seller/team/members/:id/role',
    why: 'Changing a role grants standing access that outlasts the session.',
  },
  {
    method: 'POST',
    path: '/store/team/invitations',
    why: 'Inviting somebody grants standing access that outlasts the session.',
  },
  {
    method: 'POST',
    path: '/seller/roles',
    why: 'A seller role IS a bundle of standing permissions. Creating one is the same act as changing a member role, one level of indirection away — and `/seller/team` is already on the list for exactly that reason.',
  },
  {
    method: 'PATCH',
    path: '/seller/roles/:id',
    why: 'Widening a role widens it for everybody who holds it, after the session has ended.',
  },
  {
    method: 'POST',
    path: '/auth/seller/password-reset/confirm',
    why: 'Changing their password locks them out of their own account.',
  },
  {
    method: 'POST',
    path: '/auth/store/password-reset/confirm',
    why: 'Changing their password locks them out of their own account.',
  },

  // ── Money ─────────────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/seller/wallet/withdrawal-requests',
    why: 'Moving their money out is never a support action.',
  },
  {
    method: 'PATCH',
    path: '/seller/wallet/withdrawal-schedule',
    why: 'The schedule moves money on its own, afterwards, with nobody watching. It is a withdrawal with a delay.',
  },
  {
    method: 'POST',
    path: '/store/wallet/withdrawals',
    why: 'Moving their money out is never a support action — and a store has its own wallet.',
  },
  {
    method: 'PATCH',
    path: '/seller/profile/bank-details',
    why: 'Bank details decide where their money lands.',
  },

  // The ones the sweep below found, named here too, because this is the
  // list a reader scans to answer "could a support session move money?".
  {
    method: 'POST',
    path: '/seller/reseller-stores/:storeId/wallet/payouts',
    why: 'Their money leaves their wallet for a store’s.',
  },
  {
    method: 'POST',
    path: '/seller/reseller-stores/:storeId/wallet/top-up',
    why: 'Their money moves into a store’s wallet.',
  },
  {
    method: 'PATCH',
    path: '/seller/profile/bank-details',
    why: 'Where their money lands. Covered only by half-segment luck until 2026-10-07.',
  },
  {
    method: 'POST',
    path: '/seller/wallet/topups',
    why: 'Half of crediting a wallet with no transfer behind it; one person can hold both halves.',
  },

  // ── A signature ───────────────────────────────────────────────────
  {
    method: 'POST',
    path: '/store/terms/:versionId/accept',
    why: 'Accepting terms is a signature, and orders are priced under the version in force.',
  },
  {
    method: 'POST',
    path: '/seller/reseller-stores/:storeId/terms',
    why: 'Publishing terms sets the fee split and the credit timing for every later order — the stronger half of the pair whose acceptance was already refused.',
  },
];

describe('the route inventory this test depends on', () => {
  const routes = mutatingRoutes();

  it('found a plausible number of mutating seller/store routes', () => {
    // If the scan broke — a decorator style it does not recognise, a
    // moved directory — every assertion below would pass against an
    // empty list. This is the tripwire for that.
    expect(routes.length).toBeGreaterThan(100);
  });

  it('found the routes we know by name', () => {
    const paths = new Set(routes.map((r) => r.path));
    for (const known of [
      '/seller/api-keys',
      '/seller/webhook-endpoints',
      '/seller/wallet/withdrawal-requests',
      '/store/api-keys',
      '/auth/seller/password-reset/confirm',
    ]) {
      expect(paths).toContain(known);
    }
  });

  it('every route in MUST_BE_REFUSED is a route that really exists', () => {
    // So the table below cannot drift into testing paths nobody serves,
    // which is the very failure it is here to catch.
    const serves = (candidate: { method: string; path: string }): boolean =>
      routes.some((r) => r.method === candidate.method && r.path === candidate.path);

    const missing = MUST_BE_REFUSED.filter((c) => !serves(c)).map((c) => `${c.method} ${c.path}`);
    expect(missing).toEqual([]);
  });
});

describe('every deny-list prefix names a route that exists', () => {
  /*
    ── FAILING: two prefixes match nothing, and both are typos ────────

    `refusalFor` is `path.startsWith(prefix)`. A prefix that matches no
    route is not an error and not a warning — it is a line in a list
    that reads as protection and provides none:

      '/seller/webhooks'    → the controller is `seller/webhook-endpoints`
      '/seller/withdrawals' → the controller is `seller/wallet/withdrawal-requests`

    The store equivalents are spelled correctly (`/store/webhook-
    endpoints` is on the list and does match), which is what makes these
    two read as slips rather than decisions — and is why the seller side
    is open while the store side is shut.
  */
  const routes = mutatingRoutes();
  const ahead = new Set(DELIBERATELY_AHEAD_OF_THE_CODE.map(([prefix]) => prefix));

  for (const entry of FORBIDDEN_WHILE_IMPERSONATING) {
    if (ahead.has(entry.prefix)) continue;

    it(`${entry.prefix} matches at least one real route`, () => {
      // Through `refusalFor` itself rather than a `startsWith` of our
      // own: a prefix carrying a `:param` segment cannot be compared
      // with a literal, and a second implementation of the match here
      // would be free to disagree with the one that guards production.
      const matched = routes.filter(
        (r) =>
          (entry.method === '*' || entry.method === r.method) &&
          refusalFor(r.method, r.path, true) !== null,
      );
      expect(matched.map((r) => `${r.method} ${r.path}`)).not.toEqual([]);
    });
  }

  it('the entries that are ahead of the code are still ahead of it', () => {
    // When one of these routes lands, this test fails and somebody
    // moves the entry off the exception list. That is the point: the
    // exception is temporary and says so out loud.
    for (const [prefix] of DELIBERATELY_AHEAD_OF_THE_CODE) {
      expect(routes.filter((r) => r.path === prefix || r.path.startsWith(`${prefix}/`))).toEqual(
        [],
      );
    }
  });
});

describe('every route an audit row cannot undo is refused', () => {
  /*
    ── FAILING: six live routes in these categories are allowed ───────

    With `mayWrite: true` — a staff member holding
    `support.impersonate.write`, which is a permission we intend to
    grant — `refusalFor` returns null for:

      POST   /seller/webhook-endpoints
      PATCH  /seller/webhook-endpoints/:id
      POST   /seller/webhook-endpoints/:id/rotate-secret
      POST   /seller/wallet/withdrawal-requests
      PATCH  /seller/wallet/withdrawal-schedule
      POST   /store/wallet/withdrawals
      POST   /seller/roles
      PATCH  /seller/roles/:id

    Four of them are the two typo'd prefixes above. `/seller/roles` is a
    different kind of gap: it was never on the list, and a seller role
    is a bundle of standing permissions, so creating or widening one is
    the same act `/seller/team` is already blocked for.
  */
  for (const entry of MUST_BE_REFUSED) {
    it(`${entry.method} ${entry.path} is refused with mayWrite: true`, () => {
      const refusal = refusalFor(entry.method, entry.path, true);
      // The message is the list's own wording, not ours — we only
      // assert that SOMETHING refuses it, and say why it has to.
      expect(refusal).not.toBeNull();
    });

    it(`${entry.method} ${entry.path} is refused in a read-only session`, () => {
      // True for every mutation, so this half can never be the one
      // that fails — it is here so a route moving off the named list
      // does not look completely unguarded.
      expect(refusalFor(entry.method, entry.path, false)).not.toBeNull();
    });
  }
});

/**
 * Every mutating seller/store route a write session CAN still reach,
 * each with the reason it is allowed.
 *
 * ── WHY THIS LIST EXISTS AT ALL ──────────────────────────────────────
 * `forbidden-while-impersonating.ts` claims the list is "allow-nothing
 * by shape: a new route is refused until somebody has thought about it".
 * That was never true of the mechanism — the mechanism is a deny list,
 * so a new route is ALLOWED until somebody names it — and the spec that
 * was supposed to make it true checked something else: a hand-written
 * set of routes it already knew about. So the claim held for exactly the
 * routes somebody had thought about, which is no claim.
 *
 * What it missed, found by sweeping instead of listing: eleven live
 * routes on a reseller store, including `POST .../wallet/payouts` (the
 * seller's money leaving their wallet), `POST .../wallet/top-up`,
 * `POST .../terms` (the fee split and credit timing for every later
 * order — while the store ACCEPTING those terms was refused, which is
 * backwards), and four that mail somebody standing access to an account.
 *
 * ── HOW TO ADD A ROUTE ───────────────────────────────────────────────
 * Write the route. This test fails. Then either name it on the deny list
 * with the harm, or add it here with the reason it is safe. Both are one
 * line, and neither is the default — which is the point: the decision is
 * forced, in the commit that adds the route, by the person who knows
 * what it does.
 */
const DELIBERATELY_ALLOWED: ReadonlyArray<readonly [string, string]> = [
  // ── Public auth routes: a session grants no access to these ───────
  // `password-reset/*` is NOT here: it is on the deny list, and that is
  // the older and stricter decision. Refusing it stops nothing a staff
  // member could not do from another tab — the route is public — but
  // "reset their password while inside their account" is the single
  // worst-looking line an audit row could carry, and it costs support
  // nothing to make it impossible.
  // Every one is `@Public`, needs no session, and is reachable from any
  // browser on earth. Refusing them inside a support session would be
  // theatre: it would stop nothing a staff member could not do by
  // closing the tab. The two that look alarming are safe for a concrete
  // reason — `password-reset/confirm` and the invitation acceptances all
  // need a token that only reaches the real person's inbox.
  ['/auth/seller/login', 'Public. A session is not what grants this.'],
  ['/auth/store/login', 'Public. A session is not what grants this.'],
  ['/auth/seller/refresh', 'Public. Rotates a cookie this browser already holds.'],
  ['/auth/store/refresh', 'Public. Rotates a cookie this browser already holds.'],
  ['/auth/seller/logout', 'Drops a session. The worst case is a nuisance.'],
  ['/auth/store/logout', 'Drops a session. The worst case is a nuisance.'],
  ['/auth/seller/logout-all', 'Signs their users out. A nuisance, not access.'],
  ['/auth/store/logout-all', 'Signs their users out. A nuisance, not access.'],
  [
    '/auth/seller/email-verification/request',
    'Mails the address already on file. Changes nothing.',
  ],
  ['/auth/store/email-verification/request', 'Mails the address already on file. Changes nothing.'],
  ['/auth/seller/email-verification/confirm', 'Needs the token from that mail.'],
  ['/auth/store/email-verification/confirm', 'Needs the token from that mail.'],
  [
    '/auth/seller/register/invite',
    'Needs an invitation token from somebody’s inbox, and creates THAT person’s user, not the staff member’s.',
  ],
  ['/auth/seller/accept-team-invitation', 'Needs the invitation token. Same shape.'],
  ['/auth/store/invitations/accept', 'Needs the invitation token. Same shape.'],
  ['/auth/store/invitations/preview', 'Reads an invitation by its token. A read in POST clothing.'],

  // ── The session's own way out ─────────────────────────────────────
  // Refusing these would trap the staff member inside the account,
  // which is the opposite of the intent. `/exchange` is how the session
  // begins; the gate skips all three by decorator anyway.
  ['/auth/seller/impersonation', 'The support session’s own exchange, leave and end.'],
  ['/auth/store/impersonation', 'The support session’s own exchange, leave and end.'],

  // ── Ordinary business data ────────────────────────────────────────
  // The whole point of a write session. None of it creates access and
  // none of it moves money: an order, a product, a price, an address, a
  // ticket, a note, a notification read.
  ['/seller/orders', 'Orders are the work. Placing, editing and submitting one is the job.'],
  ['/seller/orders-pending', 'Triaging an import row that failed.'],
  ['/seller/order-imports', 'Uploading and previewing a CSV of their orders.'],
  ['/seller/order-defaults', 'What they charge their own customers. Forward-looking, and theirs.'],
  ['/seller/products', 'The catalogue.'],
  ['/seller/variants', 'Variant images and favourites.'],
  ['/seller/csv-imports', 'Catalogue CSV upload.'],
  ['/seller/csv-mappings', 'Remembered column mappings.'],
  ['/seller/customers', 'Correcting a customer record (ORD-7: the phone stays immutable).'],
  ['/seller/addresses', 'Their own pickup and return addresses.'],
  ['/seller/recipient-addresses', 'A saved delivery address.'],
  ['/seller/consignments', 'Declaring a consignment. Cancelling one is refused above.'],
  ['/seller/goods-receipts', 'Confirming a count. Cancelling one is refused above.'],
  ['/seller/tickets', 'Raising an issue with us, and replying on it.'],
  [
    '/seller/profile',
    'Contact name, WhatsApp, language, currency, logo. Bank details are refused.',
  ],
  ['/seller/notifications', 'Reading, dismissing and subscribing — their own inbox.'],
  ['/seller/notification-preferences', 'What the company is emailed about.'],
  ['/seller/early-reservation-reviews', 'Answering “keep trying?” on one of their own orders.'],
  [
    '/seller/stores',
    'A CHANNEL store — a sales channel, with no login and no invitation. Reseller stores are refused above.',
  ],
  ['/seller/store-action-requests', 'Answering a reseller store’s request. Support work.'],
  ['/seller/store-address-changes', 'Answering a reseller store’s request. Support work.'],
  ['/seller/store-order-requests', 'Answering a reseller store’s request. Support work.'],
  [
    '/seller/reseller-price-list',
    'A price list. Placed orders keep the price snapshotted at the time (ORD-6/RS-5), so this reaches no order already placed.',
  ],
  [
    '/seller/reseller-stores/:storeId/catalogue',
    'What a store is shown and what it pays. The same class as a price list, and the thing a store most often needs help with.',
  ],
  [
    '/seller/reseller-stores/:storeId/pause',
    'Stops a store trading, and `resume` puts it back. Reversible by the route next to it, creates no access and moves no money — unlike `approve`, `reject` and `close`, which are refused above.',
  ],
  ['/seller/reseller-stores/:storeId/resume', 'The other half of pause.'],
  [
    '/seller/reseller-reports/stores/:storeId/auto-pause',
    'A risk threshold: pause a store if returns spike. It changes who may do what for nobody, and moves no money.',
  ],
  [
    '/seller/orders/:orderId/delivery-actions',
    'Asks US to act on a parcel; our own staff then do it. It creates a request, not an outcome.',
  ],
  ['/seller/orders/:orderId/reattempt-request', 'The same: a request to us.'],
  [
    '/seller/orders/:orderId/consignee',
    'Asks the courier to deliver somewhere else. The commonest support call there is.',
  ],

  // ── The store side of the same ────────────────────────────────────
  ['/store/orders', 'Orders are the work.'],
  ['/store/order-imports', 'Uploading a CSV of their orders.'],
  ['/store/customers', 'Correcting a customer record.'],
  ['/store/profile', 'Display name and logo.'],
  ['/store/notifications', 'Their own inbox.'],
  ['/store/notification-preferences', 'What they are told about.'],
  ['/store/tickets', 'Raising an issue, and replying.'],
  ['/store/issues', 'Raising it with Skydrop.'],
  ['/store/call-reviews', 'Answering “keep trying?” on one of their own orders.'],
  ['/store/expenses', 'The store’s own book. No bank entry and no wallet entry (RS-8).'],
];

describe('every mutating seller/store route is decided, one way or the other', () => {
  const routes = mutatingRoutes();

  it('found a plausible number of routes (the scan still works)', () => {
    // A regex that stops matching returns an empty list, and an empty
    // list passes every "nothing is unaccounted for" check below
    // perfectly. This is the floor that makes the rest mean something.
    expect(routes.length).toBeGreaterThan(100);
  });

  it('nothing is unaccounted for', () => {
    const allowed = DELIBERATELY_ALLOWED.map(([prefix]) => prefix);
    const matchesAllowed = (path: string): boolean =>
      allowed.some((prefix) => {
        const re = new RegExp(
          '^' +
            prefix
              .split('/')
              .map((seg) =>
                seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
              )
              .join('/') +
            '(?:/|$)',
        );
        return re.test(path);
      });

    const undecided = [
      ...new Set(
        routes
          .filter((r) => refusalFor(r.method, r.path, true) === null && !matchesAllowed(r.path))
          .map((r) => `${r.method} ${r.path}`),
      ),
    ].sort();

    // The failure message IS the instruction: each line is a route a
    // staff member could change inside somebody's account with nobody
    // having decided that they may.
    expect(undecided).toEqual([]);
  });

  it('nothing on the allow list is also refused', () => {
    // The two lists disagreeing is how a route reads as allowed in one
    // place and refused in the other, and the deny list wins silently.
    for (const [prefix] of DELIBERATELY_ALLOWED) {
      const concrete = prefix
        .split('/')
        .map((seg) => (seg.startsWith(':') ? 'x' : seg))
        .join('/');
      expect({ prefix, refusal: refusalFor('POST', concrete, true) }).toEqual({
        prefix,
        refusal: null,
      });
    }
  });
});
