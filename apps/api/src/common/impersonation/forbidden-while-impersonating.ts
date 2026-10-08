/**
 * What a support session may NEVER do, however much permission the staff
 * member holds and whatever the seller themselves could do.
 *
 * ── THE TEST ────────────────────────────────────────────────────────
 * Two things an audit log cannot undo: **lasting access**, and **money
 * that has moved**. Everything on this list creates one or the other.
 *
 * A session is bounded — minutes, one account, one reason, and it ends.
 * An API key created inside it is not bounded: it outlives the session,
 * under the seller's name, and nothing afterwards distinguishes it from
 * one they made themselves. A changed password is worse: it is account
 * takeover, and it locks out the person whose account it is. A bank
 * detail changed and a withdrawal requested in the same session is not
 * support, it is theft with a receipt.
 *
 * Accepting terms is on the list for a different reason: it is a
 * SIGNATURE. RS-4 keeps terms versions for ever because placed orders
 * are priced under the version in force when they were placed. Agreeing
 * on somebody's behalf is not a support action in any reading.
 *
 * ── A PREFIX THAT MATCHES NOTHING IS SILENT, AND TWO DID ────────────
 * Written from memory, this list said `/seller/webhooks` and
 * `/seller/withdrawals`. The routes are `seller/webhook-endpoints` and
 * `seller/wallet/withdrawal-{requests,schedule}`. `startsWith` on a
 * prefix nobody serves refuses nothing and says nothing, so eight live
 * routes in the two categories this list exists to close — a webhook
 * that outlives the session, and money leaving — were reachable with
 * `mayWrite: true`. `/store/wallet/withdrawals` and `/seller/roles` were
 * never named in any spelling.
 *
 * Found by `impersonation-deny-list.spec.ts`, which scans the actual
 * controllers rather than trusting this file. That is the only kind of
 * test that could have found it: a test that feeds `refusalFor` these
 * prefixes passes perfectly while they guard nothing.
 *
 * ── WHY MATCHING ON ROUTES ──────────────────────────────────────────
 * The alternative — a flag on each handler — puts the decision in 40
 * places and makes a NEW dangerous endpoint safe by default, which is
 * the wrong default.
 *
 * But a deny list does not make a new route safe by default EITHER, and
 * this docblock claimed it did — "allow-nothing by shape" — while the
 * spec it named as the enforcement checked a hand-written set of routes
 * somebody had already thought about. Eleven live routes on a reseller
 * store, four of them money and four of them standing access, were
 * reachable the whole time the claim stood.
 *
 * What makes it true is the SWEEP in
 * `impersonation-deny-list.spec.ts`: it reads every mutating seller and
 * store route out of the controllers and fails unless each one is
 * either named here, with the harm, or named on its
 * `DELIBERATELY_ALLOWED` list, with the reason it is safe. Neither is
 * the default, so the decision is forced in the commit that adds the
 * route.
 *
 * Enforced SERVER-SIDE, in the guard. FE-2: hiding a button is a
 * courtesy, never a control.
 */

/**
 * A method + path-prefix pair.
 *
 * `*` means every MUTATING method, not literally every one: `refusalFor`
 * returns null for a read before it consults this list at all. That is
 * deliberate and it is the whole shape of the feature — a support
 * session exists so somebody can SEE what the seller sees, and a list
 * that blocked reads would make the read-only tier useless.
 *
 * Said here because the two disagreed in spirit: an entry reading `'*'`
 * beside `/seller/api-keys` looks like a promise that the page cannot be
 * opened, when what it guarantees is that no key can be created. The
 * first returns a prefix and metadata; the second is the one that
 * outlives the session.
 */
export interface ForbiddenRoute {
  readonly method: '*' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /**
   * Matched against the path with the app prefix already stripped, as a
   * PREFIX — the path either equals it or continues with a `/`, so
   * `/seller/team` covers `/seller/team/:id/role` and never
   * `/seller/teams`.
   *
   * A `:name` segment matches exactly one path segment, which is what
   * lets this list name a leaf under a nested resource. It is needed:
   * every dangerous route on a reseller store is
   * `/seller/reseller-stores/<id>/<the dangerous bit>`, and with literal
   * prefixes the only expressible rules were "nothing under reseller
   * stores" or "everything under them" — one of which blocks ordinary
   * support and the other of which leaves a wallet payout reachable.
   */
  readonly prefix: string;
  /**
   * Match this path ONLY, never anything below it.
   *
   * Needed for exactly one shape, and it is a shape a deny list meets
   * the moment a collection is dangerous and its members are not:
   * `POST /seller/reseller-stores` opens a store (and mails an
   * invitation), while `POST /seller/reseller-stores/:id/catalogue/...`
   * is an ordinary price edit. As a prefix the first swallowed the
   * second and refused a support session the one thing in that subtree
   * it is most often needed for — caught by the sweep in
   * `impersonation-deny-list.spec.ts`, not by reading.
   */
  readonly exact?: boolean;
  /** Said to the staff member, and written to the audit row. */
  readonly why: string;
}

export const FORBIDDEN_WHILE_IMPERSONATING: readonly ForbiddenRoute[] = [
  // ── Lasting access ────────────────────────────────────────────────
  {
    // The routes are `password-reset/request` and
    // `password-reset/confirm`; there is no `/auth/seller/password`. The
    // old prefix covered them only because `startsWith` will match half
    // a segment, so tightening the matcher to segment boundaries — right
    // in itself — would have reopened both. The SECOND prefix in this
    // file to have been correct by accident; both are named in full now.
    method: '*',
    prefix: '/auth/seller/password-reset',
    why: 'Changing their password would lock them out of their own account.',
  },
  {
    // The routes are `password-reset/request` and
    // `password-reset/confirm`; there is no `/auth/store/password`. The
    // old prefix covered them only because `startsWith` will match half
    // a segment, so tightening the matcher to segment boundaries — right
    // in itself — would have reopened both. The SECOND prefix in this
    // file to have been correct by accident; both are named in full now.
    method: '*',
    prefix: '/auth/store/password-reset',
    why: 'Changing their password would lock them out of their own account.',
  },
  {
    method: '*',
    prefix: '/seller/profile/email',
    why: 'Changing the address a login belongs to is account takeover, not support.',
  },
  {
    method: '*',
    prefix: '/seller/api-keys',
    why: 'An API key outlives this session, under their name. Nothing afterwards could tell it from one they made.',
  },
  {
    method: '*',
    prefix: '/store/api-keys',
    why: 'An API key outlives this session, under their name. Nothing afterwards could tell it from one they made.',
  },
  {
    method: '*',
    prefix: '/seller/webhook-endpoints',
    why: 'An endpoint added here keeps receiving their data after the session ends.',
  },
  {
    method: '*',
    prefix: '/store/webhook-endpoints',
    why: 'An endpoint added here keeps receiving their data after the session ends.',
  },
  {
    method: '*',
    prefix: '/seller/team',
    why: 'Inviting somebody or changing a role grants standing access that outlasts this session.',
  },
  {
    method: '*',
    prefix: '/seller/roles',
    why: 'Editing a role changes what everybody holding it may do, now and after this session ends.',
  },
  {
    method: '*',
    prefix: '/store/team',
    why: 'Inviting somebody or changing a role grants standing access that outlasts this session.',
  },
  {
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/invitations',
    why: 'An invitation to a reseller store is standing access to an account, created under their name and outlasting this session.',
  },
  {
    // A store is CREATED with an invitation — `CreateResellerStoreDto.invite`
    // is required (RS-1, 2026-09-16), precisely so no store exists that
    // nobody can sign in to. Which means creating one from in here mails
    // somebody a way in.
    method: 'POST',
    prefix: '/seller/reseller-stores',
    exact: true,
    why: 'Opening a reseller store sends an invitation, which is standing access to an account that outlasts this session.',
  },
  {
    // Approving carries a required invitation for the same reason.
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/approve',
    why: 'Approving a store opens it and invites its first user — standing access, created under their name.',
  },
  {
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/reject',
    why: 'Refusing a store somebody asked for is the seller’s decision about who they trade with, not a support action.',
  },
  {
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/close',
    why: 'Closing a store ends its access and its trading. Taking that away on their behalf is not support.',
  },
  {
    // The same argument as `/seller/roles`, one level out: this decides
    // whether a store may cancel an order, change one or turn a parcel
    // round WITHOUT the seller seeing it first. It is a standing grant.
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/action-policy',
    why: 'This decides what a store may do without asking. It is a standing permission, and it outlasts this session.',
  },
  {
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/wallet-manager',
    why: 'Who manages a store’s wallet decides who may move its money. Not from inside somebody’s account.',
  },

  // ── Money ─────────────────────────────────────────────────────────
  {
    method: '*',
    prefix: '/seller/wallet/withdrawal-requests',
    why: 'Moving their money out is never a support action.',
  },
  {
    method: '*',
    prefix: '/seller/wallet/withdrawal-schedule',
    why: 'An automatic withdrawal set from in here moves their money later, with nobody watching.',
  },
  {
    method: '*',
    prefix: '/store/wallet/withdrawals',
    why: 'Moving their money out is never a support action.',
  },
  {
    // `/seller/profile/bank` with the old `startsWith` happened to cover
    // `PATCH /seller/profile/bank-details`, the only route there is.
    // Making the match respect segment boundaries — right in itself —
    // would have silently reopened it, since `bank-details` continues
    // without a `/`. Named in full, which is what it should always have
    // been: a prefix that relies on matching half a segment is a prefix
    // that stops working the day somebody tightens the matcher.
    method: '*',
    prefix: '/seller/profile/bank-details',
    why: 'Bank details decide where their money lands. Changing them from inside their account is indistinguishable from theft.',
  },
  {
    method: '*',
    prefix: '/seller/bank-change-requests',
    why: 'Bank details decide where their money lands. Changing them from inside their account is indistinguishable from theft.',
  },
  {
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/wallet/payouts',
    why: 'A payout to a store moves the seller’s money out of their wallet. Never a support action.',
  },
  {
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/wallet/top-up',
    why: 'Topping a store up moves the seller’s money into it. Never a support action.',
  },
  {
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/wallet/negative-limit',
    why: 'This is how far a store may go into debt against them. Changing it moves money later, with nobody watching.',
  },
  {
    // WAL-2 means a claim credits nothing by itself — a person has to
    // see the money on our statement first. The reason it is still
    // refused is that BOTH steps are reachable by one person: a staff
    // member holding `money.topups.review` could file the claim as the
    // seller and accept it themselves, and the wallet would be credited
    // with no transfer behind it. Two halves that are each safe alone.
    method: '*',
    prefix: '/seller/wallet/topups',
    why: 'Declaring a payment under their name is one half of crediting a wallet with no money behind it. File it from the console instead.',
  },
  {
    method: '*',
    prefix: '/store/wallet/topups',
    why: 'Declaring a payment under their name is one half of crediting a wallet with no money behind it. File it from the console instead.',
  },

  // ── Irreversible in the physical world ────────────────────────────
  // These are not access and not a wallet entry; they are acts that
  // cannot be taken back by anybody, at the seller's cost. Each has a
  // STAFF-side equivalent (`courier.ops.write`, the admin consignment
  // and goods-receipt screens), so refusing them here loses support
  // nothing and keeps the record honest about who decided.
  {
    method: '*',
    prefix: '/seller/orders/:orderId/return',
    why: 'This turns a moving parcel round at their cost, through the courier. Do it from the console, under your own name.',
  },
  {
    method: '*',
    prefix: '/seller/consignments/:consignmentId/cancel',
    why: 'Cancelling a consignment takes their stock back off the ledger. Not from inside their account.',
  },
  {
    method: '*',
    prefix: '/seller/goods-receipts/:receiptId/cancel',
    why: 'Cancelling a receipt reverses stock that was counted in. Not from inside their account.',
  },

  // ── A signature ───────────────────────────────────────────────────
  {
    method: '*',
    prefix: '/store/terms',
    why: 'Accepting terms is a signature, and orders are priced under the version in force. It is not yours to give.',
  },
  {
    // The stronger half of the pair, and it was missing while the
    // ACCEPTANCE was blocked — which is backwards. Publishing sets the
    // fee split and the credit timing for every order placed afterwards.
    method: '*',
    prefix: '/seller/reseller-stores/:storeId/terms',
    why: 'Publishing terms sets the fee split and when each side is paid, for every order after it. That is money, and it is their signature.',
  },

  // ── ASSOC-1 — a store's own sales people ──────────────────────────
  // The sweep forced this decision when the three routes landed, which
  // is what it is for. All three are REFUSED, by the same reasoning as
  // the terms entry above, one level down: an associate's price decides
  // what every later order of that person sells at, and whether their
  // order creation is on decides whether a third party can trade at all.
  // Those are the STORE's commercial decisions about their own staff,
  // each has a store-side equivalent one click away, and each affects
  // somebody who is not in the room — so refusing costs support nothing
  // and keeps the record honest about who decided.
  //
  // The READS are untouched and deliberately so: support must be able to
  // see the roster, the prices and the performance to help with a
  // question about them. The sweep covers mutating routes only, so a
  // prefix here never blinds a GET.
  {
    method: '*',
    prefix: '/store/associates',
    why: 'An associate’s price sets what every later order of theirs sells at, and the pause switch decides whether they may trade at all. Both are the store’s own commercial decisions about their staff, both outlast this session, and both are one click away on their own screen.',
  },
];

/** Methods that CHANGE something. Everything else is a read. */
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutating(method: string): boolean {
  return MUTATING.has(method.toUpperCase());
}

/**
 * Why this request is refused, or null if it is allowed.
 *
 * `mayWrite === false` refuses every mutation outright — the read-only
 * session. The named list applies on TOP of write access, so a staff
 * member holding `support.impersonate.write` still cannot reach any of
 * it.
 */
/**
 * A prefix compiled once, at module load.
 *
 * ── CASE-INSENSITIVE, AND THAT IS THE WHOLE LIST'S SAFETY ───────────
 * Express routes case-INSENSITIVELY by default (`case sensitive
 * routing` is `undefined`, and this app never sets it), while `req.path`
 * hands over whatever the caller typed. Measured on the express 5.2.1 in
 * this workspace: `POST /SELLER/api-keys` reaches the
 * `/seller/api-keys` handler with a 200.
 *
 * So a case-sensitive matcher did not weaken this list, it REMOVED it.
 * Every entry was bypassable by capitalising one letter — an API key
 * minted under the seller's name, a bank detail changed, a wallet paid
 * out — and silently, because no refusal happened and therefore no
 * `impersonation.request_refused` audit row was written either. The
 * uppercasing of the METHOD three lines down, beside a raw `path`, is
 * the asymmetry that should have been the tell.
 *
 * The sweep in `impersonation-deny-list.spec.ts` structurally cannot
 * catch this: it feeds `refusalFor` the paths it read out of the
 * controllers, which are canonical-case by construction.
 * `forbidden-while-impersonating.spec.ts` now feeds it mixed case
 * instead.
 *
 * Fixed HERE rather than by making Express case-sensitive: this
 * matcher compares a caller-controlled string against a security list
 * and must not depend on how some other layer happens to be configured
 * — and flipping the app to case-sensitive routing would start 404ing
 * requests that work today, across every endpoint in the estate, to fix
 * one matcher.
 *
 * `:name` → exactly one path segment. Everything else keeps `startsWith`
 * semantics, INCLUDING the tail: `/seller/api-keys` still refuses
 * `/seller/api-keys-something`, and that is deliberate — see
 * `forbidden-while-impersonating.spec.ts`, "prefix matching cannot be
 * fooled". For a deny list the two mistakes are not symmetrical:
 * over-refusing is a sentence on screen that somebody fixes, while
 * under-refusing is invisible and permanent.
 *
 * Worth saying because tightening the tail to a segment boundary looks
 * like a correctness fix and was tried here. It reads better and it
 * silently reopened three routes — `PATCH /seller/profile/bank-details`
 * and both `password-reset` routes were covered only by half-segment
 * matching. That spec caught it. Those three are now named in full
 * anyway, because a prefix that depends on matching half a segment is
 * one that breaks the next time somebody has this same good idea.
 */
const COMPILED: ReadonlyArray<{ readonly route: ForbiddenRoute; readonly re: RegExp }> =
  FORBIDDEN_WHILE_IMPERSONATING.map((route) => ({
    route,
    re: new RegExp(
      '^' +
        route.prefix
          .split('/')
          .map((seg) =>
            seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          )
          .join('/') +
        (route.exact === true ? '$' : ''),
      'i',
    ),
  }));

export function refusalFor(method: string, path: string, mayWrite: boolean): string | null {
  if (!isMutating(method)) return null;
  if (!mayWrite) {
    return 'This is a read-only support session. Nothing in their account can be changed from it.';
  }
  const verb = method.toUpperCase();
  const hit = COMPILED.find(
    ({ route, re }) => (route.method === '*' || route.method === verb) && re.test(path),
  );
  return hit?.route.why ?? null;
}
