import { CredentialEnvironment } from '@skydrop/db';
import { DelhiveryHttpService } from '../../src/modules/courier-delhivery/services/delhivery-http.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { CourierCredentialService } from '../../src/modules/courier-shared/services/courier-credential.service';
import { makeTestEnv } from '../helpers/env';
import type { DelhiveryRateLimitService } from '../../src/modules/courier-delhivery/services/delhivery-rate-limit.service';

type AnyArgs = Record<string, unknown>;

function makeService(
  opts: {
    baseUrl?: string | null; // null → no setting row; '' → stub mode
    isProduction?: boolean;
    creds?: Record<string, string>;
  } = {},
) {
  const systemSettingFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(async () =>
    opts.baseUrl === null ? null : { valueString: opts.baseUrl ?? '' },
  );
  const client = { systemSetting: { findUnique: systemSettingFindUnique } };
  // `resolveCredential`, not `getCredential`: the funnel resolves through
  // the one function that knows the explicit → default → legacy order, so
  // a call authenticates as the account it was routed to rather than as
  // whoever `findFirst` returned.
  const resolveCredential = jest.fn(async () => opts.creds ?? { apiToken: 'tok-123' });
  const credentials = { resolveCredential };
  const env = makeTestEnv(opts.isProduction ? { NODE_ENV: 'production' } : {});

  const rateLimit = {
    consume: jest.fn(async () => undefined),
    budgetFor: jest.fn(() => 1000),
    remaining: jest.fn(async () => 1000),
  } as unknown as DelhiveryRateLimitService;
  const svc = new DelhiveryHttpService(
    { client } as unknown as PrismaService,
    env,
    credentials as unknown as CourierCredentialService,
    rateLimit,
  );
  return { svc, systemSettingFindUnique, resolveCredential };
}

describe('DelhiveryHttpService.isStubMode', () => {
  it('true when courier.delhivery_api_base_url is empty', async () => {
    const { svc } = makeService({ baseUrl: '' });
    expect(await svc.isStubMode()).toBe(true);
  });

  it('true when the setting row is absent', async () => {
    const { svc } = makeService({ baseUrl: null });
    expect(await svc.isStubMode()).toBe(true);
  });

  it('false when a base URL is configured', async () => {
    const { svc } = makeService({ baseUrl: 'https://sandbox.delhivery.test' });
    expect(await svc.isStubMode()).toBe(false);
  });

  it('treats a whitespace-only value as stub mode', async () => {
    const { svc } = makeService({ baseUrl: '   ' });
    expect(await svc.isStubMode()).toBe(true);
  });
});

describe('DelhiveryHttpService.getBaseUrl', () => {
  it('returns the configured URL', async () => {
    const { svc } = makeService({ baseUrl: 'https://sandbox.delhivery.test' });
    expect(await svc.getBaseUrl()).toBe('https://sandbox.delhivery.test');
  });

  it('throws in stub mode (caller must branch on isStubMode first)', async () => {
    const { svc } = makeService({ baseUrl: '' });
    await expect(svc.getBaseUrl()).rejects.toThrow(/STUB MODE/);
  });
});

describe('DelhiveryHttpService.environment', () => {
  it('SANDBOX outside production', () => {
    const { svc } = makeService({ isProduction: false });
    expect(svc.environment()).toBe(CredentialEnvironment.SANDBOX);
  });

  it('PRODUCTION when NODE_ENV=production', () => {
    const { svc } = makeService({ isProduction: true });
    expect(svc.environment()).toBe(CredentialEnvironment.PRODUCTION);
  });
});

describe('DelhiveryHttpService.authHeaders', () => {
  it('builds the Token auth header from the decrypted credential', async () => {
    const { svc, resolveCredential } = makeService({
      creds: { apiToken: 'secret-token' },
    });
    const headers = await svc.authHeaders(CredentialEnvironment.SANDBOX);
    expect(headers.Authorization).toBe('Token secret-token');
    expect(headers['Content-Type']).toBe('application/json');
    // The argument order is the contract: courier, environment, ACCOUNT,
    // actor. The account is third and `null` here because this test calls
    // authHeaders directly with no account — null is what makes
    // resolveCredential fall through to the default account, or to the
    // legacy single credential when none exists. Threading from real call
    // sites is covered by delhivery-account-threading.spec.ts.
    expect(resolveCredential).toHaveBeenCalledWith(
      'delhivery',
      CredentialEnvironment.SANDBOX,
      null,
      undefined,
    );
  });

  it('passes the account through, so the token belongs to it', async () => {
    const { svc, resolveCredential } = makeService({ creds: { apiToken: 'acct-b-token' } });
    const headers = await svc.authHeaders(CredentialEnvironment.PRODUCTION, undefined, 'acct-b');
    expect(headers.Authorization).toBe('Token acct-b-token');
    expect(resolveCredential).toHaveBeenCalledWith(
      'delhivery',
      CredentialEnvironment.PRODUCTION,
      'acct-b',
      undefined,
    );
  });

  it('throws when the credential lacks the apiToken field', async () => {
    const { svc } = makeService({ creds: { clientName: 'x' } });
    await expect(svc.authHeaders()).rejects.toThrow(/apiToken/);
  });
});

describe('DelhiveryHttpService.request (real mode)', () => {
  /**
   * `fetch` is MOCKED here, and that is a deliberate change from what
   * this test used to do.
   *
   * It previously left fetch real and pointed at a `.test` host,
   * asserting only that something threw — so a unit test's outcome
   * depended on DNS behaviour. It cost a real resolution attempt on
   * every run and flaked under full-suite load, which makes the whole
   * unit job network-dependent for no coverage.
   *
   * Mocking is also the STRONGER assertion: "it threw" is satisfied by
   * a typo, whereas this pins the URL, the method and the auth header
   * the real-mode path actually sends.
   */
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends a real fetch to the configured base URL with the auth header', async () => {
    const fetchMock = jest.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { svc } = makeService({ baseUrl: 'https://sandbox.delhivery.test' });
    await svc.request({ method: 'GET', endpoint: 'tracking', path: '/x' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A structural type rather than `RequestInit`: the API's TS lib does
    // not include DOM types, which is also why the Shiprocket adapter
    // declares its own FetchInit.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      {
        method: string;
        headers: Record<string, string>;
        signal?: unknown;
      },
    ];
    // The base URL is joined to the path without a doubled slash.
    expect(url).toBe('https://sandbox.delhivery.test/x');
    expect(init.method).toBe('GET');
    // The decrypted token reaches the wire as Delhivery's scheme. A
    // request that went out unauthenticated would 401 in production
    // and look like a credential problem rather than a code one.
    expect(init.headers['Authorization']).toMatch(/^Token /);
    // A hung courier must not hold a saga open forever.
    expect(init.signal).toBeDefined();
  });

  it('surfaces a non-2xx rather than returning it as success', async () => {
    globalThis.fetch = jest.fn(
      async () => new Response('upstream exploded', { status: 500 }),
    ) as unknown as typeof fetch;

    const { svc } = makeService({ baseUrl: 'https://sandbox.delhivery.test' });
    await expect(
      svc.request({ method: 'GET', endpoint: 'tracking', path: '/x' }),
    ).rejects.toThrow();
  });
});
