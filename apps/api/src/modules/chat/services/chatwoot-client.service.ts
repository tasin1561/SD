import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EnvService } from '../../../config/env.service';

/**
 * Module 18 — ChatWoot Live Chat.
 *
 * STUB MODE (default) when `chat.chatwoot_base_url` is empty: every
 * call is a no-op that logs the intent. Order / notification flows
 * continue without ChatWoot.
 *
 * REAL MODE: built against the public ChatWoot API
 * (https://www.chatwoot.com/developers/api/). Configuration:
 *
 *   - system_settings:
 *       chat.chatwoot_base_url      e.g. "https://chat.skydrop.online"
 *       chat.chatwoot_account_id    integer (ChatWoot account)
 *       chat.chatwoot_inbox_id      integer (the "API" inbox we send to)
 *   - env:
 *       CHATWOOT_API_TOKEN          the `api_access_token` for a user
 *                                   with access to the account. NEVER
 *                                   in DB.
 *       CHATWOOT_HMAC_SECRET        shared secret used to HMAC-SHA256
 *                                   the webhook body. ChatWoot
 *                                   configures it on the inbox; we
 *                                   verify the `X-Chatwoot-Hmac-Token`
 *                                   header.
 *
 * Idempotency:
 *   - Contact `source_id` is the customer's E.164 phone — ChatWoot
 *     treats source_id as the natural key, so creates upsert.
 *   - Conversation lookup uses the contact's open conversations on
 *     our inbox; we create only if none.
 *
 * No persistent mapping in our DB yet — Phase 1A keeps state in
 * ChatWoot. Surfacing conversation URLs on the admin order detail
 * without a lookup is a Phase-1B `customer_chats` table follow-up.
 */

export interface ChatConversationRef {
  readonly conversationId: number | null;
  readonly url: string | null;
}

export interface NotifyOrderUpdateInput {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly sellerId: string;
  readonly customerPhoneE164: string;
  readonly toStatus: string;
  /** Optional custom message; if omitted, a default is generated. */
  readonly message?: string;
  /** Optional display name to use on contact create. */
  readonly customerName?: string;
}

@Injectable()
export class ChatWootClientService {
  private readonly logger = new Logger(ChatWootClientService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  async notifyOrderUpdate(input: NotifyOrderUpdateInput): Promise<ChatConversationRef> {
    const config = await this.config();
    if (!config) {
      this.logger.log(
        { mode: 'STUB', ...input },
        'ChatWootClient.notifyOrderUpdate (no-op; chat.chatwoot_base_url unset)',
      );
      return { conversationId: null, url: null };
    }

    const message =
      input.message ??
      `Order ${input.orderNumber} status update: ${humanizeStatus(input.toStatus)}.`;

    try {
      const contact = await this.upsertContact(config, {
        phone: input.customerPhoneE164,
        name: input.customerName ?? `Customer ${input.customerPhoneE164.slice(-4)}`,
      });
      const conversation = await this.ensureConversation(config, {
        contactId: contact.id,
        customField: { orderId: input.orderId, sellerId: input.sellerId },
      });
      await this.postMessage(config, conversation.id, message);
      return {
        conversationId: conversation.id,
        url: `${config.baseUrl}/app/accounts/${config.accountId}/conversations/${conversation.id}`,
      };
    } catch (err) {
      // Never let chat failures bubble (NOTIF-1 best-effort discipline).
      this.logger.error(
        { orderId: input.orderId, err: (err as Error).message },
        'ChatWoot notifyOrderUpdate failed',
      );
      return { conversationId: null, url: null };
    }
  }

  async getConversationUrl(customerPhoneE164: string): Promise<string | null> {
    const config = await this.config();
    if (!config) return null;
    try {
      const conv = await this.findConversationByContactPhone(config, customerPhoneE164);
      if (!conv) return null;
      return `${config.baseUrl}/app/accounts/${config.accountId}/conversations/${conv.id}`;
    } catch (err) {
      this.logger.warn(
        { customerPhoneE164, err: (err as Error).message },
        'ChatWoot getConversationUrl failed',
      );
      return null;
    }
  }

  // ── internals ────────────────────────────────────────────────────

  private async config(): Promise<ChatWootConfig | null> {
    const [baseUrlRow, accountIdRow, inboxIdRow] = await Promise.all([
      this.prisma.client.systemSetting.findUnique({
        where: { key: 'chat.chatwoot_base_url' },
        select: { valueString: true },
      }),
      this.prisma.client.systemSetting.findUnique({
        where: { key: 'chat.chatwoot_account_id' },
        select: { valueInt: true },
      }),
      this.prisma.client.systemSetting.findUnique({
        where: { key: 'chat.chatwoot_inbox_id' },
        select: { valueInt: true },
      }),
    ]);
    const baseUrl = (baseUrlRow?.valueString ?? '').trim();
    const accountId = accountIdRow?.valueInt ?? null;
    const inboxId = inboxIdRow?.valueInt ?? null;
    const apiToken = this.env.chatwootApiToken ?? '';
    if (!baseUrl || accountId === null || inboxId === null || !apiToken) {
      return null;
    }
    return {
      baseUrl: baseUrl.replace(/\/$/, ''),
      accountId,
      inboxId,
      apiToken,
    };
  }

  private async upsertContact(
    cfg: ChatWootConfig,
    input: { phone: string; name: string },
  ): Promise<{ id: number }> {
    const search = await this.cw<{
      payload: Array<{ id: number; phone_number?: string }>;
    }>(
      cfg,
      'GET',
      `/api/v1/accounts/${cfg.accountId}/contacts/search?q=${encodeURIComponent(input.phone)}`,
    );
    const match = (search.payload ?? []).find((c) => c.phone_number === input.phone);
    if (match) return { id: match.id };

    const created = await this.cw<{ payload?: { contact?: { id?: number } } }>(
      cfg,
      'POST',
      `/api/v1/accounts/${cfg.accountId}/contacts`,
      {
        name: input.name,
        phone_number: input.phone,
        source_id: input.phone,
        inbox_id: cfg.inboxId,
      },
    );
    const id = created.payload?.contact?.id;
    if (!id) throw new Error('ChatWoot contact create returned no id');
    return { id };
  }

  private async ensureConversation(
    cfg: ChatWootConfig,
    input: {
      contactId: number;
      customField: Record<string, string>;
    },
  ): Promise<{ id: number }> {
    const list = await this.cw<{
      payload: Array<{ id: number; inbox_id?: number; status?: string }>;
    }>(cfg, 'GET', `/api/v1/accounts/${cfg.accountId}/contacts/${input.contactId}/conversations`);
    const existing = (list.payload ?? []).find(
      (c) => c.inbox_id === cfg.inboxId && (c.status === 'open' || c.status === 'pending'),
    );
    if (existing) return { id: existing.id };

    const created = await this.cw<{ id?: number }>(
      cfg,
      'POST',
      `/api/v1/accounts/${cfg.accountId}/conversations`,
      {
        source_id: input.contactId.toString(),
        inbox_id: cfg.inboxId,
        contact_id: input.contactId,
        custom_attributes: input.customField,
      },
    );
    if (!created.id) throw new Error('ChatWoot conversation create returned no id');
    return { id: created.id };
  }

  private async postMessage(
    cfg: ChatWootConfig,
    conversationId: number,
    content: string,
  ): Promise<void> {
    await this.cw<unknown>(
      cfg,
      'POST',
      `/api/v1/accounts/${cfg.accountId}/conversations/${conversationId}/messages`,
      { content, message_type: 'outgoing', private: false },
    );
  }

  private async findConversationByContactPhone(
    cfg: ChatWootConfig,
    phone: string,
  ): Promise<{ id: number } | null> {
    const search = await this.cw<{
      payload: Array<{ id: number; phone_number?: string }>;
    }>(
      cfg,
      'GET',
      `/api/v1/accounts/${cfg.accountId}/contacts/search?q=${encodeURIComponent(phone)}`,
    );
    const contact = (search.payload ?? []).find((c) => c.phone_number === phone);
    if (!contact) return null;
    const list = await this.cw<{
      payload: Array<{ id: number; inbox_id?: number }>;
    }>(cfg, 'GET', `/api/v1/accounts/${cfg.accountId}/contacts/${contact.id}/conversations`);
    const conv = (list.payload ?? []).find((c) => c.inbox_id === cfg.inboxId);
    return conv ? { id: conv.id } : null;
  }

  private async cw<T>(
    cfg: ChatWootConfig,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        api_access_token: cfg.apiToken,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ChatWoot ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}

interface ChatWootConfig {
  readonly baseUrl: string;
  readonly accountId: number;
  readonly inboxId: number;
  readonly apiToken: string;
}

function humanizeStatus(s: string): string {
  return s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
