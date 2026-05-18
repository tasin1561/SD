import { CallOutcome } from '@skydrop/db';
import { AdminAgentService } from '../../src/modules/call-center/services/admin-agent.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type {
  AgentSettingsService,
  AgentSettingsView,
} from '../../src/modules/call-center/services/agent-settings.service';

type AnyArgs = Record<string, unknown>;

const SETTINGS: AgentSettingsView = {
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
};

function makeService(
  opts: {
    agents?: AnyArgs[];
    staff?: AnyArgs | null;
    assignedGroup?: AnyArgs[];
    outcomeGroup?: AnyArgs[];
    currentAssigned?: number;
  } = {},
) {
  const staffFindMany = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.agents ?? [],
  );
  const staffFindFirst = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.staff === undefined ? { id: 'agent-1', email: 'a@x.io' } : opts.staff,
  );
  const queueGroupBy = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.assignedGroup ?? [],
  );
  const queueCount = jest.fn<Promise<number>, [AnyArgs]>(
    async () => opts.currentAssigned ?? 0,
  );
  const attemptGroupBy = jest.fn<Promise<AnyArgs[]>, [AnyArgs]>(
    async () => opts.outcomeGroup ?? [],
  );
  const client = {
    staffUser: { findMany: staffFindMany, findFirst: staffFindFirst },
    callQueueEntry: { groupBy: queueGroupBy, count: queueCount },
    callAttempt: { groupBy: attemptGroupBy },
  };
  const get = jest.fn<Promise<AgentSettingsView>, [string]>(async () => SETTINGS);
  const settings = { get };
  const svc = new AdminAgentService(
    { client } as unknown as PrismaService,
    settings as unknown as AgentSettingsService,
  );
  return { svc, staffFindMany, staffFindFirst, queueGroupBy, queueCount, attemptGroupBy, get };
}

describe('AdminAgentService.listAgents', () => {
  it('returns [] when there are no call agents', async () => {
    const { svc, queueGroupBy } = makeService({ agents: [] });
    expect(await svc.listAgents()).toEqual([]);
    expect(queueGroupBy).not.toHaveBeenCalled();
  });

  it('maps agents + effective settings + live ASSIGNED count', async () => {
    const { svc } = makeService({
      agents: [
        { id: 'agent-1', email: 'a1@x.io' },
        { id: 'agent-2', email: 'a2@x.io' },
      ],
      assignedGroup: [{ assignedAgentId: 'agent-1', _count: { _all: 1 } }],
    });
    const r = await svc.listAgents();
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ agentId: 'agent-1', activeAssigned: 1 });
    expect(r[1]).toMatchObject({ agentId: 'agent-2', activeAssigned: 0 });
    expect(r[0]!.settings).toMatchObject({ maxActiveCalls: 1 });
  });
});

describe('AdminAgentService.getMetrics', () => {
  it('404 when the agent does not exist', async () => {
    const { svc } = makeService({ staff: null });
    await expect(svc.getMetrics('ghost')).rejects.toMatchObject({ status: 404 });
  });

  it('aggregates byOutcome + totalAttempts + confirmedCount + currentAssigned', async () => {
    const { svc } = makeService({
      outcomeGroup: [
        { outcome: CallOutcome.CONFIRMED, _count: { _all: 4 } },
        { outcome: CallOutcome.NO_ANSWER, _count: { _all: 6 } },
      ],
      currentAssigned: 1,
    });
    const m = await svc.getMetrics('agent-1');
    expect(m).toMatchObject({
      agentId: 'agent-1',
      totalAttempts: 10,
      confirmedCount: 4,
      currentAssigned: 1,
    });
    expect(m.byOutcome).toMatchObject({
      [CallOutcome.CONFIRMED]: 4,
      [CallOutcome.NO_ANSWER]: 6,
    });
  });
});

describe('AdminAgentService.getDetail', () => {
  it('404 when not found', async () => {
    const { svc } = makeService({ staff: null });
    await expect(svc.getDetail('ghost')).rejects.toMatchObject({ status: 404 });
  });

  it('returns identity + settings + metrics', async () => {
    const { svc } = makeService({
      staff: { id: 'agent-1', email: 'a1@x.io' },
      outcomeGroup: [{ outcome: CallOutcome.CONFIRMED, _count: { _all: 2 } }],
      currentAssigned: 0,
    });
    const d = await svc.getDetail('agent-1');
    expect(d).toMatchObject({
      agentId: 'agent-1',
      email: 'a1@x.io',
      settings: { maxActiveCalls: 1 },
      metrics: { totalAttempts: 2, confirmedCount: 2 },
    });
  });
});
