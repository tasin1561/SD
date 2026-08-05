import { Injectable, Logger } from '@nestjs/common';
import { ActorType, CourierOutboxKind, CourierPortalMode } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CourierChannelSettingsService } from '../../courier-escalation/services/courier-channel-settings.service';
import { CourierOutboxService } from '../../courier-escalation/services/courier-outbox.service';
import { RaiseTicketModal } from '../pages/raise-ticket.modal';
import { TicketDetailPage } from '../pages/ticket-detail.page';
import { PortalChallengeError, PortalSessionService } from './portal-session.service';
import { PortalPacingService } from './portal-pacing.service';

export interface PortalCycleSummary {
  readonly mode: CourierPortalMode;
  readonly claimed: number;
  readonly shadowed: number;
  readonly confirmed: number;
  readonly alreadyPresent: number;
  readonly unverified: number;
  readonly notEligible: number;
  readonly taskPending: number;
  readonly failed: number;
  readonly frozen: boolean;
}

/**
 * The portal consumer of the outbox.
 *
 * ── SHADOW IS THE DEFAULT AND IT IS NOT A NO-OP ───────────────────────
 * In SHADOW the worker logs in, navigates to the real ticket, reads the
 * real thread, resolves the real category and composes the real action —
 * then records what it WOULD have done and stops. Every selector, every
 * eligibility read and every already-present check is exercised against
 * production. That is the only honest way to find out whether this
 * understands the portal before it writes into a thread a customer reads.
 *
 * A shadow run therefore proves something a test cannot, and costs
 * nothing: the item stays PENDING and the ops queue keeps serving it to
 * humans meanwhile. Which is why SHADOW is separate from `writeMode` —
 * it runs happily under MANUAL.
 *
 * ── IT NEVER SETS CONFIRMED ITSELF ────────────────────────────────────
 * A verified write goes through `confirmFromReadBack`, and only after the
 * page object has actually re-read the thread and found the text. An
 * unverified write becomes SENT_UNCONFIRMED for the reconciler. There is
 * no path here that asserts success.
 *
 * ── A CHALLENGE STOPS EVERYTHING ─────────────────────────────────────
 * `PortalChallengeError` breaks the loop, the session has already paused
 * the channel and alerted a human, and the item is returned to the queue.
 * Nothing is retried — a loop against an OTP is the most damaging thing
 * this worker could do.
 */
@Injectable()
export class PortalDispatcherService {
  private readonly logger = new Logger(PortalDispatcherService.name);
  /** Serial and bounded. ~30 items/day; this is a full day's worth. */
  private static readonly MAX_PER_CYCLE = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: CourierOutboxService,
    private readonly settings: CourierChannelSettingsService,
    private readonly session: PortalSessionService,
    private readonly pacing: PortalPacingService,
  ) {}

  /** Public so it doubles as the manual ops trigger. */
  async runCycle(): Promise<PortalCycleSummary> {
    const settings = await this.settings.get();
    const mode = settings.portalMode;
    const shadow = mode === CourierPortalMode.SHADOW;

    const base = {
      mode,
      claimed: 0,
      shadowed: 0,
      confirmed: 0,
      alreadyPresent: 0,
      unverified: 0,
      notEligible: 0,
      taskPending: 0,
      failed: 0,
      frozen: false,
    };

    if (settings.effectivelyPaused) {
      this.logger.log({ reason: settings.pauseReason }, 'Portal channel paused — nothing claimed');
      return base;
    }

    const counters = { ...base };

    for (let i = 0; i < PortalDispatcherService.MAX_PER_CYCLE; i += 1) {
      // Re-read every iteration: a pause or a mode flip takes effect at
      // the next claim, never mid-item.
      const item = shadow ? await this.peekForShadow() : await this.outbox.claimForWorker();
      if (item === null) break;
      counters.claimed += 1;

      try {
        await this.handleOne(item, shadow, counters);
      } catch (err) {
        if (err instanceof PortalChallengeError) {
          // The session already paused the channel and alerted. Give the
          // item back and stop the cycle entirely.
          counters.frozen = true;
          if (!shadow) await this.outbox.release(item.id, `Portal challenge: ${err.challenge}`);
          this.logger.error({ challenge: err.challenge }, 'Portal cycle stopped by a challenge');
          break;
        }
        counters.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        await this.record(item.id, mode, 'FAILED', message);
        if (!shadow) {
          // Classified by the outbox, which decides FAILED vs
          // SENT_UNCONFIRMED — a browser timeout is AMBIGUOUS and must
          // not be retried.
          const { classifyDispatchError } =
            await import('../../courier-escalation/services/courier-outbox.service');
          await this.outbox.fail({
            itemId: item.id,
            error: message,
            errorClass: classifyDispatchError(err),
            actorType: ActorType.SYSTEM,
          });
        }
      }

      // Pace between items, not after the last one.
      if (i < PortalDispatcherService.MAX_PER_CYCLE - 1) await this.pacing.pace();
    }

    if (counters.claimed > 0) this.logger.log(counters, 'Portal cycle complete');
    return counters;
  }

  /**
   * In SHADOW we do not claim: claiming would take items away from the
   * ops queue that humans are still the only ones who can finish. So the
   * shadow path READS the next pending item and leaves it alone.
   */
  private async peekForShadow(): Promise<{
    id: string;
    escalationId: string;
    kind: CourierOutboxKind;
    body: string;
    categoryId: string | null;
  } | null> {
    const row = await this.prisma.client.courierOutboxItem.findFirst({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, escalationId: true, kind: true, body: true, categoryId: true },
    });
    return row;
  }

  private async handleOne(
    item: {
      id: string;
      escalationId: string;
      kind: CourierOutboxKind;
      body: string;
      categoryId: string | null;
    },
    shadow: boolean,
    counters: { [k: string]: number | boolean | CourierPortalMode },
  ): Promise<void> {
    const mode = shadow ? CourierPortalMode.SHADOW : CourierPortalMode.LIVE;
    const escalation = await this.prisma.client.courierEscalation.findUnique({
      where: { id: item.escalationId },
      select: { externalTicketId: true, awbNumber: true },
    });

    const page = await this.session.page();

    if (item.kind === CourierOutboxKind.COMMENT) {
      const ticketId = escalation?.externalTicketId ?? '';
      if (ticketId === '') {
        // Nothing to comment on. Not a failure of the portal — the
        // escalation has no courier ticket yet, so this item is a
        // RAISE_TICKET that was mis-queued, or it is waiting on one.
        await this.record(item.id, mode, 'NOT_ELIGIBLE', 'No external ticket id on the escalation');
        counters['notEligible'] = (counters['notEligible'] as number) + 1;
        return;
      }
      const detail = new TicketDetailPage(page);
      await detail.open(ticketId);
      const outcome = await detail.postComment(item.body, shadow);

      switch (outcome.kind) {
        case 'ALREADY_PRESENT':
          // The message is in the thread. If we were the ones who put it
          // there on a previous attempt, this is the read-back that
          // confirms it.
          counters['alreadyPresent'] = (counters['alreadyPresent'] as number) + 1;
          await this.record(item.id, mode, 'ALREADY_PRESENT', null);
          if (!shadow) {
            await this.outbox.confirmFromReadBack({
              itemId: item.id,
              externalRef: ticketId,
              actorType: ActorType.SYSTEM,
            });
          }
          return;
        case 'SHADOW':
          counters['shadowed'] = (counters['shadowed'] as number) + 1;
          await this.record(item.id, mode, 'SHADOW', `would comment on ${ticketId}`);
          return;
        case 'CONFIRMED':
          counters['confirmed'] = (counters['confirmed'] as number) + 1;
          await this.record(item.id, mode, 'OK', `commented on ${ticketId}`);
          await this.outbox.confirmFromReadBack({
            itemId: item.id,
            externalRef: ticketId,
            actorType: ActorType.SYSTEM,
          });
          return;
        case 'SENT_UNVERIFIED':
          counters['unverified'] = (counters['unverified'] as number) + 1;
          await this.record(item.id, mode, 'SENT_UNVERIFIED', outcome.reason);
          // Dispatched, outcome unknown. The reconciler owns it now.
          await this.outbox.markSentUnconfirmed({
            itemId: item.id,
            actorType: ActorType.SYSTEM,
            externalRef: ticketId,
          });
          return;
      }
    }

    // RAISE_TICKET
    const awb = escalation?.awbNumber ?? '';
    if (awb === '' || item.categoryId === null) {
      await this.record(item.id, mode, 'NOT_ELIGIBLE', 'Missing AWB or category id');
      counters['notEligible'] = (counters['notEligible'] as number) + 1;
      return;
    }

    const modal = new RaiseTicketModal(page);
    await modal.open(awb);
    const res = await modal.raise(
      { awbNumber: awb, categoryId: item.categoryId, body: item.body },
      shadow,
    );

    switch (res.kind) {
      case 'SHADOW':
        counters['shadowed'] = (counters['shadowed'] as number) + 1;
        await this.record(item.id, mode, 'SHADOW', `would raise ${item.categoryId} on ${awb}`);
        return;
      case 'CREATED':
      case 'ALREADY_EXISTS': {
        // ALREADY_EXISTS is a SUCCESS: their dedup is roughly per
        // (awb, category), so a second attempt legitimately finds one.
        counters['confirmed'] = (counters['confirmed'] as number) + 1;
        await this.record(item.id, mode, res.kind, res.externalTicketId);
        await this.outbox.confirmFromReadBack({
          itemId: item.id,
          externalRef: res.externalTicketId,
          actorType: ActorType.SYSTEM,
        });
        if (res.externalTicketId !== null) {
          await this.prisma.client.courierEscalation.updateMany({
            where: { id: item.escalationId, externalTicketId: null },
            data: { externalTicketId: res.externalTicketId },
          });
        }
        return;
      }
      case 'NOT_ELIGIBLE':
        counters['notEligible'] = (counters['notEligible'] as number) + 1;
        await this.record(item.id, mode, 'NOT_ELIGIBLE', res.reason);
        await this.outbox.fail({
          itemId: item.id,
          error: res.reason,
          errorClass: 'REJECTED',
          actorType: ActorType.SYSTEM,
        });
        return;
      case 'TASK_PENDING':
        // Creation is async on their side. Dispatched, outcome unknown —
        // which is exactly SENT_UNCONFIRMED, and the reconciler polls.
        counters['taskPending'] = (counters['taskPending'] as number) + 1;
        await this.record(item.id, mode, 'TASK_PENDING', res.taskRef);
        await this.outbox.markSentUnconfirmed({
          itemId: item.id,
          actorType: ActorType.SYSTEM,
          externalRef: res.taskRef,
        });
        return;
    }
  }

  private async record(
    outboxItemId: string,
    mode: CourierPortalMode,
    outcome: string,
    detail: string | null,
  ): Promise<void> {
    await this.prisma.client.courierPortalRun.create({
      data: { outboxItemId, kind: 'dispatch', mode, outcome, detail },
    });
  }
}
