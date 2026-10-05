import {
  looksLikeCompanyName,
  makeCredentialRedactor,
  redactCredentialsInError,
} from '../../src/common/crypto/credential-redaction';

/**
 * CUR-1 says plaintext is never logged. These are the backstop's own
 * tests, and the thing they pin is narrow and absolute: a value we hold
 * must not survive into a string that leaves the process.
 *
 * It is worth a test rather than a reading because the leak this exists
 * for came out of a message NOBODY WROTE — Playwright's locator timeout
 * quotes the text it waited for, so interpolating a credential field
 * into a selector published it without a single call site saying so.
 */
describe('a credential value never survives into a message', () => {
  const creds = {
    portalUsername: 'ops@skydrop.global',
    portalPassword: 'Tr0ub4dor&3-horse',
    // The incident itself: the password typed into the company field.
    portalCompany: 'Tr0ub4dor&3-horse',
    apiToken: undefined,
  };

  it('replaces the value with the FIELD NAME, which is the safe half of the fact', () => {
    const redact = makeCredentialRedactor(creds);
    const out = redact('locator.click: waiting for getByText("Tr0ub4dor&3-horse")');
    expect(out).not.toContain('Tr0ub4dor&3-horse');
    // Longest-first ordering means one of the two fields holding this
    // value wins; either name is a field name and neither is a secret.
    expect(out).toMatch(/«portal(Company|Password) redacted»/);
  });

  it('matches regardless of case — over-redaction is the cheap direction', () => {
    const redact = makeCredentialRedactor({ portalPassword: 'HunterTwo' });
    expect(redact('typed huntertwo into the box')).not.toContain('huntertwo');
  });

  it('treats a value as a literal, not a pattern', () => {
    // A password may hold regex metacharacters. Escaping is what stops
    // `.*` matching the whole message (which would look like it worked)
    // or an unbalanced `(` throwing inside a catch block.
    const redact = makeCredentialRedactor({ portalPassword: 'a.*b(' });
    expect(redact('saw a.*b( here')).toBe('saw «portalPassword redacted» here');
    expect(redact('axxb( here')).toBe('axxb( here');
  });

  it('leaves a one- or two-character value alone — that is noise, not a secret', () => {
    // Redacting "a" would destroy every message while protecting
    // nothing. A value that short is the thing to report, not to hide.
    const redact = makeCredentialRedactor({ portalCompany: 'a' });
    expect(redact('a page about a company')).toBe('a page about a company');
  });

  it('is the identity function when the credential holds nothing worth hiding', () => {
    const redact = makeCredentialRedactor({ apiToken: undefined, portalCompany: '' });
    expect(redact('unchanged')).toBe('unchanged');
  });
});

describe('scrubbing a thrown error', () => {
  class PortalChallengeLike extends Error {}

  it('keeps the error CLASS — callers branch on instanceof to freeze the queue', () => {
    const redact = makeCredentialRedactor({ portalPassword: 'secret-value' });
    const err = new PortalChallengeLike('failed near secret-value');
    const out = redactCredentialsInError(err, redact);
    // Mutated in place rather than wrapped: a wrapper turns a challenge
    // into an ordinary failure and the portal keeps knocking.
    expect(out).toBe(err);
    expect(out).toBeInstanceOf(PortalChallengeLike);
    expect((out as Error).message).toBe('failed near «portalPassword redacted»');
  });

  it('scrubs the STACK too — V8 renders the message into it', () => {
    const redact = makeCredentialRedactor({ portalPassword: 'secret-value' });
    const err = new Error('failed near secret-value');
    redactCredentialsInError(err, redact);
    expect(err.stack ?? '').not.toContain('secret-value');
  });

  it('stringifies a non-Error throw so the value cannot escape via String(err)', () => {
    const redact = makeCredentialRedactor({ portalPassword: 'secret-value' });
    const out = redactCredentialsInError('raw secret-value', redact);
    expect(out).toBeInstanceOf(Error);
    expect((out as Error).message).toBe('raw «portalPassword redacted»');
  });

  it('returns the original error when it cannot be scrubbed at all', () => {
    // A redaction that swallowed the failure it was scrubbing would be
    // worse than the leak: the job would fail with nothing to show.
    const err = new Error('x');
    const out = redactCredentialsInError(err, () => {
      throw new Error('redactor blew up');
    });
    expect(out).toBe(err);
  });
});

describe('does this read like a company name?', () => {
  it('says yes to the two companies on the live login', () => {
    expect(looksLikeCompanyName('MS EXPORTS')).toBe(true);
    expect(looksLikeCompanyName('M S ENTERPRISE')).toBe(true);
    expect(looksLikeCompanyName("O'Brien & Sons (India) Pvt. Ltd.")).toBe(true);
  });

  it('says yes to a single-word name with no digits in it', () => {
    expect(looksLikeCompanyName('Flipkart')).toBe(true);
  });

  it('says no to a password — the question nobody was asking on night one', () => {
    // The real one. It passes the character test outright, which is why
    // the character test alone is not enough.
    expect(looksLikeCompanyName('Tr0ub4dor&3-horse')).toBe(false);
    expect(looksLikeCompanyName('p@ssw0rd#2026')).toBe(false);
    expect(looksLikeCompanyName('12345678')).toBe(false);
    expect(looksLikeCompanyName('   ')).toBe(false);
  });

  it('misreads a one-word alphanumeric company, and that is the accepted trade', () => {
    // Only ever asked about a value that already matched nothing the
    // dropdown offered, so the cost is one over-eager sentence beside
    // the real names.
    expect(looksLikeCompanyName('Shop24')).toBe(false);
  });
});
