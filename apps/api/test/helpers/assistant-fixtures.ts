import type Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { Prisma, type AssistantAudience } from '@skydrop/db';
import type { AssistantToolDeps } from '../../src/modules/assistant/tools/assistant-tools';
import type { CallerScope } from '../../src/modules/assistant/assistant.types';
import {
  AssistantModelGateway,
  type AssistantModelRequest,
} from '../../src/modules/assistant/services/assistant-model-gateway';
import { NotFoundException } from '@nestjs/common';
import { AssistantAttachmentService } from '../../src/modules/assistant/services/assistant-attachment.service';
import type {
  AssistantStoreService,
  AttachmentRow,
  ConversationRow,
  StoredMessage,
} from '../../src/modules/assistant/services/assistant-store.service';
import { AssistantBudgetService } from '../../src/modules/assistant/services/assistant-budget.service';
import { AssistantChatService } from '../../src/modules/assistant/services/assistant-chat.service';
import { AssistantHelpService } from '../../src/modules/assistant/services/assistant-help.service';
import { AssistantToolRegistry } from '../../src/modules/assistant/services/assistant-tool-registry.service';

// Specs assert on behaviour; the service's own log lines are noise here.
Logger.overrideLogger(false);

export const SELLER_A = '0191a000-0000-7000-8000-00000000000a';
export const SELLER_B = '0191a000-0000-7000-8000-00000000000b';
export const USER_A = '0191a000-0000-7000-8000-0000000000a1';
export const USER_B = '0191a000-0000-7000-8000-0000000000b1';
export const STAFF_1 = '0191a000-0000-7000-8000-0000000000c1';
export const STORE_1 = '0191a000-0000-7000-8000-0000000000d1';

export function scope(over: Partial<CallerScope> = {}): CallerScope {
  return {
    audience: 'SELLER',
    userId: USER_A,
    sellerId: SELLER_A,
    storeId: null,
    orderScope: null,
    permissions: ['orders.view', 'wallet.view'],
    impersonatingStaffId: null,
    ...over,
  };
}

export const staffScope = (over: Partial<CallerScope> = {}): CallerScope =>
  scope({
    audience: 'STAFF',
    userId: STAFF_1,
    sellerId: null,
    permissions: ['orders.view', 'callcenter.queue.view'],
    ...over,
  });

export const storeScope = (over: Partial<CallerScope> = {}): CallerScope =>
  scope({
    audience: 'STORE',
    userId: USER_B,
    sellerId: SELLER_A,
    storeId: STORE_1,
    orderScope: 'ALL',
    permissions: ['orders.view'],
    ...over,
  });

/** An order book keyed by owning seller, so a fake can apply the scope it is GIVEN. */
export interface FakeOrder {
  readonly sellerId: string;
  readonly orderNumber: string;
}

export function fakeDeps(orders: readonly FakeOrder[] = []): AssistantToolDeps {
  const summary = (o: FakeOrder) => ({
    orderNumber: o.orderNumber,
    sellerOrderRef: null,
    status: 'CONFIRMED',
    source: 'MANUAL',
    placedAt: '2026-11-01T00:00:00.000Z',
    paymentMode: 'COD',
    codAmountInr: '999',
    recipient: { name: 'Customer', city: 'Pune', state: 'MH', postalCode: '411001' },
    shipment: null,
  });
  return {
    orders: {
      // Applies the seller id it receives, as OrderService.list's WHERE does.
      findForSeller: async (sellerId: string, identifier: string) => {
        const o = orders.find((x) => x.sellerId === sellerId && x.orderNumber === identifier);
        return o ? summary(o) : null;
      },
      listForSeller: async (sellerId: string) =>
        orders.filter((x) => x.sellerId === sellerId).map(summary),
      resolveForSeller: async (sellerId: string, identifier: string) => {
        const o = orders.find((x) => x.sellerId === sellerId && x.orderNumber === identifier);
        return o ? { id: `order-${o.orderNumber}`, orderNumber: o.orderNumber } : null;
      },
      findForStaff: async (identifier: string) => {
        const o = orders.find((x) => x.orderNumber === identifier);
        return o ? summary(o) : null;
      },
    },
    tracking: { list: async () => [], detail: async () => ({}) as never },
    restrictions: { assertAllowed: async () => undefined },
    wallet: { balanceCached: async () => new Prisma.Decimal('1234.5') },
    storeOrders: {
      list: async () => ({ items: [], total: 0, page: 1, pageSize: 5 }),
      detail: async () => ({}) as never,
    },
    callQueue: {
      stats: async () => ({ byStatus: { PENDING: 3 }, openTotal: 3, assignedByAgent: [] }),
    },
    help: new AssistantHelpService(),
    proposals: {
      createProposal: async (_scope: CallerScope, _conversationId: string, row) => ({
        proposal: {
          id: '0191a000-0000-7000-8000-0000000000f1',
          conversationId: _conversationId,
          subject: row.subject,
          description: row.description,
          orderId: row.orderId,
          orderNumber: row.orderNumber,
          status: 'PENDING' as const,
          ticketId: null,
          ticketNumber: null,
          requestId: null,
          createdAt: new Date(),
          decidedAt: null,
        },
        created: true,
      }),
    },
  };
}

export function fakeRegistry(orders: readonly FakeOrder[] = []): AssistantToolRegistry {
  return AssistantToolRegistry.fromDeps(fakeDeps(orders));
}

// ── an in-memory store, standing in for AssistantStoreService in chat tests ──

export class MemoryStore {
  conversations: ConversationRow[] = [];
  rows: Array<StoredMessage & { conversationId: string }> = [];
  usage: Array<{ costUsd: Prisma.Decimal }> = [];
  toolCalls: Array<Record<string, unknown>> = [];
  questions = 0;
  monthCost = new Prisma.Decimal(0);
  private seq = 0;

  seedConversation(audience: AssistantAudience = 'SELLER'): ConversationRow {
    const c: ConversationRow = {
      id: `0191a000-0000-7000-8000-${String(++this.seq).padStart(12, '0')}`,
      audience,
      title: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.conversations.push(c);
    return c;
  }
  async findOwned(_s: CallerScope, id: string) {
    return this.conversations.find((c) => c.id === id) ?? null;
  }
  async setTitleIfEmpty() {}
  async touch() {}
  async messages(conversationId: string) {
    return this.rows.filter((r) => r.conversationId === conversationId);
  }
  async appendMessage(
    conversationId: string,
    role: 'USER' | 'ASSISTANT',
    content: unknown,
    isQuestion = false,
  ) {
    this.rows.push({
      id: `m${String(++this.seq).padStart(6, '0')}`,
      conversationId,
      role,
      content,
      isQuestion,
      createdAt: new Date(),
    });
  }
  // ── attachments: the same ownership predicate the real store applies ──
  attachments: Array<
    AttachmentRow & {
      audience: AssistantAudience;
      ownerUserId: string;
      impersonatedByStaffId: string | null;
    }
  > = [];
  /** Rows reading back as present or missing, for the bucket-failure test. */
  async appendQuestion(
    scope: CallerScope,
    conversationId: string,
    content: unknown,
    attachmentIds: readonly string[],
  ) {
    const mine = (a: (typeof this.attachments)[number]) =>
      attachmentIds.includes(a.id) &&
      a.conversationId === conversationId &&
      a.messageId === null &&
      a.audience === scope.audience &&
      a.ownerUserId === scope.userId &&
      a.impersonatedByStaffId === scope.impersonatingStaffId;
    const hits = this.attachments.filter(mine);
    if (hits.length !== attachmentIds.length) {
      throw new NotFoundException({ code: 'ASSISTANT_ATTACHMENT_NOT_FOUND', message: 'x' });
    }
    await this.appendMessage(conversationId, 'USER', content, true);
    const id = this.rows[this.rows.length - 1]?.id ?? '';
    for (const h of hits) (h as { messageId: string | null }).messageId = id;
  }
  async createAttachment(row: {
    scope: CallerScope;
    conversationId: string;
    kind: 'IMAGE' | 'PDF';
    mediaType: string;
    originalName: string;
    bytes: number;
    pages: number | null;
    width: number | null;
    height: number | null;
    sha256: string;
    storageKey: string;
  }): Promise<AttachmentRow> {
    const { scope: sc, ...rest } = row;
    const a = {
      ...rest,
      id: `0191a000-0000-7000-8000-${String(++this.seq + 5000).padStart(12, '0')}`,
      messageId: null,
      audience: sc.audience,
      ownerUserId: sc.userId,
      impersonatedByStaffId: sc.impersonatingStaffId,
    };
    this.attachments.push(a);
    return a;
  }
  async findOwnedAttachments(
    scope: CallerScope,
    conversationId: string,
    ids: readonly string[],
    unsentOnly: boolean,
  ) {
    return this.attachments.filter(
      (a) =>
        ids.includes(a.id) &&
        a.conversationId === conversationId &&
        (!unsentOnly || a.messageId === null) &&
        a.audience === scope.audience &&
        a.ownerUserId === scope.userId &&
        a.impersonatedByStaffId === scope.impersonatingStaffId,
    );
  }
  async countUnsentAttachments(scope: CallerScope, conversationId: string) {
    return (
      await this.findOwnedAttachments(
        scope,
        conversationId,
        this.attachments.map((a) => a.id),
        true,
      )
    ).length;
  }
  async attachmentsByIds(conversationId: string, ids: readonly string[]) {
    return this.attachments.filter(
      (a) => a.conversationId === conversationId && ids.includes(a.id),
    );
  }
  async sentAttachments(conversationId: string) {
    return this.attachments.filter(
      (a) => a.conversationId === conversationId && a.messageId !== null,
    );
  }
  async appendToolRound(conversationId: string, a: unknown, u: unknown) {
    await this.appendMessage(conversationId, 'ASSISTANT', a);
    await this.appendMessage(conversationId, 'USER', u);
  }
  async recordToolCall(row: Record<string, unknown>) {
    this.toolCalls.push(row);
  }
  async recordUsage(row: { costUsd: Prisma.Decimal }) {
    this.usage.push(row);
  }
  async costSince() {
    return this.monthCost;
  }
  async questionsSince() {
    return this.questions;
  }
}

export class FakeSettings {
  constructor(private readonly values: Record<string, unknown> = {}) {}
  async getByKey(key: string) {
    if (!(key in this.values)) throw new Error('missing');
    return { value: this.values[key] };
  }
}

/** A gateway that records every request and replays scripted responses. */
export class FakeGateway extends AssistantModelGateway {
  requests: AssistantModelRequest[] = [];
  constructor(
    private readonly script: Anthropic.Message[],
    private readonly configured = true,
  ) {
    super();
  }
  isConfigured(): boolean {
    return this.configured;
  }
  async complete(
    req: AssistantModelRequest,
    onText: (d: string) => void,
  ): Promise<Anthropic.Message> {
    this.requests.push(req);
    const next = this.script.shift();
    if (next === undefined) throw new Error('script exhausted');
    for (const b of next.content) if (b.type === 'text') onText(b.text);
    return next;
  }
}

export function message(
  over: Partial<Anthropic.Message> & { content: Anthropic.ContentBlock[] },
): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...over,
  } as unknown as Anthropic.Message;
}

/** An in-memory stand-in for the private bucket. */
export class FakeSpaces {
  objects = new Map<string, Buffer>();
  failReads = false;
  async putObject(key: string, body: Buffer) {
    this.objects.set(key, Buffer.from(body));
  }
  async getObject(key: string) {
    if (this.failReads) throw new Error('bucket down');
    return this.objects.get(key) ?? null;
  }
  async deleteObjects(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
  }
  async presignGetUrl(key: string, ttl = 900, response?: { contentDisposition?: string }) {
    return `https://signed.example/${key}?ttl=${ttl}&d=${encodeURIComponent(response?.contentDisposition ?? '')}`;
  }
}

export interface ChatRig {
  readonly attachments: AssistantAttachmentService;
  readonly spaces: FakeSpaces;
  readonly chat: AssistantChatService;
  readonly store: MemoryStore;
  readonly gateway: FakeGateway;
}

export function chatRig(
  script: Anthropic.Message[],
  opts: {
    settings?: Record<string, unknown>;
    configured?: boolean;
    orders?: readonly FakeOrder[];
    store?: MemoryStore;
  } = {},
): ChatRig {
  const store = opts.store ?? new MemoryStore();
  const gateway = new FakeGateway(script, opts.configured ?? true);
  const budget = new AssistantBudgetService(
    new FakeSettings(opts.settings ?? {}) as never,
    store as unknown as AssistantStoreService,
  );
  const spaces = new FakeSpaces();
  const attachments = new AssistantAttachmentService(
    store as unknown as AssistantStoreService,
    spaces as never,
  );
  const chat = new AssistantChatService(
    store as unknown as AssistantStoreService,
    budget,
    fakeRegistry(opts.orders ?? []),
    gateway,
    attachments,
  );
  return { chat, store, gateway, attachments, spaces };
}
