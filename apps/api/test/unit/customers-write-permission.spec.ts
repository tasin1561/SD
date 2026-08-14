import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SELLER_PERMISSIONS,
  DEFAULT_SELLER_ROLES,
  type SellerPermissionKey,
} from '../../src/common/auth/seller-permissions';

/**
 * A read permission must not guard a write.
 *
 * `PATCH /seller/customers/:id` and `DELETE /seller/customers/:id` were
 * both gated on `customers.view`. The effect was not that the endpoints
 * were unguarded — it was that a company could not EXPRESS the
 * distinction: the only way to stop a teammate renaming and removing
 * customer records was to stop them seeing the customer list at all.
 *
 * It survived because the class-level decorator already supplied
 * `customers.view`, so the two handler-level repeats read as deliberate
 * rather than as a write permission somebody forgot to add. The guard is
 * fail-closed on an endpoint that declares NOTHING (rule 4), but it
 * cannot tell that a declared permission is the wrong one.
 *
 * These read the controller source rather than exercising the guard,
 * because the defect is in what the decorator NAMES. A behavioural test
 * against a token holding both permissions passes either way.
 */

const CONTROLLER = readFileSync(
  join(__dirname, '../../src/modules/order/controllers/seller-customer.controller.ts'),
  'utf8',
);

/** The decorators attached to one HTTP handler in a controller source. */
function handlerBlock(src: string, decorator: string): string {
  const at = src.indexOf(decorator);
  if (at === -1) throw new Error(`handler ${decorator} not found`);
  // Up to the start of the method body is where the decorators live.
  return src.slice(at, src.indexOf('{', src.indexOf('(', src.indexOf(')', at))));
}

describe('customers: the write is a separate permission from the read', () => {
  it('the catalogue declares customers.manage', () => {
    const keys = SELLER_PERMISSIONS.map((p) => p.key);
    expect(keys).toContain('customers.manage');
    expect(keys).toContain('customers.view');
  });

  it('it is marked sensitive, like the read it was split from', () => {
    const perm = SELLER_PERMISSIONS.find((p) => p.key === 'customers.manage');
    expect(perm?.sensitive).toBe(true);
  });

  it.each([
    ['@Patch', "@RequireSellerPermissions('customers.manage')"],
    ['@Delete', "@RequireSellerPermissions('customers.manage')"],
  ])('%s requires the WRITE permission, not the read', (verb, expected) => {
    const block = handlerBlock(CONTROLLER, `${verb}(':id')`);
    expect(block).toContain(expected);
    // The specific regression: naming the read permission on a write.
    expect(block).not.toContain("@RequireSellerPermissions('customers.view')");
  });

  it('the reads still ask only for customers.view', () => {
    // Splitting the write must not quietly raise the bar on looking.
    const get = handlerBlock(CONTROLLER, "@Get(':id')");
    expect(get).not.toContain('customers.manage');
    expect(CONTROLLER).toContain("@RequireSellerPermissions('customers.view')");
  });
});

describe('who holds it out of the box', () => {
  const holders = DEFAULT_SELLER_ROLES.filter(
    (r) => r.isOwner !== true && r.permissions.includes('customers.manage' as SellerPermissionKey),
  ).map((r) => r.key);

  it('goes to the roles that could already do it — admin and ops', () => {
    // Not a tightening for anyone who has it today. `admin` is computed
    // as every key except roles.manage, so it picks this up on its own.
    expect(holders).toContain('ops');
    const admin = DEFAULT_SELLER_ROLES.find((r) => r.key === 'admin');
    expect(admin?.permissions).toContain('customers.manage');
  });

  it('does NOT go to viewer, inventory or finance', () => {
    // None of them holds customers.view either, so granting the write
    // would hand out an ability whose object they cannot even see.
    for (const key of ['viewer', 'inventory', 'finance']) {
      const role = DEFAULT_SELLER_ROLES.find((r) => r.key === key);
      expect(role?.permissions ?? []).not.toContain('customers.manage');
    }
  });

  it('every role granted the write can also read', () => {
    // A role able to edit a record it cannot open is a broken screen.
    for (const role of DEFAULT_SELLER_ROLES) {
      if (role.isOwner === true) continue;
      if (!role.permissions.includes('customers.manage' as SellerPermissionKey)) continue;
      expect(role.permissions).toContain('customers.view');
    }
  });
});

describe('the backfill exists, because the guard is fail-closed', () => {
  const raw = readFileSync(
    join(
      __dirname,
      '../../../../packages/db/prisma/migrations/20260813200000_customers_manage_permission/migration.sql',
    ),
    'utf8',
  );

  /**
   * The STATEMENT, with the explanation stripped.
   *
   * This mattered immediately: the comment says why ON CONFLICT is the
   * wrong tool here, and asserting against the whole file made that
   * sentence indistinguishable from the clause it warns about. Every
   * other assertion below had the same flaw — they would have passed on
   * a migration that only TALKED about granting the permission.
   */
  const migration = raw
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n');

  it('grants the new permission to existing roles', () => {
    // Without it the permission would exist and nobody would hold it —
    // every seller loses customer editing at the moment of deploy.
    expect(migration).toContain('customers.manage');
    expect(migration).toContain("permission = 'customers.view'");
  });

  it('only to roles that already held some other write', () => {
    // A role with customers.view and no write at all is one somebody
    // built to be read-only. It does not get the write back — that is
    // the hole this closes.
    expect(migration).toContain('orders.create');
    expect(migration).toContain('catalog.manage');
  });

  it('skips the owner role, which grants everything implicitly', () => {
    expect(migration).toContain('is_owner = FALSE');
  });

  it('guards with NOT EXISTS rather than ON CONFLICT', () => {
    // The unique key includes the nullable `scope`, and Postgres treats
    // NULLs as distinct — ON CONFLICT would not fire for these rows.
    expect(migration).toContain('NOT EXISTS');
    expect(migration).not.toContain('ON CONFLICT');
  });
});
