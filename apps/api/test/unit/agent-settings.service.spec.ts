import { AgentSettingsService } from '../../src/modules/call-center/services/agent-settings.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { UpdateAgentSettingsDto } from '../../src/modules/call-center/dto/update-agent-settings.dto';

type AnyArgs = Record<string, unknown>;

function makeService(opts: { row?: AnyArgs | null; target?: AnyArgs | null } = {}) {
  const findUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.row === undefined ? null : opts.row,
  );
  const upsert = jest.fn<Promise<AnyArgs>, [AnyArgs]>(async (a) => ({
    agentId: 'agent-1',
    maxActiveCalls: 1,
    isAvailable: true,
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    workingDays: [1, 2, 3, 4, 5, 6],
    timezone: 'Asia/Kolkata',
    languages: ['en', 'hi'],
    canHandleHighRisk: false,
    canHandleHighValue: false,
    ...(a.update as AnyArgs),
  }));
  const staffFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.target === undefined ? { id: 'agent-1' } : opts.target,
  );
  const client = {
    agentCallSettings: { findUnique, upsert },
    staffUser: { findFirst: staffFindFirst },
  };
  const auditLog = jest.fn<Promise<string | null>, [AnyArgs]>(async () => 'a1');
  const audit = { log: auditLog };
  const svc = new AgentSettingsService(
    { client } as unknown as PrismaService,
    audit as unknown as AuditLogService,
  );
  return { svc, findUnique, upsert, staffFindFirst, auditLog };
}

describe('AgentSettingsService.get', () => {
  it('returns the persisted row when present', async () => {
    const { svc } = makeService({ row: { agentId: 'agent-1', maxActiveCalls: 3 } });
    const v = await svc.get('agent-1');
    expect(v).toMatchObject({ agentId: 'agent-1', maxActiveCalls: 3 });
  });

  it('synthesizes schema defaults (no write) when no row exists', async () => {
    const { svc, upsert } = makeService({ row: null });
    const v = await svc.get('agent-9');
    expect(v).toMatchObject({
      agentId: 'agent-9',
      maxActiveCalls: 1,
      isAvailable: true,
      languages: ['en', 'hi'],
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('AgentSettingsService.updateSelf — 10c permission split', () => {
  it('rejects an admin-only field (maxActiveCalls) with 403 FIELD_ADMIN_ONLY', async () => {
    const { svc, upsert } = makeService();
    await expect(
      svc.updateSelf('agent-1', { maxActiveCalls: 5 } as UpdateAgentSettingsDto),
    ).rejects.toMatchObject({ response: { code: 'FIELD_ADMIN_ONLY' } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects canHandleHighRisk / canHandleHighValue for self-edit', async () => {
    const { svc } = makeService();
    await expect(
      svc.updateSelf('agent-1', {
        canHandleHighValue: true,
      } as UpdateAgentSettingsDto),
    ).rejects.toMatchObject({ response: { code: 'FIELD_ADMIN_ONLY' } });
  });

  it('applies advisory fields via upsert (PATCH: only provided keys) + LOW audit', async () => {
    const { svc, upsert, auditLog } = makeService();
    await svc.updateSelf('agent-1', {
      isAvailable: false,
      timezone: 'Asia/Dhaka',
    } as UpdateAgentSettingsDto);

    const call = upsert.mock.calls[0]![0];
    expect(call.where).toEqual({ agentId: 'agent-1' });
    expect(call.update).toEqual({ isAvailable: false, timezone: 'Asia/Dhaka' });
    expect(call.create).toEqual({
      agentId: 'agent-1',
      isAvailable: false,
      timezone: 'Asia/Dhaka',
    });
    const audited = auditLog.mock.calls[0]![0];
    expect(audited).toMatchObject({
      action: 'agent_call_settings.updated',
      severity: 'LOW',
    });
  });
});

describe('AgentSettingsService.updateAsAdmin', () => {
  it('404 when the target agent does not exist', async () => {
    const { svc } = makeService({ target: null });
    await expect(
      svc.updateAsAdmin('ghost', { isAvailable: true }, 'admin-1'),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('admin may set any field incl. maxActiveCalls, MEDIUM audit', async () => {
    const { svc, upsert, auditLog } = makeService();
    await svc.updateAsAdmin(
      'agent-1',
      { maxActiveCalls: 5, canHandleHighRisk: true },
      'admin-1',
    );
    expect(upsert.mock.calls[0]![0].update).toEqual({
      maxActiveCalls: 5,
      canHandleHighRisk: true,
    });
    expect(auditLog.mock.calls[0]![0]).toMatchObject({
      action: 'agent_call_settings.admin_override',
      severity: 'MEDIUM',
      actorId: 'admin-1',
    });
  });
});
