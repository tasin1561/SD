import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SELLER_ROLES } from '../../src/common/auth/seller-permissions';

/**
 * WHICH permission each seller GET requires — read off the decorators the
 * guard actually consults.
 *
 * ── WHY THIS EXISTS, AND WHY IT LOOKS LIKE THIS ──────────────────────
 * It replaces `seller-viewer-read-surface.spec.ts`, which pinned the
 * placement of `@SellerViewerReadable` / `@SellerRoles` — decorators
 * `SellerJwtGuard` stopped reading when RBAC-1 moved to permissions, and
 * which have now been deleted. That spec did not merely go stale: its
 * last assertion searched a 700-character window for the string
 * `@SellerRoles`, and the only occurrence left in the file was inside the
 * 16-line COMMENT explaining why `customer-lookup` must be narrowed. So
 * it passed, in green, over an endpoint whose gate had been deleted —
 * `customer-lookup` fell through to the class's `orders.view`, which the
 * `viewer` role holds, and every seller login on the platform could pull
 * platform-wide order counts for any phone number.
 *
 * Two lessons are encoded here. **Assert on what the mechanism reads** —
 * the permission, not a decorator name that may no longer be wired to
 * anything. And **strip comments before parsing source**, because prose
 * about a rule reads exactly like the rule to a regex; the old file's own
 * `getPaths()` stripped them for route counting and the one assertion
 * that mattered did not.
 *
 * The failure mode it guards is SILENT: a new GET on a controller with a
 * broad class-level key joins that key's surface by inheritance, and
 * nobody decides. So every GET is listed BY NAME with the key it ends up
 * behind. Adding one fails here until somebody writes it down, which is
 * the point — the decision should cost a line in this file, not nothing.
 */

const MODULES = join(__dirname, '../../src/modules');

/** Source with comments removed — prose must never read as a decorator. */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

interface SellerGet {
  readonly file: string;
  readonly route: string;
  readonly permissions: readonly string[] | 'self-service';
}

function everySellerController(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  for (const mod of readdirSync(MODULES, { withFileTypes: true })) {
    if (!mod.isDirectory()) continue;
    for (const dir of [join(MODULES, mod.name, 'controllers'), join(MODULES, mod.name)]) {
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        if (!n.endsWith('.controller.ts')) continue;
        const src = readFileSync(join(dir, n), 'utf8');
        if (!src.includes('SellerJwtGuard')) continue;
        if (out.some((c) => c.file === n)) continue;
        out.push({ file: n, src });
      }
    }
  }
  return out;
}

/** Every `@Get` on a seller controller, with the key it resolves to. */
function sellerGets(): readonly SellerGet[] {
  const out: SellerGet[] = [];
  for (const { file, src } of everySellerController()) {
    const code = codeOf(src);
    const selfService = /@SellerSelfService\(\)/.test(code);
    const classKeys = /\n@RequireSellerPermissions\(([^)]*)\)/.exec(code)?.[1];
    // Split on the indented decorator that opens each handler, exactly
    // as the permission-surface specs do.
    for (const block of code.split(/\n {2}(?=@(?:Get|Post|Patch|Put|Delete)\()/).slice(1)) {
      const head = /^@Get\('?([^')]*)'?\)/.exec(block);
      if (head === null) continue;
      const own = /\n {2}@RequireSellerPermissions\(([^)]*)\)/.exec(block)?.[1];
      const raw = own ?? classKeys;
      out.push({
        file,
        route: head[1] ?? '',
        permissions: selfService
          ? 'self-service'
          : raw === undefined
            ? []
            : [...raw.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? ''),
      });
    }
  }
  return out;
}

/**
 * Every GET on a seller controller whose CLASS declares a broad key, and
 * the key that GET actually ends up behind.
 *
 * Only the controllers gated on `orders.view` are enumerated: that key is
 * the one the narrowest seeded role holds, so an endpoint inheriting it
 * is reachable by every seller login there is, which makes inheritance
 * there the expensive kind of accident.
 */
const ORDERS_VIEW_GETS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'seller-order.controller.ts': {
    '': 'orders.view',
    ':id': 'orders.view',
    ':id/events': 'orders.view',
    summary: 'orders.view',
    'money-in-flight': 'orders.view',
    // NOT orders.view. The counts inside span EVERY seller on the
    // platform, for any phone number the caller types — a lookup TOOL,
    // not a view of their own orders. `orders.create` reproduces the
    // owner / admin / ops surface it has always been meant to have, and
    // names the act it is for: deciding whether to accept an order.
    'customer-lookup': 'orders.create',
  },
  // The same order, told as a story — a strict re-presentation of what
  // `:id` and `:id/events` already return.
  'seller-order-journey.controller.ts': { ':id/journey': 'orders.view' },
  // Where those same parcels are.
  'seller-tracking.controller.ts': { '': 'orders.view', ':shipmentId': 'orders.view' },
  // Their own orders stuck out for delivery — a filtered view of the list.
  'seller-nsa.controller.ts': { '': 'orders.view' },
  // The names of their own company's shopfronts, which the order list
  // filters by. Every WRITE here declares profile.manage at the handler.
  'seller-store.controller.ts': { '': 'orders.view' },
  // All per-order and scoped by the order's own seller: what the call
  // centre did, and what has been asked about a live parcel. Each is part
  // of the order this key already opens.
  'seller-delivery-action.controller.ts': {
    ':orderId/call-history': 'orders.view',
    ':orderId/delivery-actions': 'orders.view',
  },
  'seller-reattempt.controller.ts': { ':orderId/reattempt-requests': 'orders.view' },
  // `seller-reseller-order-money.controller.ts` is DELIBERATELY ABSENT.
  // It was in this table on `orders.view`, under a sentence calling the
  // money on a reseller order "part of the order this key already
  // opens". It is not: it is the transfer price the store pays and the
  // fee split — the company's margin — and `orders.view` is the ONE key
  // `viewer` holds. It is `stores.order_money.view` now, so it leaves
  // this table entirely; the assertion below stops it coming back.
  'seller-shipment-address.controller.ts': {
    ':orderId/consignee': 'orders.view',
    ':orderId/consignee/history': 'orders.view',
  },
  // The fee this company would be charged — its own number, which the
  // order form shows before anything is placed.
  'seller-order-defaults.controller.ts': { 'customer-delivery-fee': 'orders.view' },
  // What OUR three flat fees cost this company: the delivery fee and the
  // two return fees, priced in rupees now. Their own numbers, resolved
  // through SET-1, and they disclose nothing about another tenant.
  //
  // Deliberately NOT `wallet.view`, which is where a money figure would
  // otherwise sit: the callers are the two return dialogs on an ORDER,
  // and the Operations role holds `orders.cancel` without ever holding
  // `wallet.view` — so gating it on the wallet would have shown the role
  // that actually returns parcels a dialog whose fee was a dash.
  'seller-pricing.controller.ts': { fees: 'orders.view' },
  // Whether a pincode is serviceable. Courier data rather than any
  // seller's, so it discloses nothing about another tenant — but note it
  // spends a live courier lookup, which is the reason to look here again
  // if the rate budget ever becomes the constraint.
  'seller-serviceability.controller.ts': { '': 'orders.view' },
};

describe('the seller GET surface', () => {
  const gets = sellerGets();

  it('finds the seller GETs (a parser matching nothing would pass everything)', () => {
    expect(gets.length).toBeGreaterThan(40);
  });

  it('every seller GET declares a permission, or is self-service', () => {
    const undeclared = gets
      .filter((g) => g.permissions !== 'self-service' && g.permissions.length === 0)
      .map((g) => `${g.file} GET /${g.route}`);
    expect(undeclared).toEqual([]);
  });

  it('the controllers gated on orders.view are exactly the ones listed here', () => {
    const found = [
      ...new Set(
        gets
          .filter((g) => g.permissions !== 'self-service' && g.permissions.includes('orders.view'))
          .map((g) => g.file),
      ),
    ].sort();
    expect(found).toEqual(Object.keys(ORDERS_VIEW_GETS).sort());
  });

  /**
   * The disclosure that was behind `orders.view` and should never have
   * been. Asserted as its own test rather than left to the table above,
   * because leaving the table is what "fixed" looks like here — and an
   * absence proves nothing on its own.
   */
  it('a reseller order’s money is NOT behind orders.view', () => {
    const money = gets.filter((g) => g.file === 'seller-reseller-order-money.controller.ts');
    // A parser that stopped finding the file would make this vacuous.
    expect(money.length).toBeGreaterThan(0);
    for (const g of money) {
      expect(g.permissions).toEqual(['stores.order_money.view']);
    }
  });

  it('each of those controllers opens exactly the GETs listed, behind the key named', () => {
    for (const [file, expected] of Object.entries(ORDERS_VIEW_GETS)) {
      const own = gets.filter((g) => g.file === file);
      expect(own.length).toBeGreaterThan(0);
      const actual: Record<string, string> = {};
      for (const g of own) {
        actual[g.route] =
          g.permissions === 'self-service' ? 'self-service' : g.permissions.join('|');
      }
      expect(actual).toEqual(expected);
    }
  });

  it('customer-lookup is NOT reachable by the narrowest seeded role', () => {
    // The assertion the old spec was trying to make, stated against the
    // thing that decides it: the role's grants. `viewer` holds exactly
    // `orders.view`, so any key but that one closes this endpoint to it.
    const key = ORDERS_VIEW_GETS['seller-order.controller.ts']?.['customer-lookup'];
    expect(key).toBeDefined();
    const viewer = DEFAULT_SELLER_ROLES.find((r) => r.key === 'viewer');
    expect(viewer?.permissions).toEqual(['orders.view']);
    expect(viewer?.permissions).not.toContain(key);

    // And it IS reachable by the three roles the deleted
    // `@SellerRoles(OWNER, ADMIN, OPS)` named — owner holds everything
    // implicitly, so it carries no permission rows to check.
    expect(DEFAULT_SELLER_ROLES.find((r) => r.key === 'owner')?.isOwner).toBe(true);
    for (const role of ['admin', 'ops'] as const) {
      expect(DEFAULT_SELLER_ROLES.find((r) => r.key === role)?.permissions).toContain(key);
    }
    for (const role of ['inventory', 'finance'] as const) {
      expect(DEFAULT_SELLER_ROLES.find((r) => r.key === role)?.permissions).not.toContain(key);
    }
  });

  it('no seller controller still reaches for a decorator the guard does not read', () => {
    // `@SellerRoles` and `@SellerViewerReadable` were deleted with the
    // role model. A file reintroducing one would compile (they are just
    // SetMetadata) and enforce nothing — the exact shape that lost
    // customer-lookup its gate.
    const zombies = everySellerController()
      .filter(({ src }) => /@SellerRoles\(|@SellerViewerReadable\(/.test(codeOf(src)))
      .map(({ file }) => file);
    expect(zombies).toEqual([]);
  });
});
