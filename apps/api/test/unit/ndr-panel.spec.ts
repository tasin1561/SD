import {
  NEED_ACTION_URL,
  parseNdrDrawerText,
  parseNdrPanelText,
  parseNeedActionText,
  readNdrPanel,
} from '../../src/modules/courier-portal/pages/delhivery-ndr-panel';
import {
  NDR_ALERT_PREFIX,
  NdrPanelService,
  ndrAlertConditions,
  ndrAlertKey,
  ndrChanged,
} from '../../src/modules/courier-portal/services/ndr-panel.service';
import { judgeClickNdr } from '../../src/modules/courier-portal/services/portal-read-only-guard';
import { FakeAttemptTicketService } from '../../src/modules/courier-whatsapp/services/fake-attempt-ticket.service';

/**
 * Decisions only: whether the selectors match Delhivery's real DOM can
 * only be proven against the live panel — live verification is pending.
 */
const PAGE_NOT_VERIFIED = [
  'AWB 38061110627384',
  '1/3 delivery attempts failed',
  'Deadline: 2 Days',
  'COD: Not collected',
  'Action needed to ensure timely delivery',
  'View NDRs',
  'Tracking',
  'NDR (1)',
  'NDR Remark is not verified',
  'Not Verified',
].join('\n');

function fakePage(opts: {
  body?: string | Error;
  viewButton?: boolean;
  drawer?: string | null;
  closeButton?: boolean;
}) {
  const log = { clicks: [] as string[], escape: 0 };
  const yes = async (): Promise<void> => undefined;
  const no = async (): Promise<void> => {
    throw new Error('timeout');
  };
  const node = (name: string, present: boolean, text = ''): Record<string, unknown> => {
    const n: Record<string, unknown> = {
      first: () => n,
      or: () => n,
      waitFor: present ? yes : no,
      innerText: async () => text,
      click: async () => {
        if (!present) throw new Error('timeout');
        log.clicks.push(name);
      },
    };
    return n;
  };
  const dialog = node('dialog', opts.drawer != null, opts.drawer ?? '');
  dialog.getByRole = () => node('close', opts.closeButton !== false, 'Close');
  const page = {
    getByText: () => node('banner', true),
    locator: () => ({
      innerText: async () => {
        if (opts.body instanceof Error) throw opts.body;
        return opts.body ?? '';
      },
    }),
    getByRole: (role: string) =>
      role === 'dialog' ? dialog : node('view-ndrs', opts.viewButton !== false, 'View NDRs'),
    keyboard: {
      press: async () => {
        log.escape += 1;
      },
    },
  };
  return { page: page as never, log };
}

describe('parseNdrPanelText', () => {
  it('reads the owner screenshot: open NDR, 1/3 failed, 2 days, not verified', () => {
    expect(parseNdrPanelText(PAGE_NOT_VERIFIED, true)).toEqual({
      open: true,
      attemptsFailed: 1,
      attemptsMax: 3,
      deadlineDays: 2,
      remarkVerified: false,
      reasonText: null,
    });
  });

  it('reads the verified variant and "1 Day"', () => {
    const r = parseNdrPanelText(
      '2/3 delivery attempts failed\nDeadline: 1 Day\nNDR (1)\nNDR Remark is verified\nVerified',
    );
    expect(r).toMatchObject({
      open: true,
      attemptsFailed: 2,
      deadlineDays: 1,
      remarkVerified: true,
    });
  });

  it('hours read as 0 days', () => {
    expect(parseNdrPanelText('1/3 delivery attempts failed Deadline: 5 Hours')?.deadlineDays).toBe(
      0,
    );
  });

  it('no banner but the header chip read: open=false (a proven "no NDR")', () => {
    const r = parseNdrPanelText('AWB 1\n0/3 delivery attempts failed\nTracking');
    expect(r).toMatchObject({ open: false, attemptsFailed: 0, remarkVerified: null });
  });

  it('selector drift (nothing NDR-shaped) is null, never "no NDR"', () => {
    expect(parseNdrPanelText('AWB 1\nSomething new\nTracking')).toBeNull();
    expect(parseNdrPanelText('')).toBeNull();
  });

  it('a lone banner reads open=true with the rest unread', () => {
    expect(parseNdrPanelText('Action needed to ensure timely delivery')).toMatchObject({
      open: true,
      attemptsFailed: null,
      deadlineDays: null,
      remarkVerified: null,
    });
  });
});

describe('parseNdrDrawerText', () => {
  it('keeps the reason, drops the chrome, refuses a WhatsApp window', () => {
    expect(parseNdrDrawerText('NDR\nCustomer not available\nClose')).toBe(
      'NDR · Customer not available',
    );
    expect(parseNdrDrawerText('Whatsapp\nhello')).toBeNull();
    expect(parseNdrDrawerText('Close')).toBeNull();
  });
});

describe('readNdrPanel (fake page)', () => {
  it('reads the facts and clicks NOTHING ("View NDRs" is a link to another page)', async () => {
    const { page, log } = fakePage({ body: PAGE_NOT_VERIFIED });
    const r = await readNdrPanel(page);
    expect(r).toMatchObject({
      open: true,
      attemptsFailed: 1,
      remarkVerified: false,
      reasonText: null,
    });
    expect(log.clicks).toEqual([]);
    expect(log.escape).toBe(0);
  });

  it('absent NDR: no clicks at all', async () => {
    const { page, log } = fakePage({ body: '0/3 delivery attempts failed', viewButton: false });
    const r = await readNdrPanel(page);
    expect(r?.open).toBe(false);
    expect(log.clicks).toEqual([]);
  });

  it('selector drift or a throwing page is null', async () => {
    expect(
      (await readNdrPanel(fakePage({ body: 'redesigned page', viewButton: false }).page)) ?? null,
    ).toBeNull();
    expect(await readNdrPanel(fakePage({ body: new Error('boom') }).page)).toBeNull();
    expect(await readNdrPanel({} as never)).toBeNull();
  });
});

/** The NDR page from the owner's screenshot (2026-11-16), as innerText. */
const NEED_ACTION_PAGE = [
  'Exceptions & NDR',
  'NDR Management',
  'Need Action',
  '1',
  'Auto Reattempt',
  'Return Recommendation',
  'ORDER ID & AWB NO.',
  'PRODUCT DETAILS',
  'PAYMENT MODE',
  'NDR TYPE',
  'ATTEMPT COUNT',
  'LAST UPDATED',
  'SH-2026-11-000058',
  '38061110627384',
  'Elite Collagen x1',
  '₹1,400',
  'COD',
  'Consignee Unavailable',
  '1 attempt',
  'Nov 16 | 11:38 AM',
  'Proofs',
  'Call not connected',
  'Consignee details',
  'Reattempt',
  'Return',
  'Showing',
].join('\n');

describe('the NDR page "View NDRs" links to', () => {
  it('is addressed by AWB', () => {
    expect(NEED_ACTION_URL('38061110627384')).toBe(
      'https://one.delhivery.com/v2/exceptions/ndr/need-action?filter_awb=38061110627384',
    );
  });

  it('reads type, attempts, time and proof from the owner screenshot', () => {
    expect(parseNeedActionText(NEED_ACTION_PAGE, '38061110627384')).toBe(
      'Consignee Unavailable · 1 attempt · Nov 16 | 11:38 AM · Proof: Call not connected',
    );
  });

  it('never takes an action button for a reason or a proof', () => {
    const r = parseNeedActionText(NEED_ACTION_PAGE, '38061110627384') ?? '';
    expect(r).not.toMatch(/reattempt|return|consignee details/i);
  });

  it('another AWB, a missing row, or a shifted layout reads null', () => {
    expect(parseNeedActionText(NEED_ACTION_PAGE, '99999')).toBeNull();
    expect(parseNeedActionText('NDR Management\nNo results', '38061110627384')).toBeNull();
    expect(
      parseNeedActionText(
        '38061110627384\nCOD\n1 attempt\nConsignee Unavailable',
        '38061110627384',
      ),
    ).toBeNull();
  });
});

describe('NDR click allow-list', () => {
  const click = (label: string) => judgeClickNdr({ label, tag: 'button', type: '', inForm: false });
  it('allows only View NDRs and its close control', () => {
    expect(click('View NDRs').allowed).toBe(true);
    expect(click('Close').allowed).toBe(true);
    expect(click('×').allowed).toBe(true);
    for (const bad of ['Resolve now', 'Activate now', 'Edit', 'View Whatsapp', 'Raise NDR', '']) {
      expect(click(bad).allowed).toBe(false);
    }
  });
});

describe('alert conditions', () => {
  const base = {
    open: true,
    attemptsFailed: 1,
    attemptsMax: 3,
    deadlineDays: 2,
    remarkVerified: false,
    reasonText: null,
  };
  it('last attempt = failed >= max-1; deadline <= 1 day; unread never alerts', () => {
    expect(ndrAlertConditions(base)).toEqual([]);
    expect(ndrAlertConditions({ ...base, attemptsFailed: 2 })).toEqual(['last-attempt']);
    expect(ndrAlertConditions({ ...base, deadlineDays: 1 })).toEqual(['deadline']);
    expect(ndrAlertConditions({ ...base, attemptsFailed: 2, deadlineDays: 0 })).toEqual([
      'last-attempt',
      'deadline',
    ]);
    expect(ndrAlertConditions({ ...base, attemptsFailed: null, deadlineDays: null })).toEqual([]);
  });
  it('key format', () => {
    expect(ndrAlertKey('s1', 'deadline')).toBe(`${NDR_ALERT_PREFIX}s1:deadline`);
  });
  it('changed: only a real difference counts; an unread reason does not', () => {
    expect(ndrChanged(null, base)).toBe(true);
    expect(ndrChanged({ ...base, reasonText: 'a' }, base)).toBe(false);
    expect(ndrChanged(base, { ...base, deadlineDays: 1 })).toBe(true);
    expect(ndrChanged(base, { ...base, reasonText: 'new' })).toBe(true);
  });
});

describe('NdrPanelService', () => {
  function svc(prev: unknown) {
    const created: unknown[] = [];
    const raised: Array<{ dedupeKey: string }> = [];
    const resolved: string[] = [];
    const prisma = {
      client: {
        courierNdrPanelSnapshot: {
          findFirst: jest.fn(async () => prev),
          create: jest.fn(async (a: { data: unknown }) => {
            created.push(a.data);
          }),
        },
        shipment: { findMany: jest.fn(async () => [{ id: 's1' }]) },
      },
    };
    const issues = {
      raise: jest.fn(async (i: { dedupeKey: string }) => {
        raised.push(i);
        return { id: 'x', isNew: true };
      }),
      resolveByKey: jest.fn(async (k: string) => {
        resolved.push(k);
        return 1;
      }),
      openDedupeKeys: jest.fn(async () => ['ndr-panel:s1:deadline', 'ndr-panel:s1:last-attempt']),
    };
    return {
      service: new NdrPanelService(prisma as never, issues as never),
      created,
      raised,
      resolved,
    };
  }
  const last = {
    open: true,
    attemptsFailed: 2,
    attemptsMax: 3,
    deadlineDays: 2,
    remarkVerified: false,
    reasonText: null,
  };

  it('writes and raises ONE alert (keyed shipment+condition) on a changed snapshot', async () => {
    const { service, created, raised, resolved } = svc(null);
    expect(await service.record('s1', 'AWB1', last, false)).toBe(true);
    expect(created).toHaveLength(1);
    expect(raised.map((r) => r.dedupeKey)).toEqual(['ndr-panel:s1:last-attempt']);
    expect(resolved).toEqual(['ndr-panel:s1:deadline']);
  });

  it('an identical re-read writes nothing and raises nothing', async () => {
    const { service, created, raised } = svc({ ...last });
    expect(await service.record('s1', 'AWB1', last, false)).toBe(false);
    expect(created).toHaveLength(0);
    expect(raised).toHaveLength(0);
  });

  it('an unreadable page (null / open=null) stores nothing', async () => {
    const { service, created } = svc(null);
    expect(await service.record('s1', 'A', null, false)).toBe(false);
    expect(await service.record('s1', 'A', { ...last, open: null }, false)).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('a delivered/returned parcel raises nothing and clears', async () => {
    const { service, raised, resolved } = svc(null);
    await service.record('s1', 'AWB1', last, true);
    expect(raised).toHaveLength(0);
    expect(resolved).toContain('ndr-panel:s1:last-attempt');
  });

  it('clearFinished resolves every open key of a finished parcel', async () => {
    const { service, resolved } = svc(null);
    expect(await service.clearFinished()).toBe(2);
    expect(resolved).toEqual(['ndr-panel:s1:deadline', 'ndr-panel:s1:last-attempt']);
  });
});

describe('FakeAttemptTicketService', () => {
  function svc(existing: unknown, remarkVerified: boolean | null) {
    const openOrFind = jest.fn(async () => ({
      created: true,
      ticket: { id: 't-new', ticketNumber: 'T-2' },
    }));
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      ticket: { findFirst: jest.fn(async () => existing) },
      courierNdrPanelSnapshot: {
        findFirst: jest.fn(async () => ({
          remarkVerified,
          attemptsFailed: 1,
          attemptsMax: 3,
          reasonText: null,
        })),
      },
    };
    const prisma = {
      client: {
        shipment: {
          findUnique: jest.fn(async () => ({
            id: 's1',
            awbNumber: '123',
            courierCode: 'delhivery',
            orderShipments: [{ order: { id: 'o1', sellerId: 'sel1' } }],
          })),
        },
        $transaction: async (fn: (t: unknown) => unknown) => fn(tx),
      },
    };
    return {
      service: new FakeAttemptTicketService(prisma as never, { openOrFind } as never),
      openOrFind,
    };
  }

  it('opens one ticket in not-delivered.fake-remark under a lock', async () => {
    const { service, openOrFind } = svc(null, false);
    const r = await service.raise('s1', 'staff1');
    expect(r).toEqual({ created: true, ticket: { id: 't-new', number: 'T-2' } });
    expect(openOrFind).toHaveBeenCalledWith(
      expect.objectContaining({
        issueCategoryExternalId: 'not-delivered.fake-remark',
        shipmentId: 's1',
        orderId: 'o1',
      }),
      expect.objectContaining({ staffId: 'staff1' }),
      expect.anything(),
    );
  });

  it('an open one already there is returned, not duplicated', async () => {
    const { service, openOrFind } = svc({ id: 't-old', ticketNumber: 'T-1' }, false);
    expect(await service.raise('s1', 'staff1')).toEqual({
      created: false,
      ticket: { id: 't-old', number: 'T-1' },
    });
    expect(openOrFind).not.toHaveBeenCalled();
  });

  it('refuses when the panel does not say "not verified"', async () => {
    const { service } = svc(null, true);
    await expect(service.raise('s1', 'staff1')).rejects.toMatchObject({
      response: { code: 'NDR_REMARK_NOT_UNVERIFIED' },
    });
  });
});
