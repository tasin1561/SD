import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { attachmentBlocksIn } from '../assistant-attachment-block';
import { MAX_QUESTION_ATTACHMENT_BYTES } from '../assistant-attachment-rebuild';
import {
  estimateTokens,
  toApiMessages,
  windowStart,
  type ApiFileBlock,
} from '../assistant-history';
import { detectReplyLanguage, helpLinks, noticeText, type NoticeCode } from '../assistant-language';
import { assistantBilledUsd } from '../assistant-pricing';
import { systemPromptFor } from '../assistant-system-prompt';
import { ASSISTANT_MODEL, type AssistantStreamEvent, type CallerScope } from '../assistant.types';
import { AssistantAttachmentService, AttachmentUnavailable } from './assistant-attachment.service';
import { AssistantBudgetAlertService } from './assistant-budget-alert.service';
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
/** The public helper's limits: short questions, short conversations. */
export const PUBLIC_MAX_QUESTION_CHARS = 300;
export const PUBLIC_MAX_TURNS = 6;

/** Notices whose words point at "help links" a tracking page does not have. */
const PUBLIC_UNAVAILABLE_CODES: ReadonlySet<NoticeCode> = new Set([
  'DISABLED',
  'NOT_CONFIGURED',
  'RESTING_BUDGET',
  'RESTING_DAILY',
]);
/**
 * What ONE question's files (plus its words) may cost in prompt tokens. The
 * whole request must stay under 100K (above that the prompt is billed at
 * 5x); history gets 60K, and the files of the current question get the
 * same 60K minus 10K kept free for the tool rounds this question may add.
 */
export const ATTACHMENT_QUESTION_TOKEN_BUDGET = 50_000;

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
    private readonly attachments: AssistantAttachmentService,
    // Optional so the unit rigs that build this service by hand keep working;
    // the module always provides it.
    @Optional() private readonly alerts?: AssistantBudgetAlertService,
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
    attachmentIds: readonly string[] = [],
  ): Promise<void> {
    const conv = await this.requireOwned(scope, conversationId);
    const lang = detectReplyLanguage(text);
    const notice = (requested: NoticeCode): void => {
      const code: NoticeCode =
        scope.audience === 'PUBLIC' && PUBLIC_UNAVAILABLE_CODES.has(requested)
          ? 'PUBLIC_UNAVAILABLE'
          : requested;
      // Counted for the control panel (code only, fire and forget).
      void this.store.recordNotice(conv.id, scope.audience, code);
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
    // The public helper is a SHORT conversation: the cap is checked before the
    // question is stored, so a seventh question never reaches the model.
    if (
      scope.audience === 'PUBLIC' &&
      (await this.store.questionsIn(conv.id)) >= PUBLIC_MAX_TURNS
    ) {
      return notice('PUBLIC_TURN_LIMIT');
    }

    // Where the person is and what just went wrong. Browser-supplied, so it
    // is UNTRUSTED text: it rides in the USER turn (after the cached prefix,
    // never in the system prompt), labelled as such. It is STORED with the
    // question, exactly as sent: Haiku 5.5 binds every thinking block to the
    // conversation before it, so a note sent once and dropped on the next
    // request edits an earlier turn and the follow-up is a 400. (That was
    // the live bug of 2026-11-12: every second question failed.) The
    // transcript hides it — see `visibleText`.
    const ctxText = renderPageContext(pageContext);

    // The files this question carries: the caller's own, in this
    // conversation, unsent (else a 404 — the controller has already asked
    // once, before the stream opened; the link below asks again atomically).
    const files = await this.attachments.requireUnsent(scope, conv.id, attachmentIds);
    let loaded = new Map<string, ApiFileBlock>();
    if (files.length > 0) {
      const fileBytes = files.reduce((n, f) => n + f.bytes, 0);
      const fileTokens = files.reduce((n, f) => n + attachmentBlocksTokens(this.attachments, f), 0);
      // Too big to ever fit: refuse BEFORE the question is stored and
      // before Claude is called. The files stay unsent, so the person can
      // remove one and ask again.
      if (
        fileBytes > MAX_QUESTION_ATTACHMENT_BYTES ||
        fileTokens + estimateTokens(text) > ATTACHMENT_QUESTION_TOKEN_BUDGET
      ) {
        return notice('ATTACHMENTS_TOO_LARGE');
      }
      // Read the bytes back NOW, before anything is stored: a question
      // that cannot be replayed must not become part of the history.
      try {
        loaded = await this.attachments.loadBlocks(
          conv.id,
          files.map((f) => f.id),
        );
      } catch (e) {
        if (e instanceof AttachmentUnavailable) return notice('ATTACHMENT_UNAVAILABLE');
        throw e;
      }
    }

    const question: Anthropic.ContentBlockParam[] = [
      // Files first, then the words: the order the API recommends.
      ...files.map(
        (f) => this.attachments.storedBlock(f) as unknown as Anthropic.ContentBlockParam,
      ),
      { type: 'text', text },
    ];
    if (ctxText !== null) question.push({ type: 'text', text: ctxText });
    await this.store.appendQuestion(
      scope,
      conv.id,
      question,
      files.map((f) => f.id),
    );
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
    // Earlier turns' files, read back from the bucket (the same immutable
    // bytes as the first time). A failed read ends THIS turn with a plain
    // notice; it is never a 500 and never a different prompt.
    const wanted = new Set<string>();
    for (let i = start; i < rows.length; i++) {
      for (const b of attachmentBlocksIn(rows[i]?.content)) {
        if (!loaded.has(b.id)) wanted.add(b.id);
      }
    }
    if (wanted.size > 0) {
      try {
        const more = await this.attachments.loadBlocks(conv.id, [...wanted]);
        loaded = new Map([...loaded, ...more]);
      } catch (e) {
        if (e instanceof AttachmentUnavailable) return notice('ATTACHMENT_UNAVAILABLE');
        throw e;
      }
    }
    const messages = toApiMessages(rows, start, currentTurnStart, loaded);

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
        if (round > 0 && !(await this.budget.monthlyOk(new Date(), scope.audience))) {
          return notice('RESTING_BUDGET');
        }

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
        let message: Anthropic.Message;
        try {
          message = await this.gateway.complete(req, (delta) => emit({ type: 'text', delta }));
        } catch (e) {
          // A conversation whose history was already edited (stored before
          // the fix above) can never replay its thinking blocks again. The
          // API decides this before any output, so nothing was streamed:
          // drop EVERY thinking block from the copy we send (removing all
          // of them is allowed) and retry once. Stored rows stay untouched.
          if (!isThinkingBindingError(e) || !stripThinking(messages)) throw e;
          this.log.warn('assistant: history no longer matches its thinking; retrying without it');
          message = await this.gateway.complete(req, (delta) => emit({ type: 'text', delta }));
        }
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
              const run = await this.registry.execute(scope, use.name, use.input, {
                conversationId: conv.id,
                emit,
              });
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
        const answerId = await this.store.appendMessage(conv.id, 'ASSISTANT', content);
        await this.store.touch(conv.id);
        // `messageId` lets the thumbs under the answer name it.
        emit({ type: 'done', conversationId: conv.id, messageId: answerId });
        return;
      }
      // Ran out of tool rounds without an answer.
      await this.store.appendMessage(conv.id, 'ASSISTANT', [
        { type: 'text', text: noticeText('TRUNCATED', lang) },
      ]);
      return notice('TRUNCATED');
    } catch (e) {
      // Log what happened; tell the user nothing internal (and never the key).
      // The API's own message names the field at fault and never carries
      // the key; without it the log said only "BadRequestError".
      this.log.error(`assistant turn failed: ${describeError(e)}`);
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
      // Stored at the billed figure (2.5x real; see assistant-pricing.ts).
      costUsd: assistantBilledUsd(tokens),
    });
    // POST-COMMIT of the usage row, not awaited: the 80% / 100% warning can
    // never delay or fail the person's answer.
    this.alerts?.afterUsage();
    // The cache is only working if cache_read_input_tokens is > 0 on the
    // second request of a conversation.
    this.log.log(
      `assistant usage audience=${scope.audience} input=${tokens.inputTokens} output=${tokens.outputTokens} cache_read_input_tokens=${tokens.cacheReadTokens} cache_creation_input_tokens=${tokens.cacheWriteTokens}`,
    );
  }
}

function attachmentBlocksTokens(
  svc: AssistantAttachmentService,
  row: Parameters<AssistantAttachmentService['storedBlock']>[0],
): number {
  return svc.storedBlock(row).tokens;
}

/** The history-editing check: a replayed thinking block no longer matches its prefix. */
export function isThinkingBindingError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const status = (e as { status?: unknown }).status;
  return status === 400 && /signature/i.test(e.message) && /thinking/i.test(e.message);
}

/** Removes every thinking block from the copy sent to the API; true if any were removed. */
export function stripThinking(messages: Anthropic.MessageParam[]): boolean {
  let removed = false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m === undefined || !Array.isArray(m.content)) continue;
    const kept = m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
    if (kept.length === m.content.length) continue;
    removed = true;
    if (kept.length === 0) messages.splice(i, 1);
    else messages[i] = { ...m, content: kept } as Anthropic.MessageParam;
  }
  return removed;
}

function describeError(e: unknown): string {
  if (!(e instanceof Error)) return 'unknown';
  const status = (e as { status?: unknown }).status;
  return `${e.name}${typeof status === 'number' ? ` ${status}` : ''}: ${e.message.slice(0, 500)}`;
}
