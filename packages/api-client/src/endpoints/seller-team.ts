import type { SellerUserRole } from '@skydrop/db';

export interface TeamInvitationListItem {
  readonly id: string;
  readonly email: string;
  readonly role: SellerUserRole;
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

export interface CreateTeamInvitationRequest {
  readonly email: string;
  readonly role: SellerUserRole;
  readonly fullName: string;
  readonly expiresInDays?: number;
}

export interface TeamMemberRow {
  readonly id: string;
  readonly email: string;
  readonly emailDisplay: string;
  readonly fullName: string;
  readonly role: SellerUserRole;
  readonly emailVerifiedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly deletedAt: string | null;
  readonly isYou: boolean;
}

export interface AcceptTeamInvitationRequest {
  readonly token: string;
  readonly password: string;
  readonly fullName: string;
}
