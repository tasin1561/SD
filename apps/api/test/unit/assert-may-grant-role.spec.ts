import { ForbiddenException } from '@nestjs/common';
import {
  ROLE_GRANTS_MORE_THAN_YOU_HOLD,
  assertMayGrantRole,
} from '../../src/common/auth/assert-may-grant-role';
import { ALL_PERMISSION_KEYS } from '../../src/common/auth/permissions';
import { ALL_SELLER_PERMISSION_KEYS } from '../../src/common/auth/seller-permissions';

/**
 * Nobody may grant a role that can do more than they can.
 *
 * The hole this closes: `staff.manage` (and a seller's `team.manage`)
 * covered inviting a colleague AND choosing their role, and the DTOs
 * validate against the whole role vocabulary — SUPER_ADMIN on one side,
 * OWNER on the other. So one holder of a narrow custom role carrying
 * `staff.manage` could invite an address they controlled as SUPER_ADMIN,
 * accept it, and hold everything. `updateRole` guarded
 * CANNOT_CHANGE_OWN_ROLE and LAST_SUPER_ADMIN — both about not LOSING
 * access — and nothing about gaining it.
 */
describe('assertMayGrantRole', () => {
  const code = (fn: () => void): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (e) {
      if (!(e instanceof ForbiddenException)) throw e;
      return (e.getResponse() as { code?: string }).code;
    }
  };

  it('a superuser may grant anything, including another superuser role', () => {
    const owner = { isSuperuser: true, permissions: [] as readonly string[] };
    expect(() =>
      assertMayGrantRole(owner, { name: 'Super admin', isSuperuser: true, permissions: [] }),
    ).not.toThrow();
    expect(() =>
      assertMayGrantRole(owner, {
        name: 'Finance',
        isSuperuser: false,
        permissions: [...ALL_PERMISSION_KEYS],
      }),
    ).not.toThrow();
  });

  it('REFUSES a superuser target to a non-superuser — even one holding every key today', () => {
    // The load-bearing case for rule 1. A superuser role carries NO
    // permission rows: it grants the catalogue implicitly, including keys
    // added in a later release. A subset check cannot see that, so
    // holding everything today must not let somebody hand out
    // "everything, forever".
    expect(
      code(() =>
        assertMayGrantRole(
          { isSuperuser: false, permissions: [...ALL_PERMISSION_KEYS] },
          { name: 'Super admin', isSuperuser: true, permissions: [] },
        ),
      ),
    ).toBe(ROLE_GRANTS_MORE_THAN_YOU_HOLD);

    expect(
      code(() =>
        assertMayGrantRole(
          { isSuperuser: false, permissions: [...ALL_SELLER_PERMISSION_KEYS] },
          { name: 'Owner', isSuperuser: true, permissions: [] },
        ),
      ),
    ).toBe(ROLE_GRANTS_MORE_THAN_YOU_HOLD);
  });

  it('REFUSES a target holding a key the actor does not, and NAMES it', () => {
    let thrown: ForbiddenException | undefined;
    try {
      assertMayGrantRole(
        { isSuperuser: false, permissions: ['staff.view', 'staff.manage'] },
        { name: 'Finance', isSuperuser: false, permissions: ['staff.view', 'money.pnl.god_mode'] },
      );
    } catch (e) {
      thrown = e as ForbiddenException;
    }
    expect(thrown).toBeInstanceOf(ForbiddenException);
    const body = thrown?.getResponse() as { code: string; message: string };
    expect(body.code).toBe(ROLE_GRANTS_MORE_THAN_YOU_HOLD);
    // Whoever reads the refusal has to know WHICH key to go and ask for.
    expect(body.message).toContain('money.pnl.god_mode');
    expect(body.message).toContain('Finance');
  });

  it('ALLOWS delegating a narrower role — a subset, not equality', () => {
    // Otherwise the guard would forbid the ordinary act the roles screen
    // exists for: handing somebody a slice of what you do.
    expect(() =>
      assertMayGrantRole(
        { isSuperuser: false, permissions: ['staff.view', 'staff.manage', 'orders.view'] },
        { name: 'Read-only', isSuperuser: false, permissions: ['staff.view'] },
      ),
    ).not.toThrow();
    // And an empty target is always fine.
    expect(() =>
      assertMayGrantRole(
        { isSuperuser: false, permissions: [] },
        { name: 'Nothing', isSuperuser: false, permissions: [] },
      ),
    ).not.toThrow();
  });
});
