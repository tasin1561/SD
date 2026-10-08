import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_STORE_PERMISSION_KEYS,
  DEFAULT_STORE_ROLES,
  STORE_PERMISSIONS,
  type StorePermissionDef,
} from '../../src/common/auth/store-permissions';

/**
 * RS-2 — WHICH reseller-store endpoints are gated, and by what. The
 * seller and staff specs' twin for the third identity.
 *
 * `StoreJwtGuard` refuses an endpoint that declares nothing (reads AND
 * writes), so a missing declaration is a 403 at runtime — this fails the
 * build first, and pins that the store surface cannot quietly grow a
 * self-service hole. It parses source rather than booting the DI graph:
 * the question is what the code DECLARES.
 */

const SRC = join(__dirname, '../../src');

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...controllerFiles(full));
    else if (entry.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

interface Handler {
  readonly file: string;
  readonly name: string;
  readonly method: string;
  readonly route: string;
  readonly permissions: readonly string[] | 'self-service' | null;
}

const HTTP = String.raw`@(Get|Post|Patch|Put|Delete)\(`;

function parse(file: string): readonly Handler[] {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('StoreJwtGuard')) return [];
  const short = file.slice(file.lastIndexOf('/') + 1);
  const selfService = /\n@StoreSelfService\(\)/.test(src);
  const classPerms = /\n@RequireStorePermissions\(([^)]*)\)/.exec(src)?.[1];
  const out: Handler[] = [];
  for (const block of src.split(new RegExp(String.raw`\n  (?=${HTTP})`)).slice(1)) {
    const head = new RegExp(String.raw`^@(Get|Post|Patch|Put|Delete)\('?([^')]*)'?`).exec(block);
    const name = /\n {2}(?:async )?(\w+)\(/.exec(block)?.[1];
    if (head === null || name === undefined) continue;
    const own = /\n {2}@RequireStorePermissions\(([^)]*)\)/.exec(block)?.[1];
    const raw = own ?? classPerms;
    out.push({
      file: short,
      name,
      method: head[1] ?? '',
      route: head[2] ?? '',
      permissions: selfService
        ? 'self-service'
        : raw === undefined
          ? null
          : [...raw.matchAll(/'([^']+)'/g)].map((m) => m[1] ?? ''),
    });
  }
  return out;
}

const HANDLERS: readonly Handler[] = controllerFiles(SRC).flatMap(parse);

describe('store permission surface (RS-2)', () => {
  it('finds the store endpoints (guards against a parser that silently matches nothing)', () => {
    expect(HANDLERS.length).toBeGreaterThanOrEqual(15);
  });

  it('every store endpoint declares what it requires', () => {
    const undeclared = HANDLERS.filter((h) => h.permissions === null).map(
      (h) => `${h.file} ${h.method} /${h.route} → ${h.name}()`,
    );
    expect(undeclared).toEqual([]);
  });

  it('every declared permission exists in the store catalogue', () => {
    const known = new Set<string>(ALL_STORE_PERMISSION_KEYS);
    const unknown = HANDLERS.filter(
      (h) => h.permissions !== null && h.permissions !== 'self-service',
    ).flatMap((h) =>
      (h.permissions as readonly string[])
        .filter((p) => !known.has(p))
        .map((p) => `${h.file} ${h.name}() → '${p}'`),
    );
    expect(unknown).toEqual([]);
  });

  it('self-service is only the caller’s own session, credentials and inbox', () => {
    // Each entry is named WITH ITS REASON, so a third one has to be
    // argued for rather than added.
    //
    //   store-auth.controller.ts   — the caller's own session and
    //     password. A permission there would be a question the token has
    //     already answered.
    //
    //   store-notification.controller.ts (NOTIF-11, 2026-09-19) — the
    //     caller's own inbox. Same argument, plus a second: a permission
    //     has to be GRANTED, and a key added today reaches no role that
    //     already exists — so every store login in production would have
    //     seen a bell that rendered and then 403'd. Every row is
    //     addressed by the user id AND the store id on the token, and
    //     both go into the WHERE clause. The STORE-WIDE half of the same
    //     feature is a SEPARATE controller behind `store.profile.*`,
    //     because the guard short-circuits its whole permission gate on a
    //     class-level self-service marker.
    const files = [
      ...new Set(HANDLERS.filter((h) => h.permissions === 'self-service').map((h) => h.file)),
    ];
    expect(files.sort()).toEqual(['store-auth.controller.ts', 'store-notification.controller.ts']);
  });

  it('every store permission is held by at least one endpoint', () => {
    const used = new Set(
      HANDLERS.filter((h) => h.permissions !== null && h.permissions !== 'self-service').flatMap(
        (h) => h.permissions as readonly string[],
      ),
    );
    expect(ALL_STORE_PERMISSION_KEYS.filter((k) => !used.has(k))).toEqual([]);
  });

  it('every store WRITE outside auth needs a manage permission, never a view one', () => {
    // RS-4's `terms.accept` is the ONE named write key that is not a
    // `.manage`: the store cannot change terms, only agree to them, and
    // agreeing binds every later order — so it is its own permission,
    // never folded into a view one. Named here so a second exception has
    // to be argued for.
    // RS-5 adds two more, each argued for: `orders.create` places an order
    // (portal or CSV) and `orders.cancel` calls one off — both commit or
    // release the SELLER's stock and our warehouse for a customer, which
    // is a different act from managing a setting, so neither is folded
    // into a `.manage` key or a view one.
    // 2026-09-16 adds a fourth, argued for the same way: `orders.actions`
    // asks for something to be DONE about a live parcel — the customer
    // rung again, another delivery attempt, the parcel sent back. It is
    // not a setting being managed, and folding it into `orders.cancel`
    // would be wrong in both directions: calling off an unpacked order
    // costs nothing, while these reach our call centre or the courier.
    // Whether a given store may actually do it is the SELLER's policy per
    // store; this key only says who at the store may ask.
    const WRITE_KEYS_NOT_MANAGE = new Set([
      'terms.accept',
      'orders.create',
      'orders.cancel',
      'orders.actions',
    ]);
    const loose = HANDLERS.filter(
      (h) =>
        h.method !== 'Get' &&
        h.permissions !== 'self-service' &&
        h.permissions !== null &&
        !h.permissions.every((p) => p.endsWith('.manage') || WRITE_KEYS_NOT_MANAGE.has(p)),
    ).map((h) => `${h.file} ${h.method} ${h.name}()`);
    expect(loose).toEqual([]);
  });

  it('RS-4: every role can read the terms; only admin (and the owner) may accept them', () => {
    const byKey = new Map(DEFAULT_STORE_ROLES.map((r) => [r.key, r.permissions]));
    for (const key of ['admin', 'ops', 'finance', 'viewer'] as const) {
      expect(byKey.get(key)).toContain('terms.view');
    }
    expect(byKey.get('admin')).toContain('terms.accept');
    for (const key of ['ops', 'finance', 'viewer'] as const) {
      expect(byKey.get(key)).not.toContain('terms.accept');
    }
  });

  it('the six store roles, one owner, and only real keys', () => {
    // ASSOC-1 added a SIXTH fixed key. Named in full rather than counted:
    // a role is a bundle of standing permissions, and a seventh appearing
    // without anybody arguing for it is the thing this pins.
    expect(DEFAULT_STORE_ROLES.map((r) => r.key)).toEqual([
      'owner',
      'admin',
      'ops',
      'finance',
      'viewer',
      'associate',
    ]);
    expect(DEFAULT_STORE_ROLES.filter((r) => r.isOwner === true)).toHaveLength(1);
    const known = new Set<string>(ALL_STORE_PERMISSION_KEYS);
    for (const r of DEFAULT_STORE_ROLES) {
      for (const p of r.permissions) expect(known.has(p)).toBe(true);
    }
    // The narrowest login can manage nothing.
    const viewer = DEFAULT_STORE_ROLES.find((r) => r.key === 'viewer');
    expect(viewer?.permissions.some((p) => p.endsWith('.manage'))).toBe(false);
  });

  it('RS-3: every role sees the catalogue, and the catalogue is read-only to the store', () => {
    // The products a store may sell and their prices are what the whole
    // team works from, so every starting role holds catalogue.view (the
    // owner implicitly). The seller sets the terms; a store has no write.
    //
    // ASSOC-1 is the ONE exception, and it is the whole of boundary 2:
    // `catalogue.view` carries `transferPriceInr` — what the STORE pays
    // its seller — so an associate holding it could work out the spread
    // the store makes on them. They get `catalogue.sell` instead, which
    // is the same catalogue with the store's cost removed and their own
    // selling price in its place. A SECOND PERMISSION OPENING A NARROWER
    // ENDPOINT beats a filter inside the wide one: a filter is something
    // somebody has to remember on every new field.
    for (const r of DEFAULT_STORE_ROLES.filter(
      (role) => role.isOwner !== true && role.key !== 'associate',
    )) {
      expect(r.permissions).toContain('catalogue.view');
    }
    // The narrow projection is the ASSOCIATE's, and only theirs — except
    // `admin`, whose set IS `ALL_STORE_PERMISSION_KEYS` by construction,
    // so it picks up every key added anywhere. The pair that matters
    // (associate holds `sell` and NOT `view`) is asserted in the ASSOC-1
    // block below, where the reason for it is written down.
    for (const r of DEFAULT_STORE_ROLES.filter(
      (role) => role.isOwner !== true && role.key !== 'associate' && role.key !== 'admin',
    )) {
      expect(r.permissions).not.toContain('catalogue.sell');
    }
    const catalogue = HANDLERS.filter((h) => h.file === 'store-catalogue.controller.ts');
    expect(catalogue.map((h) => `${h.method} ${h.name}`)).toEqual(['Get list']);
    expect(
      catalogue.every(
        (h) => Array.isArray(h.permissions) && h.permissions.join() === 'catalogue.view',
      ),
    ).toBe(true);
  });

  it('RS-5: the order, customer and integration permissions — who holds what by default', () => {
    const byKey = new Map(DEFAULT_STORE_ROLES.map((r) => [r.key, r.permissions]));
    // Every role follows the store's orders; the viewer does nothing else.
    for (const key of ['admin', 'ops', 'finance', 'viewer'] as const) {
      expect(byKey.get(key)).toContain('orders.view');
    }
    // Placing and cancelling: the people who do the work.
    for (const key of ['admin', 'ops'] as const) {
      expect(byKey.get(key)).toContain('orders.create');
      expect(byKey.get(key)).toContain('orders.cancel');
    }
    for (const key of ['finance', 'viewer'] as const) {
      expect(byKey.get(key)).not.toContain('orders.create');
      expect(byKey.get(key)).not.toContain('orders.cancel');
    }
    // The customer list is a list of PEOPLE — not the viewer's.
    for (const key of ['admin', 'ops', 'finance'] as const) {
      expect(byKey.get(key)).toContain('customers.view');
    }
    expect(byKey.get('viewer')).not.toContain('customers.view');
    // Keys and webhooks: admin (and the owner) only.
    expect(byKey.get('admin')).toContain('integrations.manage');
    for (const key of ['ops', 'finance', 'viewer'] as const) {
      expect(byKey.get(key)).not.toContain('integrations.manage');
    }
  });

  it('RS-5: the store order surface declares exactly these gates', () => {
    const got = (file: string): string[] =>
      HANDLERS.filter((h) => h.file === file).map(
        (h) =>
          `${h.method} ${h.name} → ${Array.isArray(h.permissions) ? h.permissions.join('|') : String(h.permissions)}`,
      );
    expect(got('store-order.controller.ts')).toEqual([
      'Get list → orders.view',
      'Post create → orders.create',
      'Get get → orders.view',
      'Get events → orders.view',
      'Post cancel → orders.cancel',
      // 2026-09-17: what the store sent Seller staff to approve on it.
      'Get requests → orders.view',
    ]);
    // 2026-09-17: the store reads its own effective action policy.
    expect(got('store-action-policy.controller.ts')).toEqual(['Get get → orders.view']);
    // 2026-09-18 (owner): a store maintains its own customers' records.
    // Its OWN key, not folded into `customers.view` — seeing a phone
    // number and changing what we hold about somebody are different acts.
    expect(got('store-customer.controller.ts')).toEqual([
      'Get list → customers.view',
      'Get get → customers.view',
      'Patch update → customers.manage',
    ]);
    expect(
      got('store-order-csv-import.controller.ts').every((h) => h.endsWith('→ orders.create')),
    ).toBe(true);
    expect(
      [...got('store-api-key.controller.ts'), ...got('store-webhook.controller.ts')].every((h) =>
        h.endsWith('→ integrations.manage'),
      ),
    ).toBe(true);
  });

  it('RS-8: reports and the expense book — finance and admin by default, and the endpoints behind them', () => {
    const byKey = new Map(DEFAULT_STORE_ROLES.map((r) => [r.key, r.permissions]));
    for (const key of ['admin', 'finance'] as const) {
      expect(byKey.get(key)).toEqual(
        expect.arrayContaining(['reports.view', 'expenses.view', 'expenses.manage']),
      );
    }
    // A P&L and an expense book are not day-to-day order work.
    for (const key of ['ops', 'viewer'] as const) {
      expect(byKey.get(key)).not.toContain('reports.view');
      expect(byKey.get(key)).not.toContain('expenses.view');
      expect(byKey.get(key)).not.toContain('expenses.manage');
    }
    const got = (file: string): string[] =>
      HANDLERS.filter((h) => h.file === file).map(
        (h) =>
          `${h.method} ${h.name} → ${Array.isArray(h.permissions) ? h.permissions.join(',') : String(h.permissions)}`,
      );
    expect(got('store-reports.controller.ts').every((h) => h.endsWith('→ reports.view'))).toBe(
      true,
    );
    expect(got('store-expense.controller.ts')).toEqual([
      'Get list → expenses.view',
      'Post record → expenses.manage',
      'Post remove → expenses.manage',
    ]);
  });

  it('ASSOC-1: an associate sells, and the three things they cannot see are absent by PERMISSION', () => {
    const associate = DEFAULT_STORE_ROLES.find((r) => r.key === 'associate');
    expect(associate).toBeDefined();
    const held = associate?.permissions ?? [];

    // What is PRESENT is everything needed to sell and to look after what
    // they sold. The orders and the customers are narrowed to their own by
    // `orderScope`, NOT by withholding the permission — an associate
    // genuinely needs the order screen, just not somebody else's rows.
    expect([...held].sort()).toEqual(
      [
        'store.profile.view',
        'catalogue.sell',
        'orders.view',
        'orders.create',
        'orders.cancel',
        'orders.actions',
        'customers.view',
        'tickets.view',
        'tickets.manage',
      ].sort(),
    );

    // Each absence is about the FIELD, not about seniority:
    //   catalogue.view — carries `transferPriceInr`, the store's cost.
    //   terms.view     — the fee split and the credit timing, from which
    //                    the store's margin on them is derivable.
    //   reports.view / expenses.* / wallet.* — the store's money.
    //   associates.manage — setting other people's selling prices.
    for (const withheld of [
      'catalogue.view',
      'terms.view',
      'terms.accept',
      'reports.view',
      'expenses.view',
      'expenses.manage',
      'wallet.view',
      'wallet.topups.manage',
      'wallet.withdrawals.manage',
      'associates.manage',
      'team.view',
      'team.manage',
      'integrations.manage',
      'store.profile.manage',
      'customers.manage',
    ]) {
      expect(held).not.toContain(withheld);
    }

    // A stronger form of the same, so a permission added to the role
    // later cannot quietly be a money one: nothing the associate holds
    // is marked sensitive except the two that are unavoidably so — the
    // order list (it carries customers' delivery details) and the
    // customer list itself.
    // Read through the DECLARED interface, not the `as const` literal
    // union: `sensitive` is optional, so on the union it exists only on
    // the members that set it and the property access does not compile.
    const defs: readonly StorePermissionDef[] = STORE_PERMISSIONS;
    const sensitive = new Set(defs.filter((p) => p.sensitive === true).map((p) => p.key));
    expect(held.filter((k) => sensitive.has(k)).sort()).toEqual(
      ['customers.view', 'orders.view'].sort(),
    );
  });

  it('ASSOC-1: only the associate role is narrow, and the other five say ALL out loud', () => {
    // The migration states ALL on the five that predate associates rather
    // than leaving them to the column default (which is OWN) — defaulting
    // them would have silently narrowed every existing store login to
    // "only orders I placed myself", and since no order placed before
    // ASSOC-1 records a store user at all, that reads as every store
    // suddenly having no orders.
    for (const r of DEFAULT_STORE_ROLES) {
      if (r.key === 'associate') expect(r.orderScope).toBe('OWN');
      else expect(r.orderScope).toBeUndefined();
    }
    // And the narrow role is not ALSO the owner, which would make it wide
    // again — `storeOrderScope` is widest-wins, and `isOwner` is ALL
    // whatever the column says.
    expect(DEFAULT_STORE_ROLES.find((r) => r.key === 'associate')?.isOwner).toBeUndefined();
  });

  it('no store controller reaches for a seller or staff guard', () => {
    // A store route guarded by the wrong identity would accept the wrong
    // token. Every controller mentioning the store guard uses only it.
    const mixed = controllerFiles(SRC)
      .map((f) => ({ f, src: readFileSync(f, 'utf8') }))
      .filter(({ src }) => /@UseGuards\(StoreJwtGuard\)/.test(src))
      .filter(({ src }) => /@UseGuards\((SellerJwtGuard|StaffJwtGuard)\)/.test(src))
      .map(({ f }) => f.slice(f.lastIndexOf('/') + 1));
    expect(mixed).toEqual([]);
  });
});
