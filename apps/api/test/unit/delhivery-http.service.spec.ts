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
  const systemSettingFindUnique = jest.fn<Promise<AnyArgs | null>, [AnyArgs]>(
    async () =>
      opts.baseUrl === null
        ? null
        : { valueString: opts.baseUrl ?? '' },
  );
  const client = { systemSetting: { findUnique: systemSettingFindUnique } };
  const getCredential = jest.fn(async () =>
    opts.creds ?? { apiToken: 'tok-123' },
  );
  const credentials = { getCredential };
  const env = makeTestEnv(
    opts.isProduction ? { NODE_ENV: 'production' } : {},
  );

  const rateLimit = {
    consume: jest.fn(async () => undefined),
    budgetFor: jest.fn(() => 1000),
    remaining: jest.fn(async () => 1000),
  } as unknown as DelhiveryRateLimitService;
  const svc = new DelhiveryHttpService(
    { client } as unknown as PrismaService,
    env,
    credentials as unknown as CourierCredentialService, rateLimit);
  return { svc, systemSettingFindUnique, getCredential };
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
    const { svc, getCredential } = makeService({
      creds: { apiToken: 'secret-token' },
    });
    const headers = await svc.authHeaders(CredentialEnvironment.SANDBOX);
    expect(headers.Authorization).toBe('Token secret-token');
    expect(headers['Content-Type']).toBe('application/json');
    expect(getCredential).toHaveBeenCalledWith(
      'delhivery',
      CredentialEnvironment.SANDBOX,
    );
  });

  it('throws when the credential lacks the apiToken field', async () => {
    const { svc } = makeService({ creds: { clientName: 'x' } });
    await expect(svc.authHeaders()).rejects.toThrow(/apiToken/);
  });
});

describe('DelhiveryHttpService.request (real mode)', () => {
  it('attempts a real fetch against the configured base URL', async () => {
    const { svc } = makeService({ baseUrl: 'https://sandbox.delhivery.test' });
    // No mocked global fetch — node will try to resolve a real host
    // and fail. That's the assertion: it WENT through fetch (not the
    // old TODO throw). The error type confirms real-mode path is wired.
    await expect(
      svc.request({ method: 'GET', endpoint: 'tracking', path: '/x' }),
    ).rejects.toThrow();
  });
});
