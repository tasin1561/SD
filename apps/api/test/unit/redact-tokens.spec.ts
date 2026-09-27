import {
  REDACTED_TOKEN,
  redactTokens,
  redactTokensInVariables,
  redactTokensOrNull,
} from '../../src/modules/email/redact-tokens';

describe('redactTokens', () => {
  it('rewrites the query-parameter value and nothing around it', () => {
    expect(redactTokens('Go to https://x.io/reset?token=abc123 now')).toBe(
      `Go to https://x.io/reset?token=${REDACTED_TOKEN} now`,
    );
  });

  it('stops at the next parameter — a URL keeps everything after the token', () => {
    expect(redactTokens('https://x.io/a?token=abc123&lang=hi&x=1')).toBe(
      `https://x.io/a?token=${REDACTED_TOKEN}&lang=hi&x=1`,
    );
    expect(redactTokens('https://x.io/a?lang=hi&token=abc123')).toBe(
      `https://x.io/a?lang=hi&token=${REDACTED_TOKEN}`,
    );
  });

  it('stops at the closing quote of an href, leaving the HTML intact', () => {
    expect(redactTokens('<a href="https://x.io/v?token=abc123">Verify</a>')).toBe(
      `<a href="https://x.io/v?token=${REDACTED_TOKEN}">Verify</a>`,
    );
    expect(redactTokens("<a href='https://x.io/v?token=abc123'>Verify</a>")).toBe(
      `<a href='https://x.io/v?token=${REDACTED_TOKEN}'>Verify</a>`,
    );
  });

  it('handles several links in one body', () => {
    const out = redactTokens('one ?token=aaa and two ?token=bbb');
    expect(out).not.toContain('aaa');
    expect(out).not.toContain('bbb');
    expect(out.match(/token=\[redacted]/g)).toHaveLength(2);
  });

  it('is idempotent — re-running leaves the placeholder alone', () => {
    const once = redactTokens('https://x.io/a?token=abc123');
    expect(redactTokens(once)).toBe(once);
  });

  it('leaves prose and non-parameter uses alone', () => {
    // Anchored on `?`/`&`/`;`, so the WORD token is not a URL parameter.
    const prose = 'Your token= is single use. A bearer token=nothing here.';
    expect(redactTokens(prose)).toBe(prose);
    expect(redactTokens('no links at all')).toBe('no links at all');
  });

  it('redactTokensOrNull tolerates the nullable column', () => {
    expect(redactTokensOrNull(null)).toBeNull();
    expect(redactTokensOrNull(undefined)).toBeNull();
    expect(redactTokensOrNull('?token=x')).toBe(`?token=${REDACTED_TOKEN}`);
  });
});

describe('redactTokensInVariables', () => {
  it('rewrites string values and leaves other scalars as they are', () => {
    const out = redactTokensInVariables({
      reset_url: 'https://x.io/r?token=abc123',
      name: 'Alex',
      attempts: 3,
      ok: true,
      nothing: null,
    });
    expect(out.reset_url).toBe(`https://x.io/r?token=${REDACTED_TOKEN}`);
    expect(out.name).toBe('Alex');
    expect(out.attempts).toBe(3);
    expect(out.ok).toBe(true);
    expect(out.nothing).toBeNull();
  });

  it('returns the SAME object when nothing needed redacting', () => {
    // Keeps the common path allocation-free, and makes "nothing changed"
    // observable rather than inferred.
    const input = { name: 'Alex', count: 2 };
    expect(redactTokensInVariables(input)).toBe(input);
  });
});
