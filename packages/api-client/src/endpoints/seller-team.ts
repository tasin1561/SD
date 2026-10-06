/**
 * ── A PERSON HOLDS SEVERAL ROLES ────────────────────────────────────
 * `seller_user_roles` is the authority and permissions are the UNION of
 * every live role held. There is no longer a single `role` field: it
 * was an enum that spelled only the six roles shipped with the product,
 * so it was null for anybody holding only roles the company invented —
 * a screen reading it showed nothing for exactly the people a custom
 * role was made for, and showed it without failing. Render `roleNames`.
 *
 * `roleId` / `roleName` are the FIRST role held, a label the server
 * keeps truthful. They are NOT the answer to "what can this person do",
 * and they are not "their role" either — somebody on three roles has
 * two more that a label cannot show. `roleIds` / `roleNames` are the
 * whole set.
 */
export interface TeamInvitationListItem {
  readonly id: string;
  /** `seller_roles.id`s the invitation offers, in the order chosen. */
  readonly roleIds: readonly string[];
  /** Their display names, same order — what a screen should show. */
  readonly roleNames: readonly string[];
  readonly email: string;
  readonly invitedById: string;
  readonly acceptedById: string | null;
  readonly expiresAt: string;
  readonly usedAt: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

export interface CreatedTeamInvitation extends TeamInvitationListItem {
  readonly token: string;
  readonly inviteUrl: string;
}

/**
 * Role IDS, not the enum: a company can build exactly the role a new
 * colleague needs under Team → Roles, and until this took ids there was
 * no way to invite anybody onto it — the only route was one of the six
 * defaults plus a change afterwards.
 *
 * At least one. WHICH refusal an empty set draws is the server's
 * business and has already changed once while this was being built —
 * which is itself the argument for not encoding it here. The client
 * sends what was chosen and shows whatever comes back (FE-2).
 */
export interface CreateTeamInvitationRequest {
  readonly email: string;
  readonly roleIds: readonly string[];
  readonly fullName: string;
  readonly expiresInDays?: number;
}

export interface TeamMemberRow {
  /** The FIRST role held — a label. `roleIds` is all of them. */
  readonly roleId: string;
  readonly roleName: string;
  readonly roleIds: readonly string[];
  readonly roleNames: readonly string[];
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  readonly fullName: string;
  readonly emailVerifiedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly isYou: boolean;
}

/** The roles a member holds, REPLACED wholesale (never merged). */
export interface SetTeamMemberRolesRequest {
  readonly roleIds: readonly string[];
}

export interface SetTeamMemberRolesResult {
  readonly id: string;
  readonly roleIds: readonly string[];
  readonly roleNames: readonly string[];
}

export interface AcceptTeamInvitationRequest {
  readonly token: string;
  readonly password: string;
  readonly fullName: string;
}
