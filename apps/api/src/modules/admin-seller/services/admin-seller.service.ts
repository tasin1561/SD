import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  AddressOwnerType,
  AddressType,
  OnboardingStepActor,
  Prisma,
  SellerNoteCategory,
  SellerOnboardingStep,
  SellerStatus,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SellerAccountStatusService } from '../../seller-management/services/seller-account-status.service';
import {
  SellerOnboardingService,
  type OnboardingProgressView,
} from '../../seller-onboarding/services/seller-onboarding.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { ListSellersQueryDto } from '../dto/list-sellers.dto';
import type {
  CreateSellerNoteDto,
  ListSellerNotesQueryDto,
  UpdateSellerNoteDto,
} from '../dto/note.dto';
import type { UpdateSellerStatusDto } from '../dto/update-status.dto';
import type { OnboardingStepOverrideDto } from '../dto/onboarding-override.dto';

const SELLER_OWNED_ADDRESS_TYPES: AddressType[] = [
  AddressType.BD_ORIGIN,
  AddressType.BD_OFFICE,
  AddressType.IN_RETURN,
];

export interface SellerListItem {
  id: string;
  email: string;
  emailDisplay: string;
  companyName: string;
  contactPersonName: string;
  status: SellerStatus;
  approvedAt: Date | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  onboardingComplete: boolean;
}

export interface SellerListResponse {
  items: SellerListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SellerDetailView extends SellerListItem {
  phone: string;
  whatsapp: string | null;
  displayCurrency: string;
  displayLanguage: string;
  countryCode: string;
  approvedById: string | null;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankRoutingNumber: string | null;
  bankSwiftCode: string | null;
  addresses: Array<{
    id: string;
    type: AddressType;
    label: string | null;
    city: string;
    stateProvince: string;
    postalCode: string;
    countryCode: string;
    isDefault: boolean;
  }>;
  onboarding: OnboardingProgressView;
  recentAuditLogs: Array<{
    id: string;
    action: string;
    actorType: ActorType;
    staffUserId: string | null;
    sellerId: string | null;
    entityType: string;
    entityId: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
  }>;
  notes: Array<{
    id: string;
    authorId: string;
    category: SellerNoteCategory;
    content: string;
    isPinned: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface SellerNoteView {
  id: string;
  sellerId: string;
  authorId: string;
  category: SellerNoteCategory;
  content: string;
  isPinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AdminSellerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly status: SellerAccountStatusService,
    private readonly onboarding: SellerOnboardingService,
  ) {}

  async list(query: ListSellersQueryDto): Promise<SellerListResponse> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sort = query.sort ?? 'createdAt:desc';

    const where: Prisma.SellerWhereInput = { deletedAt: null };

    if (query.status?.length) {
      where.status = { in: query.status };
    }
    if (query.search) {
      where.OR = [
        { email: { contains: query.search.toLowerCase(), mode: 'insensitive' } },
        { companyName: { contains: query.search, mode: 'insensitive' } },
        { contactPersonName: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.createdAtFrom || query.createdAtTo) {
      where.createdAt = {};
      if (query.createdAtFrom) where.createdAt.gte = new Date(query.createdAtFrom);
      if (query.createdAtTo) where.createdAt.lte = new Date(query.createdAtTo);
    }
    if (query.approvedAtFrom || query.approvedAtTo) {
      where.approvedAt = {};
      if (query.approvedAtFrom) where.approvedAt.gte = new Date(query.approvedAtFrom);
      if (query.approvedAtTo) where.approvedAt.lte = new Date(query.approvedAtTo);
    }

    // onboardingComplete is derived from seller_onboarding_progress. To
    // filter we issue a sub-query.
    if (query.onboardingComplete !== undefined) {
      const matchingSellerIds = await this.findSellerIdsByOnboardingComplete(
        query.onboardingComplete,
      );
      where.id = { in: matchingSellerIds };
    }

    const [rows, total] = await Promise.all([
      this.prisma.client.seller.findMany({
        where,
        orderBy: this.orderByFor(sort),
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          id: true,
          email: true,
          emailDisplay: true,
          companyName: true,
          contactPersonName: true,
          status: true,
          approvedAt: true,
          emailVerifiedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.client.seller.count({ where }),
    ]);

    const sellerIds = rows.map((r) => r.id);
    const completionBySeller = await this.completionMap(sellerIds);

    return {
      items: rows.map((r) => ({
        ...r,
        onboardingComplete: completionBySeller.get(r.id) ?? false,
      })),
      total,
      page,
      pageSize,
    };
  }

  async getDetail(sellerId: string): Promise<SellerDetailView> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: {
        id: true,
        email: true,
        emailDisplay: true,
        companyName: true,
        contactPersonName: true,
        status: true,
        approvedAt: true,
        approvedById: true,
        emailVerifiedAt: true,
        createdAt: true,
        phone: true,
        whatsapp: true,
        displayCurrency: true,
        displayLanguage: true,
        countryCode: true,
        bankName: true,
        bankAccountName: true,
        bankAccountNumber: true,
        bankRoutingNumber: true,
        bankSwiftCode: true,
      },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }

    const [addresses, onboarding, recentAuditLogs, notes] = await Promise.all([
      this.prisma.client.address.findMany({
        where: {
          ownerType: AddressOwnerType.SELLER,
          ownerId: sellerId,
          deletedAt: null,
          type: { in: SELLER_OWNED_ADDRESS_TYPES },
        },
        orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          type: true,
          label: true,
          city: true,
          stateProvince: true,
          postalCode: true,
          countryCode: true,
          isDefault: true,
        },
      }),
      this.onboarding.getProgress(sellerId),
      this.prisma.client.auditLog.findMany({
        where: { sellerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          actorType: true,
          staffUserId: true,
          sellerId: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.client.sellerNote.findMany({
        where: { sellerId, deletedAt: null },
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        take: 20,
        select: {
          id: true,
          authorId: true,
          category: true,
          content: true,
          isPinned: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      ...seller,
      onboardingComplete: onboarding.isComplete,
      addresses,
      onboarding,
      recentAuditLogs,
      notes,
    };
  }

  async updateStatus(
    sellerId: string,
    input: UpdateSellerStatusDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<{ sellerId: string; newStatus: SellerStatus }> {
    if (input.newStatus === SellerStatus.SUSPENDED) {
      if (!input.reasonNote || input.reasonNote.trim().length === 0) {
        throw new BadRequestException({
          code: 'REASON_NOTE_REQUIRED',
          message: 'reasonNote is required when suspending a seller',
        });
      }
      const result = await this.status.suspend({
        sellerId,
        staffActorId,
        reasonNote: input.reasonNote,
        ctx,
      });
      return { sellerId, newStatus: result.newStatus };
    }
    if (input.newStatus === SellerStatus.APPROVED) {
      const result = await this.status.reapprove({
        sellerId,
        staffActorId,
        ...(input.reasonNote ? { noteContent: input.reasonNote } : {}),
        ctx,
      });
      return { sellerId, newStatus: result.newStatus };
    }
    throw new BadRequestException({
      code: 'INVALID_STATUS_TRANSITION',
      message: 'Admin status update only supports SUSPENDED or APPROVED',
    });
  }

  async listNotes(
    sellerId: string,
    query: ListSellerNotesQueryDto,
  ): Promise<{ items: SellerNoteView[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.SellerNoteWhereInput = { sellerId, deletedAt: null };
    if (query.category) where.category = query.category;

    const [rows, total] = await Promise.all([
      this.prisma.client.sellerNote.findMany({
        where,
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        take: pageSize,
        skip: (page - 1) * pageSize,
        select: {
          id: true,
          sellerId: true,
          authorId: true,
          category: true,
          content: true,
          isPinned: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.client.sellerNote.count({ where }),
    ]);
    return { items: rows, total, page, pageSize };
  }

  async createNote(
    sellerId: string,
    input: CreateSellerNoteDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<SellerNoteView> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }

    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.sellerNote.create({
        data: {
          sellerId,
          authorId: staffActorId,
          category: input.category,
          content: input.content,
          isPinned: input.isPinned ?? false,
        },
        select: {
          id: true,
          sellerId: true,
          authorId: true,
          category: true,
          content: true,
          isPinned: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          sellerId,
          action: 'staff.seller_note.created',
          entityType: 'seller_note',
          entityId: row.id,
          metadata: {
            category: input.category,
            isPinned: input.isPinned ?? false,
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

  async updateNote(
    sellerId: string,
    noteId: string,
    input: UpdateSellerNoteDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<SellerNoteView> {
    const existing = await this.prisma.client.sellerNote.findFirst({
      where: { id: noteId, sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'NOTE_NOT_FOUND', message: 'Note not found' });
    }

    const data: Prisma.SellerNoteUpdateInput = {};
    const changes: Record<string, string | boolean | null> = {};
    if (input.content !== undefined) {
      data.content = input.content;
      changes['content'] = 'updated';
    }
    if (input.isPinned !== undefined) {
      data.isPinned = input.isPinned;
      changes['isPinned'] = input.isPinned;
    }
    if (Object.keys(changes).length === 0) {
      return this.requireNote(sellerId, noteId);
    }

    return this.prisma.client.$transaction(async (tx) => {
      const row = await tx.sellerNote.update({
        where: { id: noteId },
        data,
        select: {
          id: true,
          sellerId: true,
          authorId: true,
          category: true,
          content: true,
          isPinned: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          sellerId,
          action: 'staff.seller_note.updated',
          entityType: 'seller_note',
          entityId: noteId,
          changes: changes as Prisma.InputJsonValue,
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

  async deleteNote(
    sellerId: string,
    noteId: string,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<void> {
    const existing = await this.prisma.client.sellerNote.findFirst({
      where: { id: noteId, sellerId, deletedAt: null },
      select: { id: true, category: true },
    });
    if (!existing) {
      throw new NotFoundException({ code: 'NOTE_NOT_FOUND', message: 'Note not found' });
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.sellerNote.update({
        where: { id: noteId },
        data: { deletedAt: new Date() },
      });
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          sellerId,
          action: 'staff.seller_note.deleted',
          entityType: 'seller_note',
          entityId: noteId,
          metadata: {
            category: existing.category,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
        },
        tx,
      );
    });
  }

  async getOnboarding(sellerId: string): Promise<OnboardingProgressView> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }
    return this.onboarding.getProgress(sellerId);
  }

  async overrideOnboardingStep(
    sellerId: string,
    stepCode: SellerOnboardingStep,
    input: OnboardingStepOverrideDto,
    staffActorId: string,
    ctx: ClientContext,
  ): Promise<OnboardingProgressView> {
    const seller = await this.prisma.client.seller.findFirst({
      where: { id: sellerId, deletedAt: null },
      select: { id: true },
    });
    if (!seller) {
      throw new NotFoundException({ code: 'SELLER_NOT_FOUND', message: 'Seller not found' });
    }

    await this.prisma.client.$transaction(async (tx) => {
      const result = await this.onboarding.markStepComplete(
        sellerId,
        stepCode,
        OnboardingStepActor.ADMIN,
        input.reason ? { reason: input.reason, staffActorId } : { staffActorId },
        tx,
      );
      await this.audit.log(
        {
          actorType: ActorType.STAFF,
          staffUserId: staffActorId,
          sellerId,
          action: 'staff.seller_onboarding.step_overridden',
          entityType: 'seller_onboarding_progress',
          entityId: null,
          metadata: {
            stepCode,
            reason: input.reason ?? null,
            alreadyComplete: !result.marked,
            onboardingCompletedNow: result.onboardingCompleted,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            requestId: ctx.requestId,
          },
          severity: 'MEDIUM',
        },
        tx,
      );
    });

    return this.onboarding.getProgress(sellerId);
  }

  // ---------- internal ----------

  private async findSellerIdsByOnboardingComplete(want: boolean): Promise<string[]> {
    // Sellers with `incomplete` are those who have at least one required
    // step not yet completed. Complete = no required-step rows with
    // completedAt null.
    const incomplete = await this.prisma.client.sellerOnboardingProgress.findMany({
      where: { isRequired: true, completedAt: null },
      select: { sellerId: true },
      distinct: ['sellerId'],
    });
    const incompleteIds = new Set(incomplete.map((r) => r.sellerId));

    if (!want) {
      return Array.from(incompleteIds);
    }
    const allSellers = await this.prisma.client.seller.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    return allSellers.filter((s) => !incompleteIds.has(s.id)).map((s) => s.id);
  }

  private async completionMap(sellerIds: string[]): Promise<Map<string, boolean>> {
    const map = new Map<string, boolean>();
    if (sellerIds.length === 0) return map;
    const incomplete = await this.prisma.client.sellerOnboardingProgress.findMany({
      where: { sellerId: { in: sellerIds }, isRequired: true, completedAt: null },
      select: { sellerId: true },
      distinct: ['sellerId'],
    });
    const incompleteSet = new Set(incomplete.map((r) => r.sellerId));
    for (const id of sellerIds) {
      map.set(id, !incompleteSet.has(id));
    }
    return map;
  }

  private async requireNote(sellerId: string, noteId: string): Promise<SellerNoteView> {
    const row = await this.prisma.client.sellerNote.findFirst({
      where: { id: noteId, sellerId, deletedAt: null },
      select: {
        id: true,
        sellerId: true,
        authorId: true,
        category: true,
        content: true,
        isPinned: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOTE_NOT_FOUND', message: 'Note not found' });
    }
    return row;
  }

  private orderByFor(sort: string): Prisma.SellerOrderByWithRelationInput {
    switch (sort) {
      case 'createdAt:asc':
        return { createdAt: 'asc' };
      case 'companyName:asc':
        return { companyName: 'asc' };
      case 'approvedAt:desc':
        return { approvedAt: { sort: 'desc', nulls: 'last' } };
      case 'createdAt:desc':
      default:
        return { createdAt: 'desc' };
    }
  }
}
