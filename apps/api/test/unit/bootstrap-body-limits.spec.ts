import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A STRUCTURAL spec, because nothing else in CI can see this file.
 *
 * The unit suite constructs services directly and the e2e harness builds
 * its own Nest app, so `main.ts` is executed by neither — the body-parser
 * configuration is invisible to every gate we run. It reached production
 * refusing every real courier document at 100kb, and no test failed.
 *
 * These assertions are deliberately about the SHAPE of the bootstrap
 * rather than behaviour: what matters is that the pieces are still wired
 * in the order that makes them work.
 */
describe('main.ts — courier document body limits', () => {
  const src = readFileSync(join(__dirname, '../../src/main.ts'), 'utf8');

  it('turns Nest body parsing off so ours can be registered in order', () => {
    // useBodyParser appends at call time, so the size guard can only run
    // first if nothing was registered at create.
    expect(src).toContain('bodyParser: false');
    expect(src).toContain('rawBody: true');
  });

  it('registers the size guard BEFORE the parser', () => {
    const guard = src.indexOf('PAYLOAD_TOO_LARGE');
    const parser = src.indexOf("useBodyParser('json'");
    expect(guard).toBeGreaterThan(-1);
    expect(parser).toBeGreaterThan(-1);
    // Reversed, the guard never runs and the large limit is global.
    expect(guard).toBeLessThan(parser);
  });

  it('allows the document routes more than everything else', () => {
    expect(src).toContain("DOCUMENT_WEBHOOK_PREFIX = '/public/tracking/documents'");
    const general = /GENERAL_BODY_LIMIT = '(\d+)mb'/.exec(src);
    const document = /DOCUMENT_BODY_LIMIT = '(\d+)mb'/.exec(src);
    expect(general).not.toBeNull();
    expect(document).not.toBeNull();
    const g = Number(general?.[1]);
    const d = Number(document?.[1]);
    // A base64 photo needs several MB; the default 100kb refused all of
    // them. The general limit must stay well under it — granting the
    // document allowance to every public endpoint is how a 4GB box is
    // exhausted, since the body is buffered before any guard runs.
    expect(d).toBeGreaterThanOrEqual(8);
    expect(g).toBeLessThan(d);
  });

  it('keeps the guard keyed on the document prefix, not on a method or a courier', () => {
    // Scoping by anything else would either miss a route or open all of
    // them; the prefix is what the three endpoints actually share.
    expect(src).toContain('.startsWith(DOCUMENT_WEBHOOK_PREFIX)');
  });
});
