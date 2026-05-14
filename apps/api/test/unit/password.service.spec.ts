import { PasswordService } from '../../src/modules/auth-common/services/password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes and verifies a password (round trip)', async () => {
    const hash = await svc.hash('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await svc.verify(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await svc.hash('correct horse battery staple');
    expect(await svc.verify(hash, 'wrong-password')).toBe(false);
  });

  it('returns false (does not throw) for a malformed hash', async () => {
    expect(await svc.verify('not-a-real-hash', 'anything')).toBe(false);
  });

  it('produces a different hash each call (random salt)', async () => {
    const h1 = await svc.hash('same-input');
    const h2 = await svc.hash('same-input');
    expect(h1).not.toEqual(h2);
  });

  it('uses argon2id with memoryCost=19456, timeCost=2, parallelism=1', async () => {
    const hash = await svc.hash('probe');
    // Encoded params show up in the hash string: m=19456,t=2,p=1
    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
    expect(hash).toContain('p=1');
    expect(svc.needsRehash(hash)).toBe(false);
  });
});
