import { ForbiddenException } from '@nestjs/common';

/**
 * Nobody may grant a role that can do more than they can.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * `staff.manage` and a seller's `team.manage` cover inviting a colleague
 * AND choosing their role, and neither path asked whether the actor was
 * entitled to the role they were handing out. The DTOs validate against
 * the whole role vocabulary, which includes SUPER_ADMIN on the staff side
 * and OWNER on the seller's. So one `staff.manage` holder could invite an
 * address they control as SUPER_ADMIN, accept their own invitation, and
 * hold every permission on the platform — or promote a colleague to it
 * and borrow the account. `updateRole` guarded `CANNOT_CHANGE_OWN_ROLE`
 * and `LAST_SUPER_ADMIN`, both of which are about not LOSING access, and
 * said nothing about gaining it.
 *
 * It was latent rather than live: no seeded role below super-admin holds
 * `staff.manage`, and both keys are `dangerous: true` and audited HIGH.
 * It becomes real the first time an operator grants `staff.manage` to a
 * narrower custom role, which is an ordinary thing to do and exactly what
 * the roles screen is for.
 *
 * ── THE TWO RULES, AND WHY BOTH ARE NEEDED ───────────────────────────
 * 1. A SUPERUSER role (staff `is_super_admin`, seller `is_owner`) may be
 *    granted only by somebody who holds one. A superuser role carries no
 *    permission rows at all — it grants the whole catalogue implicitly,
 *    INCLUDING keys added in a later release — so rule 2 cannot see it:
 *    an actor who happens to hold every key today still must not be able
 *    to hand out "everything, forever".
 * 2. Otherwise the target's permissions must be a SUBSET of the actor's.
 *    A subset check rather than an equality one, so delegating a narrower
 *    role stays free, which is the whole point of having roles.
 *
 * Deliberately NOT applied to `rbac.manage` / `roles.manage`: those are
 * documented as equivalent-to-superuser by design (whoever holds them can
 * edit the role they themselves hold), and pretending otherwise here
 * would be a guard that reads like protection and is not.
 */
export interface GrantableRole {
  /** For the message — whoever reads a 403 needs the role's name. */
  readonly name: string;
  /** Grants the whole catalogue implicitly, now and in future releases. */
  readonly isSuperuser: boolean;
  /** The role's own grants. Empty for a superuser role, by construction. */
  readonly permissions: readonly string[];
}

export interface GrantingActor {
  readonly isSuperuser: boolean;
  readonly permissions: readonly string[];
}

export const ROLE_GRANTS_MORE_THAN_YOU_HOLD = 'ROLE_GRANTS_MORE_THAN_YOU_HOLD';

export function assertMayGrantRole(actor: GrantingActor, target: GrantableRole): void {
  if (actor.isSuperuser) return;

  if (target.isSuperuser) {
    throw new ForbiddenException({
      code: ROLE_GRANTS_MORE_THAN_YOU_HOLD,
      message:
        `Only somebody already holding “${target.name}” can give it to anyone else. ` +
        'It grants everything, including permissions added in future releases.',
    });
  }

  const held = new Set(actor.permissions);
  const extra = target.permissions.filter((p) => !held.has(p));
  if (extra.length > 0) {
    throw new ForbiddenException({
      code: ROLE_GRANTS_MORE_THAN_YOU_HOLD,
      message:
        `“${target.name}” can do things you cannot, so you cannot give it to anybody: ` +
        `${extra.join(', ')}. Ask somebody who holds them.`,
    });
  }
}
