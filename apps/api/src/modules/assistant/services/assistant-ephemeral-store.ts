import type { AssistantAudience, AssistantMessageRole, Prisma } from '@skydrop/db';
import type { ConversationRow, StoredMessage } from './assistant-store.service';

/**
 * ONE conversation held in memory, standing in for `AssistantStoreService` when
 * the recommendations gate asks the real chat service an eval question.
 *
 * Why not the database: a gate run is hundreds of throwaway conversations.
 * Stored, they would show up in the conversation explorer, in the usage and
 * the 80% budget alert of the people-facing line, and be re-scored by the
 * overnight monitor. Held here, they exist for the length of one question and
 * leave nothing behind but the usage numbers, which the gate records on its
 * own budget line.
 *
 * It implements exactly the methods the chat service calls on its store and
 * pins the conversation to the knowledge version under test.
 */
export class EphemeralChatStore {
  readonly rows: Array<StoredMessage & { conversationId: string }> = [];
  readonly usage: Array<{ costUsd: Prisma.Decimal; tokens: TokenCounts }> = [];
  readonly tools: string[] = [];
  readonly notices: string[] = [];
  private seq = 0;
  private readonly conversation: ConversationRow;

  constructor(
    audience: AssistantAudience,
    private readonly versionId: string | null,
  ) {
    this.conversation = {
      id: '00000000-0000-7000-8000-00000000e7a1',
      audience,
      title: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  get conversationId(): string {
    return this.conversation.id;
  }

  async knowledgeVersionOf(): Promise<string | null> {
    return this.versionId;
  }
  async findOwned(): Promise<ConversationRow> {
    return this.conversation;
  }
  async setTitleIfEmpty(): Promise<void> {}
  async touch(): Promise<void> {}
  async questionsIn(): Promise<number> {
    return this.rows.filter((r) => r.isQuestion).length;
  }
  async messages(): Promise<StoredMessage[]> {
    return [...this.rows];
  }
  async appendMessage(
    conversationId: string,
    role: AssistantMessageRole,
    content: unknown,
    isQuestion = false,
  ): Promise<string> {
    const id = `m${String(++this.seq).padStart(6, '0')}`;
    this.rows.push({ id, conversationId, role, content, isQuestion, createdAt: new Date() });
    return id;
  }
  async appendQuestion(_scope: unknown, conversationId: string, content: unknown): Promise<void> {
    await this.appendMessage(conversationId, 'USER', content, true);
  }
  async appendToolRound(
    conversationId: string,
    assistantContent: unknown,
    toolResults: unknown,
  ): Promise<void> {
    await this.appendMessage(conversationId, 'ASSISTANT', assistantContent);
    await this.appendMessage(conversationId, 'USER', toolResults);
  }
  async recordToolCall(row: { toolName: string }): Promise<void> {
    this.tools.push(row.toolName);
  }
  async recordNotice(_conversationId: string, _audience: string, code: string): Promise<void> {
    this.notices.push(code);
  }
  async recordUsage(row: {
    costUsd: Prisma.Decimal;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  }): Promise<void> {
    this.usage.push({
      costUsd: row.costUsd,
      tokens: {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
      },
    });
  }
}

export interface TokenCounts {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}
