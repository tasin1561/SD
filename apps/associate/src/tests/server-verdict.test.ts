import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@skydrop/api-client';
import { serverVerdict } from '../lib/server-verdict';

/*
  FE-2's formatter, and the one failure shape it used to render as
  punctuation.

  `ApiError` builds its own `message` as `API <status>[ (code)]: <body
  message>` and appends the colon whether or not anything follows it, so
  a 500 with an empty body arrives as the literal `"API 500: "`. That
  reached the screen on the associate portal's accept-invitation page.
*/
describe('serverVerdict', () => {
  it('shows a real refusal VERBATIM, code and all', () => {
    const err = new ApiError(409, 'ASSOCIATE_PRICE_NOT_SET', {
      code: 'ASSOCIATE_PRICE_NOT_SET',
      message: 'Nobody has set your price for Kurta · Blue.',
    });
    expect(serverVerdict(err)).toBe(
      '[ASSOCIATE_PRICE_NOT_SET] Nobody has set your price for Kurta · Blue.',
    );
  });

  it('never puts a bodiless 5xx on screen as punctuation', () => {
    const out = serverVerdict(new ApiError(500, undefined, null));
    expect(out).not.toMatch(/API 500/);
    expect(out).not.toMatch(/:\s*$/);
    // Says what happened, keeps the status for support, and answers the
    // question somebody actually has at that moment.
    expect(out).toContain('(500)');
    expect(out).toContain('Nothing was changed');
  });

  it('keeps the status for a bodiless 4xx too, rather than a bare fallback', () => {
    expect(serverVerdict(new ApiError(404, undefined, null))).toBe('Request failed. (404)');
  });

  it('a whitespace-only message is treated as no message, not as a verdict', () => {
    // The shape that produced the original defect: present but empty.
    const out = serverVerdict(new ApiError(502, undefined, { message: '   ' }));
    expect(out).toContain('(502)');
    expect(out).not.toMatch(/\s{2,}$/);
  });

  it('falls back for a non-Error and for an Error with nothing to say', () => {
    expect(serverVerdict('boom')).toBe('Request failed.');
    expect(serverVerdict(new Error('  '))).toBe('Request failed.');
    expect(serverVerdict(new Error('offline'))).toBe('offline');
  });

  it('is BYTE-IDENTICAL in every app that carries it', () => {
    /*
      Four apps hold their own copy, by the same decision that keeps
      components out of `packages/ui` until a second consumer forces the
      shape. That is fine while they agree — and the moment they do not,
      one app starts rendering a different sentence for the same failure
      and nobody finds out, because each app's own tests pass.

      So the copies are pinned to each other rather than to a snapshot of
      their text: this fails on DIVERGENCE, not on an edit, and the fix
      is to make the same edit everywhere.
    */
    const root = join(__dirname, '../../../..');
    const apps = ['admin', 'associate', 'reseller', 'seller'];
    const read = (a: string) =>
      readFileSync(join(root, 'apps', a, 'src/lib/server-verdict.ts'), 'utf8');
    const mine = read('associate');
    for (const app of apps) {
      expect(read(app), `apps/${app} has drifted from the other copies`).toBe(mine);
    }
  });
});
