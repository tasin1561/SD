import type { EnvService } from '../../src/config/env.service';
import { makeTestEnv } from '../helpers/env';

/*
  ── WHY THIS SUITE EXISTS ─────────────────────────────────────────────
  The Solustation key moved from `SOLADDR_API_KEY` to
  `SOLUSTATION_ADDRESS_KEY` on 2026-11-03, with the old name kept as a
  fallback for one release. A fallback is the kind of thing that works
  perfectly until it is deleted, so the precedence is pinned here rather
  than left to the day somebody removes a branch.

  The `sa_test_` check is pinned for a different reason: a test key in
  production is the quietest wrong answer the integration can give. It
  returns 200, with a plausible score, from fake map providers, and bills
  nothing. It has already happened once on a dev machine where
  `.env.local` shadowed `.env`.
*/

// `makeTestEnv` already hands back an EnvService (MUST #14 — never an
// inline literal env object).
function env(over: Parameters<typeof makeTestEnv>[0]): EnvService {
  return makeTestEnv(over);
}

describe('Solustation env resolution', () => {
  describe('the key', () => {
    it('prefers SOLUSTATION_ADDRESS_KEY when both are set', () => {
      const e = env({
        SOLUSTATION_ADDRESS_KEY: 'sa_live_NEW00000',
        SOLADDR_API_KEY: 'sa_live_OLD00000',
      });
      expect(e.soladdrApiKey).toBe('sa_live_NEW00000');
      expect(e.soladdrKeySource).toBe('SOLUSTATION_ADDRESS_KEY');
    });

    it('falls back to SOLADDR_API_KEY so an un-updated droplet keeps working', () => {
      const e = env({ SOLADDR_API_KEY: 'sa_live_OLD00000' });
      expect(e.soladdrApiKey).toBe('sa_live_OLD00000');
      expect(e.soladdrKeySource).toBe('SOLADDR_API_KEY');
      expect(e.hasSoladdrApiKey).toBe(true);
    });

    it('treats a whitespace-only new name as unset rather than as an empty key', () => {
      // Otherwise a stray space in the env file would shadow a working
      // fallback and send the whole estate to stub mode.
      const e = env({ SOLUSTATION_ADDRESS_KEY: '   ', SOLADDR_API_KEY: 'sa_live_OLD00000' });
      expect(e.soladdrApiKey).toBe('sa_live_OLD00000');
      expect(e.soladdrKeySource).toBe('SOLADDR_API_KEY');
    });

    it('reports STUB, not a crash, when neither is set', () => {
      const e = env({});
      expect(e.hasSoladdrApiKey).toBe(false);
      expect(e.soladdrKeySource).toBeNull();
      expect(e.soladdrKeyPrefix).toBe('');
    });
  });

  describe('the base URL', () => {
    it('comes from SOLUSTATION_ADDRESS_URL, trailing slashes trimmed', () => {
      const e = env({ SOLUSTATION_ADDRESS_URL: 'https://address-api.solustation.site/' });
      expect(e.soladdrBaseUrl).toBe('https://address-api.solustation.site');
    });

    it('is empty when unset, which is the signal to read the old DB setting', () => {
      expect(env({}).soladdrBaseUrl).toBe('');
    });
  });

  describe('the key prefix is the only part that may be logged', () => {
    it('is exactly the first 8 characters', () => {
      const e = env({ SOLUSTATION_ADDRESS_KEY: 'sa_live_abcdefghijklmnop' });
      expect(e.soladdrKeyPrefix).toBe('sa_live_');
      expect(e.soladdrKeyPrefix).toHaveLength(8);
    });

    it('never contains the secret tail', () => {
      const secret = 'sa_live_SECRETTAIL999';
      const e = env({ SOLUSTATION_ADDRESS_KEY: secret });
      expect(secret).toContain(e.soladdrKeyPrefix);
      expect(e.soladdrKeyPrefix).not.toContain('SECRETTAIL');
    });
  });

  describe('a test key in production', () => {
    it('is flagged', () => {
      const e = env({ NODE_ENV: 'production', SOLUSTATION_ADDRESS_KEY: 'sa_test_abcdefgh' });
      expect(e.soladdrKeyIsTestInProduction).toBe(true);
    });

    it('is flagged even when it arrived through the deprecated name', () => {
      const e = env({ NODE_ENV: 'production', SOLADDR_API_KEY: 'sa_test_abcdefgh' });
      expect(e.soladdrKeyIsTestInProduction).toBe(true);
    });

    it('is fine outside production', () => {
      const e = env({ NODE_ENV: 'development', SOLUSTATION_ADDRESS_KEY: 'sa_test_abcdefgh' });
      expect(e.soladdrKeyIsTestInProduction).toBe(false);
    });

    it('does not fire for a live key in production', () => {
      const e = env({ NODE_ENV: 'production', SOLUSTATION_ADDRESS_KEY: 'sa_live_abcdefgh' });
      expect(e.soladdrKeyIsTestInProduction).toBe(false);
    });

    it('does not fire when there is no key at all — that is stub mode, not a wrong key', () => {
      const e = env({ NODE_ENV: 'production' });
      expect(e.soladdrKeyIsTestInProduction).toBe(false);
    });
  });
});
