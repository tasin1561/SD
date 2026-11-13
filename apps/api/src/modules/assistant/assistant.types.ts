import type { AssistantAudience } from '@skydrop/db';

export type { AssistantAudience };

/** The model the owner chose. Do not change without the owner. */
export const ASSISTANT_MODEL = 'claude-haiku-5-5';

/**
 * WHO is asking, built SERVER-SIDE from the authenticated identity
 * (`@CurrentSeller` / `@CurrentStaff` / `@CurrentStoreUser`) and from
 * nothing else. The model never supplies, sees, or can influence any
 * field of it, and no tool input schema may carry one of these ids
 * (`assistant-tool-schemas.spec.ts` fails if one does).
 */
export interface CallerScope {
  readonly audience: AssistantAudience;
  /** staff_users.id / seller_users.id / store_users.id, by audience. */
  readonly userId: string;
  /** The seller company — null for staff. */
  readonly sellerId: string | null;
  /** The reseller store — store and associate only. */
  readonly storeId: string | null;
  /** ASSOC-1: set for store users; 'OWN' narrows every order read. */
  readonly orderScope: 'OWN' | 'ALL' | null;
  /** The effective permission keys the guard resolved for this request. */
  readonly permissions: readonly string[];
  /** Set when a staff member is acting inside a support session. */
  readonly impersonatingStaffId: string | null;
}

/** The JSON-Schema subset tool inputs may use (validated by hand, see assistant-input.ts). */
export interface ToolProperty {
  readonly type: 'string' | 'integer';
  readonly description: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enum?: readonly string[];
  /** A regular expression the (trimmed) value must match in full. Enforced by us; not sent to the API. */
  readonly pattern?: string;
}

export interface ToolInputSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, ToolProperty>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

/**
 * Where an equivalent HTTP route declares the permission this tool
 * mirrors. `assistant-tool-permission-parity.spec.ts` reads the
 * controller source and fails if the two keys differ.
 */
export interface RouteMirror {
  /** Path under apps/api/src/modules. */
  readonly controller: string;
  readonly handler: string;
}

export interface AssistantTool {
  readonly name: string;
  readonly description: string;
  readonly audience: readonly AssistantAudience[];
  /**
   * The key the equivalent route requires (`RequirePermissions` /
   * `RequireSellerPermissions` / `RequireStorePermissions`), or null for
   * a tool with no HTTP route (`search_help`), which any signed-in
   * member of the audience may use.
   */
  readonly permission: string | null;
  readonly mirrors: RouteMirror | null;
  readonly inputSchema: ToolInputSchema;
  run(scope: CallerScope, input: Record<string, unknown>): Promise<unknown>;
}

/** A refusal a tool wants the model to see, with a short stable code. */
export class ToolError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_INPUT' | 'FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

/** What the SSE stream carries, one JSON object per `data:` line. */
export type AssistantStreamEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool'; readonly name: string }
  | {
      readonly type: 'notice';
      readonly code:
        | 'DISABLED'
        | 'NOT_CONFIGURED'
        | 'RESTING_BUDGET'
        | 'RESTING_DAILY'
        | 'REFUSED'
        | 'TRUNCATED'
        | 'ATTACHMENTS_TOO_LARGE'
        | 'ATTACHMENT_UNAVAILABLE'
        | 'FAILED';
      readonly text: string;
      readonly helpLinks: ReadonlyArray<{ readonly label: string; readonly path: string }>;
    }
  | { readonly type: 'done'; readonly conversationId: string };
