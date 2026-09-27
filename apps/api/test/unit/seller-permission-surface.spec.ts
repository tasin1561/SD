import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_SELLER_PERMISSION_KEYS,
  RESERVED_SELLER_PERMISSION_KEYS,
} from '../../src/common/auth/seller-permissions';

/**
 * WHICH seller endpoints are gated, and by what. The staff spec's twin.
 *
 * The role system this replaced was fail-closed on WRITES only. Reads
 * stayed open to five of the six roles, so a company could not express
 * "may not SEE the wallet" — only "may not change it". Both directions
 * are closed by default now, and this spec is what stops an endpoint
 * being added without somebody deciding who it is for.
 *
 * It parses source rather than booting the DI graph: the question is
 * what the code DECLARES, and source is the honest thing to read for
 * that.
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

function parse(file: string): {
  readonly isSeller: boolean;
  readonly handlers: readonly Handler[];
} {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('SellerJwtGuard')) return { isSeller: false, handlers: [] };

  const short = file.slice(file.lastIndexOf('/') + 1);
  const selfService = /\n@SellerSelfService\(\)/.test(src);
  const classPerms = /\n@RequireSellerPermissions\(([^)]*)\)/.exec(src)?.[1];

  const handlers: Handler[] = [];
  const blocks = src.split(new RegExp(String.raw`\n  (?=${HTTP})`)).slice(1);
  for (const block of blocks) {
    const head = new RegExp(String.raw`^@(Get|Post|Patch|Put|Delete)\('?([^')]*)'?`).exec(block);
    const name = /\n {2}(?:async )?(\w+)\(/.exec(block)?.[1];
    if (head === null || name === undefined) continue;

    const own = /\n {2}@RequireSellerPermissions\(([^)]*)\)/.exec(block)?.[1];
    const raw = own ?? classPerms;
    handlers.push({
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
  return { isSeller: true, handlers };
}

const SELLER_HANDLERS: readonly Handler[] = controllerFiles(SRC)
  .map(parse)
  .filter((r) => r.isSeller)
  .flatMap((r) => r.handlers);

describe('seller permission surface', () => {
  it('finds the seller endpoints (guards against a parser that silently matches nothing)', () => {
    // A regex that stops matching would make every assertion below pass
    // vacuously, which is the failure mode a structural test has to rule
    // out first.
    expect(SELLER_HANDLERS.length).toBeGreaterThan(110);
  });

  it('every seller endpoint declares what it requires', () => {
    const undeclared = SELLER_HANDLERS.filter((h) => h.permissions === null).map(
      (h) => `${h.file} ${h.method} /${h.route} → ${h.name}()`,
    );
    expect(
      undeclared,
      // Jest prints the array; the message is for whoever reads the run.
    ).toEqual([]);
  });

  it('every declared permission exists in the catalogue', () => {
    const known = new Set<string>(ALL_SELLER_PERMISSION_KEYS);
    const unknown = SELLER_HANDLERS.filter(
      (h) => h.permissions !== null && h.permissions !== 'self-service',
    ).flatMap((h) =>
      (h.permissions as readonly string[])
        .filter((p) => !known.has(p))
        .map((p) => `${h.file} ${h.name}() → '${p}'`),
    );
    expect(unknown).toEqual([]);
  });

  it('self-service is the narrow exception it is meant to be', () => {
    // Only the endpoints about the caller themselves — signing in and
    // out, their own password, their own identity. If this number grows,
    // something that needs a permission was given a pass instead.
    const selfService = SELLER_HANDLERS.filter((h) => h.permissions === 'self-service');
    const files = [...new Set(selfService.map((h) => h.file))].sort();
    expect(files).toEqual(
      [
        // Signing in and out, their own password, their own identity.
        'seller-auth.controller.ts',
        // Their own inbox and their own notification choices, scoped
        // to the user id on their token and never to one in the
        // request. Opened as self-service rather than as a permission
        // for the same reason the staff side was: a permission is a
        // thing somebody has to GRANT, and a key added today reaches
        // no existing role, so every ops / finance / viewer login in
        // production would have had a bell that rendered and refused.
        'seller-notification.controller.ts',
      ].sort(),
    );
  });

  it('the dangerous permissions are each held by at least one endpoint', () => {
    // A permission nothing checks is a checkbox that does nothing, which
    // is worse than an absent one: it reads as a control.
    const used = new Set(
      SELLER_HANDLERS.filter(
        (h) => h.permissions !== null && h.permissions !== 'self-service',
      ).flatMap((h) => h.permissions as readonly string[]),
    );
    // RESERVED keys (RS-2 registers later phases' reseller keys) are the
    // one named exception, and the next test pins that they stay unused.
    const reserved = new Set(RESERVED_SELLER_PERMISSION_KEYS);
    const orphaned = ALL_SELLER_PERMISSION_KEYS.filter((k) => !used.has(k) && !reserved.has(k));
    expect(orphaned).toEqual([]);
  });

  it('no seller WRITE is gated only on a `.view` permission', () => {
    // The staff spec's twin, and the same reason: a key whose label says
    // "See the catalogue" or "See what an order cost" must not also mean
    // "change it". See that file for why the rule is "not a `.view` key"
    // rather than the store spec's "must be a `.manage` key".
    //
    // Exceptions are named WITH THEIR REASON, so a second has to be
    // argued for.
    //
    //   seller-invoice.controller.ts generate → charges.view
    //     It mints an invoice NUMBER from a per-financial-year sequence,
    //     so it is a real write; the cost of misuse is a burned number on
    //     the seller's own books. Left on the read key deliberately,
    //     because every alternative locks somebody out at every company
    //     that already exists: `orders.create` excludes FINANCE, which is
    //     the role most likely to want an invoice, and a new
    //     `charges.manage` would reach NO seeded role at all — the six
    //     defaults were written into the database by migration with
    //     explicit key lists, so a key added today reaches only the owner
    //     (who holds the catalogue implicitly). Reading an order's charges
    //     and producing the invoice for them is one act to a seller, the
    //     call is idempotent per order, and it is scoped to their own
    //     order inside the service.
    const VIEW_GATED_WRITES = new Set(['seller-invoice.controller.ts generate']);

    const loose = SELLER_HANDLERS.filter(
      (h) =>
        h.method !== 'Get' &&
        h.permissions !== 'self-service' &&
        h.permissions !== null &&
        h.permissions.length > 0 &&
        !VIEW_GATED_WRITES.has(`${h.file} ${h.name}`) &&
        h.permissions.every((p) => p.endsWith('.view')),
    ).map((h) => `${h.file} ${h.method} ${h.name}() → ${(h.permissions as string[]).join('|')}`);
    expect(loose).toEqual([]);
  });

  it('a reserved permission is declared by no endpoint (drop the flag when one arrives)', () => {
    const reserved = new Set(RESERVED_SELLER_PERMISSION_KEYS);
    const declaring = SELLER_HANDLERS.filter(
      (h) => h.permissions !== null && h.permissions !== 'self-service',
    ).flatMap((h) =>
      (h.permissions as readonly string[])
        .filter((p) => reserved.has(p))
        .map((p) => `${h.file} ${h.name}() → '${p}'`),
    );
    expect(declaring).toEqual([]);
    // Pinned by name, so a key cannot be quietly reserved to dodge the
    // orphan check above.
    // Nothing is reserved any more: `stores.pricing` gained endpoints with RS-3,
    // `reseller.credit_after_confirmation.enable` with RS-4, `stores.wallet` with RS-6.
    expect([...reserved].sort()).toEqual([]);
  });
});
