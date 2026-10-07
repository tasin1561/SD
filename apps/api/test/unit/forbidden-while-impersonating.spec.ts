import {
  FORBIDDEN_WHILE_IMPERSONATING,
  isMutating,
  refusalFor,
} from '../../src/common/impersonation/forbidden-while-impersonating';

/**
 * The deny list is the security boundary, so it is tested hardest.
 *
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────
 * Everything else about support impersonation is recoverable. A session
 * that reads too much leaves a trail somebody can follow afterwards. The
 * two things on this list are the ones an audit row cannot undo: access
 * that outlives the session, and money that has already moved. If
 * `refusalFor` returns null once where it should have returned a
 * sentence, a staff member creates an API key under a seller's name and
 * nothing afterwards can tell it from one the seller made.
 *
 * ── WHY IT ITERATES THE EXPORTED LIST ────────────────────────────────
 * Hardcoding the paths here would mean a new entry arrives untested, and
 * — far worse — a DELETED entry leaves a green suite behind it. Walking
 * `FORBIDDEN_WHILE_IMPERSONATING` makes the test fail the moment the
 * list shrinks, which is the direction that actually hurts.
 *
 * ── WHAT IS DELIBERATELY NOT TESTED HERE ─────────────────────────────
 * Whether each prefix matches a route that really exists. That is a
 * question about the rest of the codebase, not about this function, and
 * it belongs in the deny-list coverage spec. This file only holds
 * `refusalFor` to the contract it states.
 */

/** Every method the interface admits as mutating. */
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Methods that only ever read, and so are never the list's business. */
const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

/**
 * Ordinary seller and store work. None of this is on the list, and all
 * of it is the reason a write session exists at all — if a support
 * session cannot fix an address or re-place an order, it is a read-only
 * session wearing a different name.
 */
const EVERYDAY_PATHS = [
  '/seller/orders',
  '/seller/orders/0190d4d9-1f21-7a3b-8c4e-6b9e2a1d7f55/charges',
  '/seller/products',
  '/seller/addresses',
  '/seller/stock',
  '/store/orders',
  '/store/customers',
];

describe('refusalFor: what a support session may never do', () => {
  it('the list is not empty — an empty deny list is a disabled boundary', () => {
    // A refactor that left this at [] would make every test below pass
    // trivially while the feature protected nothing.
    expect(FORBIDDEN_WHILE_IMPERSONATING.length).toBeGreaterThan(0);
  });

  describe('reads are always allowed', () => {
    // Looking is the whole point of a support session. If a GET were
    // ever refused, the read-only session — the one we want staff to
    // reach for first — would be useless and they would ask for write.
    const everyPath = [...EVERYDAY_PATHS, ...FORBIDDEN_WHILE_IMPERSONATING.map((r) => r.prefix)];

    for (const method of READ_METHODS) {
      for (const path of everyPath) {
        it(`${method} ${path} is allowed in a write session`, () => {
          expect(refusalFor(method, path, true)).toBeNull();
        });

        it(`${method} ${path} is allowed in a read-only session`, () => {
          expect(refusalFor(method, path, false)).toBeNull();
        });
      }
    }

    it('isMutating agrees: read methods are not mutations', () => {
      for (const method of READ_METHODS) {
        expect(isMutating(method)).toBe(false);
      }
    });
  });

  describe('a read-only session refuses every mutation', () => {
    // `mayWrite: false` is the default on the session row, so this is
    // the branch most sessions take. It has to refuse on the METHOD
    // alone: a read-only session that only consulted the named list
    // would happily let a staff member edit an order.
    for (const method of MUTATING) {
      for (const path of EVERYDAY_PATHS) {
        it(`${method} ${path} is refused`, () => {
          const refusal = refusalFor(method, path, false);
          expect(refusal).not.toBeNull();
          expect(refusal).toContain('read-only');
        });
      }
    }

    it('isMutating agrees: every mutating method is a mutation', () => {
      for (const method of MUTATING) {
        expect(isMutating(method)).toBe(true);
      }
    });

    it('the method is matched case-insensitively', () => {
      // Node hands the guard whatever the client sent. A lowercase
      // `post` that slipped past `isMutating` would be a mutation the
      // read-only session never saw.
      expect(refusalFor('post', '/seller/orders', false)).not.toBeNull();
      expect(refusalFor('delete', '/seller/orders', false)).not.toBeNull();
    });
  });

  describe('the named list applies ON TOP of write access', () => {
    // This is the part that cannot be got wrong. `support.impersonate
    // .write` is a permission a staff member may legitimately hold, and
    // it must not be read as "may do anything the seller could do".
    for (const route of FORBIDDEN_WHILE_IMPERSONATING) {
      const methods = route.method === '*' ? MUTATING : [route.method];

      for (const method of methods) {
        it(`${method} ${route.prefix} is still refused with mayWrite: true`, () => {
          expect(refusalFor(method, route.prefix, true)).toBe(route.why);
        });

        const below = `${route.prefix}/0190d4d9-1f21-7a3b-8c4e-6b9e2a1d7f55`;

        if (route.exact === true) {
          it(`${method} ${route.prefix} does NOT refuse paths below it, which is what exact means`, () => {
            // ONE entry carries `exact`, and the shape is worth naming
            // because a deny list meets it whenever a collection is
            // dangerous and its members are not: creating a reseller
            // store mails somebody standing access, while
            // `PUT /seller/reseller-stores/:id/catalogue/:variantId` is
            // an ordinary price edit — and the thing a support session
            // is most often needed for in that subtree. As a prefix the
            // first swallowed the second.
            //
            // The safety of this does not rest on the entry being
            // narrow: `impersonation-deny-list.spec.ts` sweeps every
            // route below it, so each one is either on the deny list or
            // named as safe. That sweep is what makes `exact` something
            // other than a hole.
            expect(refusalFor(method, below, true)).toBeNull();
          });
          continue;
        }

        it(`${method} ${route.prefix} is refused for paths BELOW the prefix too`, () => {
          // The list names a prefix, not an exact path. A sub-resource
          // under a forbidden prefix is at least as dangerous as the
          // collection — `DELETE /seller/api-keys/:id` is not safer
          // than `POST /seller/api-keys`.
          expect(refusalFor(method, below, true)).toBe(route.why);
        });
      }
    }
  });

  describe('ordinary seller and store work is allowed with write access', () => {
    // The flip side of the test above. A deny list that refused
    // everything would be safe and worthless; this is what makes the
    // feature worth having.
    for (const method of MUTATING) {
      for (const path of EVERYDAY_PATHS) {
        it(`${method} ${path} is allowed`, () => {
          expect(refusalFor(method, path, true)).toBeNull();
        });
      }
    }

    it('POST /seller/orders — the canonical support action — is allowed', () => {
      expect(refusalFor('POST', '/seller/orders', true)).toBeNull();
    });
  });

  describe('a refusal is a sentence a person can read', () => {
    /*
      The refusal is shown to the staff member and written into the
      audit row. A code like `ERR_IMPERSONATION_FORBIDDEN` tells the
      person at the keyboard nothing about why the platform is saying
      no, so they raise a ticket asking, and tells a reviewer six months
      later nothing about what was being protected. Every string on this
      path has to stand on its own as an explanation.
    */
    const everyRefusal = [
      ...FORBIDDEN_WHILE_IMPERSONATING.map((r) => r.why),
      // The read-only message takes a different branch and is the one
      // most sessions ever see, so it is held to the same bar.
      refusalFor('POST', '/seller/orders', false)!,
    ];

    for (const why of everyRefusal) {
      it(`"${why.slice(0, 48)}…" is a non-empty sentence ending in a full stop`, () => {
        expect(why.trim().length).toBeGreaterThan(0);
        expect(why.trim().endsWith('.')).toBe(true);
      });

      it(`"${why.slice(0, 48)}…" reads as prose, not as a code`, () => {
        // Several words, and no SCREAMING_SNAKE identifier standing in
        // for an explanation.
        expect(why.trim().split(/\s+/).length).toBeGreaterThanOrEqual(5);
        expect(why).not.toMatch(/[A-Z]{3,}_[A-Z]/);
      });
    }
  });

  describe('prefix matching cannot be fooled', () => {
    /*
      ── WHAT IS CORRECT FOR `/seller/api-keys-something` ──────────────

      `startsWith` means a sibling route whose name merely BEGINS with a
      forbidden prefix is also refused. We assert that it IS refused,
      because for a security boundary the two possible mistakes are not
      equally bad:

        - Over-refusing is visible and harmless. A staff member sees a
          sentence explaining why, and somebody fixes the prefix.
        - Under-refusing is invisible and permanent. An API key created
          under a seller's name cannot be distinguished afterwards from
          one they made, which is the exact failure the list exists to
          prevent.

      So the safe reading of an ambiguous path is "refused", and that is
      what this function does. If a real route ever needs to live at
      `/seller/api-keys-something` and be writable, the fix is a more
      precise prefix in the list, not a looser matcher here.
    */
    it('/seller/api-keys-something is refused, erring towards safety', () => {
      expect(refusalFor('POST', '/seller/api-keys-something', true)).not.toBeNull();
    });

    it('a path that merely CONTAINS a forbidden prefix is not refused', () => {
      // The other direction: matching anywhere in the string would make
      // the list unpredictable, and `/seller/orders/.../seller/api-keys`
      // is not a route anybody has. Anchoring at the start is right.
      expect(refusalFor('POST', '/seller/orders/export?to=/seller/api-keys', true)).toBeNull();
    });

    it('an unrelated path that shares a leading segment is allowed', () => {
      // `/seller/teams-overview` is not `/seller/team`, but it starts
      // with it, so it is refused — same trade as above. Its NEIGHBOUR
      // one level up must stay allowed, or the list would swallow the
      // whole `/seller` namespace.
      expect(refusalFor('POST', '/seller/templates', true)).toBeNull();
    });

    it('matching is anchored, so the empty-prefix catastrophe cannot happen', () => {
      // A '' prefix would make `startsWith` true for every path and
      // silently turn every write session into a read-only one.
      for (const route of FORBIDDEN_WHILE_IMPERSONATING) {
        expect(route.prefix.startsWith('/')).toBe(true);
        expect(route.prefix.length).toBeGreaterThan(1);
      }
    });
  });

  describe('the list is well formed', () => {
    it('every entry names a method the interface admits', () => {
      for (const route of FORBIDDEN_WHILE_IMPERSONATING) {
        expect(['*', ...MUTATING]).toContain(route.method);
      }
    });

    it('no two entries claim the same method and prefix', () => {
      // A duplicate means two different `why` strings for one route and
      // only the first is ever shown — so one of them is a reason
      // nobody will ever read.
      const seen = FORBIDDEN_WHILE_IMPERSONATING.map((r) => `${r.method} ${r.prefix}`);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('no entry is shadowed by a shorter prefix with a different reason', () => {
      /*
        `find` returns the FIRST match, so if `/seller/profile` sat
        above `/seller/profile/bank` the bank entry's reason would never
        be shown and the list would lie about what it protects.
      */
      for (const [i, route] of FORBIDDEN_WHILE_IMPERSONATING.entries()) {
        const shadower = FORBIDDEN_WHILE_IMPERSONATING.slice(0, i).find(
          (earlier) =>
            (earlier.method === '*' || earlier.method === route.method) &&
            route.prefix.startsWith(earlier.prefix) &&
            earlier.why !== route.why,
        );
        expect(shadower).toBeUndefined();
      }
    });
  });
});
