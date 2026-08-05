import { Injectable, Logger } from '@nestjs/common';
import { CourierTemplateCandidateStatus } from '@skydrop/db';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * What the classifier produces. A LABEL, and nothing that can act.
 *
 * There is deliberately no field here that names a tool, an endpoint, or
 * a courier call. `state` and `action` are strings a TypeScript decision
 * table looks up; if the model returns nonsense, the worst case is an
 * unrecognised label that routes to a human — never an action fired.
 */
export interface Classification {
  readonly templateCode: string | null;
  readonly state: string | null;
  readonly action: string | null;
  /** 0..1. Regex matches are 1 — they either matched or they did not. */
  readonly confidence: number;
  /** True when a human must look: unmatched, or below the gate. */
  readonly needsReview: boolean;
  readonly source: 'REGEX' | 'MODEL' | 'UNMATCHED';
}

/** Below this, a model's answer is not trusted to stand alone. */
const CONFIDENCE_GATE = 0.85;

/**
 * Turn a courier message into a state label.
 *
 * ── REGEX FIRST, AND FOR NOW ONLY ────────────────────────────────────
 * The library lives in `courier_message_templates` — DATA, not a
 * TypeScript array — so a new canned reply is a row, not a release. It is
 * seeded from the four templates captured verbatim from the Delhivery One
 * panel and grows from real traffic.
 *
 * ── WHY THE MODEL IS OFF BY DEFAULT ──────────────────────────────────
 * Not mainly cost. If the model is live from day one, every gap in the
 * regex library gets silently papered over and the deterministic path
 * never gets built — the system would work while being permanently
 * dependent on inference for something that is a fixed set of canned
 * strings. Regex-only makes the misses VISIBLE.
 *
 * ── WHICH IS WHY A MISS IS RECORDED, NOT DROPPED ─────────────────────
 * Every unmatched body lands in `courier_template_candidates` as
 * UNMATCHED, with a seen-count so the most repeated miss sorts to the
 * top. That is the corpus, built from real courier traffic, before the
 * model is ever switched on — and when it is, its `suggestedRegex` lands
 * in the SAME queue for a human to promote. A pattern nobody reviewed is
 * a pattern that silently mislabels.
 *
 * ── UNTRUSTED INPUT ──────────────────────────────────────────────────
 * Courier text is attacker-influenced in principle (anyone who can get a
 * message into a ticket can put words in it). Regex matching cannot be
 * talked out of its answer. When the model path lands it must wrap the
 * body in explicit data tags and constrain output to a closed enum —
 * and even then, the output is a label consumed by TypeScript, never a
 * selected tool or argument.
 */
@Injectable()
export class CourierMessageClassifierService {
  private readonly logger = new Logger(CourierMessageClassifierService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whitespace-normalised, lowercased body.
   *
   * Exported through `hashBody` as the dedup input too, so "the same
   * message" means the same thing to the classifier and to the dedup key.
   * Email replies arrive with wrapped lines and inconsistent indentation;
   * without this, one soft line-break makes a known template unmatched.
   */
  normalise(body: string): string {
    return body.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  hashBody(body: string): string {
    return createHash('sha256').update(this.normalise(body)).digest('hex');
  }

  async classify(body: string): Promise<Classification> {
    const text = this.normalise(body);

    const templates = await this.prisma.client.courierMessageTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ priority: 'asc' }, { code: 'asc' }],
      select: { code: true, pattern: true, state: true, action: true },
    });

    for (const t of templates) {
      let re: RegExp;
      try {
        // Patterns are operator-editable data, so a bad one is a
        // possibility rather than a bug. It must not take down the
        // pipeline — skip it and say so loudly.
        re = new RegExp(t.pattern, 'i');
      } catch {
        this.logger.error(
          { code: t.code, pattern: t.pattern },
          'Courier message template has an invalid regex — skipping it',
        );
        continue;
      }
      if (re.test(text)) {
        return {
          templateCode: t.code,
          state: t.state,
          action: t.action,
          // A regex either matched or it did not. Inventing a fractional
          // confidence here would make the gate meaningless.
          confidence: 1,
          needsReview: false,
          source: 'REGEX',
        };
      }
    }

    // MISS. The model path would go here, behind its own setting; while
    // it is off this is the whole tail.
    await this.recordCandidate(body);
    return {
      templateCode: null,
      state: null,
      action: null,
      confidence: 0,
      // Unmatched ALWAYS goes to a human. The alternative is a message
      // with no state that nobody is told about.
      needsReview: true,
      source: 'UNMATCHED',
    };
  }

  /**
   * Add a miss to the promotion queue, or bump the one already there.
   *
   * Upsert on the body hash so a repeated canned reply becomes a count
   * rather than a hundred rows — the count is the signal for which
   * pattern to write first.
   */
  private async recordCandidate(body: string): Promise<void> {
    const bodyHash = this.hashBody(body);
    try {
      await this.prisma.client.courierTemplateCandidate.upsert({
        where: { bodyHash },
        update: { seenCount: { increment: 1 }, lastSeenAt: new Date() },
        create: {
          bodyHash,
          body: this.normalise(body),
          status: CourierTemplateCandidateStatus.UNMATCHED,
        },
      });
    } catch (err) {
      // Never let corpus-keeping fail the ingest: the message itself is
      // the thing that must be stored.
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'Could not record an unmatched courier message candidate',
      );
    }
  }

  /**
   * The gate a model answer must clear. Exposed so the (not yet built)
   * model path and its tests share one number rather than each carrying
   * a copy that can drift.
   */
  static readonly confidenceGate = CONFIDENCE_GATE;

  /** Whether a model-sourced answer stands on its own. */
  static modelAnswerNeedsReview(confidence: number): boolean {
    return confidence < CONFIDENCE_GATE;
  }
}
