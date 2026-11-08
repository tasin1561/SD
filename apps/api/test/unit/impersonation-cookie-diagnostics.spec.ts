import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import {
  IMPERSONATION_COOKIE,
  inspectImpersonationCookie,
  signImpersonationCookie,
} from '../../src/common/impersonation/impersonation-cookie';
import {
  ImpersonationSessionLoader,
  SERVED_ROWS_PER_SESSION,
} from '../../src/common/impersonation/impersonation-session-loader.service';

const KEY = 'k'.repeat(48);
const reqWith = (cookies: Record<string, unknown> | undefined): Request =>
  ({ cookies, path: '/seller/orders', method: 'GET', headers: {}, ip: '1.2.3.4' }) as never;
const withCookie = (v: string) => reqWith({ [IMPERSONATION_COOKIE]: v });

describe('inspectImpersonationCookie reason codes', () => {
  it('accepts a good cookie', () => {
    const v = signImpersonationCookie({
      signingKey: KEY,
      sessionId: 'sid-1',
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(inspectImpersonationCookie({ signingKey: KEY, req: withCookie(v) })).toEqual({
      ok: true,
      sessionId: 'sid-1',
    });
  });
  it('missing cookie', () => {
    expect(inspectImpersonationCookie({ signingKey: KEY, req: reqWith({}) })).toEqual({
      ok: false,
      reason: 'COOKIE_ABSENT',
    });
  });
  it('cookie parser not applied', () => {
    expect(inspectImpersonationCookie({ signingKey: KEY, req: reqWith(undefined) })).toEqual({
      ok: false,
      reason: 'COOKIES_NOT_PARSED',
    });
  });
  it('bad signature', () => {
    const v = jwt.sign({ sid: 'x' }, 'other-key-other-key', {
      audience: 'skydrop-impersonation',
      issuer: 'skydrop',
      expiresIn: 60,
    });
    expect(inspectImpersonationCookie({ signingKey: KEY, req: withCookie(v) })).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });
  it('wrong audience', () => {
    const v = jwt.sign({ sid: 'x' }, KEY, {
      audience: 'someone-else',
      issuer: 'skydrop',
      expiresIn: 60,
    });
    expect(inspectImpersonationCookie({ signingKey: KEY, req: withCookie(v) })).toEqual({
      ok: false,
      reason: 'AUDIENCE_OR_ISSUER_MISMATCH',
    });
  });
  it('expired token', () => {
    const v = jwt.sign({ sid: 'x', exp: Math.floor(Date.now() / 1000) - 30 }, KEY, {
      audience: 'skydrop-impersonation',
      issuer: 'skydrop',
    });
    expect(inspectImpersonationCookie({ signingKey: KEY, req: withCookie(v) })).toEqual({
      ok: false,
      reason: 'EXPIRED',
    });
  });
  it('malformed token', () => {
    expect(inspectImpersonationCookie({ signingKey: KEY, req: withCookie('not-a-jwt') })).toEqual({
      ok: false,
      reason: 'MALFORMED_TOKEN',
    });
  });
});

describe('ImpersonationSessionLoader diagnostics', () => {
  const make = () => {
    const log = jest.fn().mockResolvedValue('id');
    const loader = new ImpersonationSessionLoader(
      { jwtSigningKey: KEY } as never,
      { loadUsableSession: jest.fn() } as never,
      { log } as never,
    );
    return { loader, log };
  };

  it('records a present-but-bad cookie as HIGH with reason and path, no token text', async () => {
    const { loader, log } = make();
    const bad = jwt.sign({ sid: 'x' }, 'other-key-other-key', {
      audience: 'skydrop-impersonation',
      issuer: 'skydrop',
    });
    const v = await loader.verdictFor(withCookie(bad));
    expect(v).toEqual({ kind: 'none' });
    const arg = log.mock.calls[0][0];
    expect(arg.action).toBe('impersonation.cookie_rejected');
    expect(arg.severity).toBe('HIGH');
    expect(arg.metadata).toMatchObject({
      reason: 'BAD_SIGNATURE',
      path: '/seller/orders',
      method: 'GET',
    });
    expect(JSON.stringify(arg)).not.toContain(bad);
  });

  it('records an absent cookie only on the authed surface without a bearer, throttled', async () => {
    const { loader, log } = make();
    await loader.verdictFor(reqWith({}));
    await loader.verdictFor(reqWith({}));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0].action).toBe('impersonation.cookie_missing');
    expect(log.mock.calls[0][0].metadata.reason).toBe('COOKIE_ABSENT');
  });

  it('stays silent for anonymous/public paths and bearer-carrying requests', async () => {
    const { loader, log } = make();
    await loader.verdictFor({ ...reqWith({}), path: '/track/abc' } as never);
    await loader.verdictFor({
      ...reqWith({}),
      headers: { authorization: 'Bearer x' },
    } as never);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('ImpersonationSessionLoader success-path diagnostics', () => {
  const claim = {
    sessionId: 'sess-1',
    staffUserId: 'staff-1',
    subject: { kind: 'SELLER', id: 'sel-1' },
    mayWrite: false,
  };
  const make = () => {
    const log = jest.fn().mockResolvedValue('id');
    const loader = new ImpersonationSessionLoader(
      { jwtSigningKey: KEY } as never,
      { loadUsableSession: jest.fn().mockResolvedValue(claim) } as never,
      { log } as never,
    );
    return { loader, log };
  };
  const goodCookie = () =>
    signImpersonationCookie({
      signingKey: KEY,
      sessionId: 'sess-1',
      expiresAt: new Date(Date.now() + 60_000),
    });

  it('ok path writes a LOW request_served row with path and method, no token text', async () => {
    const { loader, log } = make();
    const cookie = goodCookie();
    const v = await loader.verdictFor(withCookie(cookie));
    expect(v.kind).toBe('ok');
    const arg = log.mock.calls[0][0];
    expect(arg.action).toBe('impersonation.request_served');
    expect(arg.severity).toBe('LOW');
    expect(arg.entityId).toBe('sess-1');
    expect(arg.metadata).toMatchObject({ path: '/seller/orders', method: 'GET', hasBearer: false });
    expect(JSON.stringify(arg)).not.toContain(cookie);
    expect(JSON.stringify(arg)).not.toContain(cookie.split('.')[1]);
  });

  it('stops writing after the per-session cap, still returns ok', async () => {
    const { loader, log } = make();
    const cookie = goodCookie();
    for (let i = 0; i < SERVED_ROWS_PER_SESSION + 5; i++) {
      const v = await loader.verdictFor(withCookie(cookie));
      expect(v.kind).toBe('ok');
    }
    expect(log).toHaveBeenCalledTimes(SERVED_ROWS_PER_SESSION);
  });

  it('a failing audit write never changes the verdict', async () => {
    const { loader, log } = make();
    log.mockRejectedValue(new Error('db down'));
    const v = await loader.verdictFor(withCookie(goodCookie()));
    expect(v.kind).toBe('ok');
  });
});
