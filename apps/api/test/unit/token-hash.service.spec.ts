import { TokenHashService } from '../../src/modules/auth-common/services/token-hash.service';

describe('TokenHashService', () => {
  const svc = new TokenHashService();

  it('sha256Hex is deterministic', () => {
    expect(svc.sha256Hex('hello')).toBe(svc.sha256Hex('hello'));
  });

  it('sha256Hex output is 64-char lowercase hex', () => {
    const h = svc.sha256Hex('whatever');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refresh tokens are url-safe and high-entropy', () => {
    const t = svc.generateRefreshToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
    // Two consecutive generations must differ.
    expect(svc.generateRefreshToken()).not.toEqual(t);
  });

  it.each([
    ['password reset', 'generatePasswordResetToken'] as const,
    ['email verification', 'generateEmailVerificationToken'] as const,
    ['invitation', 'generateInvitationToken'] as const,
  ])('%s tokens are url-safe and unique', (_name, method) => {
    const a = svc[method]();
    const b = svc[method]();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a).not.toEqual(b);
  });

  it('generateApiKey returns plaintext, 12-char prefix, sha256 hash', () => {
    const { plaintext, prefix, hash } = svc.generateApiKey();
    expect(plaintext.startsWith('skd_')).toBe(true);
    expect(plaintext.length).toBe(36); // 'skd_' + 32 chars
    expect(prefix.length).toBe(12);
    expect(plaintext.startsWith(prefix)).toBe(true);
    expect(hash).toBe(svc.sha256Hex(plaintext));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two generated API keys have different plaintext + hash', () => {
    const a = svc.generateApiKey();
    const b = svc.generateApiKey();
    expect(a.plaintext).not.toEqual(b.plaintext);
    expect(a.hash).not.toEqual(b.hash);
  });
});
