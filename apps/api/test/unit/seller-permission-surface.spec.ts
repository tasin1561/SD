import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_SELLER_PERMISSION_KEYS } from '../../src/common/auth/seller-permissions';

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

function parse(file: string): { readonly isStaff: boolean; readonly handlers: readonly Handler[] } {
  const src = readFileSync(file, 'utf8');
  if (!src.includes('SellerJwtGuard')) return { isStaff: false, handlers: [] };

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
  return { isStaff: true, handlers };
}

const STAFF_HANDLERS: readonly Handler[] = controllerFiles(SRC)
  .map(parse)
  .filter((r) => r.isStaff)
  .flatMap((r) => r.handlers);

describe('seller permission surface', () => {
  it('finds the staff endpoints (guards against a parser that silently matches nothing)', () => {
    // A regex that stops matching would make every assertion below pass
    // vacuously, which is the failure mode a structural test has to rule
    // out first.
    expect(STAFF_HANDLERS.length).toBeGreaterThan(110);
  });

  it('every staff endpoint declares what it requires', () => {
    const undeclared = STAFF_HANDLERS.filter((h) => h.permissions === null).map(
      (h) => `${h.file} ${h.method} /${h.route} → ${h.name}()`,
    );
    expect(
      undeclared,
      // Jest prints the array; the message is for whoever reads the run.
    ).toEqual([]);
  });

  it('every declared permission exists in the catalogue', () => {
    const known = new Set<string>(ALL_SELLER_PERMISSION_KEYS);
    const unknown = STAFF_HANDLERS.filter(
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
    const selfService = STAFF_HANDLERS.filter((h) => h.permissions === 'self-service');
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
      STAFF_HANDLERS.filter(
        (h) => h.permissions !== null && h.permissions !== 'self-service',
      ).flatMap((h) => h.permissions as readonly string[]),
    );
    const orphaned = ALL_SELLER_PERMISSION_KEYS.filter((k) => !used.has(k));
    expect(orphaned).toEqual([]);
  });
});
