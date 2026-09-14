import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_STORE_PERMISSION_KEYS,
  DEFAULT_STORE_ROLES,
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

  it('self-service is only the caller’s own session and credentials', () => {
    const files = [
      ...new Set(HANDLERS.filter((h) => h.permissions === 'self-service').map((h) => h.file)),
    ];
    expect(files).toEqual(['store-auth.controller.ts']);
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
    const loose = HANDLERS.filter(
      (h) =>
        h.method !== 'Get' &&
        h.permissions !== 'self-service' &&
        h.permissions !== null &&
        !h.permissions.every((p) => p.endsWith('.manage')),
    ).map((h) => `${h.file} ${h.method} ${h.name}()`);
    expect(loose).toEqual([]);
  });

  it('the five RS-2 roles, one owner, and only real keys', () => {
    expect(DEFAULT_STORE_ROLES.map((r) => r.key)).toEqual([
      'owner',
      'admin',
      'ops',
      'finance',
      'viewer',
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
