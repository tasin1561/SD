/**
 * Grouping the roles list, and the union.
 *
 * `roleAxis` names the three tier keys by hand because `staff_roles` has
 * no column saying which axis a role is on. That is a second copy of
 * something the server knows, and the mitigation is that the copy can
 * only ever be wrong about a HEADING: nothing is filtered, nothing
 * gated. So the load-bearing test is not "admin is a tier" — it is that
 * every role in a list lands in exactly ONE group, including a role with
 * a key this file has never heard of. A role that fell through every
 * group would VANISH from the screen, which is the only way this can
 * cost anything.
 */
import { describe, expect, it } from 'vitest';
import { ROLE_AXIS_GROUPS, roleAxis, rolesInGroup, unionPermissions } from '@/lib/role-axes';
import type { RoleView } from '@/lib/rbac-hooks';
import { ROLES } from './role-fixtures';

function role(over: Partial<RoleView> & Pick<RoleView, 'key'>): RoleView {
  return {
    id: over.key,
    name: over.key,
    description: null,
    isSystem: false,
    isSuperAdmin: false,
    permissions: [],
    staffCount: 0,
    ...over,
  };
}

describe('roleAxis', () => {
  it('puts the superuser and the three tiers on the access ladder', () => {
    expect(roleAxis(role({ key: 'super_admin', isSystem: true, isSuperAdmin: true }))).toBe(
      'superuser',
    );
    expect(roleAxis(role({ key: 'admin', isSystem: true }))).toBe('tier');
    expect(roleAxis(role({ key: 'support', isSystem: true }))).toBe('tier');
    expect(roleAxis(role({ key: 'readonly', isSystem: true }))).toBe('tier');
  });

  it('a seeded role it does not recognise is a job function, not nothing', () => {
    expect(roleAxis(role({ key: 'some_future_seeded_role', isSystem: true }))).toBe('function');
  });

  it('a role somebody invented is custom', () => {
    expect(roleAxis(role({ key: 'returns_desk' }))).toBe('custom');
  });

  it('`isSuperAdmin` beats the key list — a renamed superuser is still the ladder', () => {
    expect(roleAxis(role({ key: 'owner', isSystem: true, isSuperAdmin: true }))).toBe('superuser');
  });
});

describe('every role is shown, in exactly one group', () => {
  it('covers the production-shaped list', () => {
    const seen = ROLE_AXIS_GROUPS.flatMap((g) => rolesInGroup(ROLES, g.axes));
    expect(seen).toHaveLength(ROLES.length);
    expect(new Set(seen.map((r) => r.id)).size).toBe(ROLES.length);
  });

  it('covers a role with a key nothing here has ever heard of', () => {
    const odd = [...ROLES, role({ key: 'night_shift', isSystem: true }), role({ key: 'xyz' })];
    const seen = ROLE_AXIS_GROUPS.flatMap((g) => rolesInGroup(odd, g.axes));
    expect(new Set(seen.map((r) => r.id)).size).toBe(odd.length);
  });

  it('the groups do not overlap', () => {
    for (const a of ROLE_AXIS_GROUPS) {
      for (const b of ROLE_AXIS_GROUPS) {
        if (a.id === b.id) continue;
        expect(a.axes.filter((x) => b.axes.includes(x))).toEqual([]);
      }
    }
  });
});

describe('unionPermissions — the union, never the sum', () => {
  it('counts a permission two roles share once', () => {
    // Admin and Support both hold `orders.view`; 2 + 2 would read 4.
    const chosen = ROLES.filter((r) => r.id === 'r-admin' || r.id === 'r-support');
    expect(unionPermissions(chosen)).toEqual({ count: 3, everything: false });
  });

  it('a superuser role in the set means everything, whatever it lists', () => {
    const chosen = ROLES.filter((r) => r.id === 'r-super' || r.id === 'r-readonly');
    expect(unionPermissions(chosen).everything).toBe(true);
  });

  it('nothing chosen is nothing granted', () => {
    expect(unionPermissions([])).toEqual({ count: 0, everything: false });
  });
});
