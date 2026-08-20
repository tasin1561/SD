import { Injectable, Logger } from '@nestjs/common';
import { CallHoldOutcome, Prisma } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

/**
 * Closes the record of an agent's hold on a queue entry.
 *
 * The hold is OPENED in the same transaction as the pull (see
 * `CallAssignmentService.pullNext`) so a hold can never exist for a claim
 * that did not happen. Closing is separate because the four ways a hold
 * ends live in four services, and only the caller knows which one
 * happened.
 *
 * `call_assignment_holds` is APPEND-ONLY in the sense that matters: a
 * row is written once and closed once, never rewritten. The close is
 * guarded on the hold still being open, so a retry, a duplicate BullMQ
 * delivery, or two paths racing to close the same hold cannot overwrite
 * an outcome that was already recorded — first close wins, which is the
 * one that actually happened.
 *
 * Best-effort by design: a failure to record evaluation data must never
 * roll back the call outcome, the release, or the expiry it describes.
 */
@Injectable()
export class CallHoldService {
  private readonly logger = new Logger(CallHoldService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Close the open hold on this entry.
   *
   * @param tx pass the caller's transaction when the close belongs with
   *           it (the attempt write); omit for post-commit closes.
   */
  async close(
    queueEntryId: string,
    outcome: CallHoldOutcome,
    opts: { attemptId?: string; tx?: Prisma.TransactionClient; endedAt?: Date } = {},
  ): Promise<void> {
    const client = opts.tx ?? this.prisma.client;
    const endedAt = opts.endedAt ?? new Date();
    try {
      const open = await client.callAssignmentHold.findFirst({
        where: { queueEntryId, endedAt: null },
        orderBy: { startedAt: 'desc' },
        select: { id: true, startedAt: true },
      });
      if (!open) return;

      await client.callAssignmentHold.updateMany({
        // Guarded on still-open: first close wins.
        where: { id: open.id, endedAt: null },
        data: {
          endedAt,
          outcome,
          heldSeconds: Math.max(
            0,
            Math.round((endedAt.getTime() - open.startedAt.getTime()) / 1000),
          ),
          attemptId: opts.attemptId ?? null,
        },
      });
    } catch (e) {
      // Evaluation data is worth having, never worth failing a call for.
      this.logger.error(
        { queueEntryId, outcome, err: (e as Error).message },
        'Failed to close call assignment hold',
      );
    }
  }

  /** Close every open hold this agent has — the presence sweep's form,
   *  where the trigger is the PERSON rather than one entry. */
  async closeAllForAgent(agentId: string, outcome: CallHoldOutcome): Promise<number> {
    try {
      const open = await this.prisma.client.callAssignmentHold.findMany({
        where: { agentId, endedAt: null },
        select: { queueEntryId: true },
      });
      for (const h of open) await this.close(h.queueEntryId, outcome);
      return open.length;
    } catch (e) {
      this.logger.error(
        { agentId, err: (e as Error).message },
        'Failed to close open holds for agent',
      );
      return 0;
    }
  }
}
