import { Injectable } from '@nestjs/common';
import type { CallerScope } from '../assistant.types';
import { AssistantChatService } from './assistant-chat.service';
import { AssistantStoreService, type ConversationRow } from './assistant-store.service';

export interface TranscriptLine {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly at: string;
  /** Chips for the files a question carried: name, type and size. Never the bytes. */
  readonly attachments?: ReadonlyArray<{
    readonly id: string;
    readonly kind: 'IMAGE' | 'PDF';
    readonly mediaType: string;
    readonly name: string;
    readonly bytes: number;
    readonly pages: number | null;
  }>;
}

type Block = { type?: string; text?: string };

/**
 * What the portal may show of a stored turn: the words a person typed and
 * the words the assistant wrote. Tool calls, tool results and thinking
 * are never sent back to a browser — a tool result is another copy of
 * somebody's data, and there is nothing in it the screen needs.
 */
export function visibleText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return (
    (content as Block[])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      // The page note stored with a question is for the model, not the screen.
      .filter((b) => !(b.text as string).startsWith('<untrusted_page_context>'))
      .map((b) => b.text as string)
      .join('')
  );
}

@Injectable()
export class AssistantConversationService {
  constructor(
    private readonly store: AssistantStoreService,
    private readonly chat: AssistantChatService,
  ) {}

  create(scope: CallerScope, title: string | null): Promise<ConversationRow> {
    return this.store.createConversation(scope, title);
  }

  list(scope: CallerScope): Promise<ConversationRow[]> {
    return this.store.listConversations(scope, 50);
  }

  /** Only the caller's own; anyone else's is a 404, not a 403 (it does not "exist" for them). */
  async getMine(
    scope: CallerScope,
    id: string,
  ): Promise<{ conversation: ConversationRow; messages: TranscriptLine[] }> {
    const conversation = await this.chat.requireOwned(scope, id);
    const rows = await this.store.messages(conversation.id);
    const messages: TranscriptLine[] = [];
    const sent = await this.store.sentAttachments(conversation.id);
    for (const r of rows) {
      const text = visibleText(r.content);
      const files = sent.filter((a) => a.messageId === r.id);
      if (text.trim() === '' && files.length === 0) continue;
      messages.push({
        role: r.role === 'USER' ? 'user' : 'assistant',
        text,
        at: r.createdAt.toISOString(),
        ...(files.length > 0
          ? {
              attachments: files.map((a) => ({
                id: a.id,
                kind: a.kind,
                mediaType: a.mediaType,
                name: a.originalName,
                bytes: a.bytes,
                pages: a.pages,
              })),
            }
          : {}),
      });
    }
    return { conversation, messages };
  }
}
