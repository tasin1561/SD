import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActorType } from '@skydrop/db';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuditLogService } from '../../auth-common/services/audit-log.service';
import type { ClientContext } from '../../seller-auth/seller-auth.service';
import type { UpdateAgentSettingsDto } from '../dto/update-agent-settings.dto';

export interface AgentSettingsView {
  agentId: string;
  maxActiveCalls: number;
  isAvailable: boolean;
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: number[];
  timezone: string;
  languages: string[];
  canHandleHighRisk: boolean;
  canHandleHighValue: boolean;
}

/** Schema @default mirror — the effective settings for an agent with no
 *  row yet (maxActiveCalls=1 matches CallAssignmentService's cap default). */
const DEFAULTS: Omit<AgentSettingsView, 'agentId'> = {
  maxActiveCalls: 1,
  isAvailable: true,
  workingHoursStart: '09:00',
  workingHoursEnd: '18:00',
  workingDays: [1, 2, 3, 4, 5, 6],
  timezone: 'Asia/Kolkata',
  languages: ['en', 'hi'],
  canHandleHighRisk: false,
  canHandleHighValue: false,
};

/** Fields a non-admin agent may NEVER set on their own settings (locked
 *  decision 10c). The capacity cap (10a) + high-risk/value capabilities
 *  are operational levers owned by admin. */
const ADMIN_ONLY_FIELDS = [
  'maxActiveCalls',
  'canHandleHighRisk',
  'canHandleHighValue',
] as const;

const SELECT = {
  agentId: true,
  maxActiveCalls: true,
  isAvailable: true,
  workingHoursStart: true,
  workingHoursEnd: true,
  workingDays: true,
  timezone: true,
  languages: true,
  canHandleHighRisk: true,
  canHandleHighValue: true,
} as const;

/**
 * Module 7 — agent_call_settings read + the 10c permission split.
 *
 * `updateSelf` (the agent editing their own row) is restricted to the
 * advisory fields; `updateAsAdmin` may set any field including the
 * concurrent-assignment cap. The split is enforced HERE (single source)
 * — controllers only decide which entry point to call. Internal to
 * call-center (NOT exported); the admin path is wired by the
 * admin-agent controller in a later commit.
 */
@Injectable()
export class AgentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  /** Effective settings for an agent. Synthesizes schema defaults when
   *  the agent has no row yet (no write — a GET never creates state). */
  async get(agentId: string): Promise<AgentSettingsView> {
    const row = await this.prisma.client.agentCallSettings.findUnique({
      where: { agentId },
      select: SELECT,
    });
    return row ?? { agentId, ...DEFAULTS };
  }

  /** Agent edits their OWN settings — advisory fields only. */
  async updateSelf(
    agentId: string,
    dto: UpdateAgentSettingsDto,
    ctx?: ClientContext,
  ): Promise<AgentSettingsView> {
    const offending = ADMIN_ONLY_FIELDS.filter(
      (f) => dto[f] !== undefined,
    );
    if (offending.length > 0) {
      throw new ForbiddenException({
        code: 'FIELD_ADMIN_ONLY',
        message: `Only an admin may set: ${offending.join(', ')}`,
      });
    }
    return this.apply(agentId, dto, {
      asAdmin: false,
      actorId: agentId,
      ...(ctx ? { ctx } : {}),
    });
  }

  /** Admin edits ANY agent's settings — every field permitted (11). */
  async updateAsAdmin(
    agentId: string,
    dto: UpdateAgentSettingsDto,
    adminStaffId: string,
    ctx?: ClientContext,
  ): Promise<AgentSettingsView> {
    const target = await this.prisma.client.staffUser.findFirst({
      where: { id: agentId, deletedAt: null },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }
    return this.apply(agentId, dto, {
      asAdmin: true,
      actorId: adminStaffId,
      ...(ctx ? { ctx } : {}),
    });
  }

  // ── internal ──────────────────────────────────────────────────────

  private async apply(
    agentId: string,
    dto: UpdateAgentSettingsDto,
    opts: { asAdmin: boolean; actorId: string; ctx?: ClientContext },
  ): Promise<AgentSettingsView> {
    // PATCH: only the keys actually present mutate (omitted = untouched).
    const data: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined) data[k] = v;
    }

    const row = await this.prisma.client.agentCallSettings.upsert({
      where: { agentId },
      create: { agentId, ...data },
      update: data,
      select: SELECT,
    });

    await this.audit.log({
      actorType: ActorType.STAFF,
      actorId: opts.actorId,
      action: opts.asAdmin
        ? 'agent_call_settings.admin_override'
        : 'agent_call_settings.updated',
      entityType: 'agent_call_settings',
      entityId: agentId,
      severity: opts.asAdmin ? 'MEDIUM' : 'LOW',
      metadata: {
        agentId,
        changedFields: Object.keys(data),
        ipAddress: opts.ctx?.ipAddress ?? null,
        userAgent: opts.ctx?.userAgent ?? null,
        requestId: opts.ctx?.requestId ?? null,
      },
    });

    return row;
  }
}
