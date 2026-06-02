import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, NotificationRecipientType, type Prisma } from '@skydrop/db';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../config/env.service';
import { TokenHashService } from '../auth-common/services/token-hash.service';
import { AuditLogService } from '../auth-common/services/audit-log.service';
import { EmailQueue } from '../email/queue/email.queue';
import type { ClientContext } from '../staff-auth/staff-auth.service';
import type {
  CreatedInvitationDto,
} from './dto/list.dto';
import type {
  InvitationListItemDto,
  InvitationListResponseDto,
  ListSellerInvitationsQueryDto,
  InvitationListStatus,
} from './dto/list.dto';

const DEFAULT_EXPIRES_IN_DAYS = 7;

interface CreateInput {
  email: string;
  expiresInDays?: number;
}

@Injectable()
export class SellerInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly hashes: TokenHashService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
  ) {}

  async create(
    input: CreateInput,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<CreatedInvitationDto> {
    const emailLower = input.email.trim().toLowerCase();

    // Refuse to invite someone who already has a seller account.
    const existing = await this.prisma.client.seller.findUnique({
      where: { email: emailLower },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'A seller account already exists for this email',
      });
    }

    // Refuse if there's already a live (unused, unexpired, not deleted)
    // invitation for this email. Resend should be used instead.
    const live = await this.findLiveInvitation(emailLower);
    if (live) {
      throw new ConflictException({
        code: 'INVITATION_ALREADY_PENDING',
        message: `A pending invitation already exists for ${input.email}. Resend it instead.`,
      });
    }

    const plaintext = this.hashes.generateInvitationToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(
      Date.now() + (input.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS) * 24 * 60 * 60 * 1000,
    );

    const row = await this.prisma.client.sellerInvitation.create({
      data: {
        email: input.email, // preserve original case for display
        token: tokenHash,
        invitedById: actor.staffId,
        expiresAt,
      },
      select: {
        id: true,
        email: true,
        invitedById: true,
        sellerId: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
      },
    });

    await this.email.enqueue({
      templateCode: 'seller.invitation.email',
      recipient: { type: NotificationRecipientType.SELLER, email: input.email },
      variables: {
        contact_name: input.email,
        invite_url: this.inviteUrlFor(plaintext),
        expires_at: expiresAt.toISOString(),
        expires_at_display: this.formatExpiresAt(expiresAt),
      },
      triggerEvent: 'seller.invitation.created',
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.seller_invitation.created',
      entityType: 'seller_invitation',
      entityId: row.id,
      metadata: {
        email: input.email,
        expiresAt: expiresAt.toISOString(),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return {
      ...this.toListItem(row),
      token: plaintext,
      inviteUrl: this.inviteUrlFor(plaintext),
    };
  }

  async list(query: ListSellerInvitationsQueryDto): Promise<InvitationListResponseDto> {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;

    const where: Prisma.SellerInvitationWhereInput = {};

    if (query.email) {
      where.email = { contains: query.email, mode: 'insensitive' };
    }
    if (query.createdAfter) where.createdAt = { ...(where.createdAt as object), gte: new Date(query.createdAfter) };
    if (query.createdBefore) where.createdAt = { ...(where.createdAt as object), lte: new Date(query.createdBefore) };

    const now = new Date();
    switch (query.status) {
      case 'used':
        where.usedAt = { not: null };
        where.deletedAt = null;
        break;
      case 'expired':
        where.usedAt = null;
        where.expiresAt = { lt: now };
        where.deletedAt = null;
        break;
      case 'pending':
        where.usedAt = null;
        where.expiresAt = { gte: now };
        where.deletedAt = null;
        break;
      case 'deleted':
        where.deletedAt = { not: null };
        break;
      default:
        // No status filter — exclude deleted by default.
        where.deletedAt = null;
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.sellerInvitation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          email: true,
          invitedById: true,
          sellerId: true,
          expiresAt: true,
          usedAt: true,
          createdAt: true,
          deletedAt: true,
        },
      }),
      this.prisma.client.sellerInvitation.count({ where }),
    ]);

    return {
      items: rows.map((r) => this.toListItem(r)),
      total,
      limit,
      offset,
    };
  }

  async resend(
    invitationId: string,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<CreatedInvitationDto> {
    const existing = await this.prisma.client.sellerInvitation.findUnique({
      where: { id: invitationId },
      select: {
        id: true,
        email: true,
        invitedById: true,
        usedAt: true,
        sellerId: true,
        deletedAt: true,
      },
    });
    if (!existing || existing.deletedAt !== null) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invitation not found' });
    }
    if (existing.usedAt !== null || existing.sellerId !== null) {
      throw new BadRequestException({
        code: 'INVITATION_ALREADY_USED',
        message: 'Cannot resend a used invitation',
      });
    }

    // Issue a brand-new token (rotate the hash). Old plaintext stops working.
    const plaintext = this.hashes.generateInvitationToken();
    const tokenHash = this.hashes.sha256Hex(plaintext);
    const expiresAt = new Date(Date.now() + DEFAULT_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);

    const row = await this.prisma.client.sellerInvitation.update({
      where: { id: invitationId },
      data: { token: tokenHash, expiresAt, invitedById: actor.staffId },
      select: {
        id: true,
        email: true,
        invitedById: true,
        sellerId: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
      },
    });

    await this.email.enqueue({
      templateCode: 'seller.invitation.email',
      recipient: { type: NotificationRecipientType.SELLER, email: row.email },
      variables: {
        contact_name: row.email,
        invite_url: this.inviteUrlFor(plaintext),
        expires_at: expiresAt.toISOString(),
        expires_at_display: this.formatExpiresAt(expiresAt),
      },
      triggerEvent: 'seller.invitation.resent',
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.seller_invitation.resent',
      entityType: 'seller_invitation',
      entityId: row.id,
      metadata: {
        email: row.email,
        expiresAt: expiresAt.toISOString(),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return {
      ...this.toListItem(row),
      token: plaintext,
      inviteUrl: this.inviteUrlFor(plaintext),
    };
  }

  async softDelete(
    invitationId: string,
    actor: { staffId: string },
    ctx: ClientContext,
  ): Promise<void> {
    const row = await this.prisma.client.sellerInvitation.findUnique({
      where: { id: invitationId },
      select: { id: true, email: true, usedAt: true, sellerId: true, deletedAt: true },
    });
    if (!row || row.deletedAt !== null) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Invitation not found' });
    }
    if (row.usedAt !== null || row.sellerId !== null) {
      throw new BadRequestException({
        code: 'INVITATION_ALREADY_USED',
        message: 'Cannot delete a used invitation',
      });
    }

    await this.prisma.client.sellerInvitation.update({
      where: { id: invitationId },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: actor.staffId,
      action: 'staff.seller_invitation.deleted',
      entityType: 'seller_invitation',
      entityId: invitationId,
      metadata: { email: row.email, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });
  }

  // ---------- internal ----------

  private toListItem(row: {
    id: string;
    email: string;
    invitedById: string;
    sellerId: string | null;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
    deletedAt?: Date | null;
  }): InvitationListItemDto {
    return {
      id: row.id,
      email: row.email,
      status: this.statusOf(row),
      invitedById: row.invitedById,
      sellerId: row.sellerId,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
    };
  }

  private statusOf(row: {
    usedAt: Date | null;
    expiresAt: Date;
    deletedAt?: Date | null;
  }): InvitationListStatus {
    if (row.deletedAt) return 'deleted';
    if (row.usedAt) return 'used';
    if (row.expiresAt.getTime() < Date.now()) return 'expired';
    return 'pending';
  }

  private async findLiveInvitation(emailLower: string) {
    return this.prisma.client.sellerInvitation.findFirst({
      where: {
        email: { equals: emailLower, mode: 'insensitive' },
        usedAt: null,
        deletedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
  }

  private inviteUrlFor(plaintext: string): string {
    return `${this.env.sellerAppUrl}/auth/accept-invitation?token=${plaintext}`;
  }

  /** Human-readable form for the email template (e.g.
   *  "9 June 2026, 03:32 UTC"). Avoids dumping a raw ISO string at
   *  the recipient. */
  private formatExpiresAt(d: Date): string {
    const date = d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const time = d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
      hour12: false,
    });
    return `${date}, ${time} UTC`;
  }
}
