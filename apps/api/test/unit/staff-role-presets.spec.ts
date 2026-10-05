import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_PERMISSION_KEYS, PERMISSIONS } from '../../src/common/auth/permissions';
import { ADMIN_WITHHELD, STAFF_ROLE_PRESETS } from '../../src/common/auth/staff-role-presets';

/**
 * The migration that seeds Admin / Support / Read-only cannot import
 * TypeScript, so it carries the DERIVED rows as literal SQL. This spec
 * is the only thing standing between that file and this one disagreeing
 * about what "Admin" means — and it compares them IN BOTH DIRECTIONS,
 * because a one-way check passes while the SQL holds a key the constant
 * dropped.
 *
 * It reads the migration by PATH rather than by querying a database:
 * the question is whether the committed SQL matches the committed
 * constant, which is answerable in milliseconds and before CI.
 */
const MIGRATION = join(
  __dirname,
  '../../../../packages/db/prisma/migrations/20261005000100_staff_access_tier_roles/migration.sql',
);

/** `('admin', 'orders.view'),` → `['admin', 'orders.view']`, comments stripped. */
function rowsFromMigration(): readonly (readonly [string, string])[] {
  const sql = readFileSync(MIGRATION, 'utf8')
    // Comments FIRST: prose about a rule reads exactly like the rule to
    // a regex (the lesson from the spec that asserted on a docblock and
    // passed while testing nothing).
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const out: [string, string][] = [];
  const re = /\('([a-z_]+)',\s*'([a-z0-9_.]+)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const key = m[1];
    const permission = m[2];
    if (key === undefined || permission === undefined) continue;
    out.push([key, permission]);
  }
  return out;
}

describe('staff access tiers (Admin / Support / Read-only)', () => {
  const sqlRows = rowsFromMigration();

  it('seeds exactly the three presets, by key', () => {
    expect(STAFF_ROLE_PRESETS.map((p) => p.key)).toEqual(['admin', 'support', 'readonly']);
    expect([...new Set(sqlRows.map(([k]) => k))].sort()).toEqual(['admin', 'readonly', 'support']);
  });

  for (const preset of STAFF_ROLE_PRESETS) {
    describe(preset.key, () => {
      const fromSql = sqlRows.filter(([k]) => k === preset.key).map(([, p]) => p);

      it('the migration grants exactly what the constant derives', () => {
        expect([...fromSql].sort()).toEqual([...preset.permissions].sort());
      });

      it('grants no key the migration invented', () => {
        const declared = new Set<string>(preset.permissions);
        expect(fromSql.filter((p) => !declared.has(p))).toEqual([]);
      });

      it('every key is in the catalogue', () => {
        const known = new Set<string>(ALL_PERMISSION_KEYS);
        expect(preset.permissions.filter((p) => !known.has(p))).toEqual([]);
      });

      it('grants no key twice', () => {
        expect(new Set(preset.permissions).size).toBe(preset.permissions.length);
        expect(new Set(fromSql).size).toBe(fromSql.length);
      });
    });
  }

  describe('Admin — what it must NOT hold', () => {
    const held = new Set<string>(
      STAFF_ROLE_PRESETS.find((p) => p.key === 'admin')?.permissions ?? [],
    );

    /**
     * CHANGING who has access, and the financial identity. An Admin runs
     * the platform; it does not decide who else may, and it does not
     * touch where money goes.
     */
    it.each([
      'staff.manage',
      'rbac.manage',
      'money.bank_accounts.manage',
      'sellers.bank_account.reveal',
      'sellers.bank_change.approve',
    ])('withholds %s', (key) => {
      expect(held.has(key)).toBe(false);
    });

    /**
     * SEEING who has access is held, and the asymmetry is deliberate —
     * it reads like an oversight a future reader would tidy up. Owner's
     * call, 2026-10-05: withholding the read left Read-only (every
     * `.view` key) able to see the staff list while the platform
     * administrator could not, and it bought almost nothing, because an
     * Admin holds `notifications.broadcast` whose preview returns five
     * staff addresses for any role or permission selector.
     */
    it('SEES the staff list, while being unable to change it', () => {
      expect(held.has('staff.view')).toBe(true);
      expect(held.has('staff.manage')).toBe(false);
      expect(held.has('rbac.manage')).toBe(false);
    });

    /** The five documented as SUPER_ADMIN-by-construction. */
    it.each([
      'orders.override',
      'warehouse.bins.collapse',
      'money.pnl.god_mode',
      'money.wallet.transfer',
      'reseller.credit_after_confirmation.enable',
    ])('withholds the invariant bypass %s', (key) => {
      expect(held.has(key)).toBe(false);
    });

    /**
     * NOT "every dangerous key": an Admin must be able to resolve a
     * ticket, record a remittance and cancel a parcel at the courier.
     * Dangerous means "confirm twice", not "nobody but the owner".
     */
    it.each(['tickets.resolve', 'money.remittances.manage', 'courier.ops.write'])(
      'still holds the dangerous-but-ordinary %s',
      (key) => {
        expect(held.has(key)).toBe(true);
      },
    );

    it('holds everything else in the catalogue', () => {
      const withheld = new Set<string>(ADMIN_WITHHELD);
      expect(ALL_PERMISSION_KEYS.filter((k) => !withheld.has(k) && !held.has(k))).toEqual([]);
    });
  });

  describe('Read-only — every read and nothing else', () => {
    const held = new Set<string>(
      STAFF_ROLE_PRESETS.find((p) => p.key === 'readonly')?.permissions ?? [],
    );

    it('holds every `.view` key in the catalogue', () => {
      expect(ALL_PERMISSION_KEYS.filter((k) => k.endsWith('.view') && !held.has(k))).toEqual([]);
    });

    it('holds nothing that is not a `.view` key', () => {
      expect([...held].filter((k) => !k.endsWith('.view'))).toEqual([]);
    });

    /**
     * It reads data and is NOT a view key: it is the key that puts a
     * seller's account number on a screen, and every use of it is
     * audited because of that.
     */
    it('does NOT hold sellers.bank_account.reveal', () => {
      expect(held.has('sellers.bank_account.reveal')).toBe(false);
    });

    /**
     * ── THE PRICE OF DERIVING A ROLE FROM A NAME ────────────────────
     * Read-only is `ALL_PERMISSION_KEYS.filter(isViewKey)`, so it holds
     * whatever `.view` keys exist — INCLUDING any that guard a WRITE.
     * `staff-permission-surface.spec.ts` already forbids that
     * ("a write may not rest on a `.view` key alone") and names its
     * exceptions with their reasons; this reads that list, because the
     * exceptions ARE the writes a Read-only login can perform and the
     * person maintaining this preset is the one who needs to know.
     *
     * Read rather than restated: a second copy of the rule is how the
     * two come to disagree, and a second copy of the parser would be a
     * second thing to keep right.
     *
     * If this fails, somebody added a `.view`-gated write. Either it
     * belongs on a `.manage` key, or "read-only" has stopped being
     * true and the name has to change.
     */
    it('can perform exactly the ONE documented .view-gated write, and no more', () => {
      const surfaceSpec = readFileSync(join(__dirname, 'staff-permission-surface.spec.ts'), 'utf8');
      const literal = /const VIEW_GATED_WRITES = new Set\(\[([^\]]*)\]\)/.exec(surfaceSpec)?.[1];
      // A regex that stopped matching would make this pass vacuously.
      expect(literal).toBeDefined();
      const exceptions = [...(literal ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '');
      expect(exceptions).toEqual(['admin-system-issue.controller.ts acknowledge']);
    });
  });

  describe('Support', () => {
    const held = new Set<string>(
      STAFF_ROLE_PRESETS.find((p) => p.key === 'support')?.permissions ?? [],
    );

    it('can work the ticket queue', () => {
      expect(held.has('tickets.view')).toBe(true);
      expect(held.has('tickets.resolve')).toBe(true);
    });

    /**
     * `system.settings.view` is what opens `/system-issues` (NOTIF-16),
     * and support IS the audience for "something broke". CHANGING a
     * setting is a different key, which support does not hold.
     */
    it('can open the system-issues page, and cannot change a setting', () => {
      expect(held.has('system.settings.view')).toBe(true);
      expect(held.has('system.settings.manage')).toBe(false);
    });

    it('changes nothing operational', () => {
      const writes = [...held].filter((k) => !k.endsWith('.view') && k !== 'tickets.resolve');
      expect(writes).toEqual([]);
    });
  });

  /**
   * The failure this guards is a tier that silently stops meaning what
   * its name says: a permission added next release that lands in no
   * tier at all, with nobody noticing because nothing fails.
   */
  it('every permission in the catalogue is reachable by at least one tier or is deliberately not', () => {
    const anyTier = new Set<string>(STAFF_ROLE_PRESETS.flatMap((p) => [...p.permissions]));
    const unreachable = PERMISSIONS.map((p) => p.key).filter((k) => !anyTier.has(k));
    // Exactly the Admin exclusions — everything else is in Admin by
    // construction. If this list grows, a new permission was added that
    // no tier can reach and somebody has to decide which one gets it.
    expect(unreachable.sort()).toEqual([...ADMIN_WITHHELD].sort().filter((k) => !anyTier.has(k)));
    expect(unreachable.every((k) => ADMIN_WITHHELD.includes(k))).toBe(true);
  });
});
