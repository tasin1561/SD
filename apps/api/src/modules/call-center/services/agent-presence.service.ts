import { Injectable, Logger } from '@nestjs/common';
import { CallQueueStatus, SettingValueType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';

/** Effective window when ops.agent_presence_timeout_minutes is unset. */
const DEFAULT_TIMEOUT_MINUTES = 10;
const TIMEOUT_SETTING_KEY = 'ops.agent_presence_timeout_minutes';

/**
 * Makes "available" mean PRESENT.
 *
 * `isAvailable` on its own is a boolean nobody ever comes back to
 * change. An agent who marked themselves available and then went to
 * lunch kept claiming orders: the station's auto-advance re-pulls every
 * fifteen seconds for as long as the tab is open, so CC-7's 30-minute
 * assignment expiry handed the order back and the abandoned tab took it
 * again immediately. The order stayed held by an empty chair, and the
 * only visible trace was a rising pull count.
 *
 * So presence has to be RENEWED to persist. `touch` is called by the
 * station while a human is actually looking at it; `sweep` stands down
 * anyone whose last sighting is older than the window and hands back
 * whatever they were holding.
 *
 * The sweep is deliberately its own thing rather than an extension of
 * CC-7: that one asks "has this CALL been sitting untouched", which a
 * re-pull legitimately resets. This asks "is this PERSON here", which a
 * re-pull says nothing about. Conflating them is what let the loop run.
 */
@Injectable()
export class AgentPresenceService {
  private readonly logger = new Logger(AgentPresenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** Effective window (minutes): the ops setting, else the default. */
  async timeoutMinutes(): Promise<number> {
    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: TIMEOUT_SETTING_KEY },
      select: { valueInt: true, valueType: true },
    });
    if (row?.valueType === SettingValueType.INT && row.valueInt !== null && row.valueInt > 0) {
      return row.valueInt;
    }
    return DEFAULT_TIMEOUT_MINUTES;
  }

  /**
   * "I am still here." Cheap and idempotent — called on a timer by a
   * FOREGROUND station tab and after every action an agent takes.
   *
   * Deliberately does NOT make an agent available. Presence renews a
   * claim; it never makes one, or a background tab left open would put
   * someone back on the roster they had stood themselves down from.
   */
  async touch(agentId: string): Promise<void> {
    await this.prisma.client.agentCallSettings.updateMany({
      where: { agentId },
      data: { lastSeenAt: new Date() },
    });
  }

  /**
   * Stand down every available agent not seen inside the window, and
   * return what they were holding to the queue.
   *
   * Ordering is visible-vs-silent: the agent is marked unavailable
   * FIRST, so a crash between the two steps leaves an agent who takes no
   * new work and a call still assigned to them — recoverable by CC-7,
   * and by the next sweep. The inverse would free the call while leaving
   * them on the roster to claim it straight back, which is the loop this
   * service exists to break.
   */
  async sweep(): Promise<{ stoodDown: number; released: number }> {
    const cutoff = new Date(Date.now() - (await this.timeoutMinutes()) * 60_000);

    // A never-seen agent (lastSeenAt null) who is somehow available has
    // never demonstrated presence at all, so they go too.
    const stale = await this.prisma.client.agentCallSettings.findMany({
      where: { isAvailable: true, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }] },
      select: { agentId: true, lastSeenAt: true },
    });
    if (stale.length === 0) return { stoodDown: 0, released: 0 };

    let released = 0;
    for (const agent of stale) {
      // Guarded on still-available so a sweep can never fight an agent
      // who marked themselves available a moment ago.
      const down = await this.prisma.client.agentCallSettings.updateMany({
        where: { agentId: agent.agentId, isAvailable: true },
        data: { isAvailable: false },
      });
      if (down.count === 0) continue;

      // Hand back whatever they held, keeping its FIFO position exactly
      // as the CC-7 expiry does (availableAt untouched).
      const back = await this.prisma.client.callQueueEntry.updateMany({
        where: { assignedAgentId: agent.agentId, status: CallQueueStatus.ASSIGNED },
        data: {
          status: CallQueueStatus.PENDING,
          assignedAgentId: null,
          assignedAt: null,
        },
      });
      released += back.count;

      await this.audit.log({
        actorType: 'SYSTEM',
        actorId: null,
        action: 'call_center.agent_stood_down_absent',
        entityType: 'agent_call_settings',
        entityId: agent.agentId,
        severity: back.count > 0 ? 'MEDIUM' : 'LOW',
        metadata: {
          lastSeenAt: agent.lastSeenAt?.toISOString() ?? null,
          cutoff: cutoff.toISOString(),
          callsReturnedToQueue: back.count,
        },
      });
    }

    this.logger.log(
      { stoodDown: stale.length, released },
      'Presence sweep stood down absent agents',
    );
    return { stoodDown: stale.length, released };
  }
}
