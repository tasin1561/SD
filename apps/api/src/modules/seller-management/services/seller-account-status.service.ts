import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ActorType,
  NotificationRecipientType,
  SellerNoteCategory,
  SellerStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EmailQueue } from '../../email/queue/email.queue';
import type { ClientContext } from '../../seller-auth/seller-auth.service';

const DEFAULT_REAPPROVAL_NOTE = 'Account reapproved';

export interface SuspendInput {
  sellerId: string;
  staffActorId: string;
  reasonNote: string;
  ctx: ClientContext;
}

export interface ReapproveInput {
  sellerId: string;
  staffActorId: string;
  noteContent?: string;
  ctx: ClientContext;
}

export interface StatusChangeResult {
  sellerId: string;
  previousStatus: SellerStatus;
  newStatus: SellerStatus;
  noteId: string;
}

/**
 * Owns transitions on `sellers.status`. Centralizing the mutation here
 * keeps the four side effects (status update, refresh-token revoke, audit
 * note, audit log, transactional email) consistent everywhere — the admin
 * controller delegates; future modules (e.g., automated compliance
 * triggers) call into the same surface.
 *
 * All transitions are atomic: status, tokens, note, audit log, and the
 * email-queue add live inside a single `prisma.$transaction`. If the queue
 * write fails, the DB rolls back so we don't end up with a "SUSPENDED but
 * no record" state. A phantom job (Redis add accepted but tx commit fails
 * after) is handled by the worker's idempotency on (sellerId, templateCode,
 * triggerEvent) when it lands.
 */
@Injectable()
export class SellerAccountStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
  ) {}

  async suspend(input: SuspendInput): Promise<StatusChangeResult> {
    const trimmedReason = input.reasonNote.trim();
    if (trimmedReason.length === 0) {
      throw new BadRequestException({
        code: 'REASON_NOTE_REQUIRED',
        message: 'A reason note is required when suspending a seller',
      });
    }

    const seller = await this.prisma.client.seller.findFirst({
      where: { id: input.sellerId, deletedAt: null },
      select: { id: true, email: true, companyName: true, status: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }
    if (seller.status !== SellerStatus.APPROVED) {
      throw new BadRequestException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot suspend a seller with status ${seller.status}; only APPROVED → SUSPENDED is allowed`,
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      const now = new Date();

      await tx.seller.update({
        where: { id: seller.id },
        data: { status: SellerStatus.SUSPENDED },
      });

      await tx.sellerRefreshToken.updateMany({
        where: { sellerUser: { sellerId: seller.id }, revokedAt: null },
        data: { revokedAt: now },
      });

      const note = await tx.sellerNote.create({
        data: {
          sellerId: seller.id,
          authorId: input.staffActorId,
          content: trimmedReason,
          category: SellerNoteCategory.COMPLIANCE,
          isPinned: true,
        },
        select: { id: true },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: input.staffActorId,
          sellerId: seller.id,
          action: 'seller.suspended',
          entityType: 'seller',
          entityId: seller.id,
          changes: { status: { from: SellerStatus.APPROVED, to: SellerStatus.SUSPENDED } },
          metadata: {
            reason: trimmedReason,
            noteId: note.id,
            ipAddress: input.ctx.ipAddress,
            userAgent: input.ctx.userAgent,
            requestId: input.ctx.requestId,
          },
          severity: 'HIGH',
        },
        tx,
      );

      await this.email.enqueue({
        templateCode: 'seller.account_suspended.email',
        recipient: {
          type: NotificationRecipientType.SELLER,
          id: seller.id,
          email: seller.email,
        },
        variables: {
          company_name: seller.companyName,
          reason: trimmedReason,
          support_email: this.env.supportEmail,
          app_url: this.env.sellerAppUrl,
        },
        triggerEvent: 'seller.suspended',
      });

      return {
        sellerId: seller.id,
        previousStatus: SellerStatus.APPROVED,
        newStatus: SellerStatus.SUSPENDED,
        noteId: note.id,
      };
    });
  }

  async reapprove(input: ReapproveInput): Promise<StatusChangeResult> {
    const trimmedNote = input.noteContent?.trim() ?? '';
    const noteContent = trimmedNote.length > 0 ? trimmedNote : DEFAULT_REAPPROVAL_NOTE;

    const seller = await this.prisma.client.seller.findFirst({
      where: { id: input.sellerId, deletedAt: null },
      select: { id: true, email: true, companyName: true, status: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }
    if (seller.status !== SellerStatus.SUSPENDED) {
      throw new BadRequestException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot reapprove a seller with status ${seller.status}; only SUSPENDED → APPROVED is allowed`,
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      await tx.seller.update({
        where: { id: seller.id },
        data: { status: SellerStatus.APPROVED },
      });

      const note = await tx.sellerNote.create({
        data: {
          sellerId: seller.id,
          authorId: input.staffActorId,
          content: noteContent,
          category: SellerNoteCategory.GENERAL,
          isPinned: false,
        },
        select: { id: true },
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: input.staffActorId,
          sellerId: seller.id,
          action: 'seller.reapproved',
          entityType: 'seller',
          entityId: seller.id,
          changes: { status: { from: SellerStatus.SUSPENDED, to: SellerStatus.APPROVED } },
          metadata: {
            noteId: note.id,
            note: noteContent,
            ipAddress: input.ctx.ipAddress,
            userAgent: input.ctx.userAgent,
            requestId: input.ctx.requestId,
          },
          severity: 'MEDIUM',
        },
        tx,
      );

      await this.email.enqueue({
        templateCode: 'seller.account_reapproved.email',
        recipient: {
          type: NotificationRecipientType.SELLER,
          id: seller.id,
          email: seller.email,
        },
        variables: {
          company_name: seller.companyName,
          support_email: this.env.supportEmail,
          app_url: this.env.sellerAppUrl,
        },
        triggerEvent: 'seller.reapproved',
      });

      return {
        sellerId: seller.id,
        previousStatus: SellerStatus.SUSPENDED,
        newStatus: SellerStatus.APPROVED,
        noteId: note.id,
      };
    });
  }
}
