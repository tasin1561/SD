import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ActorType, NotificationRecipientType, StaffRole } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { PasswordService } from '../../auth-common/services/password.service';
import { TokenHashService } from '../../auth-common/services/token-hash.service';
import { EmailQueue } from '../../email/queue/email.queue';
import type { ClientContext } from '../../staff-auth/staff-auth.service';
import type { CreateStaffInvitationDto } from '../dto/create-staff-invitation.dto';
import { staffRoleKeyForEnum } from '../../../common/auth/staff-role-key';

/**
 * Phase 1B — admin staff invitations.
 *
 * - `create()` issues a one-time-use plaintext token (returned ONCE in
 *   the response + emailed to the invitee). DB stores the sha256 of the
 *   token; on accept we sha256 the presented token + look it up.
 * - `accept()` consumes the token, creates a `staff_users` row with the
 *   invite-time role, marks the invitation USED, returns the staff id
 *   for the auth flow to issue tokens.
 * - All writes audited; SUPER_ADMIN-only at the controller layer.
 */
const DEFAULT_EXPIRES_IN_DAYS = 7;

export interface InvitationListItem {
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

export interface CreatedInvitation extends InvitationListItem {
  readonly token: string;
  readonly inviteUrl: string;
}

@Injectable()
export class StaffInvitationService {
  private readonly logger = new Logger(StaffInvitationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly hashes: TokenHashService,
    private readonly password: PasswordService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
  ) {}

  private async sendInvitationEmail(
    to: string,
    role: StaffRole,
    inviteUrl: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.email.enqueue({
        templateCode: 'staff.invitation.email',
        recipient: { type: NotificationRecipientType.SELLER, email: to },
        variables: {
          role,
          invite_url: inviteUrl,
          expires_at: expiresAt.toISOString(),
          expires_at_display: expiresAt.toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
        },
        triggerEvent: 'staff.invitation.created',
      });
    } catch {
      // Best-effort: a queue failure must not block the invite.
      // The admin still has the link in the reveal card.
    }
  }

  async create(
    input: CreateStaffInvitationDto,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<CreatedInvitation> {
    const emailLower = input.email.trim().toLowerCase();

    // Refuse if a staff account already exists.
    const existing = await this.prisma.client.staffUser.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'A staff account already exists for this email',
      });
    }

    // Refuse if there's a live pending invitation.
    const live = await this.findLive(emailLower);
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

    const row = await this.prisma.client.staffInvitation.create({
      data: {
        email: input.email,
        token: tokenHash,
        role: input.role,
        invitedById: actor.staffId,
        expiresAt,
      },
      select: {
        id: true,
        email: true,
        role: true,
        invitedById: true,
        acceptedById: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        deletedAt: true,
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_invitation.created',
      entityType: 'staff_invitation',
      entityId: row.id,
      severity: 'MEDIUM',
      changes: { email: input.email, role: input.role },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    const url = this.inviteUrlFor(plaintext);
    await this.sendInvitationEmail(input.email, input.role, url, expiresAt);
    return {
      ...this.toView(row),
      token: plaintext,
      inviteUrl: url,
    };
  }

  async list(): Promise<{ items: InvitationListItem[]; total: number }> {
    const rows = await this.prisma.client.staffInvitation.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        email: true,
        role: true,
        invitedById: true,
        acceptedById: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        deletedAt: true,
      },
    });
    return { items: rows.map((r) => this.toView(r)), total: rows.length };
  }

  async resend(
    invitationId: string,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<CreatedInvitation> {
    const existing = await this.prisma.client.staffInvitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true,
        email: true,
        role: true,
        usedAt: true,
        deletedAt: true,
      },
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

    const updated = await this.prisma.client.staffInvitation.update({
      where: { id: invitationId },
      data: { token: tokenHash, expiresAt },
      select: {
        id: true,
        email: true,
        role: true,
        invitedById: true,
        acceptedById: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        deletedAt: true,
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_invitation.resent',
      entityType: 'staff_invitation',
      entityId: invitationId,
      severity: 'MEDIUM',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    const url = this.inviteUrlFor(plaintext);
    await this.sendInvitationEmail(updated.email, updated.role, url, expiresAt);
    return { ...this.toView(updated), token: plaintext, inviteUrl: url };
  }

  async softDelete(
    invitationId: string,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<void> {
    const existing = await this.prisma.client.staffInvitation.findUnique({
      where: { id: invitationId },
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
        message: 'Cannot delete a redeemed invitation',
      });
    }
    await this.prisma.client.staffInvitation.update({
      where: { id: invitationId },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_invitation.revoked',
      entityType: 'staff_invitation',
      entityId: invitationId,
      severity: 'MEDIUM',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
  }

  /**
   * Accept an invitation — creates the staff_users row + marks the
   * invitation USED in one tx. The caller (controller) then issues
   * a session via the staff-auth refresh flow.
   */
  async accept(
    plaintextToken: string,
    plaintextPassword: string,
    ctx: ClientContext,
  ): Promise<{ staffId: string; email: string; role: StaffRole }> {
    const tokenHash = this.hashes.sha256Hex(plaintextToken);
    const inv = await this.prisma.client.staffInvitation.findUnique({
      where: { token: tokenHash },
      select: {
        id: true,
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
        message: 'Invitation has expired; ask an admin to resend it',
      });
    }
    const emailLower = inv.email.trim().toLowerCase();
    const existingStaff = await this.prisma.client.staffUser.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });
    if (existingStaff) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'A staff account already exists for this email',
      });
    }

    const passwordHash = await this.password.hash(plaintextPassword);
    const now = new Date();

    const created = await this.prisma.client.$transaction(async (tx) => {
      const re = await tx.staffInvitation.findUnique({
        where: { id: inv.id },
        select: { usedAt: true },
      });
      if (re?.usedAt !== null) {
        throw new ConflictException({
          code: 'INVITATION_ALREADY_USED',
          message: 'This invitation has already been used',
        });
      }
      const staff = await tx.staffUser.create({
        data: {
          email: emailLower,
          emailDisplay: inv.email,
          passwordHash,
          role: inv.role,
          staffRole: { connect: { key: staffRoleKeyForEnum(inv.role) } },
          emailVerifiedAt: now,
        },
        select: { id: true, email: true, role: true },
      });
      await tx.staffInvitation.update({
        where: { id: inv.id },
        data: { usedAt: now, acceptedById: staff.id },
      });
      return staff;
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: created.id,
      action: 'staff.staff_invitation.accepted',
      entityType: 'staff_user',
      entityId: created.id,
      severity: 'MEDIUM',
      changes: { invitationId: inv.id, role: inv.role, email: inv.email },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    // A note confirming the account exists, where to sign in, and which
    // address is the username.
    //
    // Best-effort AFTER the account is committed: the person is about to
    // be signed in and a mail fault must not undo an account that now
    // exists, nor answer with an error to someone whose signup worked.
    //
    // Worth sending even though they are already logged in — the value is
    // three days later, on a different device, when the question is
    // "which of my addresses was it, and where do I go". That is exactly
    // when nobody has the invitation email any more.
    try {
      await this.email.enqueue({
        templateCode: 'staff.welcome.email',
        recipient: {
          type: NotificationRecipientType.STAFF,
          id: created.id,
          email: created.email,
        },
        variables: {
          email: created.email,
          role: created.role,
          login_url: `${this.env.adminAppUrl}/login`,
          support_email: this.env.supportEmail,
        },
        triggerEvent: 'staff.invitation.accepted',
      });
    } catch (e) {
      this.logger.error(
        { staffId: created.id, err: (e as Error).message },
        'Staff welcome email could not be queued; the account IS created',
      );
    }

    return { staffId: created.id, email: created.email, role: created.role };
  }

  // ── Active staff users (admin "team" page) ─────────────────────────

  async listStaff(): Promise<
    Array<{
      id: string;
      email: string;
      emailDisplay: string;
      role: StaffRole;
      emailVerifiedAt: string | null;
      lastLoginAt: string | null;
      createdAt: string;
      deletedAt: string | null;
    }>
  > {
    const rows = await this.prisma.client.staffUser.findMany({
      orderBy: [{ deletedAt: 'asc' }, { createdAt: 'desc' }],
      take: 500,
      select: {
        id: true,
        email: true,
        emailDisplay: true,
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
      role: r.role,
      emailVerifiedAt: r.emailVerifiedAt?.toISOString() ?? null,
      lastLoginAt: r.lastLoginAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      deletedAt: r.deletedAt?.toISOString() ?? null,
    }));
  }

  async updateRole(
    targetStaffId: string,
    newRole: StaffRole,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<{ id: string; role: StaffRole }> {
    if (targetStaffId === actor.staffId) {
      throw new BadRequestException({
        code: 'CANNOT_CHANGE_OWN_ROLE',
        message: 'A SUPER_ADMIN cannot change their own role',
      });
    }
    const before = await this.prisma.client.staffUser.findUnique({
      where: { id: targetStaffId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!before || before.deletedAt !== null) {
      throw new NotFoundException({
        code: 'STAFF_NOT_FOUND',
        message: 'Staff user not found',
      });
    }
    if (before.role === newRole) {
      return { id: before.id, role: before.role };
    }
    const updated = await this.prisma.client.staffUser.update({
      where: { id: targetStaffId },
      data: { role: newRole },
      select: { id: true, role: true },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_user.role_changed',
      entityType: 'staff_user',
      entityId: targetStaffId,
      severity: 'MEDIUM',
      changes: { before: before.role, after: newRole },
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
    return updated;
  }

  async deactivate(
    targetStaffId: string,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<void> {
    if (targetStaffId === actor.staffId) {
      throw new BadRequestException({
        code: 'CANNOT_DEACTIVATE_SELF',
        message: 'A SUPER_ADMIN cannot deactivate their own account',
      });
    }
    const target = await this.prisma.client.staffUser.findUnique({
      where: { id: targetStaffId },
      select: { id: true, deletedAt: true },
    });
    if (!target) {
      throw new NotFoundException({
        code: 'STAFF_NOT_FOUND',
        message: 'Staff user not found',
      });
    }
    if (target.deletedAt !== null) return;
    await this.prisma.client.staffUser.update({
      where: { id: targetStaffId },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.staff_user.deactivated',
      entityType: 'staff_user',
      entityId: targetStaffId,
      severity: 'HIGH',
      metadata: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private async findLive(emailLower: string): Promise<{ id: string } | null> {
    return this.prisma.client.staffInvitation.findFirst({
      where: {
        email: { equals: emailLower, mode: 'insensitive' },
        usedAt: null,
        deletedAt: null,
        expiresAt: { gte: new Date() },
      },
      select: { id: true },
    });
  }

  private inviteUrlFor(plaintext: string): string {
    return `${this.env.adminAppUrl}/auth/accept-invitation?token=${plaintext}`;
  }

  private toView(row: {
    id: string;
    email: string;
    role: StaffRole;
    invitedById: string;
    acceptedById: string | null;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
    deletedAt: Date | null;
  }): InvitationListItem {
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
}
