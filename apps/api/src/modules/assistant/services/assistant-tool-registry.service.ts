import { HttpException, Injectable, Logger } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { OrderAssistantReadService } from '../../order/services/order-assistant-read.service';
import { SellerTrackingService } from '../../seller-tracking/services/seller-tracking.service';
import { SellerRestrictionService } from '../../seller-restriction/services/seller-restriction.service';
import { WalletService } from '../../seller-wallet/services/wallet.service';
import { StoreOrdersService } from '../../reseller-order/services/store-orders.service';
import { AdminCallQueueService } from '../../call-center/services/admin-call-queue.service';
import { validateToolInput } from '../assistant-input';
import {
  ToolError,
  type AssistantTool,
  type CallerScope,
  type ToolContext,
} from '../assistant.types';
import { buildAssistantTools, type AssistantToolDeps } from '../tools/assistant-tools';
import { AssistantHelpService } from './assistant-help.service';
import { AssistantStoreService } from './assistant-store.service';

/** A tool result is cut here so one lookup cannot fill the prompt. */
export const MAX_TOOL_RESULT_CHARS = 6000;

export interface ToolExecution {
  readonly content: string;
  readonly isError: boolean;
  readonly errorCode: string | null;
  readonly bytes: number;
  /** The validated input — what the audit row stores. Null if it never validated. */
  readonly validatedInput: Record<string, unknown> | null;
}

/**
 * Builds each request's tool list and runs the calls.
 *
 * The list is filtered PER REQUEST from the caller's audience AND the
 * permissions the guard resolved for them: a seller is never even
 * offered a staff tool, and a team member without `wallet.view` is not
 * offered the wallet tool. `execute` looks the name up in THAT filtered
 * list, so a tool the model was never offered cannot be run by naming it.
 */
@Injectable()
export class AssistantToolRegistry {
  private readonly log = new Logger(AssistantToolRegistry.name);
  private readonly tools: readonly AssistantTool[];

  constructor(
    orders: OrderAssistantReadService,
    tracking: SellerTrackingService,
    restrictions: SellerRestrictionService,
    wallet: WalletService,
    storeOrders: StoreOrdersService,
    callQueue: AdminCallQueueService,
    help: AssistantHelpService,
    proposals: AssistantStoreService,
  ) {
    this.tools = buildAssistantTools({
      orders,
      tracking,
      restrictions,
      wallet,
      storeOrders,
      callQueue,
      help,
      proposals,
    });
  }

  /** For tests: a registry over hand-built dependencies. */
  static fromDeps(deps: AssistantToolDeps): AssistantToolRegistry {
    const r = Object.create(AssistantToolRegistry.prototype) as {
      tools: readonly AssistantTool[];
      log: Logger;
    };
    r.tools = buildAssistantTools(deps);
    r.log = new Logger(AssistantToolRegistry.name);
    return r as unknown as AssistantToolRegistry;
  }

  /** Every registered tool — for the structural specs, never for a request. */
  all(): readonly AssistantTool[] {
    return this.tools;
  }

  toolsFor(scope: CallerScope): readonly AssistantTool[] {
    return this.tools
      .filter(
        (t) =>
          t.audience.includes(scope.audience) &&
          (t.permission === null || scope.permissions.includes(t.permission)),
      )
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The API's `tools` array. Sorted by name so the same caller gets the
   * same bytes every request (the cache is a prefix match), with the
   * breakpoint on the last tool.
   */
  toolParams(scope: CallerScope): Anthropic.Tool[] {
    const list = this.toolsFor(scope);
    return list.map((t, i) => ({
      name: t.name,
      description: t.description,
      strict: true,
      input_schema: {
        type: 'object' as const,
        // Strict-mode schemas accept only a subset of JSON Schema: numeric
        // bounds and `pattern` are a 400 for the WHOLE request (live bug
        // 2026-11-12: the `limit` field's minimum/maximum failed every
        // client and member-store question). validateToolInput still
        // enforces all of them on our side.
        properties: Object.fromEntries(
          Object.entries(t.inputSchema.properties).map(([k, prop]) => [k, strictSafe(prop)]),
        ),
        required: [...t.inputSchema.required],
        additionalProperties: false,
      } as Anthropic.Tool.InputSchema,
      ...(i === list.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
    }));
  }

  async execute(
    scope: CallerScope,
    name: string,
    rawInput: unknown,
    ctx: ToolContext = { conversationId: '', emit: () => undefined },
  ): Promise<ToolExecution> {
    const tool = this.toolsFor(scope).find((t) => t.name === name);
    if (tool === undefined) {
      return this.fail('FORBIDDEN', 'That tool is not available.', null);
    }
    let input: Record<string, unknown>;
    try {
      input = validateToolInput(tool.inputSchema, rawInput);
    } catch (e) {
      return this.fail(
        'INVALID_INPUT',
        e instanceof ToolError ? e.message : 'Invalid input.',
        null,
      );
    }
    try {
      const result = await tool.run(scope, input, ctx);
      let content = JSON.stringify(result);
      if (content.length > MAX_TOOL_RESULT_CHARS) {
        content = `${content.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]`;
      }
      return {
        content,
        isError: false,
        errorCode: null,
        bytes: content.length,
        validatedInput: input,
      };
    } catch (e) {
      if (e instanceof ToolError) return this.fail(e.code, e.message, input);
      // A service's own refusal (404 on an unknown id, 403 on a restriction)
      // reads the same to the model as ours: not found / not allowed.
      if (e instanceof HttpException) {
        const status = e.getStatus();
        if (status === 404) return this.fail('NOT_FOUND', 'Not found.', input);
        if (status === 403) return this.fail('FORBIDDEN', 'Not allowed.', input);
      }
      // Anything else: log the real error server-side, tell the model nothing
      // internal.
      this.log.error(`tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
      return this.fail('FAILED', 'The lookup failed. Try again later.', input);
    }
  }

  private fail(
    code: string,
    message: string,
    validatedInput: Record<string, unknown> | null,
  ): ToolExecution {
    const content = JSON.stringify({ error: message });
    return { content, isError: true, errorCode: code, bytes: content.length, validatedInput };
  }
}

/** JSON-Schema keywords strict tool schemas reject; our own validator enforces them. */
const STRICT_UNSUPPORTED = new Set([
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
]);

/** A property schema with every keyword strict mode rejects removed. */
export function strictSafe(prop: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(prop).filter(([key]) => !STRICT_UNSUPPORTED.has(key)));
}
