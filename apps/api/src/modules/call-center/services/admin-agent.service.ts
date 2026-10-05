import { Injectable, NotFoundException } from '@nestjs/common';
import { CallHoldOutcome, CallQueueStatus } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AgentSettingsService, type AgentSettingsView } from './agent-settings.service';

export interface AgentListRow {
  agentId: string;
  email: string;
  settings: AgentSettingsView;
  activeAssigned: number;
}

export interface AgentMetrics {
  agentId: string;
  totalAttempts: number;
  byOutcome: Record<string, number>;
  confirmedCount: number;
  currentAssigned: number;
  /**
   * How this agent USES the time they hold a customer's order.
   *
   * `totalAttempts` says how much work they did; these say what happened
   * to the work they took and did not do. A high `holdsDropped` is an
   * agent claiming orders and letting them rot — invisible in an attempt
   * count, because the whole point is that no attempt was ever logged.
   */
  holds: {
    /** Closed holds that produced a logged call. */
    holdsCompleted: number;
    /** Closed holds that produced NOTHING — released, expired, or the
     *  agent turned out not to be at the desk. */
    holdsDropped: number;
    dropsByReason: Record<string, number>;
    /** Mean seconds from claiming a call to logging its outcome. Over
     *  completed holds only: averaging in a 15-minute expiry would make
     *  an agent who abandons calls look merely slow. */
    avgSecondsToOutcome: number | null;
    /** The longest single hold that ended in nothing. */
    longestDroppedSeconds: number | null;
  };
}

export interface AgentDetail {
  agentId: string;
  email: string;
  settings: AgentSettingsView;
  metrics: AgentMetrics;
}

/**
 * Module 7 — admin views over CALL_AGENT staff (decision 11). SUMMARY
 * metrics only (decision 12 — per-seller breakdown / time-series are
 * Module 13). Internal to call-center; settings WRITES route through
 * AgentSettingsService.updateAsAdmin (single source for the 10c split).
 */
@Injectable()
export class AdminAgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AgentSettingsService,
  ) {}

  /**
   * All call agents with their effective settings + live ASSIGNED count.
   * Phase-1A agent population is small; per-agent settings resolution
   * reuses the single default-synthesis path.
   *
   * ── WHO IS A CALL AGENT ──────────────────────────────────────────
   * Whoever may WORK THE QUEUE — `callcenter.work`, asked of every role
   * they hold. This read was `where: { role: StaffRole.CALL_AGENT }`,
   * which is the failure NOTIF-10 already argued against on the
   * notification side: a role name cannot see a role somebody invented,
   * so a custom "Night shift lead" holding `callcenter.work` was absent
   * from the supervisor's agent list while taking calls all evening.
   *
   * Multi-role turned that from stale into actively wrong:
   * `staff_users.role` is NULLABLE now and the access tiers have no enum
   * spelling at all, so an enum predicate matches fewer and fewer of the
   * people it is about — silently, because an empty list reads exactly
   * like a quiet night.
   *
   * A super-admin is included for the same reason the audience
   * selectors include them: they hold every permission implicitly and
   * therefore carry no permission ROWS, so matching on rows alone leaves
   * out the people who hold the most.
   */
  async listAgents(): Promise<AgentListRow[]> {
    const agents = await this.prisma.client.staffUser.findMany({
      where: {
        deletedAt: null,
        roles: {
          some: {
            role: {
              deletedAt: null,
              OR: [
                { isSuperAdmin: true },
                { permissions: { some: { permission: 'callcenter.work' } } },
              ],
            },
          },
        },
      },
      orderBy: { email: 'asc' },
      select: { id: true, email: true },
    });
    if (agents.length === 0) return [];

    const assigned = await this.prisma.client.callQueueEntry.groupBy({
      by: ['assignedAgentId'],
      where: {
        status: CallQueueStatus.ASSIGNED,
        assignedAgentId: { in: agents.map((a) => a.id) },
      },
      _count: { _all: true },
    });
    const activeByAgent = new Map<string, number>();
    for (const row of assigned) {
      if (row.assignedAgentId) {
        activeByAgent.set(row.assignedAgentId, row._count._all);
      }
    }

    const out: AgentListRow[] = [];
    for (const a of agents) {
      out.push({
        agentId: a.id,
        email: a.email,
        settings: await this.settings.get(a.id),
        activeAssigned: activeByAgent.get(a.id) ?? 0,
      });
    }
    return out;
  }

  async getDetail(staffUserId: string): Promise<AgentDetail> {
    const staff = await this.requireAgent(staffUserId);
    const [settings, metrics] = await Promise.all([
      this.settings.get(staffUserId),
      this.getMetrics(staffUserId),
    ]);
    return { agentId: staff.id, email: staff.email, settings, metrics };
  }

  async getMetrics(staffUserId: string): Promise<AgentMetrics> {
    await this.requireAgent(staffUserId);
    const [byOutcomeRows, currentAssigned] = await Promise.all([
      this.prisma.client.callAttempt.groupBy({
        by: ['outcome'],
        where: { agentId: staffUserId },
        _count: { _all: true },
      }),
      this.prisma.client.callQueueEntry.count({
        where: {
          assignedAgentId: staffUserId,
          status: CallQueueStatus.ASSIGNED,
        },
      }),
    ]);
    const byOutcome: Record<string, number> = {};
    let totalAttempts = 0;
    for (const row of byOutcomeRows) {
      byOutcome[row.outcome] = row._count._all;
      totalAttempts += row._count._all;
    }
    return {
      agentId: staffUserId,
      totalAttempts,
      byOutcome,
      confirmedCount: byOutcome['CONFIRMED'] ?? 0,
      currentAssigned,
      holds: await this.holdMetrics(staffUserId),
    };
  }

  /**
   * Read over `call_assignment_holds` — what became of the time this
   * agent spent holding other people's orders.
   */
  private async holdMetrics(agentId: string): Promise<AgentMetrics['holds']> {
    const closed = await this.prisma.client.callAssignmentHold.findMany({
      where: { agentId, endedAt: { not: null } },
      select: { outcome: true, heldSeconds: true },
    });

    const dropsByReason: Record<string, number> = {};
    let completed = 0;
    let completedSeconds = 0;
    let dropped = 0;
    let longestDropped: number | null = null;

    for (const h of closed) {
      if (h.outcome === CallHoldOutcome.COMPLETED) {
        completed += 1;
        completedSeconds += h.heldSeconds ?? 0;
        continue;
      }
      dropped += 1;
      const reason = h.outcome ?? 'UNKNOWN';
      dropsByReason[reason] = (dropsByReason[reason] ?? 0) + 1;
      const secs = h.heldSeconds ?? 0;
      if (longestDropped === null || secs > longestDropped) longestDropped = secs;
    }

    return {
      holdsCompleted: completed,
      holdsDropped: dropped,
      dropsByReason,
      avgSecondsToOutcome: completed === 0 ? null : Math.round(completedSeconds / completed),
      longestDroppedSeconds: longestDropped,
    };
  }

  // ── internal ──────────────────────────────────────────────────────

  private async requireAgent(staffUserId: string): Promise<{ id: string; email: string }> {
    const staff = await this.prisma.client.staffUser.findFirst({
      where: { id: staffUserId, deletedAt: null },
      select: { id: true, email: true },
    });
    if (!staff) {
      throw new NotFoundException(`Agent ${staffUserId} not found`);
    }
    return staff;
  }
}
