import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CourierOutboxKind, CourierOutboxStatus, SystemIssueKind } from '@skydrop/db';
import { DelhiverySupportAdapterService } from '../../src/modules/courier-delhivery/services/delhivery-support-adapter.service';
import { ShiprocketSupportAdapterService } from '../../src/modules/courier-shiprocket/services/shiprocket-support-adapter.service';
import { CourierSupportRegistryService } from '../../src/modules/courier-escalation/services/courier-support-registry.service';
import { CourierSupportDeskService } from '../../src/modules/courier-escalation/services/courier-support-desk.service';
import { CourierEscalationService } from '../../src/modules/courier-escalation/services/courier-escalation.service';
import { CourierOutboxDispatcherService } from '../../src/modules/courier-escalation/services/courier-outbox-dispatcher.service';
import { CourierOpsQueueService } from '../../src/modules/courier-escalation/services/courier-ops-queue.service';
import {
  CourierEscalationWatchService,
  OUTBOX_STALLED_KEY_PREFIX,
} from '../../src/modules/courier-escalation/services/courier-escalation-watch.service';

/**
 * Shiprocket support tickets are handled MANUALLY, exactly like
 * Delhivery's — the same queue, the same route to a person, the same
 * watchdog — and nothing upstream of the adapter knows which is which.
 */

function registry(): CourierSupportRegistryService {
  const mcp = { availability: () => ({ available: false }) };
  return new CourierSupportRegistryService([
    new DelhiverySupportAdapterService(mcp as never),
    new ShiprocketSupportAdapterService(),
  ]);
}

function desks(emails: Record<string, string> = {}): CourierSupportDeskService {
  const prisma = {
    client: {
      systemSetting: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            Object.entries(emails).map(([key, valueString]) => ({ key, valueString })),
          ),
      },
    },
  };
  return new CourierSupportDeskService(prisma as never, registry());
}

describe('both couriers have a support desk, and neither takes tickets from software', () => {
  const reg = registry();

  it('the registry knows both couriers', () => {
    expect(reg.known()).toEqual(['delhivery', 'shiprocket']);
  });

  it.each(['delhivery', 'shiprocket'])('%s routes every write to a person', (code) => {
    const caps = reg.for(code)?.capabilities();
    expect(caps?.postComment).toBe(false);
    expect(caps?.raiseTicket).toBe(false);
  });

  it('the escalation module registers both adapters', () => {
    const mod = readFileSync(
      join(__dirname, '../../src/modules/courier-escalation/courier-escalation.module.ts'),
      'utf8',
    );
    expect(mod).toMatch(/\[delhivery, shiprocket\]/);
  });
});

describe('CourierSupportDeskService — the right company, never a default', () => {
  it("a Shiprocket item points at Shiprocket's panel, with their email when set", async () => {
    const desk = await desks({ 'courier.shiprocket_support_email': 'help@example.test' }).describe(
      'shiprocket',
      'SR-TKT-9',
    );
    expect(desk.courierName).toBe('Shiprocket');
    expect(desk.panelUrl).toBe('https://app.shiprocket.in');
    // No per-ticket URL on their panel: the panel is the link.
    expect(desk.ticketUrl).toBeNull();
    expect(desk.supportEmail).toBe('help@example.test');
    expect(desk.canSendAutomatically).toBe(false);
  });

  it('a missing email is shown as missing, naming the setting', async () => {
    const desk = await desks().describe('shiprocket');
    expect(desk.supportEmail).toBeNull();
    expect(desk.supportEmailSettingKey).toBe('courier.shiprocket_support_email');
  });

  it("Delhivery's ticket links to their own ticket", async () => {
    const desk = await desks().describe('delhivery', '12345');
    expect(desk.ticketUrl).toBe('https://one.delhivery.com/support/12345');
  });

  it("a courier with no desk gets 'none on file', not Delhivery's", async () => {
    const desk = await desks().describe('manual');
    expect(desk.panelUrl).toBeNull();
    expect(desk.ticketUrl).toBeNull();
  });
});

describe('a Shiprocket escalation is filed under Shiprocket', () => {
  it('resolves the carrying courier from the ticket when the caller does not say', async () => {
    const created: Record<string, unknown>[] = [];
    const prisma = {
      client: {
        ticket: {
          findUnique: jest.fn().mockResolvedValue({
            shipment: { awbNumber: 'SR123', courierAccountId: 'acc-sr', courierCode: 'shiprocket' },
            order: null,
          }),
        },
        courierEscalation: {
          findUnique: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
            created.push(a.data);
            return Promise.resolve({ id: 'esc-sr' });
          }),
        },
      },
    };
    const svc = new CourierEscalationService(
      prisma as never,
      {} as never,
      {} as never,
      { log: jest.fn() } as never,
    );

    // The ticket panel's "Start a courier conversation" sends nothing but
    // the ticket — this is the call that used to file it under Delhivery.
    await expect(svc.openForTicket({ ticketId: 'tkt-sr' })).resolves.toEqual({
      id: 'esc-sr',
      created: true,
    });
    expect(created[0]).toMatchObject({
      courierCode: 'shiprocket',
      awbNumber: 'SR123',
      courierAccountId: 'acc-sr',
    });
  });
});

describe('the dispatcher routes a Shiprocket item to a person', () => {
  it('releases it to the ops queue — never sent, never failed', async () => {
    let claims = 0;
    const outbox = {
      claimForWorker: jest.fn().mockImplementation(() => {
        claims += 1;
        return Promise.resolve(
          claims === 1
            ? {
                id: 'ob-sr',
                escalationId: 'esc-sr',
                kind: CourierOutboxKind.COMMENT,
                body: 'Where is my parcel?',
                categoryId: null,
                courierCode: 'shiprocket',
              }
            : null,
        );
      }),
      release: jest.fn().mockResolvedValue(undefined),
      markSentUnconfirmed: jest.fn(),
      fail: jest.fn(),
    };
    const summary = await new CourierOutboxDispatcherService(
      outbox as never,
      registry(),
    ).runCycle();

    expect(summary).toMatchObject({ claimed: 1, unsupported: 1, sent: 0, failed: 0 });
    expect(outbox.release).toHaveBeenCalledWith('ob-sr', expect.stringContaining('human'));
    expect(outbox.markSentUnconfirmed).not.toHaveBeenCalled();
    expect(outbox.fail).not.toHaveBeenCalled();
  });
});

describe('the ops queue — one queue for both couriers', () => {
  function queue(opts: { rows: unknown[] }) {
    const escUpdate = jest.fn().mockResolvedValue({});
    const prisma = {
      client: {
        courierOutboxItem: {
          findMany: jest.fn().mockResolvedValue(opts.rows),
          findUnique: jest.fn().mockResolvedValue({
            escalationId: 'esc-sr',
            escalation: { externalTicketId: null },
          }),
        },
        courierEscalation: { update: escUpdate },
        systemSetting: { findMany: jest.fn().mockResolvedValue([]) },
      },
    };
    const outbox = { markSentUnconfirmed: jest.fn().mockResolvedValue(undefined) };
    const svc = new CourierOpsQueueService(
      prisma as never,
      outbox as never,
      new CourierSupportDeskService(prisma as never, registry()),
    );
    return { svc, escUpdate, outbox, prisma };
  }

  const row = (courierCode: string, externalTicketId: string | null, orderId: string | null) => ({
    id: `ob-${courierCode}`,
    escalationId: `esc-${courierCode}`,
    kind: CourierOutboxKind.COMMENT,
    status: CourierOutboxStatus.PENDING,
    body: 'hello',
    categoryId: null,
    claimedByStaffId: null,
    claimExpiresAt: null,
    createdAt: new Date('2026-09-12T00:00:00Z'),
    lastError: null,
    externalRef: null,
    escalation: {
      awbNumber: 'AWB1',
      externalTicketId,
      courierCode,
      ticket: { orderId, sellerId: 's1', seller: { companyName: 'Menev Store' } },
    },
  });

  it('lists Delhivery and Shiprocket items side by side, each with its own desk', async () => {
    const { svc } = queue({
      rows: [row('delhivery', '777', 'ord-1'), row('shiprocket', 'SR-9', null)],
    });
    const items = await svc.list({});

    expect(items.map((i) => i.courierCode)).toEqual(['delhivery', 'shiprocket']);
    const sr = items[1];
    expect(sr?.courierName).toBe('Shiprocket');
    // Never Delhivery One for a Shiprocket parcel.
    expect(sr?.deepLink).toBe('https://app.shiprocket.in');
    expect(items[0]?.deepLink).toBe('https://one.delhivery.com/support/777');
  });

  it('marking a Shiprocket message sent binds THEIR ticket number to the conversation', async () => {
    const { svc, escUpdate, outbox } = queue({ rows: [] });
    await svc.markSent({ itemId: 'ob-sr', staffId: 'staff-1', externalTicketId: ' SR-555 ' });

    expect(outbox.markSentUnconfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'ob-sr', externalRef: ' SR-555 ' }),
    );
    expect(escUpdate).toHaveBeenCalledWith({
      where: { id: 'esc-sr' },
      data: { externalTicketId: 'SR-555' },
    });
  });
});

describe('CourierEscalationWatchService — an unsent message is chased, any courier', () => {
  function watch(opts: { waiting: unknown[]; openKeys?: string[] }) {
    const raised: Record<string, unknown>[] = [];
    const resolved: string[] = [];
    const prisma = {
      client: {
        courierOutboxItem: { findMany: jest.fn().mockResolvedValue(opts.waiting) },
        systemSetting: {
          findUnique: jest.fn().mockResolvedValue({ valueInt: 24 }),
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
    };
    const issues = {
      openDedupeKeys: jest.fn().mockResolvedValue(opts.openKeys ?? []),
      resolveByKey: jest.fn().mockImplementation((key: string) => {
        resolved.push(key);
        return Promise.resolve(1);
      }),
      raise: jest.fn().mockImplementation((i: Record<string, unknown>) => {
        raised.push(i);
        return Promise.resolve(null);
      }),
    };
    const svc = new CourierEscalationWatchService(
      prisma as never,
      issues as never,
      new CourierSupportDeskService(prisma as never, registry()),
    );
    return { svc, raised, resolved, prisma };
  }

  const now = new Date('2026-09-12T12:00:00Z');
  const item = (id: string, courierCode: string) => ({
    id,
    body: 'x',
    createdAt: new Date('2026-09-11T00:00:00Z'),
    escalation: {
      id: `esc-${id}`,
      ticketId: `tkt-${id}`,
      awbNumber: `AWB-${id}`,
      courierCode,
      externalTicketId: null,
    },
  });

  it('raises HIGH for a Shiprocket message exactly as for a Delhivery one', async () => {
    const { svc, raised, prisma } = watch({
      waiting: [item('a', 'delhivery'), item('b', 'shiprocket')],
    });
    await expect(svc.checkStalledOutbox(now)).resolves.toEqual({ raised: 2, cleared: 0 });

    // No courier filter in the query.
    const where = (
      prisma.client.courierOutboxItem.findMany.mock.calls[0]?.[0] as {
        where: Record<string, unknown>;
      }
    ).where;
    expect(JSON.stringify(where)).not.toMatch(/courier/i);

    expect(raised.map((r) => r.dedupeKey)).toEqual([
      `${OUTBOX_STALLED_KEY_PREFIX}a`,
      `${OUTBOX_STALLED_KEY_PREFIX}b`,
    ]);
    expect(raised[1]).toMatchObject({ kind: SystemIssueKind.INTEGRATION, severity: 'HIGH' });
    expect(String(raised[1]?.title)).toContain('Shiprocket');
    expect(String(raised[1]?.detail)).toContain('courier.shiprocket_support_email');
  });

  it('clears itself once the message has left the send queue', async () => {
    const { svc, resolved } = watch({
      waiting: [item('b', 'shiprocket')],
      openKeys: [`${OUTBOX_STALLED_KEY_PREFIX}a`, `${OUTBOX_STALLED_KEY_PREFIX}b`],
    });
    await expect(svc.checkStalledOutbox(now)).resolves.toEqual({ raised: 1, cleared: 1 });
    expect(resolved).toEqual([`${OUTBOX_STALLED_KEY_PREFIX}a`]);
  });
});

describe('no courier-code branch upstream of the adapters (CUR-12)', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return sources(p);
      return p.endsWith('.ts') ? [p] : [];
    });
  }

  it('the escalation module never compares or switches on a courier code', () => {
    const dir = join(__dirname, '../../src/modules/courier-escalation');
    const offenders = sources(dir).filter((file) =>
      /(?:===|!==)\s*'(?:delhivery|shiprocket)'|case\s+'(?:delhivery|shiprocket)'/.test(
        readFileSync(file, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
