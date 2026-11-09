import {
  Controller,
  Get,
  Post,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { ImpersonationAlsMiddleware } from '../../src/common/impersonation/impersonation-als.middleware';
import { SESSION_LIFECYCLE_PATHS } from '../../src/common/impersonation/impersonation-als.middleware';
import { ImpersonationSessionLoader } from '../../src/common/impersonation/impersonation-session-loader.service';
import {
  IMPERSONATION_COOKIE,
  signImpersonationCookie,
} from '../../src/common/impersonation/impersonation-cookie';
import { EnvService } from '../../src/config/env.service';
import { ImpersonationService } from '../../src/modules/impersonation/services/impersonation.service';
import { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import { fullRequestPath } from '../../src/common/impersonation/request-path';
import { currentImpersonation } from '../../src/common/impersonation/impersonation-context';

const KEY = 'k'.repeat(48);
const probed: Array<Record<string, string>> = [];
const audit = { log: jest.fn().mockResolvedValue(undefined) };
const sessions = {
  loadUsableSession: jest.fn().mockResolvedValue({
    sessionId: 'sess-1',
    staffUserId: 'staff-1',
    subject: { kind: 'SELLER', id: 'sel-1' },
    mayWrite: false,
  }),
};
const env = { jwtSigningKey: KEY };
let ctxInHandler: unknown = 'unset';

function probe(req: Request, _res: Response, next: NextFunction): void {
  probed.push({
    path: req.path,
    baseUrl: req.baseUrl,
    url: req.url,
    originalUrl: req.originalUrl,
  });
  next();
}

@Controller()
class C {
  @Get('auth/seller/me')
  me() {
    ctxInHandler = currentImpersonation();
    return 'ok';
  }
  @Post('auth/seller/impersonation/end')
  end() {
    ctxInHandler = currentImpersonation();
    return 'ok';
  }
}

@Module({
  controllers: [C],
  providers: [
    ImpersonationAlsMiddleware,
    ImpersonationSessionLoader,
    { provide: EnvService, useValue: env },
    { provide: ImpersonationService, useValue: sessions },
    { provide: AuditLogService, useValue: audit },
  ],
})
class M implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(cookieParser(), probe).forRoutes('*');
    consumer.apply(ImpersonationAlsMiddleware).forRoutes('*');
  }
}

async function boot() {
  const mod = await Test.createTestingModule({ imports: [M] }).compile();
  const app = mod.createNestApplication();
  await app.init();
  return app;
}

const goodCookie = () =>
  `${IMPERSONATION_COOKIE}=${signImpersonationCookie({
    signingKey: KEY,
    sessionId: 'sess-1',
    expiresAt: new Date(Date.now() + 60_000),
  })}`;

describe('impersonation middleware sees the REAL request path', () => {
  beforeEach(() => {
    probed.length = 0;
    audit.log.mockClear();
    ctxInHandler = 'unset';
  });

  it('measured: inside forRoutes(*) middleware req.path is "/" but originalUrl is the real path', async () => {
    const app = await boot();
    await request(app.getHttpServer()).get('/auth/seller/me?token=SECRET');
    expect(probed[0]).toEqual({
      path: '/',
      baseUrl: '/auth/seller/me',
      url: '/?token=SECRET',
      originalUrl: '/auth/seller/me?token=SECRET',
    });
    expect(
      fullRequestPath({ originalUrl: probed[0]?.originalUrl ?? '', path: probed[0]?.path ?? '' }),
    ).toBe('/auth/seller/me');
    await app.close();
  });

  it('a served request to /auth/seller/me records that path, with no query string', async () => {
    const app = await boot();
    await request(app.getHttpServer())
      .get('/auth/seller/me?token=SECRET')
      .set('Cookie', goodCookie());
    const served = audit.log.mock.calls.find((c) => c[0].action === 'impersonation.request_served');
    expect(served?.[0].metadata.path).toBe('/auth/seller/me');
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('SECRET');
    expect(ctxInHandler).not.toBeNull();
    await app.close();
  });

  it('an absent cookie on /auth/seller/me records cookie_missing with header diagnostics', async () => {
    const app = await boot();
    await request(app.getHttpServer()).get('/auth/seller/me?a=SECRET');
    const row = audit.log.mock.calls.find((c) => c[0].action === 'impersonation.cookie_missing');
    expect(row?.[0].metadata).toEqual(
      expect.objectContaining({
        path: '/auth/seller/me',
        hasCookieHeader: false,
        cookieHeaderLength: 0,
        cookiesParsed: true,
        cookieNames: [],
      }),
    );
    expect(JSON.stringify(audit.log.mock.calls)).not.toContain('SECRET');
    await app.close();
  });

  it('lifecycle routes are skipped: no context, no loader call, no served row', async () => {
    const app = await boot();
    sessions.loadUsableSession.mockClear();
    await request(app.getHttpServer())
      .post('/auth/seller/impersonation/end')
      .set('Cookie', goodCookie());
    expect(ctxInHandler).toBeNull();
    expect(sessions.loadUsableSession).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    await app.close();
  });

  it('SESSION_LIFECYCLE_PATHS matches lifecycle paths and nothing else', () => {
    for (const p of [
      '/auth/seller/impersonation/end',
      '/auth/store/impersonation/leave',
      '/auth/Seller/impersonation/exchange',
    ]) {
      expect(SESSION_LIFECYCLE_PATHS.test(p)).toBe(true);
    }
    for (const p of ['/auth/seller/me', '/seller/orders', '/auth/seller/impersonationx', '/']) {
      expect(SESSION_LIFECYCLE_PATHS.test(p)).toBe(false);
    }
  });

  it('fullRequestPath strips query and fragment, and falls back to path', () => {
    expect(fullRequestPath({ originalUrl: '/a/b?x=1#h', path: '/' })).toBe('/a/b');
    expect(fullRequestPath({ originalUrl: undefined as never, path: '/p' })).toBe('/p');
  });
});
