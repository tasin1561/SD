import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { windowStart, toApiMessages } from '../assistant-history';
import { detectReplyLanguage, helpLinks, noticeText, type NoticeCode } from '../assistant-language';
import { assistantCostUsd } from '../assistant-pricing';
import { systemPromptFor } from '../assistant-system-prompt';
import { ASSISTANT_MODEL, type AssistantStreamEvent, type CallerScope } from '../assistant.types';
import { AssistantBudgetService } from './assistant-budget.service';
import { AssistantModelGateway, type AssistantModelRequest } from './assistant-model-gateway';
import { AssistantStoreService, type ConversationRow } from './assistant-store.service';
import { AssistantToolRegistry } from './assistant-tool-registry.service';
import { renderPageContext, type AssistantPageContext } from '../assistant-page-context';

/** Room for adaptive thinking (~4000) plus the answer. */
export const MAX_OUTPUT_TOKENS = 6000;
/** Tool rounds inside one answer. */
export const MAX_TOOL_ROUNDS = 5;
export const MAX_QUESTION_CHARS = 2000;

type Emit = (event: AssistantStreamEvent) => void;

/**
 * One question -> one streamed answer.
 *
 * The order of events is the safety story:
 *   1. the conversation must be the caller's (404 otherwise);
 *   2. the kill switch, the key and the budget are checked BEFORE the
 *      model is called — a refusal here never reaches Claude;
 *   3. the question is stored, then each model response and each tool
 *      round are stored as they happen, append-only;
 *   4. tools run with the CALLER's scope, never anything the model said.
 */
@Injectable()
export class AssistantChatService {
  private readonly log = new Logger(AssistantChatService.name);

  constructor(
    private readonly store: AssistantStoreService,
    private readonly budget: AssistantBudgetService,
    private readonly registry: AssistantToolRegistry,
    private readonly gateway: AssistantModelGateway,
  ) {}

  /** 404 unless the conversation is the caller's (shared by every endpoint). */
  async requireOwned(scope: CallerScope, id: string): Promise<ConversationRow> {
    const conv = await this.store.findOwned(scope, id);
    if (conv === null) {
      throw new NotFoundException({
        code: 'ASSISTANT_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    return conv;
  }

  async send(
    scope: CallerScope,
    conversationId: string,
    text: string,
    emit: Emit,
    pageContext?: AssistantPageContext | null,
  ): Promise<void> {
    const conv = await this.requireOwned(scope, conversationId);
    const lang = detectReplyLanguage(text);
    const notice = (code: NoticeCode): void => {
      emit({
        type: 'notice',
        code,
        text: noticeText(code, lang),
        helpLinks: helpLinks(scope.audience, lang),
      });
      emit({ type: 'done', conversationId: conv.id });
    };

    // ── gates: nothing below this block runs, and Claude is not called ──
    const verdict = await this.budget.check(scope);
    if (!verdict.ok) return notice(verdict.code);
    if (!this.gateway.isConfigured()) return notice('NOT_CONFIGURED');

    await this.store.appendMessage(conv.id, 'USER', [{ type: 'text', text }], true);
    await this.store.setTitleIfEmpty(conv.id, text.replace(/\s+/g, ' ').slice(0, 60));

    // The window is fixed ONCE per question: if it moved between tool
    // rounds the prefix the round's thinking blocks are bound to would
    // change under them.
    const rows = await this.store.messages(conv.id);
    const start = windowStart(rows);
    let currentTurnStart = rows.length - 1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i]?.isQuestion === true) {
        currentTurnStart = i;
        break;
      }
    }
    const messages = toApiMessages(rows, start, currentTurnStart);

    // Where the person is and what just went wrong. Browser-supplied, so it
    // is UNTRUSTED text: it rides in the USER turn (after the cached prefix,
    // never in the system prompt), labelled as such, and it is NOT stored,
    // so a transcript and later replays stay free of it.
    const ctxText = renderPageContext(pageContext);
    const tail = messages[messages.length - 1];
    if (
      ctxText !== null &&
      tail !== undefined &&
      tail.role === 'user' &&
      Array.isArray(tail.content)
    ) {
      messages[messages.length - 1] = {
        role: 'user',
        content: [...tail.content, { type: 'text', text: ctxText }],
      };
    }

    const system: Anthropic.TextBlockParam[] = [
      {
        type: 'text',
        text: systemPromptFor(scope.audience),
        // Breakpoint on the stable prefix: tools render first, then this.
        cache_control: { type: 'ephemeral' },
      },
    ];
    const tools = this.registry.toolParams(scope);

    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        if (round > 0 && !(await this.budget.monthlyOk())) return notice('RESTING_BUDGET');

        const req: AssistantModelRequest = {
          model: ASSISTANT_MODEL,
          max_tokens: MAX_OUTPUT_TOKENS,
          // No temperature / top_p / top_k and no prefill: Haiku 5.5 rejects them.
          thinking: { type: 'adaptive' },
          output_config: { effort: 'low' },
          system,
          tools,
          messages,
        };
        const message = await this.gateway.complete(req, (delta) => emit({ type: 'text', delta }));
        await this.recordUsage(scope, conv.id, message);

        // Refusal first: its content must not be read as an answer, and it
        // is never replayed (a refused turn is not a valid thing to resume from).
        if (message.stop_reason === 'refusal') {
          await this.store.appendMessage(conv.id, 'ASSISTANT', [
            { type: 'text', text: noticeText('REFUSED', lang) },
          ]);
          await this.store.touch(conv.id);
          return notice('REFUSED');
        }

        const content = message.content;
        const toolUses = content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

        if (message.stop_reason === 'tool_use' && toolUses.length > 0) {
          const results = await Promise.all(
            toolUses.map(async (use) => {
              emit({ type: 'tool', name: use.name });
              const run = await this.registry.execute(scope, use.name, use.input);
              await this.store.recordToolCall({
                conversationId: conv.id,
                scope,
                toolName: use.name,
                input: run.validatedInput,
                resultBytes: run.bytes,
                ok: !run.isError,
                errorCode: run.errorCode,
              });
              const block: Anthropic.ToolResultBlockParam = {
                type: 'tool_result',
                tool_use_id: use.id,
                content: run.content,
                ...(run.isError ? { is_error: true } : {}),
              };
              return block;
            }),
          );
          // ALL results in ONE user message, stored with the assistant turn
          // that asked for them so history can never hold a dangling tool_use.
          await this.store.appendToolRound(conv.id, content, results);
          messages.push({ role: 'assistant', content: content as Anthropic.ContentBlockParam[] });
          messages.push({ role: 'user', content: results });
          continue;
        }

        const hasText = content.some((b) => b.type === 'text' && b.text.trim() !== '');
        if (message.stop_reason === 'max_tokens' || toolUses.length > 0 || !hasText) {
          // Cut off (or empty): never store a half tool call or a
          // thinking-only turn as the model's answer.
          if (message.stop_reason === 'max_tokens' && hasText && toolUses.length === 0) {
            await this.store.appendMessage(conv.id, 'ASSISTANT', content);
          } else {
            await this.store.appendMessage(conv.id, 'ASSISTANT', [
              { type: 'text', text: noticeText('TRUNCATED', lang) },
            ]);
          }
          await this.store.touch(conv.id);
          return notice('TRUNCATED');
        }

        // A normal answer. Stored EXACTLY as returned, thinking blocks included.
        await this.store.appendMessage(conv.id, 'ASSISTANT', content);
        await this.store.touch(conv.id);
        emit({ type: 'done', conversationId: conv.id });
        return;
      }
      // Ran out of tool rounds without an answer.
      await this.store.appendMessage(conv.id, 'ASSISTANT', [
        { type: 'text', text: noticeText('TRUNCATED', lang) },
      ]);
      return notice('TRUNCATED');
    } catch (e) {
      // Log what happened; tell the user nothing internal (and never the key).
      this.log.error(`assistant turn failed: ${e instanceof Error ? e.name : 'unknown'}`);
      return notice('FAILED');
    }
  }

  private async recordUsage(
    scope: CallerScope,
    conversationId: string,
    message: Anthropic.Message,
  ): Promise<void> {
    const u = message.usage;
    const tokens = {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    };
    await this.store.recordUsage({
      conversationId,
      scope,
      model: ASSISTANT_MODEL,
      ...tokens,
      costUsd: assistantCostUsd(tokens),
    });
    // The cache is only working if cache_read_input_tokens is > 0 on the
    // second request of a conversation.
    this.log.log(
      `assistant usage audience=${scope.audience} input=${tokens.inputTokens} output=${tokens.outputTokens} cache_read_input_tokens=${tokens.cacheReadTokens} cache_creation_input_tokens=${tokens.cacheWriteTokens}`,
    );
  }
}
