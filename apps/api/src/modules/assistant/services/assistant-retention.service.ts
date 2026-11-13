import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SpacesService } from '../../../infrastructure/spaces/spaces.service';

/** Conversations are kept this long after their last activity, then anonymised. */
export const RETENTION_DAYS = 180;
export const REMOVED = '[removed]';
const BATCH = 25;
const MAX_BATCHES_PER_RUN = 40;

export interface RetentionResult {
  readonly conversations: number;
  readonly files: number;
  readonly failed: number;
}

/**
 * The 180-day rule. A conversation whose last activity is older than the
 * cut-off keeps its SHAPE and its MONEY (usage and cost rows, counts, dates,
 * portal, owner ids, notices, ratings) and loses everything a person wrote or
 * attached: message text and tool results, the question-and-answer blocks,
 * attachment names and bytes (the bucket objects are deleted), feedback
 * comments, ticket-proposal wording, tool inputs and the title.
 *
 * Idempotent: a conversation is selected only while `anonymised_at IS NULL`,
 * the rewrite is the same on a second pass, and a bucket delete that fails
 * leaves the conversation untouched so the next night retries it. Batched, so
 * a long backlog never holds one big transaction. `updated_at` is written back
 * to its own value so anonymising never makes a conversation look recent.
 */
@Injectable()
export class AssistantRetentionService {
  private readonly log = new Logger(AssistantRetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly spaces: SpacesService,
  ) {}

  async run(now: Date = new Date(), days = RETENTION_DAYS): Promise<RetentionResult> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    let conversations = 0;
    let files = 0;
    let failed = 0;
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const batch = await this.prisma.client.assistantConversation.findMany({
        where: { anonymisedAt: null, updatedAt: { lt: cutoff } },
        orderBy: { updatedAt: 'asc' },
        take: BATCH,
        select: { id: true, updatedAt: true },
      });
      if (batch.length === 0) break;
      let progressed = 0;
      for (const conv of batch) {
        try {
          files += await this.anonymise(conv.id, conv.updatedAt, now);
          conversations++;
          progressed++;
        } catch (e) {
          failed++;
          this.log.warn(
            `anonymise failed conversation=${conv.id}: ${e instanceof Error ? e.message : 'unknown'}`,
          );
        }
      }
      // A whole batch that failed would be re-selected forever; stop and let tomorrow retry.
      if (progressed === 0) break;
    }
    this.log.log({ conversations, files, failed }, 'Assistant retention pass finished');
    return { conversations, files, failed };
  }

  private async anonymise(id: string, updatedAt: Date, now: Date): Promise<number> {
    const c = this.prisma.client;
    const atts = await c.assistantAttachment.findMany({
      where: { conversationId: id, storageKey: { not: '' } },
      select: { storageKey: true },
    });
    // Bucket first: if it throws, nothing in the database has changed.
    if (atts.length > 0) await this.spaces.deleteObjects(atts.map((a) => a.storageKey));
    await c.$transaction(async (tx) => {
      await tx.assistantMessage.updateMany({
        where: { conversationId: id },
        data: { content: [{ type: 'text', text: REMOVED }] },
      });
      await tx.assistantToolCall.updateMany({ where: { conversationId: id }, data: { input: {} } });
      await tx.assistantAttachment.updateMany({
        where: { conversationId: id },
        data: { originalName: REMOVED, storageKey: '' },
      });
      await tx.assistantFeedback.updateMany({
        where: { conversationId: id },
        data: { comment: null },
      });
      await tx.assistantTicketProposal.updateMany({
        where: { conversationId: id },
        data: { subject: REMOVED, description: REMOVED, orderNumber: null },
      });
      await tx.assistantConversation.update({
        where: { id },
        data: { title: null, anonymisedAt: now, updatedAt },
      });
    });
    return atts.length;
  }
}
