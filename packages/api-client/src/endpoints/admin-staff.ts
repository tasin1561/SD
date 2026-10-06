/**
 * ── A PERSON HOLDS SEVERAL ROLES ────────────────────────────────────
 * Every shape here carries `roleIds` + `roleNames` (plural, in the order
 * chosen) because that is what the server stores and resolves
 * permissions from — the UNION of every live role held.
 *
 * `roleId` and `roleName` survive as LABELS of the FIRST role, and a
 * label is all they are: somebody on an access tier plus two job
 * functions has two more roles that a label cannot show. A screen that
 * names "their role" is naming one of several, so render `roleNames`.
 *
 * The single `role` field is gone. It was the `StaffRole` enum, and
 * neither an access tier (`admin` / `support` / `readonly`) nor a role
 * an operator invented ever had a spelling in it, so it printed "null"
 * for exactly the people the role rows were built for.
 */
export interface StaffInvitationListItem {
  readonly id: string;
  readonly email: string;
  /** `staff_roles.id`s the invitation offers, in the order chosen. */
  readonly roleIds: readonly string[];
  /** Their display names, same order — what a screen should show. */
  readonly roleNames: readonly string[];
  readonly invitedById: string;
  readonly acceptedById: string | null;
  readonly expiresAt: string;
  readonly usedAt: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

export interface CreatedStaffInvitation extends StaffInvitationListItem {
  readonly token: string;
  readonly inviteUrl: string;
}

/**
 * Role ROW ids, never a role's name.
 *
 * The `StaffRole` enum was the whole of this field, which meant
 * **nobody could be invited onto a role the team invented** — the only
 * way in was to invite somebody as one of the seven seeded ones and
 * re-role them afterwards. Plural for the same reason the assignment is: a job
 * function and an access tier are two axes, and an invitation that
 * cannot say both makes a correction the first task after somebody joins.
 */
export interface CreateStaffInvitationRequest {
  readonly email: string;
  /**
   * At least one. The server refuses an empty list — which code comes
   * back depends on which guard catches it, so read the verdict rather
   * than predicting it (FE-2).
   */
  readonly roleIds: readonly string[];
  readonly expiresInDays?: number;
}

export interface StaffUserRow {
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  /** The FIRST role held — a label. `roleIds` is all of them. */
  readonly roleId: string;
  readonly roleName: string;
  readonly roleIds: readonly string[];
  readonly roleNames: readonly string[];
  readonly emailVerifiedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

/**
 * What `PATCH /admin/staff/users/:id/roles` answers with.
 *
 * The server also returns `roleId`/`roleName` — the first role — as
 * scaffolding so the single-role `/role` route's existing callers do not
 * silently read `undefined` across the deploy. It is deliberately NOT
 * declared here: this app reads the plural fields, so the scaffolding
 * can be deleted without touching the admin console.
 */
export interface SetStaffRolesResult {
  readonly id: string;
  readonly roleIds: readonly string[];
  readonly roleNames: readonly string[];
}

export interface AcceptStaffInvitationRequest {
  readonly token: string;
  readonly password: string;
}
