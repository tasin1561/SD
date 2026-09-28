import {
  ShiprocketApiProbeService,
  SHIPROCKET_PROBE_PATHS,
  verdictFor,
  type ShiprocketProbeEndpoint,
} from '../../src/modules/courier-shiprocket/services/shiprocket-api-probe.service';
import { PortalNetworkWatch } from '../../src/modules/courier-portal/services/shiprocket-portal-network';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ShiprocketHttpService } from '../../src/modules/courier-shiprocket/services/shiprocket-http.service';

/** The one row their statement endpoint really answers with — their own
 *  published sample, and what production returned on 2026-09-28. */
const PLACEHOLDER_ROW = {
  transaction_id: '',
  order_id: '',
  awb_code: '',
  return_awb_code: null,
  action: '',
  charge: '',
  description: 'Wallet Balance',
  debit_amount: '',
  credit_amount: '',
  balance_amount: '6174.71',
  balance_weight: 0,
  created_at: '',
  can_ship: true,
};

const REAL_ROW = {
  transaction_id: 'SRTX99',
  awb_code: '90658129413',
  description: 'Freight charge',
  debit_amount: '99.00',
  credit_amount: '',
  balance_amount: '6075.71',
  created_at: '2026-09-27 18:03:00',
};

function makeProbe(
  answers: Record<string, unknown>,
  opts: { stub?: boolean; account?: { id: string; label: string } | null } = {},
): { probe: ShiprocketApiProbeService; calls: { method: string; path: string }[] } {
  const calls: { method: string; path: string }[] = [];
  const http = {
    isStubMode: async (): Promise<boolean> => opts.stub === true,
    request: async (o: { method: string; path: string }): Promise<unknown> => {
      calls.push({ method: o.method, path: o.path });
      if (!(o.path in answers)) {
        throw new Error(
          `Shiprocket GET ${o.path} failed (404): {"message":"404 Not Found","status_code":404}`,
        );
      }
      return answers[o.path];
    },
  } as unknown as ShiprocketHttpService;

  const account =
    opts.account === undefined ? { id: 'acc-1', label: 'Shiprocket - primary' } : opts.account;
  const prisma = {
    client: { courierAccount: { findFirst: async (): Promise<unknown> => account } },
  } as unknown as PrismaService;
  const audit = { log: async (): Promise<null> => null } as unknown as AuditLogService;

  return { probe: new ShiprocketApiProbeService(prisma, http, audit), calls };
}

describe('ShiprocketApiProbeService', () => {
  it('asks with GET and nothing else — a write against a courier cannot be taken back', async () => {
    const { probe, calls } = makeProbe({});
    await probe.probe({ requestedByStaffId: 'staff-1' });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    // Every declared path was asked; a 404 is an answer worth recording.
    for (const p of SHIPROCKET_PROBE_PATHS) expect(calls.some((c) => c.path === p)).toBe(true);
  });

  it('calls a SHAPED PLACEHOLDER what it is, not a ledger row', async () => {
    const { probe } = makeProbe({
      '/v1/external/account/details/statement': { data: [PLACEHOLDER_ROW] },
    });
    const out = await probe.probe({});
    const stmt = out.endpoints.find((e) => e.path === '/v1/external/account/details/statement');
    expect(stmt?.status).toBe('ANSWERED');
    // It IS one row — which is exactly why counting rows was not enough.
    expect(stmt?.attempts[0]?.rows).toBe(1);
    expect(stmt?.attempts[0]?.allRowsEmpty).toBe(true);
    expect(out.verdict).toContain('No wallet ledger on the API');
    expect(out.verdict).toContain('SHAPED PLACEHOLDER');
  });

  it('re-asks a list endpoint with the documented parameters before concluding', async () => {
    const { probe, calls } = makeProbe({
      '/v1/external/account/details/statement': { data: [PLACEHOLDER_ROW] },
    });
    await probe.probe({});
    const stmt = calls.filter((c) => c.path === '/v1/external/account/details/statement');
    // Bare, then the three parameter shapes: "empty" and "we did not send
    // a date range" look identical from one call.
    expect(stmt).toHaveLength(4);
  });

  it('says so loudly when rows DO carry content — the answer that changes the design', async () => {
    const { probe } = makeProbe({
      '/v1/external/account/details/statement': { data: [REAL_ROW] },
    });
    const out = await probe.probe({});
    expect(out.verdict).toContain('returned rows with content');
    expect(out.verdict).toContain('WalletImportService');
  });

  it('records field NAMES, never values — this lands in an audit row', async () => {
    const { probe } = makeProbe({
      '/v1/external/account/details/wallet-balance': { data: { balance_amount: '6174.71' } },
    });
    const out = await probe.probe({});
    const json = JSON.stringify(out.endpoints);
    expect(json).toContain('balance_amount');
    expect(json).not.toContain('6174.71');
  });

  it('refuses to answer from a stub — that would look exactly like proof', async () => {
    const { probe, calls } = makeProbe(
      { '/v1/external/account/details/statement': { data: [] } },
      {
        stub: true,
      },
    );
    const out = await probe.probe({});
    expect(calls).toHaveLength(0);
    expect(out.stubMode).toBe(true);
    expect(out.verdict).toBe('NOT ASKED');
  });

  it('says nothing was asked when no account has a credential', async () => {
    const { probe, calls } = makeProbe({}, { account: null });
    const out = await probe.probe({});
    expect(calls).toHaveLength(0);
    expect(out.note).toContain('No active Shiprocket account');
    expect(out.verdict).toBe('NOT ASKED');
  });
});

describe('verdictFor', () => {
  const endpoint = (over: Partial<ShiprocketProbeEndpoint>): ShiprocketProbeEndpoint => ({
    path: '/p',
    status: 'ANSWERED',
    detail: null,
    shape: null,
    attempts: [],
    rowFields: [],
    ...over,
  });

  it('prefers a real row over a placeholder when both are present', () => {
    const v = verdictFor([
      endpoint({
        path: '/placeholder',
        attempts: [{ label: 'bare', query: {}, rows: 1, allRowsEmpty: true, error: null }],
      }),
      endpoint({
        path: '/real',
        attempts: [{ label: 'bare', query: {}, rows: 7, allRowsEmpty: false, error: null }],
      }),
    ]);
    expect(v).toContain('/real');
    expect(v).toContain('returned rows with content');
  });

  it('treats an empty list as no ledger, not as a placeholder', () => {
    const v = verdictFor([
      endpoint({
        attempts: [{ label: 'bare', query: {}, rows: 0, allRowsEmpty: false, error: null }],
      }),
    ]);
    expect(v).toContain('nothing asked returned a list with rows');
  });
});

describe('PortalNetworkWatch', () => {
  interface Handler {
    response: ((r: { status(): number; url(): string }) => void) | undefined;
    requestfailed:
      | ((r: { url(): string; failure(): { errorText: string } | null }) => void)
      | undefined;
  }
  const fakePage = (): { page: Parameters<PortalNetworkWatch['watch']>[0]; h: Handler } => {
    const h: Handler = { response: undefined, requestfailed: undefined };
    const page = {
      on: (e: string, fn: unknown): void => {
        if (e === 'response') h.response = fn as Handler['response'];
        if (e === 'requestfailed') h.requestfailed = fn as Handler['requestfailed'];
      },
    } as unknown as Parameters<PortalNetworkWatch['watch']>[0];
    return { page, h };
  };

  it('keeps Shiprocket failures and drops everybody else’s', () => {
    const w = new PortalNetworkWatch();
    const { page, h } = fakePage();
    w.watch(page);
    h.response?.({
      status: (): number => 401,
      url: (): string => 'https://apiv2.shiprocket.co/v1/get/version',
    });
    h.response?.({
      status: (): number => 429,
      url: (): string => 'https://o45114.ingest.us.sentry.io/api/x/envelope/',
    });
    h.requestfailed?.({
      url: (): string => 'https://www.google.com/ccm/collect',
      failure: (): { errorText: string } => ({ errorText: 'net::ERR_FAILED' }),
    });
    const f = w.failures();
    expect(f).toHaveLength(1);
    expect(f[0]?.host).toBe('apiv2.shiprocket.co');
    expect(f[0]?.status).toBe(401);
  });

  it('drops the query string — some of theirs are signed and a person reads this', () => {
    const w = new PortalNetworkWatch();
    const { page, h } = fakePage();
    w.watch(page);
    h.response?.({
      status: (): number => 401,
      url: (): string =>
        'https://apiv2.shiprocket.co/v1/vas/isVasSubscribed?token=secret&company_id=9',
    });
    const summary = w.summary() ?? '';
    expect(summary).toContain('/v1/vas/isVasSubscribed');
    expect(summary).not.toContain('secret');
  });

  it('counts repeats instead of listing them, and puts auth first', () => {
    const w = new PortalNetworkWatch();
    const { page, h } = fakePage();
    w.watch(page);
    for (let i = 0; i < 3; i++) {
      h.response?.({
        status: (): number => 404,
        url: (): string => 'https://app.shiprocket.in/img/sprite.svg',
      });
    }
    h.response?.({
      status: (): number => 498,
      url: (): string => 'https://apiv2.shiprocket.co/v1/auth/login',
    });
    const f = w.failures();
    expect(f[0]?.path).toBe('/v1/auth/login');
    expect(f.find((x) => x.path === '/img/sprite.svg')?.count).toBe(3);
    expect(w.summary()).toContain('×3');
  });

  it('is null when nothing of theirs failed — no report is better than a noisy one', () => {
    const w = new PortalNetworkWatch();
    const { page, h } = fakePage();
    w.watch(page);
    h.response?.({ status: (): number => 200, url: (): string => 'https://app.shiprocket.in/ok' });
    expect(w.summary()).toBeNull();
  });
});
