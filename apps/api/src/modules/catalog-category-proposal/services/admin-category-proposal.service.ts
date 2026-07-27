import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, CategoryProposalStatus, NotificationRecipientType, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { EmailQueue } from '../../email/queue/email.queue';
import { CategoryService } from '../../catalog-category/services/category.service';
import { AttributeDefinitionService } from '../../catalog-attribute/services/attribute-definition.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type {
  ApproveProposalDto,
  ListAllProposalsQueryDto,
  RejectProposalDto,
} from '../dto/review-proposal.dto';
import type { CategoryProposalView } from './seller-category-proposal.service';

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

export interface ApprovalResult {
  proposal: CategoryProposalView;
  categoryId: string;
  attributeDefinitionsCreated: number;
}

@Injectable()
export class AdminCategoryProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
    private readonly audit: AuditLogService,
    private readonly email: EmailQueue,
    private readonly categories: CategoryService,
    private readonly attributes: AttributeDefinitionService,
  ) {}

  async list(
    query: ListAllProposalsQueryDto,
  ): Promise<{ items: CategoryProposalView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.CategoryProposalWhereInput = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.sellerId) where.sellerId = query.sellerId;

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

  async getById(id: string): Promise<CategoryProposalView> {
    const row = await this.prisma.client.categoryProposal.findFirst({
      where: { id, deletedAt: null },
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

  async approve(
    id: string,
    input: ApproveProposalDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<ApprovalResult> {
    const proposal = await this.prisma.client.categoryProposal.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        proposedName: true,
        proposedSlug: true,
        proposedParentId: true,
        status: true,
      },
    });
    if (!proposal) {
      throw new NotFoundException({
        code: 'PROPOSAL_NOT_FOUND',
        message: 'Category proposal not found',
      });
    }
    if (proposal.status !== CategoryProposalStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVALID_PROPOSAL_STATE',
        message: `Only PENDING proposals can be approved (current: ${proposal.status})`,
      });
    }

    const seller = await this.prisma.client.seller.findFirst({
      where: { id: proposal.sellerId },
      select: { id: true, email: true, companyName: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }

    const decisionNote = input.decisionNote?.trim() || null;

    const result = await this.prisma.client.$transaction(async (tx) => {
      // Re-validate status inside the tx (guards against a concurrent
      // approve/reject racing on the same proposal).
      const reChecked = await tx.categoryProposal.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!reChecked || reChecked.status !== CategoryProposalStatus.PENDING) {
        throw new BadRequestException({
          code: 'INVALID_PROPOSAL_STATE',
          message: 'Proposal is no longer pending',
        });
      }

      // createInTx re-checks slug uniqueness authoritatively + derives
      // depth/fullPath from the (optional) proposed parent.
      const category = await this.categories.createInTx(tx, {
        name: proposal.proposedName,
        slug: proposal.proposedSlug,
        parentId: proposal.proposedParentId,
        sortOrder: input.sortOrder,
        defaultPackageType: input.defaultPackageType ?? null,
        requiresFragile: input.requiresFragile,
        requiresColdChain: input.requiresColdChain,
        defaultHsCode: input.defaultHsCode ?? null,
        defaultGstRate: input.defaultGstRate ?? null,
      });

      const attrCount = await this.attributes.createManyInTx(
        tx,
        category.id,
        input.attributeDefinitions ?? [],
      );

      const updated = await tx.categoryProposal.update({
        where: { id },
        data: {
          status: CategoryProposalStatus.APPROVED,
          reviewedAt: new Date(),
          reviewedByStaffId: staffActorId,
          resultingCategoryId: category.id,
          decisionNote,
        },
        select: VIEW_SELECT,
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          sellerId: proposal.sellerId,
          action: 'catalog.category_proposal.approved',
          entityType: 'category_proposal',
          entityId: id,
          metadata: {
            resultingCategoryId: category.id,
            slug: category.slug,
            attributeDefinitionsCreated: attrCount,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );

      await this.email.enqueue({
        templateCode: 'seller.category_proposal_approved.email',
        recipient: {
          type: NotificationRecipientType.SELLER,
          id: seller.id,
          email: seller.email,
        },
        variables: {
          company_name: seller.companyName,
          proposed_name: proposal.proposedName,
          decision_note: decisionNote ? ` Note: ${decisionNote}` : '',
          app_url: this.env.sellerAppUrl,
          support_email: this.env.supportEmail,
        },
        triggerEvent: 'catalog.category_proposal.approved',
      });

      return { proposal: updated, categoryId: category.id, attributeDefinitionsCreated: attrCount };
    });

    return result;
  }

  async reject(
    id: string,
    input: RejectProposalDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<CategoryProposalView> {
    const proposal = await this.prisma.client.categoryProposal.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, sellerId: true, proposedName: true, status: true },
    });
    if (!proposal) {
      throw new NotFoundException({
        code: 'PROPOSAL_NOT_FOUND',
        message: 'Category proposal not found',
      });
    }
    if (proposal.status !== CategoryProposalStatus.PENDING) {
      throw new BadRequestException({
        code: 'INVALID_PROPOSAL_STATE',
        message: `Only PENDING proposals can be rejected (current: ${proposal.status})`,
      });
    }

    const seller = await this.prisma.client.seller.findFirst({
      where: { id: proposal.sellerId },
      select: { id: true, email: true, companyName: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }

    const decisionNote = input.decisionNote.trim();

    return this.prisma.client.$transaction(async (tx) => {
      const reChecked = await tx.categoryProposal.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!reChecked || reChecked.status !== CategoryProposalStatus.PENDING) {
        throw new BadRequestException({
          code: 'INVALID_PROPOSAL_STATE',
          message: 'Proposal is no longer pending',
        });
      }

      const updated = await tx.categoryProposal.update({
        where: { id },
        data: {
          status: CategoryProposalStatus.REJECTED,
          reviewedAt: new Date(),
          reviewedByStaffId: staffActorId,
          decisionNote,
        },
        select: VIEW_SELECT,
      });

      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          sellerId: proposal.sellerId,
          action: 'catalog.category_proposal.rejected',
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

      await this.email.enqueue({
        templateCode: 'seller.category_proposal_rejected.email',
        recipient: {
          type: NotificationRecipientType.SELLER,
          id: seller.id,
          email: seller.email,
        },
        variables: {
          company_name: seller.companyName,
          proposed_name: proposal.proposedName,
          decision_note: decisionNote,
          support_email: this.env.supportEmail,
        },
        triggerEvent: 'catalog.category_proposal.rejected',
      });

      return updated;
    });
  }
}
