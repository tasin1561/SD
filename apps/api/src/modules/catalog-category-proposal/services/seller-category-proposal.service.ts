import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType, CategoryProposalStatus, NotificationRecipientType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EmailQueue } from '../../email/queue/email.queue';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { CreateCategoryProposalDto } from '../dto/create-proposal.dto';
import type { ListCategoryProposalsQueryDto } from '../dto/list-proposals.dto';

export interface CategoryProposalView {
  id: string;
  sellerId: string;
  proposedName: string;
  proposedParentId: string | null;
  proposedSlug: string;
  rationale: string;
  status: CategoryProposalStatus;
  reviewedByStaffId: string | null;
  reviewedAt: Date | null;
  decisionNote: string | null;
  resultingCategoryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const VIEW_SELECT = {
  id: true,
  sellerId: true,
  proposedName: true,
  proposedParentId: true,
  proposedSlug: true,
  rationale: true,
  status: true,
  reviewedByStaffId: true,
  reviewedAt: true,
  decisionNote: true,
  resultingCategoryId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class SellerCategoryProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
  ) {}

  async propose(
    sellerId: string,
    input: CreateCategoryProposalDto,
    ctx: ClientContext,
  ): Promise<CategoryProposalView> {
    // Slug must not already belong to a real category. (Final authoritative
    // re-check happens at approval time, per the approval-tx rule.)
    const slugTaken = await this.prisma.client.category.findUnique({
      where: { slug: input.proposedSlug },
      select: { id: true },
    });
    if (slugTaken) {
      throw new ConflictException({
        code: 'SLUG_TAKEN',
        message: `A category with slug "${input.proposedSlug}" already exists`,
      });
    }

    if (input.proposedParentId) {
      const parent = await this.prisma.client.category.findFirst({
        where: { id: input.proposedParentId, deletedAt: null },
        select: { id: true },
      });
      if (!parent) {
        throw new BadRequestException({
          code: 'PARENT_NOT_FOUND',
          message: 'Proposed parent category not found',
        });
      }
    }

    // One live (PENDING) proposal per (seller, slug) — resubmits should
    // wait for the prior decision or withdraw it first.
    const dupPending = await this.prisma.client.categoryProposal.findFirst({
      where: {
        sellerId,
        proposedSlug: input.proposedSlug,
        status: CategoryProposalStatus.PENDING,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (dupPending) {
      throw new ConflictException({
        code: 'PROPOSAL_ALREADY_PENDING',
        message: `You already have a pending proposal for slug "${input.proposedSlug}"`,
      });
    }

    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true, email: true, companyName: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }

    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.categoryProposal.create({
        data: {
          sellerId,
          proposedName: input.proposedName,
          proposedSlug: input.proposedSlug,
          proposedParentId: input.proposedParentId ?? null,
          rationale: input.rationale,
          status: CategoryProposalStatus.PENDING,
        },
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.category_proposal.created',
          entityType: 'category_proposal',
          entityId: row.id,
          metadata: {
            proposedSlug: row.proposedSlug,
            proposedParentId: row.proposedParentId,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      // Enqueue inside the tx (Module 2 pattern): if the queue add fails
      // the proposal rolls back; worker-side idempotency covers the
      // commit-fails-after-enqueue edge.
      await this.email.enqueue({
        templateCode: 'seller.category_proposal_received.email',
        recipient: {
          type: NotificationRecipientType.SELLER,
          id: seller.id,
          email: seller.email,
        },
        variables: {
          company_name: seller.companyName,
          proposed_name: row.proposedName,
          app_url: this.env.sellerAppUrl,
        },
        triggerEvent: 'catalog.category_proposal.created',
      });
      return row;
    });
  }

  async list(
    sellerId: string,
    query: ListCategoryProposalsQueryDto,
  ): Promise<{ items: CategoryProposalView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CategoryProposalWhereInput = { sellerId, deletedAt: null };
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      this.prisma.client.categoryProposal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: VIEW_SELECT,
      }),
      this.prisma.client.categoryProposal.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async getById(sellerId: string, id: string): Promise<CategoryProposalView> {
    const row = await this.prisma.client.categoryProposal.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: VIEW_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        code: 'PROPOSAL_NOT_FOUND',
        message: 'Category proposal not found',
      });
    }
    return row;
  }

  async withdraw(sellerId: string, id: string, ctx: ClientContext): Promise<CategoryProposalView> {
    const existing = await this.prisma.client.categoryProposal.findFirst({
      where: { id, sellerId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'PROPOSAL_NOT_FOUND',
        message: 'Category proposal not found',
      });
    }
    if (existing.status !== CategoryProposalStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVALID_PROPOSAL_STATE',
        message: `Only PENDING proposals can be withdrawn (current: ${existing.status})`,
      });
    }

    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.categoryProposal.update({
        where: { id },
        data: { status: CategoryProposalStatus.WITHDRAWN },
        select: VIEW_SELECT,
      });
      await this.audit.log(
        {
          actorType: ActorType.SELLER,
          sellerId,
          action: 'catalog.category_proposal.withdrawn',
          entityType: 'category_proposal',
          entityId: id,
          metadata: {
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
      return row;
    });
  }
}
