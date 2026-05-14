import { UnauthorizedException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { JwtService } from '../../src/modules/auth-common/services/jwt.service';
import { EnvService } from '../../src/config/env.service';

function makeEnv(): EnvService {
  return new EnvService({
    NODE_ENV: 'test',
    PORT: 4000,
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgresql://x:y@localhost:5432/x',
    REDIS_URL: 'redis://localhost:6379',
    JWT_SIGNING_KEY: 'a'.repeat(64),
    RESEND_API_KEY: '',
    SELLER_APP_URL: 'http://localhost:3001',
    ADMIN_APP_URL: 'http://localhost:3002',
    SUPPORT_EMAIL: 'support@skydrop.online',
  });
}

describe('JwtService', () => {
  const env = makeEnv();
  const svc = new JwtService(env);

  it('signs a staff access token that verifies and exposes claims', () => {
    const signed = svc.signStaffAccess({ subject: 'staff-uuid-1', role: 'SUPER_ADMIN' });
    expect(signed.token.split('.').length).toBe(3);
    expect(signed.expiresIn).toBe(300);
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const claims = svc.verifyStaffAccess(signed.token);
    expect(claims.sub).toBe('staff-uuid-1');
    expect(claims.aud).toBe('skydrop-staff');
    expect(claims.role).toBe('SUPER_ADMIN');
    expect(claims.jti).toBe(signed.jti);
    expect(claims.iss).toBe('skydrop');
  });

  it('signs a seller access token with status claim', () => {
    const signed = svc.signSellerAccess({ subject: 'seller-uuid-1', status: 'APPROVED' });
    const claims = svc.verifySellerAccess(signed.token);
    expect(claims.sub).toBe('seller-uuid-1');
    expect(claims.aud).toBe('skydrop-seller');
    expect(claims.status).toBe('APPROVED');
  });

  it('rejects a token with the wrong audience', () => {
    const staffToken = svc.signStaffAccess({ subject: 's', role: 'CALL_AGENT' }).token;
    expect(() => svc.verifySellerAccess(staffToken)).toThrow(UnauthorizedException);
  });

  it('rejects a token signed with a different key', () => {
    const otherToken = jwt.sign({}, 'b'.repeat(64), {
      algorithm: 'HS256',
      audience: 'skydrop-staff',
      issuer: 'skydrop',
      subject: 's',
      expiresIn: 60,
    });
    expect(() => svc.verifyStaffAccess(otherToken)).toThrow(UnauthorizedException);
  });

  it('rejects an expired token', () => {
    const expired = jwt.sign({}, env.jwtSigningKey, {
      algorithm: 'HS256',
      audience: 'skydrop-staff',
      issuer: 'skydrop',
      subject: 's',
      expiresIn: -1,
    });
    expect(() => svc.verifyStaffAccess(expired)).toThrow(UnauthorizedException);
  });

  it('uses HS256 specifically and rejects alg=none', () => {
    // Construct an unsigned-style token by signing with an empty key + alg=none.
    // Our verify pins algorithms to ['HS256'], so this should be rejected.
    const noneToken = jwt.sign({}, '', {
      algorithm: 'none',
      audience: 'skydrop-staff',
      issuer: 'skydrop',
      subject: 's',
      noTimestamp: true,
    });
    expect(() => svc.verifyStaffAccess(noneToken)).toThrow(UnauthorizedException);
  });
});
