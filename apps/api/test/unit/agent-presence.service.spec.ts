import { CallQueueStatus } from '@skydrop/db';
import { AgentPresenceService } from '../../src/modules/call-center/services/agent-presence.service';

/**
 * Availability has to expire.
 *
 * `isAvailable` on its own is a boolean nobody comes back to change. An
 * agent who marked themselves available and then left kept claiming
 * orders: the station's auto-advance re-pulls every fifteen seconds
 * while the tab is open, so CC-7's 30-minute assignment expiry handed
 * the order back and the abandoned tab took it straight again. The
 * customer's order sat held by an empty chair.
 *
 * These pin the three properties that break that loop: presence must be
 * RENEWED to persist, a stand-down returns the held call, and renewing
 * presence never by itself puts someone back on the roster.
 */
describe('AgentPresenceService', () => {
  function make(stale: Array<{ agentId: string; lastSeenAt: Date | null }>, timeoutMin = 10) {
    const settingsUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const queueUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const log = jest.fn().mockResolvedValue('audit-1');
    const prisma = {
      client: {
        systemSetting: {
          findUnique: jest.fn().mockResolvedValue({ valueType: 'INT', valueInt: timeoutMin }),
        },
        agentCallSettings: {
          findMany: jest.fn().mockResolvedValue(stale),
          updateMany: settingsUpdateMany,
        },
        callQueueEntry: { updateMany: queueUpdateMany },
      },
    } as never;
    return {
      svc: new AgentPresenceService(
        prisma,
        { log } as never,
        {
          close: jest.fn(),
          closeAllForAgent: jest.fn().mockResolvedValue(0),
        } as never,
      ),
      settingsUpdateMany,
      queueUpdateMany,
      log,
      prisma,
    };
  }

  it('stands down an absent agent AND returns what they were holding', async () => {
    const { svc, settingsUpdateMany, queueUpdateMany } = make([
      { agentId: 'a1', lastSeenAt: new Date(Date.now() - 60 * 60_000) },
    ]);
    const out = await svc.sweep();

    expect(out).toEqual({ stoodDown: 1, released: 1 });
    expect(settingsUpdateMany).toHaveBeenCalledWith({
      // Guarded on still-available: a sweep must never fight an agent
      // who became available a moment ago.
      where: { agentId: 'a1', isAvailable: true },
      data: { isAvailable: false },
    });
    // FIFO position preserved exactly as the CC-7 expiry does —
    // availableAt is deliberately NOT touched.
    const queueArgs = queueUpdateMany.mock.calls[0]?.[0];
    expect(queueArgs.where).toEqual({ assignedAgentId: 'a1', status: CallQueueStatus.ASSIGNED });
    expect(queueArgs.data.status).toBe(CallQueueStatus.PENDING);
    expect(queueArgs.data.assignedAgentId).toBeNull();
    expect(queueArgs.data.assignedAt).toBeNull();
    expect(queueArgs.data).not.toHaveProperty('availableAt');
  });

  it('stands the agent down BEFORE freeing the call', async () => {
    // Visible-vs-silent: a crash between leaves an agent taking no new
    // work and a call still assigned — recoverable. The inverse frees
    // the call while leaving them on the roster to reclaim it, which is
    // the loop this service exists to break.
    const order: string[] = [];
    const { svc, settingsUpdateMany, queueUpdateMany } = make([
      { agentId: 'a1', lastSeenAt: null },
    ]);
    settingsUpdateMany.mockImplementation(async () => {
      order.push('stand-down');
      return { count: 1 };
    });
    queueUpdateMany.mockImplementation(async () => {
      order.push('release');
      return { count: 1 };
    });
    await svc.sweep();
    expect(order).toEqual(['stand-down', 'release']);
  });

  it('leaves an agent seen inside the window alone', async () => {
    const { svc, settingsUpdateMany } = make([]);
    expect(await svc.sweep()).toEqual({ stoodDown: 0, released: 0 });
    expect(settingsUpdateMany).not.toHaveBeenCalled();
  });

  it('never touches isAvailable when renewing presence', async () => {
    // A background tab must not put someone back on a roster they had
    // stood themselves down from.
    const { svc, settingsUpdateMany } = make([]);
    await svc.touch('a1');
    const args = settingsUpdateMany.mock.calls[0]?.[0];
    expect(args.data).not.toHaveProperty('isAvailable');
    expect(args.data.lastSeenAt).toBeInstanceOf(Date);
  });

  it('an available agent never seen at all is treated as absent', async () => {
    const { svc, prisma } = make([{ agentId: 'a1', lastSeenAt: null }]);
    await svc.sweep();
    const where = (prisma as never as { client: { agentCallSettings: { findMany: jest.Mock } } })
      .client.agentCallSettings.findMany.mock.calls[0][0].where;
    expect(where.isAvailable).toBe(true);
    expect(where.OR).toEqual([{ lastSeenAt: null }, { lastSeenAt: { lt: expect.any(Date) } }]);
  });
});
