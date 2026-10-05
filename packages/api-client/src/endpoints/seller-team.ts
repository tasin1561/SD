import type { SellerUserRole } from '@skydrop/db';

/**
 * ── A PERSON HOLDS SEVERAL ROLES ────────────────────────────────────
 * `seller_user_roles` is the authority and permissions are the UNION of
 * every live role held; `role` is the LEGACY enum, kept as a display
 * label and NULL for anybody holding only roles the company invented
 * (which have no enum spelling). Read `roleNames` — a screen that reads
 * `role` shows nothing for exactly the people a custom role was made
 * for, and shows it without failing.
 *
 * `roleId` / `roleName` are the FIRST role held, a label the server
 * keeps truthful. They are NOT the answer to "what can this person do";
 * `roleIds` / `roleNames` are the whole set.
 */
export interface TeamInvitationListItem {
  readonly id: string;
  /** LEGACY enum — null when no offered role has a spelling. */
  readonly role: SellerUserRole | null;
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
  /** LEGACY enum, display only — null for a custom-role-only person. */
  readonly role: SellerUserRole | null;
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
