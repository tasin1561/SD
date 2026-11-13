import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type AssistantAttachmentKind,
  type AssistantAudience,
  type AssistantMessageRole,
  type AssistantTicketProposalStatus,
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
    // A PUBLIC conversation is bound to the ONE AWB of the page it was opened
    // on: the same visitor key on another parcel's page matches nothing.
    ...(scope.publicAwb === undefined ? {} : { publicAwb: scope.publicAwb }),
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

/** What the browser may know of a proposal. Never the owner columns. */
export interface ProposalRow {
  readonly id: string;
  readonly conversationId: string;
  readonly subject: string;
  readonly description: string;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly status: AssistantTicketProposalStatus;
  readonly ticketId: string | null;
  readonly ticketNumber: string | null;
  readonly requestId: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
}

const PROPOSAL_SELECT = {
  id: true,
  conversationId: true,
  subject: true,
  description: true,
  orderId: true,
  orderNumber: true,
  status: true,
  ticketId: true,
  ticketNumber: true,
  requestId: true,
  createdAt: true,
  decidedAt: true,
} as const;

/** The same predicate for a proposal: the owner columns AND the conversation must be the caller's. */
export function proposalOwnedBy(scope: CallerScope): Prisma.AssistantTicketProposalWhereInput {
  return {
    audience: scope.audience,
    ownerUserId: scope.userId,
    impersonatedByStaffId: scope.impersonatingStaffId,
    conversation: ownedBy(scope),
  };
}

/** Files that can ride along with one ticket. */
export const MAX_TICKET_PHOTOS = 10;

/** Pending proposals one conversation may hold at once (a model cannot flood the screen). */
export const MAX_PENDING_PROPOSALS = 3;

const asJson = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/**
 * The assistant's only door to its four tables. Messages are APPEND-ONLY:
 * there is no update or delete of a message here, and there must not be.
 */
@Injectable()
export class AssistantStoreService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The knowledge version this conversation started with (null = the base
   * alone). Written once, at creation, and never changed.
   */
  async knowledgeVersionOf(conversationId: string): Promise<string | null> {
    const row = await this.prisma.client.assistantConversation.findUnique({
      where: { id: conversationId },
      select: { knowledgeVersionId: true },
    });
    return row?.knowledgeVersionId ?? null;
  }

  async createConversation(scope: CallerScope, title: string | null): Promise<ConversationRow> {
    // PIN: whatever is live right now is the version this conversation keeps.
    const live = await this.prisma.client.assistantKnowledgeLive.findUnique({ where: { id: 1 } });
    return this.prisma.client.assistantConversation.create({
      data: {
        knowledgeVersionId: live?.versionId ?? null,
        audience: scope.audience,
        ownerUserId: scope.userId,
        sellerId: scope.sellerId,
        storeId: scope.storeId,
        impersonatedByStaffId: scope.impersonatingStaffId,
        ...(scope.publicAwb === undefined ? {} : { publicAwb: scope.publicAwb }),
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
  ): Promise<string> {
    const row = await this.prisma.client.assistantMessage.create({
      data: { conversationId, role, content: asJson(content), isQuestion },
      select: { id: true },
    });
    return row.id;
  }

  /** A fixed notice that was shown. A CODE only, never text. Best effort: never breaks an answer. */
  async recordNotice(
    conversationId: string,
    audience: AssistantAudience,
    code: string,
  ): Promise<void> {
    try {
      await this.prisma.client.assistantNotice.create({
        data: { conversationId, audience, code },
      });
    } catch {
      // A missing statistic must not turn a notice into a 500.
    }
  }

  // ── feedback (thumbs) ─────────────────────────────────────────────
  // Owner-only: written and read back through the owner columns. Never part
  // of what the model is sent.

  /** The ASSISTANT message `messageId`, if it is in a conversation the caller owns. */
  async findOwnedAnswer(
    scope: CallerScope,
    messageId: string,
  ): Promise<{ id: string; conversationId: string } | null> {
    return this.prisma.client.assistantMessage.findFirst({
      where: { id: messageId, role: 'ASSISTANT', conversation: ownedBy(scope) },
      select: { id: true, conversationId: true },
    });
  }

  async upsertFeedback(
    scope: CallerScope,
    msg: { id: string; conversationId: string },
    rating: 'UP' | 'DOWN',
    comment: string | null,
  ): Promise<void> {
    await this.prisma.client.assistantFeedback.upsert({
      where: { messageId_ownerUserId: { messageId: msg.id, ownerUserId: scope.userId } },
      create: {
        messageId: msg.id,
        conversationId: msg.conversationId,
        audience: scope.audience,
        ownerUserId: scope.userId,
        sellerId: scope.sellerId,
        storeId: scope.storeId,
        impersonatedByStaffId: scope.impersonatingStaffId,
        rating,
        comment,
      },
      update: { rating, comment },
    });
  }

  async removeFeedback(scope: CallerScope, messageId: string): Promise<void> {
    await this.prisma.client.assistantFeedback.deleteMany({
      where: { messageId, ownerUserId: scope.userId, audience: scope.audience },
    });
  }

  /** The caller's own ratings in a conversation, by message id. */
  async feedbackFor(
    scope: CallerScope,
    conversationId: string,
  ): Promise<Array<{ messageId: string; rating: 'UP' | 'DOWN' }>> {
    return this.prisma.client.assistantFeedback.findMany({
      where: { conversationId, ownerUserId: scope.userId, audience: scope.audience },
      select: { messageId: true, rating: true },
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

  // ── ticket proposals ───────────────────────────────────────────────
  // The model may only ever INSERT one of these (through `propose_ticket`).
  // Every transition out of PENDING is a guarded `updateMany` that names the
  // owner columns, so a click that is not the owner's, or not the first,
  // matches nothing.

  /**
   * Store a proposal. The same words already waiting in this conversation
   * are returned instead of stored twice (a model that repeats itself must
   * not stack up cards), and a conversation holds at most
   * `MAX_PENDING_PROPOSALS` waiting ones.
   */
  async createProposal(
    scope: CallerScope,
    conversationId: string,
    row: {
      subject: string;
      description: string;
      orderId: string | null;
      orderNumber: string | null;
    },
  ): Promise<{ proposal: ProposalRow; created: boolean } | null> {
    const waiting = await this.prisma.client.assistantTicketProposal.findMany({
      where: { conversationId, status: 'PENDING', ...proposalOwnedBy(scope) },
      select: PROPOSAL_SELECT,
    });
    const same = waiting.find(
      (p) => p.subject === row.subject && p.description === row.description,
    );
    if (same !== undefined) return { proposal: same, created: false };
    if (waiting.length >= MAX_PENDING_PROPOSALS) return null;
    const proposal = await this.prisma.client.assistantTicketProposal.create({
      data: {
        conversationId,
        audience: scope.audience,
        ownerUserId: scope.userId,
        sellerId: scope.sellerId,
        storeId: scope.storeId,
        impersonatedByStaffId: scope.impersonatingStaffId,
        subject: row.subject,
        description: row.description,
        orderId: row.orderId,
        orderNumber: row.orderNumber,
      },
      select: PROPOSAL_SELECT,
    });
    return { proposal, created: true };
  }

  /** A conversation's proposals, oldest first. The caller has already proved the conversation is theirs. */
  proposals(conversationId: string): Promise<ProposalRow[]> {
    return this.prisma.client.assistantTicketProposal.findMany({
      where: { conversationId },
      orderBy: { id: 'asc' },
      select: PROPOSAL_SELECT,
    });
  }

  findOwnedProposal(scope: CallerScope, id: string): Promise<ProposalRow | null> {
    return this.prisma.client.assistantTicketProposal.findFirst({
      where: { id, ...proposalOwnedBy(scope) },
      select: PROPOSAL_SELECT,
    });
  }

  /**
   * THE exactly-once gate. PENDING → CONFIRMED for the owner, and only the
   * one caller whose UPDATE matched the PENDING row gets `true`; a second
   * click, a second tab or a replay matches nothing.
   */
  async claimProposal(scope: CallerScope, id: string): Promise<boolean> {
    const claimed = await this.prisma.client.assistantTicketProposal.updateMany({
      where: { id, status: 'PENDING', ...proposalOwnedBy(scope) },
      data: { status: 'CONFIRMED', decidedAt: new Date() },
    });
    return claimed.count === 1;
  }

  /**
   * Compensation: the ticket was NOT created, so the claim is given back.
   * Guarded on "no outcome recorded", so it can never reopen a proposal
   * that already produced a ticket or a held request.
   */
  async releaseProposal(scope: CallerScope, id: string): Promise<void> {
    await this.prisma.client.assistantTicketProposal.updateMany({
      where: {
        id,
        status: 'CONFIRMED',
        ticketId: null,
        requestId: null,
        ...proposalOwnedBy(scope),
      },
      data: { status: 'PENDING', decidedAt: null },
    });
  }

  /** What the claim produced. Written once, right after the ticket exists. */
  async recordProposalOutcome(
    id: string,
    outcome: { ticketId: string | null; ticketNumber: string | null; requestId: string | null },
  ): Promise<void> {
    await this.prisma.client.assistantTicketProposal.updateMany({
      where: { id, status: 'CONFIRMED', ticketId: null, requestId: null },
      data: outcome,
    });
  }

  /**
   * Link the files the person had ALREADY sent in this conversation to the
   * ticket their button press raised. Owner columns, the conversation and
   * "already sent" are all in the WHERE, so a file that is not the caller's,
   * not this conversation's or not yet asked about is never linked. Idempotent
   * on UNIQUE (ticket_id, attachment_id): a replayed confirm adds nothing.
   * Files that were rebuilt away by retention (empty key) are skipped.
   */
  async linkSentAttachmentsToTicket(
    scope: CallerScope,
    conversationId: string,
    ticketId: string,
    proposalId: string,
  ): Promise<number> {
    const sent = await this.prisma.client.assistantAttachment.findMany({
      where: {
        conversationId,
        messageId: { not: null },
        storageKey: { not: '' },
        ...attachmentOwnedBy(scope),
      },
      orderBy: { id: 'asc' },
      take: MAX_TICKET_PHOTOS,
      select: { id: true },
    });
    if (sent.length === 0) return 0;
    const made = await this.prisma.client.assistantTicketAttachment.createMany({
      data: sent.map((a) => ({ ticketId, attachmentId: a.id, proposalId })),
      skipDuplicates: true,
    });
    return made.count;
  }

  /** The files linked to one ticket, oldest first. Callers must already have proven the ticket is theirs to see. */
  async ticketAttachments(ticketId: string): Promise<AttachmentRow[]> {
    const links = await this.prisma.client.assistantTicketAttachment.findMany({
      where: { ticketId, attachment: { storageKey: { not: '' } } },
      orderBy: { id: 'asc' },
      take: MAX_TICKET_PHOTOS,
      select: { attachment: { select: ATTACHMENT_SELECT } },
    });
    return links.map((l) => l.attachment);
  }

  async dismissProposal(scope: CallerScope, id: string): Promise<boolean> {
    const dismissed = await this.prisma.client.assistantTicketProposal.updateMany({
      where: { id, status: 'PENDING', ...proposalOwnedBy(scope) },
      data: { status: 'DISMISSED', decidedAt: new Date() },
    });
    return dismissed.count === 1;
  }

  /**
   * Own the alert for (month, threshold). `INSERT ... ON CONFLICT DO NOTHING`
   * on the unique key: exactly one caller, across concurrent requests,
   * replays and restarts, gets `true`.
   */
  async claimBudgetAlert(
    month: string,
    threshold: number,
    spentUsd: Prisma.Decimal,
    budgetUsd: number,
  ): Promise<boolean> {
    const r = await this.prisma.client.assistantBudgetAlert.createMany({
      data: [{ month, threshold, spentUsd, budgetUsd: new Prisma.Decimal(budgetUsd) }],
      skipDuplicates: true,
    });
    return r.count === 1;
  }

  /** Give a claim back when the alert could not be raised at all, so a later request tries again. */
  async releaseBudgetAlert(month: string, threshold: number): Promise<void> {
    await this.prisma.client.assistantBudgetAlert.deleteMany({ where: { month, threshold } });
  }

  /**
   * Everything the CONSOLE audiences have spent since `since` (start of the
   * UTC month). The public parcel helper has its own line and its own cap
   * (`publicCostSince`), so a flood on a tracking page can never use up the
   * staff's and clients' budget.
   */
  async costSince(since: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.client.assistantUsage.aggregate({
      where: { createdAt: { gte: since }, audience: { not: 'PUBLIC' } },
      _sum: { costUsd: true },
    });
    return agg._sum.costUsd ?? new Prisma.Decimal(0);
  }

  /** Everything the public parcel helper has spent since `since` (billed figure). */
  async publicCostSince(since: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.client.assistantUsage.aggregate({
      where: { createdAt: { gte: since }, audience: 'PUBLIC' },
      _sum: { costUsd: true },
    });
    return agg._sum.costUsd ?? new Prisma.Decimal(0);
  }

  /** Questions already asked in ONE conversation (the public helper's turn cap). */
  questionsIn(conversationId: string): Promise<number> {
    return this.prisma.client.assistantMessage.count({
      where: { conversationId, isQuestion: true },
    });
  }

  /** Everything the overnight monitor has spent since `since` (billed figure). */
  async monitorCostSince(since: Date): Promise<Prisma.Decimal> {
    const agg = await this.prisma.client.assistantMonitorUsage.aggregate({
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
