import { ConflictException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ActorType, AssistantKnowledgeChangeAction, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import {
  applyChange,
  EMPTY_OVERLAY,
  overlayToJson,
  parseOverlay,
  type KnowledgeChange,
  type KnowledgeOverlay,
} from '../knowledge/knowledge-overlay';

const LIVE_ROW = 1;
const ADVISORY_KEY = 'assistant_knowledge_live';

export interface VersionRow {
  readonly id: string;
  readonly number: number;
  readonly parentVersionId: string | null;
  readonly recommendationId: string | null;
  readonly createdAt: Date;
}

/**
 * The knowledge OVERLAY's versions and the one pointer that says which is
 * live. Everything that can change what the assistant says goes through here.
 *
 *  - A version is an IMMUTABLE full snapshot. There is no update or delete of
 *    a version in this file, and there must not be.
 *  - `goLive` and `rollback` move the pointer with a GUARDED `updateMany`
 *    (`WHERE version_id` = the version the caller saw) inside an
 *    advisory-locked transaction, and write the audit row in the SAME
 *    transaction. A second click, or a click made on a stale screen, matches
 *    nothing and is refused.
 *  - A conversation does not read the pointer after it starts: it keeps the
 *    version id stored on it (`overlayFor(thatId)`).
 */
@Injectable()
export class AssistantKnowledgeService {
  private readonly log = new Logger(AssistantKnowledgeService.name);
  /** Versions never change, so a loaded overlay is kept (and is the SAME object every time: the help index is keyed on it). */
  private readonly loaded = new Map<string, KnowledgeOverlay>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** The live version id, or null for "the committed base alone". */
  async liveVersionId(): Promise<string | null> {
    const row = await this.prisma.client.assistantKnowledgeLive.findUnique({
      where: { id: LIVE_ROW },
    });
    return row?.versionId ?? null;
  }

  /** The overlay of one version. An unknown id reads as the base alone (never an error mid-answer). */
  async overlayFor(versionId: string): Promise<KnowledgeOverlay> {
    const hit = this.loaded.get(versionId);
    if (hit !== undefined) return hit;
    const row = await this.prisma.client.assistantKnowledgeVersion.findUnique({
      where: { id: versionId },
      select: { content: true },
    });
    if (row === null) {
      this.log.warn(`knowledge version ${versionId} not found; answering from the base`);
      return EMPTY_OVERLAY;
    }
    const overlay = parseOverlay(row.content);
    this.loaded.set(versionId, overlay);
    return overlay;
  }

  /** The overlay of the live version (EMPTY_OVERLAY when only the base is live). */
  async liveOverlay(): Promise<KnowledgeOverlay> {
    const id = await this.liveVersionId();
    return id === null ? EMPTY_OVERLAY : this.overlayFor(id);
  }

  /**
   * A DRAFT version: the current live overlay with `change` applied, parented
   * on the live version. Never live. The same (recommendation, parent) pair
   * reuses its row, so running the check twice does not pile up versions.
   */
  async createDraftVersion(
    recommendationId: string,
    change: KnowledgeChange,
  ): Promise<{ id: string; parentVersionId: string | null }> {
    const parentVersionId = await this.liveVersionId();
    const existing = await this.prisma.client.assistantKnowledgeVersion.findFirst({
      where: { recommendationId, parentVersionId },
      orderBy: { number: 'desc' },
      select: { id: true },
    });
    if (existing !== null) return { id: existing.id, parentVersionId };
    const base = parentVersionId === null ? EMPTY_OVERLAY : await this.overlayFor(parentVersionId);
    const next = applyChange(base, change);
    const row = await this.prisma.client.assistantKnowledgeVersion.create({
      data: {
        parentVersionId,
        recommendationId,
        content: overlayToJson(next) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { id: row.id, parentVersionId };
  }

  async versionRow(id: string): Promise<VersionRow | null> {
    return this.prisma.client.assistantKnowledgeVersion.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        parentVersionId: true,
        recommendationId: true,
        createdAt: true,
      },
    });
  }

  /**
   * Move the live pointer to `toVersionId`.
   *
   * `expectedFrom` is the version the caller believed was live: if the pointer
   * has moved, nothing changes and the caller gets a 409. `requireParent`
   * (approval) additionally demands that the target was built ON the current
   * live version, so a draft made before another change went live cannot
   * silently drop that change.
   */
  async moveLive(input: {
    readonly action: 'GO_LIVE' | 'ROLLBACK';
    /** null = the committed base alone (a rollback past the first overlay). */
    readonly toVersionId: string | null;
    readonly expectedFrom: string | null;
    readonly requireParent: boolean;
    readonly staffId: string;
    readonly recommendationId: string | null;
    readonly evalRunId: string | null;
    /** Runs inside the same transaction, after the pointer moved (the recommendation's status). */
    readonly alsoInTx?: (tx: Prisma.TransactionClient) => Promise<void>;
  }): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADVISORY_KEY}))`;
      await tx.assistantKnowledgeLive.upsert({
        where: { id: LIVE_ROW },
        create: { id: LIVE_ROW, versionId: null },
        update: {},
      });
      const target =
        input.toVersionId === null
          ? null
          : await tx.assistantKnowledgeVersion.findUnique({
              where: { id: input.toVersionId },
              select: { id: true, parentVersionId: true },
            });
      if (input.toVersionId !== null && target === null) {
        throw new ConflictException({
          code: 'ASSISTANT_VERSION_NOT_FOUND',
          message: 'That version does not exist.',
        });
      }
      if (input.requireParent && target !== null && target.parentVersionId !== input.expectedFrom) {
        throw new ConflictException({
          code: 'ASSISTANT_DRAFT_STALE',
          message: 'Something else went live after this draft was checked. Run the check again.',
        });
      }
      const moved = await tx.assistantKnowledgeLive.updateMany({
        where: { id: LIVE_ROW, versionId: input.expectedFrom },
        data: { versionId: input.toVersionId, updatedAt: new Date() },
      });
      if (moved.count !== 1) {
        throw new ConflictException({
          code: 'ASSISTANT_LIVE_VERSION_MOVED',
          message: 'The live version changed while you were looking. Reload and try again.',
        });
      }
      await tx.assistantKnowledgeChange.create({
        data: {
          action:
            input.action === 'GO_LIVE'
              ? AssistantKnowledgeChangeAction.GO_LIVE
              : AssistantKnowledgeChangeAction.ROLLBACK,
          fromVersionId: input.expectedFrom,
          toVersionId: input.toVersionId,
          recommendationId: input.recommendationId,
          evalRunId: input.evalRunId,
          staffId: input.staffId,
        },
      });
      if (input.alsoInTx !== undefined) await input.alsoInTx(tx);
    });
    const logged = await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffId,
      action:
        input.action === 'GO_LIVE' ? 'assistant.knowledge.go_live' : 'assistant.knowledge.rollback',
      entityType: 'assistant_knowledge_version',
      entityId: input.toVersionId ?? input.expectedFrom,
      metadata: {
        fromVersionId: input.expectedFrom,
        toVersionId: input.toVersionId,
        recommendationId: input.recommendationId,
        evalRunId: input.evalRunId,
      },
      severity: 'HIGH',
    });
    if (logged === null) {
      // The change row above is the authoritative audit and is committed; say so loudly.
      this.log.error(
        `knowledge ${input.action} ${input.toVersionId ?? 'base'}: audit_logs write failed`,
      );
      throw new ServiceUnavailableException({
        code: 'AUDIT_UNAVAILABLE',
        message:
          'The change was made and recorded in the version history, but the audit log write failed. Tell an engineer.',
      });
    }
  }

  /** Every version, newest first, with who moved the pointer to or from it. */
  async history(limit = 50): Promise<{
    liveVersionId: string | null;
    versions: Array<
      VersionRow & {
        readonly live: boolean;
        readonly counts: { guides: number; glossary: number; addenda: number };
        readonly wentLiveAt: Date | null;
        readonly wentLiveBy: string | null;
      }
    >;
    changes: Array<{
      readonly id: string;
      readonly action: 'GO_LIVE' | 'ROLLBACK';
      readonly fromVersionId: string | null;
      readonly toVersionId: string | null;
      readonly recommendationId: string | null;
      readonly staffId: string;
      readonly createdAt: Date;
    }>;
  }> {
    const live = await this.liveVersionId();
    const [versions, changes] = await Promise.all([
      this.prisma.client.assistantKnowledgeVersion.findMany({
        orderBy: { number: 'desc' },
        take: limit,
      }),
      this.prisma.client.assistantKnowledgeChange.findMany({
        orderBy: { id: 'desc' },
        take: limit * 2,
      }),
    ]);
    return {
      liveVersionId: live,
      versions: versions.map((v) => {
        const o = parseOverlay(v.content);
        const went = changes.find((c) => c.toVersionId === v.id);
        return {
          id: v.id,
          number: v.number,
          parentVersionId: v.parentVersionId,
          recommendationId: v.recommendationId,
          createdAt: v.createdAt,
          live: v.id === live,
          counts: {
            guides: o.guides.length,
            glossary: o.glossary.length,
            addenda: o.addenda.length,
          },
          wentLiveAt: went?.createdAt ?? null,
          wentLiveBy: went?.staffId ?? null,
        };
      }),
      changes: changes.map((c) => ({
        id: c.id,
        action: c.action === AssistantKnowledgeChangeAction.GO_LIVE ? 'GO_LIVE' : 'ROLLBACK',
        fromVersionId: c.fromVersionId,
        toVersionId: c.toVersionId,
        recommendationId: c.recommendationId,
        staffId: c.staffId,
        createdAt: c.createdAt,
      })),
    };
  }

  /** Versions that have EVER been live (the only ones a rollback may name). */
  async everLive(): Promise<Set<string>> {
    const rows = await this.prisma.client.assistantKnowledgeChange.findMany({
      select: { toVersionId: true },
    });
    return new Set(rows.flatMap((r) => (r.toVersionId === null ? [] : [r.toVersionId])));
  }
}
