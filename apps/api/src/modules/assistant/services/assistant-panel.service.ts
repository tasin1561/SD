import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ActorType, Prisma, SettingValueType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import { SystemSettingsService } from '../../system-settings/services/system-settings.service';
import { detectReplyLanguage, type ReplyLanguage } from '../assistant-language';
import { maskPhonesDeep, maskPhones } from '../assistant-masking';
import {
  DAY_RE,
  BILLING_TIMEZONE,
  daysBetween,
  dayStart,
  dhakaDate,
  dayKey,
} from '../assistant-panel-time';
import { billedFromRealUsd, realFromBilledUsd } from '../assistant-pricing';
import { AssistantAttachmentService } from './assistant-attachment.service';
import { AssistantBillingService, PORTALS, type PortalKey } from './assistant-billing.service';
import { visibleText } from './assistant-conversation.service';

/** The settings the Controls tab may change, and the type each is written as. */
export const CONTROL_SETTINGS: Readonly<Record<string, SettingValueType>> = {
  'assistant.enabled': SettingValueType.BOOLEAN,
  'assistant.monthly_budget_usd': SettingValueType.DECIMAL,
  'assistant.daily_messages_per_user': SettingValueType.INT,
  'assistant.portal_staff_enabled': SettingValueType.BOOLEAN,
  'assistant.portal_seller_enabled': SettingValueType.BOOLEAN,
  'assistant.portal_store_enabled': SettingValueType.BOOLEAN,
  'assistant.portal_associate_enabled': SettingValueType.BOOLEAN,
  'assistant.attachments_enabled': SettingValueType.BOOLEAN,
  'assistant.monitor_enabled': SettingValueType.BOOLEAN,
  'assistant.monitor_monthly_budget_usd': SettingValueType.DECIMAL,
};

/** Budget caps are stored in REAL dollars; the panel shows and accepts the billed figure. */
const BUDGET_KEYS = new Set([
  'assistant.monthly_budget_usd',
  'assistant.monitor_monthly_budget_usd',
]);
const ERROR_CODES = ['FAILED', 'NOT_CONFIGURED', 'ATTACHMENT_UNAVAILABLE'];
const LANGUAGE_SAMPLE = 5000;

export interface ConversationReview {
  readonly conversation: {
    readonly id: string;
    readonly portal: string;
    readonly title: string | null;
    readonly user: string | null;
    readonly account: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly anonymised: boolean;
  };
  readonly messages: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly isQuestion: boolean;
    readonly at: string;
    readonly blocks: unknown[];
    readonly maskedPhones: number;
    readonly attachmentIds: string[];
    readonly feedback: Array<{ rating: string; comment: string | null }>;
  }>;
  readonly attachments: ReadonlyArray<{
    readonly id: string;
    readonly kind: string;
    readonly mediaType: string;
    readonly name: string;
    readonly bytes: number;
    readonly pages: number | null;
    readonly available: boolean;
  }>;
  readonly notices: ReadonlyArray<{ code: string; at: string }>;
  readonly tools: ReadonlyArray<{
    name: string;
    ok: boolean;
    errorCode: string | null;
    resultBytes: number;
    at: string;
  }>;
}

export interface ExplorerFilters {
  readonly portal?: string | undefined;
  readonly sellerId?: string | undefined;
  readonly storeId?: string | undefined;
  readonly userId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly language?: 'en' | 'bn' | 'hi' | undefined;
  readonly hasAttachment?: boolean | undefined;
  readonly rating?: 'up' | 'down' | undefined;
  readonly hadNotice?: 'any' | 'error' | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

type Block = Record<string, unknown> & { type?: string };

/** One stored turn, shaped for the staff screen: no thinking, phones masked unless `reveal`. */
export function reviewBlocks(
  content: unknown,
  reveal: boolean,
): { blocks: unknown[]; masked: number } {
  const list = Array.isArray(content) ? (content as Block[]) : [];
  let masked = 0;
  const mask = <T>(v: T): T => {
    if (reveal) return v;
    const before = JSON.stringify(v);
    const out = maskPhonesDeep(v) as T;
    if (JSON.stringify(out) !== before) masked++;
    return out;
  };
  const blocks: unknown[] = [];
  for (const b of list) {
    if (b === null || typeof b !== 'object') continue;
    switch (b.type) {
      case 'text':
        blocks.push({ type: 'text', text: mask(String(b['text'] ?? '')) });
        break;
      case 'tool_use':
        blocks.push({
          type: 'tool_use',
          name: String(b['name'] ?? ''),
          input: mask(b['input'] ?? {}),
        });
        break;
      case 'tool_result':
        blocks.push({
          type: 'tool_result',
          ok: b['is_error'] !== true,
          content: mask(b['content'] ?? ''),
        });
        break;
      case 'image':
      case 'document':
        blocks.push({ type: 'file', kind: b.type });
        break;
      default:
        // `thinking` / `redacted_thinking` and anything unknown are never shown.
        break;
    }
  }
  return { blocks, masked };
}

@Injectable()
export class AssistantPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly settings: SystemSettingsService,
    private readonly billing: AssistantBillingService,
    private readonly attachments: AssistantAttachmentService,
  ) {}

  // ── dashboard ──────────────────────────────────────────────────────
  async dashboard(fromDay?: string, toDay?: string, now: Date = new Date()) {
    const today = dhakaDate(now);
    const to = toDay ?? dayKey(today.y, today.m, today.d);
    const defFrom = dhakaDate(new Date(dayStart(to).getTime() - 29 * 86_400_000));
    const from = fromDay ?? dayKey(defFrom.y, defFrom.m, defFrom.d);
    if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) {
      throw new BadRequestException({ code: 'BAD_RANGE', message: 'Pick a valid date range.' });
    }
    const days = daysBetween(from, to);
    if (days.length >= 366) {
      throw new BadRequestException({ code: 'RANGE_TOO_LONG', message: 'Pick at most a year.' });
    }
    const start = dayStart(from);
    const end = new Date(dayStart(to).getTime() + 86_400_000);
    const c = this.prisma.client;
    const tz = BILLING_TIMEZONE;

    const [
      perDay,
      active,
      usage,
      notices,
      tools,
      portals,
      attachments,
      proposals,
      feedback,
      sample,
    ] = await Promise.all([
      c.$queryRaw<Array<{ day: string; n: number }>>(Prisma.sql`
          SELECT to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS day, count(*)::int AS n
            FROM assistant_messages
           WHERE is_question AND created_at >= ${start} AND created_at < ${end} GROUP BY 1`),
      c.$queryRaw<Array<{ n: number }>>(Prisma.sql`
          SELECT count(DISTINCT (c.audience, c.owner_user_id))::int AS n
            FROM assistant_messages m JOIN assistant_conversations c ON c.id = m.conversation_id
           WHERE m.is_question AND m.created_at >= ${start} AND m.created_at < ${end}`),
      c.$queryRaw<
        Array<{
          requests: number;
          input: bigint | null;
          read: bigint | null;
          write: bigint | null;
          cost: Prisma.Decimal | null;
        }>
      >(Prisma.sql`
          SELECT count(*)::int AS requests, sum(input_tokens)::bigint AS input,
                 sum(cache_read_tokens)::bigint AS read, sum(cache_write_tokens)::bigint AS write,
                 sum(cost_usd) AS cost
            FROM assistant_usage WHERE created_at >= ${start} AND created_at < ${end}`),
      c.$queryRaw<Array<{ code: string; n: number }>>(Prisma.sql`
          SELECT code, count(*)::int AS n FROM assistant_notices
           WHERE created_at >= ${start} AND created_at < ${end} GROUP BY 1`),
      c.$queryRaw<Array<{ name: string; calls: number; failed: number }>>(Prisma.sql`
          SELECT tool_name AS name, count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS failed
            FROM assistant_tool_calls WHERE created_at >= ${start} AND created_at < ${end}
           GROUP BY 1 ORDER BY 2 DESC LIMIT 20`),
      c.$queryRaw<Array<{ audience: string; n: number }>>(Prisma.sql`
          SELECT c.audience::text AS audience, count(*)::int AS n
            FROM assistant_messages m JOIN assistant_conversations c ON c.id = m.conversation_id
           WHERE m.is_question AND m.created_at >= ${start} AND m.created_at < ${end} GROUP BY 1`),
      c.assistantAttachment.count({ where: { createdAt: { gte: start, lt: end } } }),
      c.assistantTicketProposal.groupBy({
        by: ['status'],
        where: { createdAt: { gte: start, lt: end } },
        _count: { _all: true },
      }),
      c.assistantFeedback.groupBy({
        by: ['rating'],
        where: { createdAt: { gte: start, lt: end } },
        _count: { _all: true },
      }),
      c.assistantMessage.findMany({
        where: { isQuestion: true, createdAt: { gte: start, lt: end } },
        orderBy: { id: 'desc' },
        take: LANGUAGE_SAMPLE,
        select: { content: true },
      }),
    ]);

    const byDay = new Map(perDay.map((r) => [r.day, r.n]));
    const questionsPerDay = days.map((d) => ({ day: d, count: byDay.get(d) ?? 0 }));
    const questions = questionsPerDay.reduce((a, r) => a + r.count, 0);
    const u = usage[0];
    const prompt = Number(u?.input ?? 0) + Number(u?.read ?? 0) + Number(u?.write ?? 0);
    const noticeMap = Object.fromEntries(notices.map((r) => [r.code, r.n]));
    const errors = ERROR_CODES.reduce((a, k) => a + (noticeMap[k] ?? 0), 0);
    const langs: Record<ReplyLanguage, number> = { en: 0, bn: 0, hi: 0, bnLatn: 0, hiLatn: 0 };
    for (const m of sample) langs[detectReplyLanguage(visibleText(m.content))]++;
    const portalMix = Object.fromEntries(PORTALS.map((p) => [p, 0])) as Record<PortalKey, number>;
    for (const r of portals) portalMix[r.audience.toLowerCase() as PortalKey] = r.n;
    const prop = Object.fromEntries(proposals.map((r) => [r.status, r._count._all]));
    const fb = Object.fromEntries(feedback.map((r) => [r.rating, r._count._all]));
    const month = await this.billing.monthly(1, now);

    return {
      range: { from, to, timezone: tz },
      questions,
      questionsPerDay,
      activeUsers: active[0]?.n ?? 0,
      spend: {
        rangeCostUsd: new Prisma.Decimal(u?.cost ?? 0).toFixed(8),
        requests: u?.requests ?? 0,
        month: month.months[0] ?? null,
        budget: month.currentBudget,
      },
      cacheHitRate: prompt === 0 ? null : Number(u?.read ?? 0) / prompt,
      notices: noticeMap,
      errorRate: questions === 0 ? null : errors / questions,
      refusalRate: questions === 0 ? null : (noticeMap['REFUSED'] ?? 0) / questions,
      tools,
      languages: { counts: langs, sampled: sample.length },
      portals: portalMix,
      attachments,
      proposals: {
        raised: Object.values(prop).reduce((a, n) => a + n, 0),
        confirmed: prop['CONFIRMED'] ?? 0,
      },
      feedback: { up: fb['UP'] ?? 0, down: fb['DOWN'] ?? 0 },
    };
  }

  // ── controls ───────────────────────────────────────────────────────
  async controls() {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(CONTROL_SETTINGS)) {
      try {
        const v = (await this.settings.getByKey(key)).value;
        // A cap is shown at the same billed scale as every cost on the page.
        out[key] = BUDGET_KEYS.has(key) ? billedFromRealUsd(Number(v)).toFixed(2) : v;
      } catch {
        out[key] = null;
      }
    }
    return { settings: out };
  }

  /** Change one control through the existing settings service (which audits it). */
  async setControl(staffId: string, key: string, value: unknown) {
    const valueType = CONTROL_SETTINGS[key];
    if (valueType === undefined) {
      throw new BadRequestException({
        code: 'NOT_A_CONTROL',
        message: 'That is not an assistant control.',
      });
    }
    let stored: unknown = value;
    if (BUDGET_KEYS.has(key)) {
      const shown = Number(value);
      if (!Number.isFinite(shown) || shown < 0) {
        throw new BadRequestException({
          code: 'BAD_AMOUNT',
          message: 'Enter an amount of zero or more.',
        });
      }
      stored = realFromBilledUsd(new Prisma.Decimal(shown)).toDecimalPlaces(2).toNumber();
    }
    await this.settings.updateValue(key, { valueType, value: stored }, staffId);
    return this.controls();
  }

  // ── explorer ───────────────────────────────────────────────────────
  private async languageIds(language: 'en' | 'bn' | 'hi'): Promise<string[]> {
    const bn = '[ঀ-৿]';
    const hi = '[ऀ-ॿ]';
    const rows =
      language === 'en'
        ? await this.prisma.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT DISTINCT conversation_id AS id FROM assistant_messages
             WHERE is_question AND content::text !~ ${bn} AND content::text !~ ${hi} LIMIT 5000`)
        : await this.prisma.client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT DISTINCT conversation_id AS id FROM assistant_messages
             WHERE is_question AND content::text ~ ${language === 'bn' ? bn : hi} LIMIT 5000`);
    return rows.map((r) => r.id);
  }

  async list(f: ExplorerFilters) {
    const limit = Math.min(Math.max(f.limit ?? 25, 1), 100);
    const offset = Math.max(f.offset ?? 0, 0);
    const where: Prisma.AssistantConversationWhereInput = { deletedAt: null };
    if (f.portal !== undefined)
      where.audience = f.portal.toUpperCase() as 'STAFF' | 'SELLER' | 'STORE' | 'ASSOCIATE';
    if (f.sellerId !== undefined) where.sellerId = f.sellerId;
    if (f.storeId !== undefined) where.storeId = f.storeId;
    if (f.userId !== undefined) where.ownerUserId = f.userId;
    if (f.from !== undefined || f.to !== undefined) {
      where.updatedAt = {
        ...(f.from !== undefined ? { gte: dayStart(f.from) } : {}),
        ...(f.to !== undefined ? { lt: new Date(dayStart(f.to).getTime() + 86_400_000) } : {}),
      };
    }
    if (f.hasAttachment === true) where.attachments = { some: {} };
    if (f.rating !== undefined)
      where.feedback = { some: { rating: f.rating === 'up' ? 'UP' : 'DOWN' } };
    if (f.hadNotice === 'any') where.notices = { some: {} };
    if (f.hadNotice === 'error')
      where.notices = { some: { code: { in: ERROR_CODES.concat('REFUSED') } } };
    if (f.language !== undefined) where.id = { in: await this.languageIds(f.language) };

    const [total, rows] = await Promise.all([
      this.prisma.client.assistantConversation.count({ where }),
      this.prisma.client.assistantConversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          audience: true,
          ownerUserId: true,
          sellerId: true,
          storeId: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          anonymisedAt: true,
          _count: { select: { attachments: true, notices: true } },
        },
      }),
    ]);
    const ids = rows.map((r) => r.id);
    const [qs, fb, firsts, names] = await Promise.all([
      this.prisma.client.assistantMessage.groupBy({
        by: ['conversationId'],
        where: { conversationId: { in: ids }, isQuestion: true },
        _count: { _all: true },
      }),
      this.prisma.client.assistantFeedback.groupBy({
        by: ['conversationId', 'rating'],
        where: { conversationId: { in: ids } },
        _count: { _all: true },
      }),
      this.prisma.client.assistantMessage.findMany({
        where: { conversationId: { in: ids }, isQuestion: true },
        orderBy: { id: 'asc' },
        take: 2000,
        select: { conversationId: true, content: true },
      }),
      this.nameLookup(rows),
    ]);
    const qMap = new Map(qs.map((r) => [r.conversationId, r._count._all]));
    const firstQ = new Map<string, string>();
    for (const m of firsts)
      if (!firstQ.has(m.conversationId)) firstQ.set(m.conversationId, visibleText(m.content));
    return {
      total,
      limit,
      offset,
      items: rows.map((r) => {
        const first = firstQ.get(r.id) ?? '';
        return {
          id: r.id,
          portal: r.audience.toLowerCase(),
          title: r.title,
          // A preview is customer text: phones masked here too.
          preview: maskPhones(first).slice(0, 140),
          language: first === '' ? null : detectReplyLanguage(first),
          user: names.user.get(r.ownerUserId) ?? null,
          account:
            (r.storeId !== null ? names.store.get(r.storeId) : null) ??
            (r.sellerId !== null ? names.seller.get(r.sellerId) : null) ??
            null,
          questions: qMap.get(r.id) ?? 0,
          attachments: r._count.attachments,
          notices: r._count.notices,
          up: fb.find((x) => x.conversationId === r.id && x.rating === 'UP')?._count._all ?? 0,
          down: fb.find((x) => x.conversationId === r.id && x.rating === 'DOWN')?._count._all ?? 0,
          anonymised: r.anonymisedAt !== null,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        };
      }),
    };
  }

  private async nameLookup(
    rows: ReadonlyArray<{
      audience: string;
      ownerUserId: string;
      sellerId: string | null;
      storeId: string | null;
    }>,
  ) {
    const pick = (a: string[]): string[] => [...new Set(a)];
    const staff = pick(rows.filter((r) => r.audience === 'STAFF').map((r) => r.ownerUserId));
    const sellerU = pick(rows.filter((r) => r.audience === 'SELLER').map((r) => r.ownerUserId));
    const storeU = pick(
      rows
        .filter((r) => r.audience === 'STORE' || r.audience === 'ASSOCIATE')
        .map((r) => r.ownerUserId),
    );
    const sellers = pick(rows.flatMap((r) => (r.sellerId === null ? [] : [r.sellerId])));
    const stores = pick(rows.flatMap((r) => (r.storeId === null ? [] : [r.storeId])));
    const c = this.prisma.client;
    const [a, b, d, e, f] = await Promise.all([
      c.staffUser.findMany({
        where: { id: { in: staff } },
        select: { id: true, emailDisplay: true },
      }),
      c.sellerUser.findMany({
        where: { id: { in: sellerU } },
        select: { id: true, fullName: true },
      }),
      c.storeUser.findMany({ where: { id: { in: storeU } }, select: { id: true, fullName: true } }),
      c.seller.findMany({
        where: { id: { in: sellers } },
        select: { id: true, companyName: true },
      }),
      c.sellerStore.findMany({ where: { id: { in: stores } }, select: { id: true, name: true } }),
    ]);
    return {
      user: new Map<string, string>([
        ...a.map((x): [string, string] => [x.id, x.emailDisplay]),
        ...b.map((x): [string, string] => [x.id, x.fullName]),
        ...d.map((x): [string, string] => [x.id, x.fullName]),
      ]),
      seller: new Map(e.map((x) => [x.id, x.companyName])),
      store: new Map(f.map((x) => [x.id, x.name])),
    };
  }

  /** Write the audit row or refuse: a transcript must never be shown without its record. */
  private async auditOrRefuse(
    staffId: string,
    action: string,
    id: string,
    metadata: Record<string, unknown>,
    severity: 'MEDIUM' | 'HIGH',
  ): Promise<void> {
    const logged = await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: staffId,
      action,
      entityType: 'assistant_conversation',
      entityId: id,
      metadata,
      severity,
    });
    if (logged === null) {
      throw new ServiceUnavailableException({
        code: 'AUDIT_UNAVAILABLE',
        message: 'This could not be recorded in the audit log, so it was not opened.',
      });
    }
  }

  private async conversationOr404(id: string) {
    const conv = await this.prisma.client.assistantConversation.findFirst({
      where: { id, deletedAt: null },
    });
    if (conv === null) {
      throw new NotFoundException({
        code: 'ASSISTANT_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found',
      });
    }
    return conv;
  }

  /** Open one conversation. AUDITED before anything is returned. */
  async open(staffId: string, id: string, reason?: string): Promise<ConversationReview> {
    const conv = await this.conversationOr404(id);
    await this.auditOrRefuse(
      staffId,
      'staff.assistant.conversation.viewed',
      id,
      { portal: conv.audience.toLowerCase(), ...(reason !== undefined ? { reason } : {}) },
      'MEDIUM',
    );
    const c = this.prisma.client;
    const [messages, attachments, feedback, notices, tools, names] = await Promise.all([
      c.assistantMessage.findMany({ where: { conversationId: id }, orderBy: { id: 'asc' } }),
      c.assistantAttachment.findMany({
        where: { conversationId: id },
        orderBy: { id: 'asc' },
        select: {
          id: true,
          messageId: true,
          kind: true,
          mediaType: true,
          originalName: true,
          bytes: true,
          pages: true,
          storageKey: true,
        },
      }),
      c.assistantFeedback.findMany({
        where: { conversationId: id },
        select: { messageId: true, rating: true, comment: true, createdAt: true },
      }),
      c.assistantNotice.findMany({
        where: { conversationId: id },
        orderBy: { id: 'asc' },
        select: { code: true, createdAt: true },
      }),
      c.assistantToolCall.findMany({
        where: { conversationId: id },
        orderBy: { id: 'asc' },
        select: { toolName: true, ok: true, errorCode: true, resultBytes: true, createdAt: true },
      }),
      this.nameLookup([conv]),
    ]);
    return {
      conversation: {
        id,
        portal: conv.audience.toLowerCase(),
        title: conv.title,
        user: names.user.get(conv.ownerUserId) ?? null,
        account:
          (conv.storeId !== null ? names.store.get(conv.storeId) : null) ??
          (conv.sellerId !== null ? names.seller.get(conv.sellerId) : null) ??
          null,
        createdAt: conv.createdAt.toISOString(),
        updatedAt: conv.updatedAt.toISOString(),
        anonymised: conv.anonymisedAt !== null,
      },
      messages: messages.map((m) => {
        const r = reviewBlocks(m.content, false);
        return {
          id: m.id,
          role: m.role.toLowerCase(),
          isQuestion: m.isQuestion,
          at: m.createdAt.toISOString(),
          blocks: r.blocks,
          maskedPhones: r.masked,
          attachmentIds: attachments.filter((a) => a.messageId === m.id).map((a) => a.id),
          feedback: feedback
            .filter((x) => x.messageId === m.id)
            .map((x) => ({
              rating: x.rating.toLowerCase(),
              comment: x.comment === null ? null : maskPhones(x.comment),
            })),
        };
      }),
      attachments: attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        mediaType: a.mediaType,
        name: a.originalName,
        bytes: a.bytes,
        pages: a.pages,
        available: a.storageKey !== '',
      })),
      notices: notices.map((n) => ({ code: n.code, at: n.createdAt.toISOString() })),
      tools: tools.map((t) => ({
        name: t.toolName,
        ok: t.ok,
        errorCode: t.errorCode,
        resultBytes: t.resultBytes,
        at: t.createdAt.toISOString(),
      })),
    };
  }

  /** One click that shows the unmasked turn. AUDITED (HIGH) first. */
  async reveal(staffId: string, conversationId: string, messageId: string, reason?: string) {
    await this.conversationOr404(conversationId);
    const msg = await this.prisma.client.assistantMessage.findFirst({
      where: { id: messageId, conversationId },
    });
    if (msg === null)
      throw new NotFoundException({
        code: 'ASSISTANT_MESSAGE_NOT_FOUND',
        message: 'Message not found',
      });
    await this.auditOrRefuse(
      staffId,
      'staff.assistant.phone.revealed',
      conversationId,
      { messageId, ...(reason !== undefined ? { reason } : {}) },
      'HIGH',
    );
    return { id: msg.id, blocks: reviewBlocks(msg.content, true).blocks };
  }

  /** A signed download of one attachment. AUDITED. */
  async downloadAttachment(staffId: string, conversationId: string, attachmentId: string) {
    await this.conversationOr404(conversationId);
    await this.auditOrRefuse(
      staffId,
      'staff.assistant.attachment.downloaded',
      conversationId,
      { attachmentId },
      'MEDIUM',
    );
    return this.attachments.downloadUrlForReview(conversationId, attachmentId);
  }
}
