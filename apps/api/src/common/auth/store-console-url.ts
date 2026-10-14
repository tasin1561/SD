/**
 * WHICH CONSOLE a store user signs in to — ASSOC-1's rule, in ONE place.
 *
 * A store user's role decides their origin, not their store: somebody
 * whose only role is `associate` belongs at `associate.skydrop.global`,
 * anybody wider at `member.skydrop.global`. It matters because
 * `__Host-storeRefresh` is bound to the origin that set it, so a link
 * into the wrong console does not merely look odd — it signs the person
 * in somewhere that refuses almost every page they then open, and their
 * session cannot follow them across.
 *
 * WHY IT MOVED HERE (2026-10-14). The rule was written for invitations
 * and lived in `store-team.service.ts` as `invitationAppUrl`. A link
 * audit then found FIVE other places that generate a link for a store
 * user and hardcoded the reseller console instead — two of them
 * CREDENTIAL mail (`store.email_verification.email`,
 * `store.password_changed.email`), which by construction has no second
 * channel (NOTIF-9) and therefore no way for the recipient to recover.
 * `store-auth` cannot import `reseller-store` without closing a module
 * cycle, so rather than reach for `forwardRef` the rule is extracted
 * into a dependency-free module both import — the R3 pattern, applied
 * to a pure function.
 *
 * It is NAMED for the question it answers rather than for the first
 * caller that needed it: `invitationAppUrl` was accurate when
 * invitations were the only link, and a name that narrow is how five
 * other call sites came to re-decide the same thing for themselves.
 *
 * WIDEST WINS, and the empty case fails to the WIDE console. No live
 * roles at all is not "narrow", it is "unknown" — and the reseller
 * console is where every store user could already sign in before
 * ASSOC-1 existed, so it is the answer that strands nobody. (RBAC-1b:
 * pass LIVE role keys only; a soft-deleted role drops out of the union.)
 */
export function storeConsoleUrl(
  roleKeys: readonly string[],
  env: { readonly resellerAppUrl: string; readonly associateAppUrl: string },
): string {
  const associateOnly = roleKeys.length > 0 && roleKeys.every((k) => k === 'associate');
  return associateOnly ? env.associateAppUrl : env.resellerAppUrl;
}

/** The live role keys off a `roles: { select: { role: { select: { key, deletedAt } } } }` read. */
export function liveRoleKeys(
  roles: readonly { readonly role: { readonly key: string; readonly deletedAt: Date | null } }[],
): string[] {
  return roles.filter((r) => r.role.deletedAt === null).map((r) => r.role.key);
}
