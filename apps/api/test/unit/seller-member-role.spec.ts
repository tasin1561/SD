import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SELLER_ROLES, SELLER_PERMISSIONS } from '../../src/common/auth/seller-permissions';

/**
 * The Member role means the same thing to a seller who signed up last
 * year and one who signs up tomorrow.
 *
 * ── WHY THIS TEST EXISTS ─────────────────────────────────────────────
 * The set lives in TypeScript, where `provisionDefaultSellerRoles` reads
 * it for every NEW company. Existing companies got theirs from
 * `20261007120000_seller_member_role`, which is SQL and cannot import
 * it. Two copies of one fact, in two languages, and nothing in the
 * compiler to notice when they stop agreeing.
 *
 * So this compares them in BOTH DIRECTIONS. One direction alone is a
 * trap: checking only that the SQL is a subset passes happily when the
 * TypeScript grows a permission the migration never granted, and every
 * seller who existed before October quietly holds a narrower Member than
 * everybody else — a difference nobody would find except by two people
 * comparing screens.
 */
const MIGRATION = join(
  __dirname,
  '../../../../packages/db/prisma/migrations/20261007120000_seller_member_role/migration.sql',
);

function keysInMigration(): readonly string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const block = /CROSS JOIN \(VALUES([\s\S]*?)\) AS p/.exec(sql);
  // A null here means the migration was renamed or restructured and
  // this guard is watching nothing — louder than a silent pass.
  expect(block).not.toBeNull();
  return [...(block?.[1] ?? '').matchAll(/\('([a-z_.]+)'\)/g)].map((m) => m[1] as string).sort();
}

function keysInCode(): readonly string[] {
  const member = DEFAULT_SELLER_ROLES.find((r) => r.key === 'member');
  // Undefined means the preset was removed or renamed; the comparisons
  // below would then both read empty and agree with each other.
  expect(member).toBeDefined();
  return [...(member?.permissions ?? [])].sort();
}

describe('the seller Member role', () => {
  it('grants the same set in the migration and in the code', () => {
    expect(keysInMigration()).toEqual(keysInCode());
  });

  it('grants only permissions that exist', () => {
    // Typed as strings on purpose: the point is to catch a key that is
    // NOT in the union, which a narrowly-typed Set would refuse to be
    // asked about at all.
    const known = new Set<string>(SELLER_PERMISSIONS.map((p) => p.key));
    for (const key of keysInCode()) {
      expect({ key, known: known.has(key) }).toEqual({ key, known: true });
    }
  });

  /**
   * The whole point of the role: it can run the business and it cannot
   * change who gets in or take money out. These are asserted by NAME
   * rather than by counting, because a future permission added to the
   * set should not quietly bring one of them along.
   */
  it.each([
    ['wallet.withdraw', 'moving money out of the company'],
    ['profile.manage', 'changing the bank account the money lands in'],
    ['team.manage', 'inviting somebody new'],
    ['roles.manage', 'granting permissions'],
    ['api_keys.manage', 'issuing a credential that outlives them'],
    ['webhooks.manage', 'pointing company data somewhere else'],
    ['stores.manage', 'opening or closing a reseller store'],
  ])('never grants %s — %s', (key) => {
    expect(keysInCode()).not.toContain(key);
  });

  it('can actually do the job it is named for', () => {
    // Placing orders, following them, reading the money, and running the
    // reseller channel — the eleven things the role was asked for.
    for (const key of [
      'orders.create',
      'orders.import',
      'orders.view',
      'charges.view',
      'inventory.view',
      'stores.reports',
      'stores.pricing',
      'tickets.create',
    ]) {
      expect(keysInCode()).toContain(key);
    }
  });
});
