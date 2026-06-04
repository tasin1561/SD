import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  NotificationRecipientType,
  SellerUserRole,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { PasswordService } from '../../auth-common/services/password.service';
import { TokenHashService } from '../../auth-common/services/token-hash.service';
import { EmailQueue } from '../../email/queue/email.queue';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { CreateTeamInvitationDto } from '../dto/create-team-invitation.dto';

const DEFAULT_EXPIRES_IN_DAYS = 7;

export interface TeamInvitationView {
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

export interface CreatedTeamInvitation extends TeamInvitationView {
  readonly token: string;
  readonly inviteUrl: string;
}

export interface TeamMemberView {
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

/**
 * Seller team management — invitations + member roles.
 *
 * RBAC at the controller layer:
 *   - All write paths require OWNER or ADMIN.
 *   - Read paths are open to any role (any team member sees the team).
 *
 * Ownership transfer + last-OWNER protection enforced in updateRole +
 * deactivate (cannot leave the company with zero OWNERs).
 */
@Injectable()
export class SellerTeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly hashes: TokenHashService,
    private readonly password: PasswordService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
  ) {}

  // ── Invitations ────────────────────────────────────────────────────

  async invite(
    sellerId: string,
    input: CreateTeamInvitationDto,
    actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<CreatedTeamInvitation> {
    const emailLower = input.email.trim().toLowerCase();

    // Refuse if a SellerUser with this email already exists ANYWHERE
    // — emails are globally unique on seller_users.
    const existing = await this.prisma.client.sellerUser.findUnique({
      where: { email: emailLower },
      select: { id: true, sellerId: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message:
          existing.sellerId === sellerId
            ? 'This person is already a team member.'
            : 'This email is registered with another seller account.',
      });
    }

    const live = await this.findLive(sellerId, emailLower);
    if (live) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_PENDING',
        message: `A pending invitation already exists for ${input.email}. Resend it instead.`,
      });
    }

    const plaintext = this.hashes.generateInvitationToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(
      Date.now() + (input.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS) * 86_400_000,
    );

    const row = await this.prisma.client.sellerUserInvitation.create({
      data: {
        sellerId,
        email: input.email,
        token: tokenHash,
        role: input.role,
        invitedById: actor.sellerUserId,
        expiresAt,
      },
      select: this.invitationSelect,
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_invitation.created',
      entityType: 'seller_user_invitation',
      entityId: row.id,
      severity: 'MEDIUM',
      changes: { email: input.email, role: input.role, fullName: input.fullName },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    const url = this.inviteUrlFor(plaintext);
    await this.sendInvitationEmail(input.email, input.fullName, input.role, url, expiresAt);
    return { ...this.toInvView(row), token: plaintext, inviteUrl: url };
  }

  async listInvitations(sellerId: string): Promise<{ items: TeamInvitationView[]; total: number }> {
    const rows = await this.prisma.client.sellerUserInvitation.findMany({
      where: { sellerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: this.invitationSelect,
    });
    return { items: rows.map((r) => this.toInvView(r)), total: rows.length };
  }

  async resendInvitation(
    sellerId: string,
    invitationId: string,
    _actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<CreatedTeamInvitation> {
    const existing = await this.prisma.client.sellerUserInvitation.findFirst({
      where: { id: invitationId, sellerId },
      select: { id: true, email: true, role: true, usedAt: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }
    if (existing.usedAt !== null) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_USED',
        message: 'Invitation has already been used',
      });
    }

    const plaintext = this.hashes.generateInvitationToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRES_IN_DAYS * 86_400_000);

    const updated = await this.prisma.client.sellerUserInvitation.update({
      where: { id: invitationId },
      data: { token: tokenHash, expiresAt },
      select: this.invitationSelect,
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_invitation.resent',
      entityType: 'seller_user_invitation',
      entityId: invitationId,
      severity: 'MEDIUM',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    const url = this.inviteUrlFor(plaintext);
    await this.sendInvitationEmail(updated.email, updated.email, updated.role, url, expiresAt);
    return { ...this.toInvView(updated), token: plaintext, inviteUrl: url };
  }

  async revokeInvitation(
    sellerId: string,
    invitationId: string,
    _actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<void> {
    const existing = await this.prisma.client.sellerUserInvitation.findFirst({
      where: { id: invitationId, sellerId },
      select: { id: true, usedAt: true, deletedAt: true },
    });
    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException({
        code: 'INVITATION_NOT_FOUND',
        message: 'Invitation not found',
      });
    }
    if (existing.usedAt !== null) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_USED',
        message: 'Cannot revoke a redeemed invitation',
      });
    }
    await this.prisma.client.sellerUserInvitation.update({
      where: { id: invitationId },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_invitation.revoked',
      entityType: 'seller_user_invitation',
      entityId: invitationId,
      severity: 'MEDIUM',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
  }

  /**
   * Accept a team invitation. Creates the SellerUser row + marks the
   * invitation USED in one tx. Returns the email so the caller's
   * auth flow can issue a session.
   */
  async accept(
    plaintextToken: string,
    plaintextPassword: string,
    fullName: string,
    ctx: ClientContext,
  ): Promise<{ sellerUserId: string; email: string; role: SellerUserRole; sellerId: string }> {
    const tokenHash = this.hashes.sha256Hex(plaintextToken);
    const inv = await this.prisma.client.sellerUserInvitation.findUnique({
      where: { token: tokenHash },
      select: {
        id: true,
        sellerId: true,
        email: true,
        role: true,
        expiresAt: true,
        usedAt: true,
        deletedAt: true,
      },
    });
    if (!inv || inv.deletedAt !== null) {
      throw new NotFoundException({
        code: 'INVALID_INVITATION',
        message: 'Invitation not found or revoked',
      });
    }
    if (inv.usedAt !== null) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_USED',
        message: 'This invitation has already been used',
      });
    }
    if (inv.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'INVITATION_EXPIRED',
        message: 'Invitation has expired; ask the team owner to resend it',
      });
    }
    const emailLower = inv.email.trim().toLowerCase();
    const existingUser = await this.prisma.client.sellerUser.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'A user with this email already exists',
      });
    }

    const passwordHash = await this.password.hash(plaintextPassword);
    const now = new Date();

    const created = await this.prisma.client.$transaction(async (tx) => {
      const re = await tx.sellerUserInvitation.findUnique({
        where: { id: inv.id },
        select: { usedAt: true },
      });
      if (re?.usedAt !== null) {
        throw new ConflictException({
          code: 'INVITATION_ALREADY_USED',
          message: 'This invitation has already been used',
        });
      }
      const user = await tx.sellerUser.create({
        data: {
          sellerId: inv.sellerId,
          email: emailLower,
          emailDisplay: inv.email,
          passwordHash,
          fullName,
          role: inv.role,
          emailVerifiedAt: now,
        },
        select: { id: true, email: true, role: true, sellerId: true },
      });
      await tx.sellerUserInvitation.update({
        where: { id: inv.id },
        data: { usedAt: now, acceptedById: user.id },
      });
      return user;
    });

    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId: created.sellerId,
      action: 'seller.team_invitation.accepted',
      entityType: 'seller_user',
      entityId: created.id,
      severity: 'MEDIUM',
      changes: { invitationId: inv.id, role: inv.role, email: inv.email },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    return {
      sellerUserId: created.id,
      email: created.email,
      role: created.role,
      sellerId: created.sellerId,
    };
  }

  // ── Team members ───────────────────────────────────────────────────

  async listMembers(
    sellerId: string,
    currentUserId: string,
  ): Promise<TeamMemberView[]> {
    const rows = await this.prisma.client.sellerUser.findMany({
      where: { sellerId },
      orderBy: [{ deletedAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
      select: {
        id: true,
        email: true,
        emailDisplay: true,
        fullName: true,
        role: true,
        emailVerifiedAt: true,
        lastLoginAt: true,
        createdAt: true,
        deletedAt: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      email: r.email,
      emailDisplay: r.emailDisplay,
      fullName: r.fullName,
      role: r.role,
      emailVerifiedAt: r.emailVerifiedAt?.toISOString() ?? null,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      deletedAt: r.deletedAt?.toISOString() ?? null,
      isYou: r.id === currentUserId,
    }));
  }

  async updateRole(
    sellerId: string,
    targetUserId: string,
    newRole: SellerUserRole,
    actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<{ id: string; role: SellerUserRole }> {
    if (targetUserId === actor.sellerUserId) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWN_ROLE',
        message: 'You cannot change your own role',
      });
    }
    const target = await this.prisma.client.sellerUser.findFirst({
      where: { id: targetUserId, sellerId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!target || target.deletedAt !== null) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Team member not found',
      });
    }
    // Last-OWNER protection: if we're demoting an OWNER, ensure at
    // least one other OWNER will remain.
    if (target.role === 'OWNER' && newRole !== 'OWNER') {
      const otherOwners = await this.prisma.client.sellerUser.count({
        where: {
          sellerId,
          role: 'OWNER',
          deletedAt: null,
          id: { not: targetUserId },
        },
      });
      if (otherOwners === 0) {
        throw new BadRequestException({
          code: 'LAST_OWNER',
          message:
            'Cannot demote the last OWNER. Promote another member to OWNER first.',
        });
      }
    }
    if (target.role === newRole) {
      return { id: target.id, role: target.role };
    }
    const updated = await this.prisma.client.sellerUser.update({
      where: { id: targetUserId },
      data: { role: newRole },
      select: { id: true, role: true },
    });
    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_member.role_changed',
      entityType: 'seller_user',
      entityId: targetUserId,
      severity: 'MEDIUM',
      changes: { before: target.role, after: newRole },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    return updated;
  }

  async deactivate(
    sellerId: string,
    targetUserId: string,
    actor: { sellerUserId: string },
    ctx: ClientContext,
  ): Promise<void> {
    if (targetUserId === actor.sellerUserId) {
      throw new BadRequestException({
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'You cannot deactivate your own account',
      });
    }
    const target = await this.prisma.client.sellerUser.findFirst({
      where: { id: targetUserId, sellerId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'MEMBER_NOT_FOUND',
        message: 'Team member not found',
      });
    }
    if (target.deletedAt !== null) return;

    // Last-OWNER protection.
    if (target.role === 'OWNER') {
      const otherOwners = await this.prisma.client.sellerUser.count({
        where: {
          sellerId,
          role: 'OWNER',
          deletedAt: null,
          id: { not: targetUserId },
        },
      });
      if (otherOwners === 0) {
        throw new BadRequestException({
          code: 'LAST_OWNER',
          message:
            'Cannot deactivate the last OWNER. Transfer ownership first.',
        });
      }
    }
    await this.prisma.client.sellerUser.update({
      where: { id: targetUserId },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      actorType: ActorType.SELLER,
      sellerId,
      action: 'seller.team_member.deactivated',
      entityType: 'seller_user',
      entityId: targetUserId,
      severity: 'HIGH',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private invitationSelect = {
    id: true,
    email: true,
    role: true,
    invitedById: true,
    acceptedById: true,
    expiresAt: true,
    usedAt: true,
    createdAt: true,
    deletedAt: true,
  } as const;

  private async findLive(sellerId: string, emailLower: string): Promise<{ id: string } | null> {
    return this.prisma.client.sellerUserInvitation.findFirst({
      where: {
        sellerId,
        email: { equals: emailLower, mode: 'insensitive' },
        usedAt: null,
        deletedAt: null,
        expiresAt: { gte: new Date() },
      },
      select: { id: true },
    });
  }

  private inviteUrlFor(plaintext: string): string {
    return `${this.env.sellerAppUrl}/auth/accept-team-invitation?token=${plaintext}`;
  }

  private toInvView(row: {
    id: string;
    email: string;
    role: SellerUserRole;
    invitedById: string;
    acceptedById: string | null;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
    deletedAt: Date | null;
  }): TeamInvitationView {
    return {
      id: row.id,
      email: row.email,
      role: row.role,
      invitedById: row.invitedById,
      acceptedById: row.acceptedById,
      expiresAt: row.expiresAt.toISOString(),
      usedAt: row.usedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    };
  }

  private async sendInvitationEmail(
    to: string,
    fullName: string,
    role: SellerUserRole,
    inviteUrl: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.email.enqueue({
        templateCode: 'seller.team_invitation.email',
        recipient: { type: NotificationRecipientType.SELLER, email: to },
        variables: {
          full_name: fullName,
          role,
          invite_url: inviteUrl,
          expires_at: expiresAt.toISOString(),
          expires_at_display: expiresAt.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        },
        triggerEvent: 'seller.team_invitation.created',
      });
    } catch {
      // Best-effort.
    }
  }
}
