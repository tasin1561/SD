import { SolustationHttpService } from '../../src/modules/address-check/services/solustation-http.service';
import {
  buildCorrectionBody,
  buildFeedbackBody,
  buildValidateBody,
  VALIDATE_BODY_KEYS,
} from '../../src/modules/address-check/services/solustation-http.service';
import { isSolustationError } from '../../src/modules/address-check/types/solustation.types';
import { makeTestEnv } from '../helpers/env';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const BASE = 'https://address-api.solustation.site';

function makeService(opts: { key?: string; baseUrl?: string } = {}) {
  const findUnique = jest.fn(async () => ({ valueString: opts.baseUrl ?? BASE }));
  const prisma = { client: { systemSetting: { findUnique } } } as unknown as PrismaService;
  const env = makeTestEnv({ SOLADDR_API_KEY: opts.key ?? 'sa_test_key' });
  return { svc: new SolustationHttpService(prisma, env), findUnique };
}

/** The shape their API really returns — copied from a live call with the
 *  test key on 2026-10-25, trimmed to what these tests read. */
function judgement(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'valid',
    recommended_action: 'approve',
    validity_score: 73,
    rto_risk: null,
    rto_risk_status: 'model_not_ready',
    post_office_confidence: 'high',
    completed_address: 'Vill Kankandighi, PO Kankandighi, South 24 Parganas, West Bengal 743383',
    issues: [{ code: 'house_number_missing', message: 'No house or flat number' }],
    suggestions: [],
    validation_id: 'val_01M5T1VMG0H1N0QWTHQTC33A0P',
    reference_id: 'draft-1',
    billable: false,
    ...over,
  };
}

/** apps/api's tsconfig has no DOM lib, so the response/request shapes
 *  are spelled out locally rather than borrowed from `ResponseInit` —
 *  same reason the Shiprocket adapter declares its own `FetchInit`. */
type RespInit = { status?: number; headers?: Record<string, string> };

function respond(body: unknown, init: RespInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'req_TEST01' },
    ...init,
  });
}

const VALIDATE_INPUT = {
  referenceId: 'draft-1',
  address: 'Vill Kankandighi, PO Kankandighi, PS Mathurapur',
  pincode: '743383',
  paymentType: 'cod' as const,
};

let fetchMock: jest.Mock;
const realFetch = globalThis.fetch;
beforeEach(() => {
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('the request body carries ONLY what the brief allows', () => {
  /*
    The load-bearing test of this whole integration.

    Solustation is a separate product and a separate data controller.
    The customer's name, phone and email never leave Skydrop, and the
    guarantee has to be structural rather than a habit — which is why
    every body is assembled field by field from named scalars and why
    this asserts the EXACT key set rather than the absence of three
    particular names.
  */
  it('validate sends exactly the five allowed keys, and never a sixth', () => {
    const body = buildValidateBody({ ...VALIDATE_INPUT, landmark: 'Near the high school' });
    expect(Object.keys(body).sort()).toEqual([...VALIDATE_BODY_KEYS].sort());
  });

  it('validate omits landmark entirely when there is none', () => {
    // Omitted, not empty: the brief says "landmark if entered
    // separately; omit otherwise", and '' is a value they would score.
    expect(Object.keys(buildValidateBody(VALIDATE_INPUT)).sort()).toEqual([
      'address',
      'payment_type',
      'pincode',
      'reference_id',
    ]);
    expect(Object.keys(buildValidateBody({ ...VALIDATE_INPUT, landmark: '   ' }))).not.toContain(
      'landmark',
    );
  });

  it.each([
    ['validate', buildValidateBody({ ...VALIDATE_INPUT, landmark: 'x' })],
    [
      'correction',
      buildCorrectionBody({
        validationId: 'val_1',
        source: 'operator_fixed',
        address: 'a new address',
        pincode: '743383',
        landmark: 'x',
      }),
    ],
    [
      'feedback',
      buildFeedbackBody({
        validationId: 'val_1',
        courier: 'delhivery',
        awb: '38061110571491',
        status: 'ndr',
        ndrReasons: ['Customer not available'],
        eventTime: '2026-10-28T11:04:00+05:30',
      }),
    ],
  ])('%s carries no customer identity of any kind', (_name, body) => {
    const keys = Object.keys(body).join(' ').toLowerCase();
    for (const forbidden of ['name', 'phone', 'mobile', 'email', 'customer', 'recipient']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('feedback drops empty NDR reasons rather than sending blanks', () => {
    const body = buildFeedbackBody({
      validationId: 'val_1',
      courier: 'delhivery',
      awb: 'A1',
      status: 'delivered',
      ndrReasons: ['', '  '],
      eventTime: '2026-10-28T11:04:00+05:30',
    });
    expect(Object.keys(body)).not.toContain('ndr_reasons');
  });
});

describe('SolustationHttpService — the three verdicts', () => {
  it.each([
    ['approve', 'valid'],
    ['confirm_with_customer', 'needs_review'],
    ['reject', 'invalid'],
  ])('passes %s through untouched', async (action, status) => {
    const { svc } = makeService();
    fetchMock.mockResolvedValue(respond(judgement({ recommended_action: action, status })));
    const out = await svc.validate(VALIDATE_INPUT);
    expect(out.recommended_action).toBe(action);
    expect(out.status).toBe(status);
  });

  it('sends the bearer key, asks for JSON, and refuses to follow a redirect', async () => {
    const { svc } = makeService({ key: 'sa_test_abc' });
    fetchMock.mockResolvedValue(respond(judgement()));
    await svc.validate(VALIDATE_INPUT);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Record<string, string>; redirect: string },
    ];
    expect(url).toBe(`${BASE}/v1/validate`);
    expect(init.headers['authorization']).toBe('Bearer sa_test_abc');
    // A service of ours answering with a redirect is not one we follow.
    expect(init.redirect).toBe('error');
  });

  it('an EDITED address goes to /v1/corrections, never back to /v1/validate', async () => {
    // Re-sending validate on the same reference returns the STORED
    // answer, so the operator would be shown the verdict on text they
    // had already changed — the failure is silent and looks like the
    // edit did nothing.
    const { svc } = makeService();
    fetchMock.mockResolvedValue(respond(judgement({ validity_score: 100 })));
    await svc.correction({
      validationId: 'val_1',
      source: 'operator_fixed',
      address: 'House 12, Netaji Road, Vill Kankandighi',
      pincode: '743383',
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${BASE}/v1/corrections`);
  });
});

describe('SolustationHttpService — failure is classified, never swallowed', () => {
  it('a timeout is retryable and says so', async () => {
    const { svc } = makeService();
    const abort = new Error('The operation was aborted');
    abort.name = 'TimeoutError';
    fetchMock.mockRejectedValue(abort);

    await expect(svc.validate(VALIDATE_INPUT)).rejects.toMatchObject({
      classification: 'TIMEOUT',
      retryable: true,
    });
  });

  it('a network error is retryable', async () => {
    const { svc } = makeService();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(svc.validate(VALIDATE_INPUT)).rejects.toMatchObject({
      classification: 'NETWORK',
      retryable: true,
    });
  });

  it('a 5xx is retryable and keeps their request id', async () => {
    const { svc } = makeService();
    fetchMock.mockResolvedValue(
      respond({ error: { code: 'internal', request_id: 'req_X' } }, { status: 503 }),
    );
    await expect(svc.validate(VALIDATE_INPUT)).rejects.toMatchObject({
      classification: 'SERVER',
      retryable: true,
      status: 503,
      requestId: 'req_TEST01',
    });
  });

  it('a 422 is OUR bug and is NOT retried', async () => {
    // This is also how a leaked field would surface: they refuse an
    // unknown key by name. Retrying it would send the same wrong
    // request again and bury the one signal that names the mistake.
    const { svc } = makeService();
    fetchMock.mockResolvedValue(
      respond(
        { error: { code: 'unknown_field', message: 'unknown field: customer_name' } },
        { status: 422 },
      ),
    );
    const err = await svc.validate(VALIDATE_INPUT).catch((e: unknown) => e);
    expect(isSolustationError(err)).toBe(true);
    expect(err).toMatchObject({ classification: 'BAD_REQUEST', retryable: false, status: 422 });
    expect((err as Error).message).toContain('unknown_field');
  });

  it.each([401, 403])('a %s is a key problem and is NOT retried in a loop', async (status) => {
    const { svc } = makeService();
    fetchMock.mockResolvedValue(
      respond(
        { error: { code: 'unauthorized', message: 'missing or invalid API key' } },
        { status },
      ),
    );
    await expect(svc.validate(VALIDATE_INPUT)).rejects.toMatchObject({
      classification: 'AUTH',
      retryable: false,
    });
  });

  it('a 429 is retryable and carries Retry-After', async () => {
    const { svc } = makeService();
    fetchMock.mockResolvedValue(
      respond(
        { error: { code: 'rate_limited' } },
        { status: 429, headers: { 'retry-after': '7', 'x-request-id': 'req_TEST01' } },
      ),
    );
    await expect(svc.validate(VALIDATE_INPUT)).rejects.toMatchObject({
      classification: 'RATE_LIMITED',
      retryable: true,
      retryAfterSeconds: 7,
    });
  });

  it('never reads an error as approval', async () => {
    // The one failure mode that would be worse than no check at all.
    const { svc } = makeService();
    fetchMock.mockResolvedValue(respond('<html>502 Bad Gateway</html>', { status: 502 }));
    const err = await svc.validate(VALIDATE_INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { recommended_action?: string }).recommended_action).toBeUndefined();
  });

  it('an HTML error page does not become a parse crash', async () => {
    const { svc } = makeService();
    fetchMock.mockResolvedValue(respond('<html>nginx</html>', { status: 502 }));
    await expect(svc.validate(VALIDATE_INPUT)).rejects.toMatchObject({ status: 502 });
  });
});

describe('SolustationHttpService — not configured is a supported state', () => {
  it('no key means STUB, not a crash, and nothing to retry', async () => {
    const { svc } = makeService({ key: '' });
    expect(await svc.isLive()).toBe(false);
    await expect(svc.validate(VALIDATE_INPUT)).rejects.toMatchObject({
      classification: 'STUB',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no base URL means STUB too', async () => {
    const { svc } = makeService({ baseUrl: '' });
    expect(await svc.isLive()).toBe(false);
    await expect(svc.validate(VALIDATE_INPUT)).rejects.toMatchObject({ classification: 'STUB' });
  });

  it('refuses an address outside their length limits without spending a call', async () => {
    // A billable call to be told a length we could measure ourselves,
    // spent inside the operator's wait.
    const { svc } = makeService();
    await expect(svc.validate({ ...VALIDATE_INPUT, address: 'ab' })).rejects.toMatchObject({
      classification: 'BAD_REQUEST',
      retryable: false,
    });
    await expect(
      svc.validate({ ...VALIDATE_INPUT, address: 'x'.repeat(501) }),
    ).rejects.toMatchObject({ classification: 'BAD_REQUEST' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
