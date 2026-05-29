import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Module 18 — ChatWoot Live Chat. **STUB SCAFFOLD ONLY** in Phase 1A.
 *
 * Per CLAUDE.md the ChatWoot droplet install is deferred — this
 * module mirrors the M9 Delhivery adapter pattern: a clean
 * interface, stub-mode by default, real-mode wire seams flagged
 * `TODO(chatwoot-api)` and throwing until validated against a
 * live ChatWoot sandbox.
 *
 * Configuration via system_settings (read on demand):
 *   - `chat.chatwoot_base_url`  (STRING; empty = stub mode)
 *   - `chat.chatwoot_account_id` (INT)
 *   - `chat.chatwoot_inbox_id`  (INT)
 *   - The API token lives in env (`CHATWOOT_API_TOKEN_<version>`)
 *     following the same secret-in-env convention as M9 (CUR-1).
 *
 * Stub mode is no-op: methods return a deterministic placeholder
 * result; the call site logs a structured event but the upstream
 * caller's logic is unaffected. This lets order/notification flows
 * continue without ChatWoot during Phase 1A.
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
}

@Injectable()
export class ChatWootClientService {
  private readonly logger = new Logger(ChatWootClientService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Posts an order-update message to the customer's ChatWoot
   *  conversation (or creates one if absent). Stub mode: logs +
   *  returns null IDs. Real mode TODO(chatwoot-api). */
  async notifyOrderUpdate(input: NotifyOrderUpdateInput): Promise<ChatConversationRef> {
    const baseUrl = await this.getOpsSetting('chat.chatwoot_base_url');
    if (!baseUrl) {
      this.logger.log(
        { mode: 'STUB', ...input },
        'ChatWootClient.notifyOrderUpdate (no-op; chat.chatwoot_base_url unset)',
      );
      return { conversationId: null, url: null };
    }
    // TODO(chatwoot-api): POST {baseUrl}/api/v1/accounts/{accountId}/inboxes/{inboxId}/contacts...
    // upsert contact by phone; create or fetch conversation; send message.
    throw new Error('chatwoot.real_mode_not_implemented');
  }

  /** Resolves the URL of a customer's existing conversation (for the
   *  admin order detail link). Stub returns null. */
  async getConversationUrl(_customerPhoneE164: string): Promise<string | null> {
    const baseUrl = await this.getOpsSetting('chat.chatwoot_base_url');
    if (!baseUrl) return null;
    // TODO(chatwoot-api): GET conversations?contact_id=...
    throw new Error('chatwoot.real_mode_not_implemented');
  }

  private async getOpsSetting(key: string): Promise<string | null> {
    const row = await this.prisma.client.systemSetting.findUnique({ where: { key } });
    if (!row) return null;
    return row.valueString ?? null;
  }
}
