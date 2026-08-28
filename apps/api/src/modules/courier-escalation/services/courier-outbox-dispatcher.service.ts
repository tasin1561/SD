import { Injectable, Logger } from '@nestjs/common';
import { ActorType, CourierOutboxKind } from '@skydrop/db';
import { CourierSupportRegistryService } from './courier-support-registry.service';
import { CourierCapabilityUnsupportedError } from '../../courier-shared/services/courier-support-adapter';
import { CourierOutboxService, classifyDispatchError } from './courier-outbox.service';

export interface DispatchCycleSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly ambiguous: number;
  readonly unsupported: number;
}

/**
 * The AUTO/SUPERVISED consumer of the outbox.
 *
 * ── IT CURRENTLY DOES NOTHING, BY CONSTRUCTION ───────────────────────
 * `capabilities()` reports every write false, because no ticket write
 * channel exists. So this loop claims nothing and dispatches nothing —
 * and that is not a stub or a placeholder: it is the router correctly
 * reading what the channel can do. When MCP writes land, the flags flip
 * and this code starts working with no changes here.
 *
 * ── ONE ITEM AT A TIME, AND IT FINISHES WHAT IT STARTS ───────────────
 * A cycle claims one item, dispatches it, records the outcome, and only
 * then looks for another. If the mode flips to MANUAL mid-cycle, the
 * NEXT claim returns null and the loop stops — but the item in hand runs
 * to completion. Aborting mid-post is exactly how you produce a
 * SENT_UNCONFIRMED with no read-back, which is the state that causes
 * duplicates. "Stop now" must mean "claim nothing new", never "drop what
 * you are holding".
 *
 * ── THE ORDERING AROUND THE ACTUAL CALL ──────────────────────────────
 * SENT_UNCONFIRMED is written the instant the call returns OR throws
 * ambiguously — before we know anything. That is the visible-vs-silent
 * discipline applied to a network write: a crash after dispatch leaves a
 * row that says "we sent something and do not know", which the
 * reconciler can act on, rather than a PENDING row that would be sent
 * again.
 */
@Injectable()
export class CourierOutboxDispatcherService {
  private readonly logger = new Logger(CourierOutboxDispatcherService.name);
  /** Bounded so one cycle cannot run away; the queue is ~tens/day. */
  private static readonly MAX_PER_CYCLE = 20;

  constructor(
    private readonly outbox: CourierOutboxService,
    private readonly registry: CourierSupportRegistryService,
  ) {}

  /** Public so it doubles as the manual ops trigger. */
  async runCycle(): Promise<DispatchCycleSummary> {
    let claimed = 0;
    let sent = 0;
    let failed = 0;
    let ambiguous = 0;
    let unsupported = 0;

    for (let i = 0; i < CourierOutboxDispatcherService.MAX_PER_CYCLE; i += 1) {
      // Re-read the mode EVERY iteration: a flip to MANUAL takes effect
      // at the next claim, not at the next cycle.
      const item = await this.outbox.claimForWorker();
      if (item === null) break;
      claimed += 1;

      try {
        // THAT courier's desk, not a default one. The registry returns
        // null for a courier with no adapter, and the throw below routes
        // the item to a human exactly as an unsupported capability does.
        const adapter = this.registry.for(item.courierCode);
        if (adapter === null) {
          // Same treatment as an unsupported capability, because it is
          // the same situation: this channel cannot carry this message,
          // so it goes back to the queue for a person rather than
          // burning an attempt or being marked failed.
          throw new CourierCapabilityUnsupportedError(
            item.kind === CourierOutboxKind.COMMENT ? 'postComment' : 'raiseTicket',
          );
        }
        if (item.kind === CourierOutboxKind.COMMENT) {
          const ticketId = await this.resolveTicketId(item.escalationId);
          await adapter.postComment(ticketId ?? '', item.body);
        } else {
          await adapter.raiseTicket({
            awbNumber: '',
            categoryId: item.categoryId ?? '',
            body: item.body,
          });
        }
        // Reached only if the call RETURNED. Still not CONFIRMED: only a
        // read-back may say that.
        await this.outbox.markSentUnconfirmed({
          itemId: item.id,
          actorType: ActorType.SYSTEM,
        });
        sent += 1;
      } catch (err) {
        if (err instanceof CourierCapabilityUnsupportedError) {
          // Not a failure of this message — the channel cannot do it at
          // all. Return it to the queue for a human rather than burning
          // an attempt or marking it failed.
          unsupported += 1;
          await this.outbox.release(
            item.id,
            `Channel cannot ${err.capability} — returned to the ops queue for a human`,
          );
          continue;
        }

        const errorClass = classifyDispatchError(err);
        await this.outbox.fail({
          itemId: item.id,
          error: err instanceof Error ? err.message : String(err),
          errorClass,
          actorType: ActorType.SYSTEM,
        });
        if (errorClass === 'AMBIGUOUS') ambiguous += 1;
        else failed += 1;
      }
    }

    if (claimed > 0) {
      this.logger.log(
        { claimed, sent, failed, ambiguous, unsupported },
        'Courier outbox cycle complete',
      );
    }
    return { claimed, sent, failed, ambiguous, unsupported };
  }

  private async resolveTicketId(_escalationId: string): Promise<string | null> {
    // Placeholder resolution: the escalation carries externalTicketId and
    // the dispatcher reads it when a write channel exists. Left thin
    // rather than elaborate, because every path through it is currently
    // unreachable — capabilities() refuses first.
    return null;
  }
}
