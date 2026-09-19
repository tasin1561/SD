import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  CourierOutboxKind,
  CourierOutboxStatus,
  SystemIssueKind,
  TicketHandling,
} from '@skydrop/db';
import { DelhiverySupportAdapterService } from '../../src/modules/courier-delhivery/services/delhivery-support-adapter.service';
import { TicketHandlingService } from '../../src/modules/ticket-handling/services/ticket-handling.service';
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

  /*
    ── THE STAMP AGREES WITH THE ADAPTER, BOTH WAYS (2026-09-19) ──────

    `TicketHandlingService` decides whether a new ticket is stamped AUTO
    ("software is carrying this to the courier") or MANUAL ("a person
    is"), from its own `AUTOMATED_COURIERS` list. That list said
    `['delhivery']` while Delhivery's adapter — three files away —
    reported `raiseTicket: false`, so the two disagreed about the same
    fact and only one of them was right.

    Nothing caught it because the automation is dormant: it sits behind
    a seeded-off switch with `portalMode` OFF in production, so the
    wrong label never rendered. The day somebody flipped the switch,
    Delhivery tickets would have been stamped AUTO and then moved by
    nobody — a ticket in a queue everybody assumes software has.

    So the stamp is pinned against the adapter, per courier, IN BOTH
    DIRECTIONS: a courier is stamped AUTO exactly when its own adapter
    says it can raise a ticket. Adding an automation means the adapter
    and the list change together or this fails.
  */
  describe('the ticket stamp agrees with the adapter that would carry it', () => {
    function handling(): TicketHandlingService {
      // The operator switch is ON, so a courier that is stamped MANUAL
      // here is stamped MANUAL because of its ADAPTER, not the switch.
      return new TicketHandlingService({
        client: {
          ticket: { updateMany: jest.fn(), update: jest.fn() },
          systemSetting: { findUnique: jest.fn(async () => ({ valueBoolean: true })) },
        },
      } as never);
    }

    it.each(['delhivery', 'shiprocket'])(
      '%s is stamped AUTO exactly when its adapter can raise a ticket',
      async (code) => {
        const canRaise = reg.for(code)?.capabilities().raiseTicket ?? false;
        const stamp = await handling().initialFor(code);
        expect(stamp).toBe(canRaise ? TicketHandling.AUTO : TicketHandling.MANUAL);
      },
    );

    it('and today that means NOT ONE of them — CUR-20', async () => {
      // Stated on its own so the day this changes, somebody has to
      // delete a test that says it out loud rather than watch a
      // parameterised one quietly start passing differently.
      for (const code of reg.known()) {
        expect(reg.for(code)?.capabilities().raiseTicket).toBe(false);
        await expect(handling().initialFor(code)).resolves.toBe(TicketHandling.MANUAL);
      }
    });
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

/*
  ── THE SCAN, WIDENED (2026-09-19) ──────────────────────────────────

  It read ONE directory (`courier-escalation`) and ONE shape
  (`=== 'delhivery'`). Both halves were too narrow, and an audit found
  what fell through each of them:

    • the DIRECTORY — `courier-pickup.service.ts` in `courier-ops` held
      `const COURIER_CODE = 'delhivery'` and used it for every courier;
      `tracking-poll.service.ts` held the same constant and stamped it
      on every scan it wrote, for every courier it polled;
      `ticket-handling.service.ts` listed Delhivery as ticket-automated
      while Delhivery's own adapter reported `raiseTicket: false`.

    • the SHAPE — a `const X = 'delhivery'` is neither a comparison nor
      a `case`, so none of those three would have matched even inside
      the one directory it did read. Nor does a settings key written out
      as the literal `'courier.delhivery_…'`, which is how a Shiprocket
      pickup came to demand a Delhivery-keyed location name.

  So it now sweeps `courier-*`, `tracking-*` and `ticket-handling`, and
  looks for all four fingerprints. COMMENTS are stripped first: these
  fixes are worth explaining, and an explanation has to be able to quote
  the literal it removed.

  ALLOWED, each because it IS the one place that knows: a courier's own
  adapter directory, and the dispatchers CUR-12 names.
*/
describe('no courier-code branch upstream of the adapters (CUR-12)', () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return sources(p);
      return p.endsWith('.ts') ? [p] : [];
    });
  }

  /** Comments are where a fix explains the literal it deleted. */
  function code(file: string): string {
    return readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  }

  const MODULES = join(__dirname, '../../src/modules');

  /**
   * Each entry is a place the courier's name is legitimately known, OR
   * a standing debt somebody decided not to pay today — and each says
   * which. The list is at its FLOOR: every remaining entry was looked
   * at on 2026-09-19 and kept on purpose, so anything NEW appearing
   * here is a regression rather than part of a backlog.
   */
  const ALLOWED: ReadonlyArray<{ readonly path: string; readonly why: string }> = [
    // ── The one place that knows, by design ──────────────────────
    { path: 'courier-delhivery/', why: "a courier's own adapter: its name IS the job" },
    { path: 'courier-shiprocket/', why: 'same' },
    {
      path: 'courier-ops/services/courier-ops-dispatch.service.ts',
      why: 'CUR-12 ops dispatcher — cancel / edit / pickup / warehouse / e-way bill',
    },
    {
      path: 'courier-ops/services/courier-ndr-dispatch.service.ts',
      why: 'CUR-12 NDR dispatcher — also owns "does this courier hand back a handle to poll"',
    },
    { path: 'courier-awb/services/courier-awb-dispatch.service.ts', why: 'CUR-12 AWB dispatcher' },
    {
      path: 'courier-escalation/services/courier-support-registry.service.ts',
      why: 'CUR-12 support-desk registry',
    },

    // ── Genuine per-courier asymmetries, at the call site ────────
    //
    // Each of these is a REAL difference the dispatcher does not cover,
    // named rather than silently degraded, and each was read on
    // 2026-09-19. They are candidates for moving behind a dispatcher
    // question (as `pickupNeedsLocationName` and `pollsOutcome` were),
    // but none of them is currently WRONG.
    {
      path: 'courier-ops/services/courier-shipment-insight.service.ts',
      why: 'Shiprocket holds one document where Delhivery holds four, and its cost/TAT reads have no Shiprocket equivalent',
    },
    {
      path: 'courier-ops/services/courier-margin-report.service.ts',
      why: "the two couriers report a parcel's real cost from different places",
    },
    {
      path: 'courier-ops/services/courier-warehouse-registration.service.ts',
      why: 'Shiprocket has add-only pickup locations (no edit), refused by name',
    },
    {
      path: 'courier-ndr-runner/services/ndr-runner.service.ts',
      why: "Shiprocket's NDR list is fetched once per account per run; Delhivery has no such list",
    },
    {
      path: 'courier-awb/services/courier-choice.service.ts',
      why: 'CUR-17: only an AGGREGATOR has a carrier to choose, and only Shiprocket is one',
    },
    {
      path: 'courier-escalation/services/courier-escalation.service.ts',
      why: 'CUR-20: the documented fallback for a ticket with NO parcel, named LEGACY_DEFAULT_COURIER',
    },

    // ── A STANDING DEBT, stated rather than hidden ───────────────
    //
    // `courier.delhivery_origin_pincode` is read as OUR dispatch origin
    // by three services that are not about Delhivery at all — the lane
    // for a TAT estimate, a serviceability check and a rate lookup. It
    // is the pincode goods leave from, so it is the same pin whoever
    // carries them, and today it is only ever asked of Delhivery. It
    // becomes wrong the day a second origin exists or a courier wants
    // its own; the honest fix is an origin on the WAREHOUSE row, which
    // `courier-warehouse-registration.service.ts` already says is where
    // an address belongs. Not changed here because picking that shape
    // is a decision, not a rename.
    {
      path: 'courier-ops/services/shipment-courier-context.service.ts',
      why: 'reads courier.delhivery_origin_pincode as OUR origin — see the standing-debt note above',
    },
    {
      path: 'courier-serviceability/services/order-serviceability.service.ts',
      why: 'same origin-pincode debt',
    },
    {
      path: 'courier-portal/',
      why: "Playwright driving each courier's own panel — the page it is on is the courier",
    },
    {
      path: 'courier-shared/services/courier-distribution.service.ts',
      why: 'the global split IS two named settings (courier.default_{delhivery,shiprocket}_account); the WEIGHT no longer reads a courier code (2026-09-19)',
    },
  ];

  const SWEPT = readdirSync(MODULES).filter(
    (name) =>
      (name.startsWith('courier-') || name.startsWith('tracking-') || name === 'ticket-handling') &&
      statSync(join(MODULES, name)).isDirectory(),
  );

  const FINGERPRINTS: ReadonlyArray<{ readonly label: string; readonly rx: RegExp }> = [
    { label: "=== 'delhivery'", rx: /(?:===|!==)\s*'(?:delhivery|shiprocket)'/ },
    { label: "case 'delhivery'", rx: /case\s+'(?:delhivery|shiprocket)'/ },
    // The one the audit actually needed: a module-level constant, then
    // used for couriers it has nothing to do with.
    {
      label: "const X = 'delhivery'",
      rx: /(?:const|let)\s+\w+\s*(?::[^=]+)?=\s*'(?:delhivery|shiprocket)'/,
    },
    // A per-courier setting key written out rather than composed.
    { label: "'courier.delhivery_…'", rx: /'courier\.(?:delhivery|shiprocket)_[a-z_]+'/ },
  ];

  it.each(FINGERPRINTS)('nothing upstream carries a $label', ({ rx }) => {
    const offenders: string[] = [];
    for (const mod of SWEPT) {
      for (const file of sources(join(MODULES, mod))) {
        const rel = file.slice(MODULES.length + 1);
        if (ALLOWED.some((a) => rel.startsWith(a.path) || rel === a.path)) continue;
        if (rx.test(code(file))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
