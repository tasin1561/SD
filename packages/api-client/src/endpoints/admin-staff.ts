import type { StaffRole } from '@skydrop/db';

export interface StaffInvitationListItem {
  readonly id: string;
  readonly email: string;
  readonly role: StaffRole;
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

export interface CreateStaffInvitationRequest {
  readonly email: string;
  readonly role: StaffRole;
  readonly expiresInDays?: number;
}

export interface StaffUserRow {
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  /** Legacy enum, kept for display continuity. */
  readonly role: StaffRole;
  readonly roleId: string;
  readonly roleName: string;
  readonly emailVerifiedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

export interface AcceptStaffInvitationRequest {
  readonly token: string;
  readonly password: string;
}
