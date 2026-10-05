import {
  hasNoLiveRoles,
  resolveRoles,
  roleNamesFor,
  unionPermissions,
} from '../../src/common/auth/role-union';

/**
 * The union is the WHOLE of multi-role authorisation, and three guards
 * read it. These are the four properties that keep it honest.
 */
describe('role union (multi-role RBAC)', () => {
  const ALL = ['a', 'b', 'c', 'd'] as const;

  it('two roles COMPOSE — the holder gets both sets', () => {
    const held = unionPermissions(
      [
        { superuser: false, permissions: ['a', 'b'] },
        { superuser: false, permissions: ['c'] },
      ],
      ALL,
    );
    expect([...held].sort()).toEqual(['a', 'b', 'c']);
  });

  it('a key granted twice appears ONCE', () => {
    const held = unionPermissions(
      [
        { superuser: false, permissions: ['a', 'b'] },
        { superuser: false, permissions: ['b', 'c'] },
      ],
      ALL,
    );
    expect([...held].sort()).toEqual(['a', 'b', 'c']);
  });

  /**
   * A superuser role carries NO permission rows — it grants the
   * catalogue implicitly, including keys a later release adds. Taking
   * the union of rows would silently demote somebody holding it
   * alongside a narrow role, which looks like working software with
   * some buttons missing.
   */
  it('a superuser role among several grants EVERYTHING', () => {
    const held = unionPermissions(
      [
        { superuser: false, permissions: ['a'] },
        { superuser: true, permissions: [] },
      ],
      ALL,
    );
    expect(held).toEqual(ALL);
  });

  it('superuser first, narrow second — still everything', () => {
    const held = unionPermissions(
      [
        { superuser: true, permissions: [] },
        { superuser: false, permissions: ['a'] },
      ],
      ALL,
    );
    expect(held).toEqual(ALL);
  });

  it('zero roles grants NOTHING — never everything, never a default', () => {
    expect(unionPermissions([], ALL)).toEqual([]);
    expect(hasNoLiveRoles([])).toBe(true);
    expect(hasNoLiveRoles([{ superuser: false, permissions: [] }])).toBe(false);
  });

  describe('resolveRoles — the shape the guards read', () => {
    const row = (
      key: string,
      perms: readonly string[],
      opts: { superAdmin?: boolean; deleted?: boolean } = {},
    ) => ({
      role: {
        key,
        name: key.toUpperCase(),
        deletedAt: opts.deleted === true ? new Date() : null,
        isSuperAdmin: opts.superAdmin === true,
        permissions: perms.map((permission) => ({ permission })),
      },
    });

    it('unions the LIVE roles and keeps the first as the label', () => {
      const r = resolveRoles([row('agent', ['a']), row('support', ['b', 'c'])], ALL);
      expect(r.primary).toEqual({ key: 'agent', name: 'AGENT' });
      expect(r.roles.map((x) => x.key)).toEqual(['agent', 'support']);
      expect([...r.permissions].sort()).toEqual(['a', 'b', 'c']);
    });

    /**
     * A soft-deleted role is not a role. Granting from one an admin
     * deleted this morning is the exact failure the LIVE filter exists
     * for, and it has to happen in ONE place or a guard that selects
     * the rows and forgets the filter reintroduces it.
     */
    it('a soft-deleted role DROPS OUT of the union', () => {
      const r = resolveRoles([row('agent', ['a']), row('gone', ['b'], { deleted: true })], ALL);
      expect(r.roles.map((x) => x.key)).toEqual(['agent']);
      expect(r.permissions).toEqual(['a']);
    });

    it('a soft-deleted SUPERUSER role does not grant the catalogue', () => {
      const r = resolveRoles(
        [row('agent', ['a']), row('super', [], { superAdmin: true, deleted: true })],
        ALL,
      );
      expect(r.permissions).toEqual(['a']);
    });

    /**
     * EVERY role deleted is somebody with nothing to reason about, and
     * the guards answer UNAUTHORIZED — "sign in again" — rather than
     * carrying on with an empty grant set, which would reach every
     * self-service endpoint while reading as a working login.
     */
    it('every role deleted leaves NO roles and NO primary', () => {
      const r = resolveRoles([row('gone', ['a'], { deleted: true })], ALL);
      expect(r.roles).toEqual([]);
      expect(r.primary).toBeNull();
      expect(r.permissions).toEqual([]);
    });

    it('reads `isOwner` as superuser too, for the seller and store sides', () => {
      const r = resolveRoles(
        [
          {
            role: { key: 'owner', name: 'Owner', deletedAt: null, isOwner: true, permissions: [] },
          },
        ],
        ALL,
      );
      expect(r.permissions).toEqual(ALL);
    });
  });

  describe('roleNamesFor — the refusal message', () => {
    it('names every role, because a refusal has to say who was refused', () => {
      expect(roleNamesFor([{ name: 'Call agent' }])).toBe('Call agent');
      expect(roleNamesFor([{ name: 'Call agent' }, { name: 'Support' }])).toBe(
        'Call agent and Support',
      );
      expect(roleNamesFor([{ name: 'A' }, { name: 'B' }, { name: 'C' }])).toBe('A, B and C');
    });

    it('says something rather than nothing for an empty set', () => {
      expect(roleNamesFor([])).toBe('Nobody');
    });
  });
});
