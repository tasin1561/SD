import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType, CourierTemplateCandidateStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

export interface CandidateView {
  readonly id: string;
  readonly body: string;
  readonly seenCount: number;
  readonly status: CourierTemplateCandidateStatus;
  readonly suggestedRegex: string | null;
  readonly suggestedState: string | null;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

export interface TemplateView {
  readonly id: string;
  readonly code: string;
  readonly pattern: string;
  readonly state: string;
  readonly action: string | null;
  readonly priority: number;
  readonly isActive: boolean;
}

/**
 * The promotion queue: unmatched courier messages becoming patterns.
 *
 * ── WHY THIS HAS TO BE A SCREEN ──────────────────────────────────────
 * The classifier records every message it could not classify, ordered by
 * how often the exact text has recurred. That corpus is the whole
 * mechanism by which the regex library grows — and until now it was
 * write-only. Messages accumulated where nobody could see them, which
 * means the library could never have grown at all and the LLM would
 * eventually have been switched on to cover for a gap nobody had looked
 * at.
 *
 * ── A PATTERN IS REVIEWED BY A HUMAN, ALWAYS ──────────────────────────
 * Promotion takes a pattern the reviewer types or approves, never one
 * applied automatically — including a model's `suggestedRegex`. An
 * unreviewed pattern does not fail loudly; it silently mislabels every
 * message it over-matches, and the label drives what the seller is shown.
 *
 * The pattern is COMPILED before it is saved. A bad regex stored as data
 * is skipped at match time with an error log, which is survivable but
 * invisible — refusing at the point of entry is where the operator can
 * still fix it.
 */
@Injectable()
export class CourierTemplateReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** Most-repeated misses first — the most valuable pattern to write. */
  async listCandidates(status?: CourierTemplateCandidateStatus): Promise<CandidateView[]> {
    return this.prisma.client.courierTemplateCandidate.findMany({
      where: status === undefined ? {} : { status },
      orderBy: [{ seenCount: 'desc' }, { lastSeenAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        body: true,
        seenCount: true,
        status: true,
        suggestedRegex: true,
        suggestedState: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    });
  }

  async listTemplates(): Promise<TemplateView[]> {
    return this.prisma.client.courierMessageTemplate.findMany({
      orderBy: [{ priority: 'asc' }, { code: 'asc' }],
      select: {
        id: true,
        code: true,
        pattern: true,
        state: true,
        action: true,
        priority: true,
        isActive: true,
      },
    });
  }

  /**
   * Promote a candidate into the live library.
   *
   * The candidate is marked PROMOTED rather than deleted: the body is the
   * evidence for why the pattern exists, and a pattern whose origin has
   * been thrown away is one nobody can safely change later.
   */
  async promote(input: {
    candidateId: string;
    code: string;
    pattern: string;
    state: string;
    action?: string | null;
    priority?: number;
    staffId: string;
    notes?: string | null;
  }): Promise<TemplateView> {
    const candidate = await this.prisma.client.courierTemplateCandidate.findUnique({
      where: { id: input.candidateId },
    });
    if (candidate === null) {
      throw new NotFoundException({ code: 'CANDIDATE_NOT_FOUND', message: 'No such candidate.' });
    }

    // Compile before saving. A pattern that only fails at match time is
    // an outage the operator cannot see.
    let re: RegExp;
    try {
      re = new RegExp(input.pattern, 'i');
    } catch (err) {
      throw new BadRequestException({
        code: 'PATTERN_INVALID',
        message: `That is not a valid regular expression: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }

    // And check it actually matches the body it was written for. A pattern
    // promoted from a candidate it does not match is the single most
    // likely mistake here, and it would look like a working promotion.
    if (!re.test(candidate.body)) {
      throw new BadRequestException({
        code: 'PATTERN_DOES_NOT_MATCH',
        message:
          'That pattern does not match the message it was written for. ' +
          'Test it against the body shown before promoting.',
      });
    }

    const template = await this.prisma.client.courierMessageTemplate.upsert({
      where: { code: input.code },
      update: {
        pattern: input.pattern,
        state: input.state,
        action: input.action ?? null,
        priority: input.priority ?? 50,
        notes: input.notes ?? `Promoted from candidate ${candidate.id}`,
      },
      create: {
        code: input.code,
        pattern: input.pattern,
        state: input.state,
        action: input.action ?? null,
        priority: input.priority ?? 50,
        notes: input.notes ?? `Promoted from candidate ${candidate.id}`,
      },
      select: {
        id: true,
        code: true,
        pattern: true,
        state: true,
        action: true,
        priority: true,
        isActive: true,
      },
    });

    await this.prisma.client.courierTemplateCandidate.update({
      where: { id: candidate.id },
      data: {
        status: CourierTemplateCandidateStatus.PROMOTED,
        reviewedByStaffId: input.staffId,
        reviewedAt: new Date(),
        reviewNotes: input.notes ?? null,
      },
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffId,
      actorId: input.staffId,
      action: 'courier.template.promoted',
      entityType: 'courier_message_template',
      entityId: template.id,
      // A new pattern changes how every future courier message is
      // labelled, and the label drives what a seller is shown.
      severity: 'MEDIUM',
      metadata: {
        code: input.code,
        pattern: input.pattern,
        state: input.state,
        candidateId: candidate.id,
        seenCount: candidate.seenCount,
      },
    });

    return template;
  }

  /** Looked at and deliberately not promoted. */
  async reject(input: {
    candidateId: string;
    staffId: string;
    notes?: string | null;
  }): Promise<void> {
    const { count } = await this.prisma.client.courierTemplateCandidate.updateMany({
      where: { id: input.candidateId, status: { not: CourierTemplateCandidateStatus.PROMOTED } },
      data: {
        status: CourierTemplateCandidateStatus.REJECTED,
        reviewedByStaffId: input.staffId,
        reviewedAt: new Date(),
        reviewNotes: input.notes ?? null,
      },
    });
    if (count === 0) {
      throw new NotFoundException({
        code: 'CANDIDATE_NOT_REJECTABLE',
        message: 'That candidate is gone, or has already been promoted.',
      });
    }
  }

  /**
   * Turn a template off without deleting it.
   *
   * Deleting would lose the record of a pattern that was once live, which
   * is what you need when a mislabelled message has to be explained.
   */
  async setTemplateActive(input: {
    templateId: string;
    isActive: boolean;
    staffId: string;
  }): Promise<void> {
    await this.prisma.client.courierMessageTemplate.update({
      where: { id: input.templateId },
      data: { isActive: input.isActive },
    });
    await this.audit.log({
      actorType: ActorType.STAFF,
      staffUserId: input.staffId,
      actorId: input.staffId,
      action: input.isActive ? 'courier.template.enabled' : 'courier.template.disabled',
      entityType: 'courier_message_template',
      entityId: input.templateId,
      severity: 'MEDIUM',
      metadata: {},
    });
  }
}
