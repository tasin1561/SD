import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type AssistantAttachmentKind,
  type AssistantAudience,
  type AssistantMessageRole,
} from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { CallerScope } from '../assistant.types';

export interface StoredMessage {
  readonly id: string;
  readonly role: AssistantMessageRole;
  readonly content: unknown;
  readonly isQuestion: boolean;
  readonly createdAt: Date;
}

export interface ConversationRow {
  readonly id: string;
  readonly audience: AssistantAudience;
  readonly title: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * THE ownership predicate. Every read of a conversation goes through it,
 * and it is the whole of "a user can only ever read their own
 * conversations":
 *
 *  - `audience` + `ownerUserId` — the person, from the guard's identity;
 *  - `impersonatedByStaffId` — a conversation opened inside a support
 *    session is the impersonated user's by identity but is shown ONLY
 *    back to that staff member, and the real owner, signing in later,
 *    never sees what support asked on their account. Outside a session
 *    the column must be NULL, so a session's conversations never appear
 *    in the owner's list either.
 */
export function ownedBy(scope: CallerScope): Prisma.AssistantConversationWhereInput {
  return {
    audience: scope.audience,
    ownerUserId: scope.userId,
    impersonatedByStaffId: scope.impersonatingStaffId,
    deletedAt: null,
  };
}

/** The attachment columns a caller may read (never the owner columns). */
export interface AttachmentRow {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string | null;
  readonly kind: AssistantAttachmentKind;
  readonly mediaType: string;
  readonly originalName: string;
  readonly bytes: number;
  readonly pages: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly sha256: string;
  readonly storageKey: string;
}

const ATTACHMENT_SELECT = {
  id: true,
  conversationId: true,
  messageId: true,
  kind: true,
  mediaType: true,
  originalName: true,
  bytes: true,
  pages: true,
  width: true,
  height: true,
  sha256: true,
  storageKey: true,
} as const;

/** The same predicate for an attachment row: the owner columns must be the caller's. */
export function attachmentOwnedBy(scope: CallerScope): Prisma.AssistantAttachmentWhereInput {
  return {
    audience: scope.audience,
    ownerUserId: scope.userId,
    impersonatedByStaffId: scope.impersonatingStaffId,
    conversation: ownedBy(scope),
  };
}

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/**
 * The assistant's only door to its four tables. Messages are APPEND-ONLY:
 * there is no update or delete of a message here, and there must not be.
 */
@Injectable()
export class AssistantStoreService {
  constructor(private readonly prisma: PrismaService) {}

  createConversation(scope: CallerScope, title: string | null): Promise<ConversationRow> {
    return this.prisma.client.assistantConversation.create({
      data: {
        audience: scope.audience,
        ownerUserId: scope.userId,
        sellerId: scope.sellerId,
        storeId: scope.storeId,
        impersonatedByStaffId: scope.impersonatingStaffId,
        title,
      },
      select: { id: true, audience: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  listConversations(scope: CallerScope, limit: number): Promise<ConversationRow[]> {
    return this.prisma.client.assistantConversation.findMany({
      where: ownedBy(scope),
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, audience: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  findOwned(scope: CallerScope, id: string): Promise<ConversationRow | null> {
    return this.prisma.client.assistantConversation.findFirst({
      where: { id, ...ownedBy(scope) },
      select: { id: true, audience: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  async setTitleIfEmpty(id: string, title: string): Promise<void> {
    await this.prisma.client.assistantConversation.updateMany({
      where: { id, title: null },
      data: { title },
    });
  }

  async touch(id: string): Promise<void> {
    await this.prisma.client.assistantConversation.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
  }

  messages(conversationId: string): Promise<StoredMessage[]> {
    return this.prisma.client.assistantMessage.findMany({
      where: { conversationId },
      orderBy: { id: 'asc' },
      select: { id: true, role: true, content: true, isQuestion: true, createdAt: true },
    });
  }

  async appendMessage(
    conversationId: string,
    role: AssistantMessageRole,
    content: unknown,
    isQuestion = false,
  ): Promise<void> {
    await this.prisma.client.assistantMessage.create({
      data: { conversationId, role, content: asJson(content), isQuestion },
    });
  }

  /**
   * The question a person typed, and the link from each attachment it
   * carries to it, in ONE transaction. The link is a guarded `updateMany`
   * (`message_id IS NULL`, same conversation, same owner): an id that is
   * someone else's, from another conversation, or already sent matches
   * nothing, the count falls short, and the whole question is rolled back
   * with a 404 — so two racing sends of the same attachment cannot both win.
   */
  async appendQuestion(
    scope: CallerScope,
    conversationId: string,
    content: unknown,
    attachmentIds: readonly string[],
  ): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      const msg = await tx.assistantMessage.create({
        data: { conversationId, role: 'USER', content: asJson(content), isQuestion: true },
        select: { id: true },
      });
      if (attachmentIds.length === 0) return;
      const linked = await tx.assistantAttachment.updateMany({
        where: {
          id: { in: [...attachmentIds] },
          conversationId,
          messageId: null,
          audience: scope.audience,
          ownerUserId: scope.userId,
          impersonatedByStaffId: scope.impersonatingStaffId,
        },
        data: { messageId: msg.id },
      });
      if (linked.count !== attachmentIds.length) {
        throw new NotFoundException({
          code: 'ASSISTANT_ATTACHMENT_NOT_FOUND',
          message: 'Attachment not found',
        });
      }
    });
  }

  createAttachment(row: {
    scope: CallerScope;
    conversationId: string;
    kind: AssistantAttachmentKind;
    mediaType: string;
    originalName: string;
    bytes: number;
    pages: number | null;
    width: number | null;
    height: number | null;
    sha256: string;
    storageKey: string;
  }): Promise<AttachmentRow> {
    return this.prisma.client.assistantAttachment.create({
      data: {
        conversationId: row.conversationId,
        audience: row.scope.audience,
        ownerUserId: row.scope.userId,
        sellerId: row.scope.sellerId,
        storeId: row.scope.storeId,
        impersonatedByStaffId: row.scope.impersonatingStaffId,
        kind: row.kind,
        mediaType: row.mediaType,
        originalName: row.originalName,
        bytes: row.bytes,
        pages: row.pages,
        width: row.width,
        height: row.height,
        sha256: row.sha256,
        storageKey: row.storageKey,
      },
      select: ATTACHMENT_SELECT,
    });
  }

  /** The caller's own attachments, in THIS conversation, among `ids`. */
  findOwnedAttachments(
    scope: CallerScope,
    conversationId: string,
    ids: readonly string[],
    unsentOnly: boolean,
  ): Promise<AttachmentRow[]> {
    return this.prisma.client.assistantAttachment.findMany({
      where: {
        id: { in: [...ids] },
        conversationId,
        ...(unsentOnly ? { messageId: null } : {}),
        ...attachmentOwnedBy(scope),
      },
      select: ATTACHMENT_SELECT,
    });
  }

  countUnsentAttachments(scope: CallerScope, conversationId: string): Promise<number> {
    return this.prisma.client.assistantAttachment.count({
      where: { conversationId, messageId: null, ...attachmentOwnedBy(scope) },
    });
  }

  /** Replay: rows of a conversation the caller already owns, by id. */
  attachmentsByIds(conversationId: string, ids: readonly string[]): Promise<AttachmentRow[]> {
    return this.prisma.client.assistantAttachment.findMany({
      where: { id: { in: [...ids] }, conversationId },
      select: ATTACHMENT_SELECT,
    });
  }

  /** The transcript's chips: every SENT attachment of a conversation. */
  sentAttachments(conversationId: string): Promise<AttachmentRow[]> {
    return this.prisma.client.assistantAttachment.findMany({
      where: { conversationId, messageId: { not: null } },
      orderBy: { id: 'asc' },
      select: ATTACHMENT_SELECT,
    });
  }

  /** An assistant turn that asked for tools and the user turn that answers it — together or not at all. */
  async appendToolRound(
    conversationId: string,
    assistantContent: unknown,
    toolResults: unknown,
  ): Promise<void> {
    // Two inserts in order; uuidv7 ids sort by insertion time, so `id asc`
    // replays them in order.
    await this.prisma.client.$transaction(async (tx) => {
      await tx.assistantMessage.create({
        data: { conversationId, role: 'ASSISTANT', content: asJson(assistantContent) },
      });
      await tx.assistantMessage.create({
        data: { conversationId, role: 'USER', content: asJson(toolResults) },
      });
    });
  }

  async recordToolCall(row: {
    conversationId: string;
    scope: CallerScope;
    toolName: string;
    input: Record<string, unknown> | null;
    resultBytes: number;
    ok: boolean;
    errorCode: string | null;
  }): Promise<void> {
    await this.prisma.client.assistantToolCall.create({
      data: {
        conversationId: row.conversationId,
        audience: row.scope.audience,
        callerUserId: row.scope.userId,
        sellerId: row.scope.sellerId,
        storeId: row.scope.storeId,
        impersonatedByStaffId: row.scope.impersonatingStaffId,
        toolName: row.toolName,
        input: asJson(row.input ?? {}),
        resultBytes: row.resultBytes,
        ok: row.ok,
        errorCode: row.errorCode,
      },
    });
  }

  async recordUsage(row: {
    conversationId: string;
    scope: CallerScope;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: Prisma.Decimal;
  }): Promise<void> {
    await this.prisma.client.assistantUsage.create({
      data: {
        conversationId: row.conversationId,
        audience: row.scope.audience,
        callerUserId: row.scope.userId,
        impersonatedByStaffId: row.scope.impersonatingStaffId,
        model: row.model,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        costUsd: row.costUsd,
      },
    });
  }

  /** Everything spent since `since` (start of the UTC month). */
  async costSince(since: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.client.assistantUsage.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { costUsd: true },
    });
    return agg._sum.costUsd ?? new Prisma.Decimal(0);
  }

  /** Questions this person typed since `since` (start of the UTC day). */
  questionsSince(scope: CallerScope, since: Date): Promise<number> {
    return this.prisma.client.assistantMessage.count({
      where: {
        isQuestion: true,
        createdAt: { gte: since },
        conversation: { audience: scope.audience, ownerUserId: scope.userId },
      },
    });
  }
}
