/**
 * How a person's ROLES are worded, in one place.
 *
 * A person holds several roles and their permissions are the union, so
 * every surface that used to print one role name now prints a set — the
 * member list, the invitation list, the one-shot invite reveal and the
 * sentence the confirm dialog puts above the button. Four places that
 * each phrase it themselves is four chances to say "Finance" where the
 * person also holds Ops.
 *
 * Pure: no React, no hooks, no fetch. That is what lets it be tested
 * directly rather than through a rendered screen.
 */

/**
 * The names to SHOW for somebody, given what the server returned.
 *
 * `roleNames` is the whole set and the right answer. `roleName` is the
 * FIRST role — a label the server keeps truthful — and is the fallback
 * only for a payload written before `roleNames` existed; it is never
 * preferred, because preferring it is how a person holding three roles
 * reads as holding one.
 *
 * The single `role` enum this replaced is not consulted, and no longer
 * exists to consult: it was null for anybody holding only roles the
 * company invented, which is precisely the person a custom role was
 * made for, and a null prints as nothing without anything failing.
 */
export function roleNamesOf(member: {
  readonly roleNames?: readonly string[] | undefined;
  readonly roleName?: string | undefined;
}): readonly string[] {
  const all = (member.roleNames ?? []).filter((n) => n.trim() !== '');
  if (all.length > 0) return all;
  const one = (member.roleName ?? '').trim();
  return one === '' ? [] : [one];
}

/**
 * The same set as one line, for a place that has room for a sentence and
 * not for chips (a dialog's subject line, an invitation's reveal note).
 *
 * `fallback` is what somebody with NO live role reads as. That is a real
 * state and not an error on this screen: a role can be deleted from
 * under its holders, and the honest thing is to say so rather than print
 * an empty string that looks like a rendering bug.
 */
export function roleLine(
  member: {
    readonly roleNames?: readonly string[] | undefined;
    readonly roleName?: string | undefined;
  },
  fallback = 'No role',
): string {
  const names = roleNamesOf(member);
  return names.length === 0 ? fallback : names.join(' · ');
}

/**
 * What a role change does, as one plain sentence naming what is ADDED
 * and what is TAKEN AWAY.
 *
 * Stating the difference rather than just the destination is the point:
 * with one role a change was self-evidently a move, and with several
 * "Ops, Finance, Inventory" on its own does not tell you which of those
 * three the person did not have a minute ago — which is the only part
 * somebody confirming needs to check.
 */
export function roleChangeSummary(
  before: readonly string[],
  after: readonly string[],
): { readonly added: readonly string[]; readonly removed: readonly string[] } {
  return {
    added: after.filter((n) => !before.includes(n)),
    removed: before.filter((n) => !after.includes(n)),
  };
}

/** `roleChangeSummary` as the sentence that goes above the confirm button. */
export function roleChangeConsequence(
  fullName: string,
  before: readonly string[],
  after: readonly string[],
): string {
  if (after.length === 0) {
    // The server refuses this and its words are what gets shown; this
    // sentence is not that refusal and names no error code. It only has
    // to say something true while the field sits empty.
    return `No roles are selected. ${fullName} must hold at least one — somebody with none cannot sign in at all.`;
  }
  const { added, removed } = roleChangeSummary(before, after);
  const parts: string[] = [];
  if (added.length > 0) parts.push(`gains ${added.join(', ')}`);
  if (removed.length > 0) parts.push(`loses ${removed.join(', ')}`);
  const movement = parts.length === 0 ? 'keeps the same roles' : parts.join(' and ');
  return `${fullName} ${movement}. They end up holding ${after.join(', ')}, and what they can see and change is everything those roles cover between them.`;
}
