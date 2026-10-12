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

  // THE THREE ASSERTIONS ABOVE COMPARE TWO SOURCE CONSTANTS, AND THAT IS
  // NOT THE INVARIANT THE COMMENT DESCRIBES. `useBodyParser` registers
  // ONE parser for the whole app, so for as long as the only `limit`
  // handed to it was DOCUMENT_BODY_LIMIT, the general limit was enforced
  // nowhere — and this file went green the entire time, because `g < d`
  // held perfectly while `g` bounded nothing. A spec that reads two
  // declarations and compares them can pass against any wiring.
  //
  // These assert the general limit is ENFORCED, which is the claim.
  it('enforces the general limit on the bytes, not on content-length alone', () => {
    // The header check cannot see a chunked body (no length declared) or
    // a compressed one (the length is the COMPRESSED size while
    // body-parser inflates), so the byte count has to be checked
    // somewhere that sees the real buffer.
    expect(src).toContain('GENERAL_BODY_LIMIT_BYTES');
    const verify = /verify:\s*rawBodyWithGeneralLimit/.exec(src);
    expect(verify).not.toBeNull();
    // The hook must compare the BUFFER's length against the general
    // limit, and must exempt only the two big prefixes.
    expect(src).toMatch(/buf\.length > GENERAL_BODY_LIMIT_BYTES/);
    expect(src).toMatch(/mayBeBig[\s\S]{0,200}DOCUMENT_WEBHOOK_PREFIX/);
  });

  it('keeps req.rawBody set by the hook that replaces Nest’s', () => {
    // Supplying our own `verify` REPLACES the one `rawBody: true`
    // installs. Four HMAC paths read those exact bytes — the tracking
    // scan webhook, the document webhook, the ChatWoot webhook and the
    // courier inbound-email guard — so losing this assignment fails
    // AUTHENTICATION rather than merely dropping a field, and it fails
    // it for couriers whose scans we would then never receive.
    expect(src).toMatch(/req\.rawBody = buf/);
  });

  it('rejects an oversized general body as 413, not 500', () => {
    // A courier reading 500 retries forever; 413 says plainly that they
    // sent more than we accept. `AllExceptionsFilter.isPayloadTooLarge`
    // keys on exactly these, so the thrown error has to carry them.
    expect(src).toContain("type: 'entity.too.large'");
    expect(src).toMatch(/status(Code)?: 413/);
  });

  it('exempts the hand upload of a courier wallet export, and ONLY the admin route', () => {
    // `WalletSyncService` tells an operator — at the moment the nightly
    // sync has already failed — that the ledger can be uploaded by hand.
    // That upload could not accept the file the sync downloads: a 90-day
    // Delhivery export is ~3.3 MB, ~4.4 MB base64'd into the JSON body,
    // against a 1 MB cap. The documented fallback was unusable for the
    // only file anybody would bring to it.
    expect(src).toContain("WALLET_IMPORT_PREFIX = '/admin/courier/wallet-import'");
    expect(src).toContain('url.startsWith(WALLET_IMPORT_PREFIX)');
    // It is an ADMIN route behind `money.treasury.manage`, which is what
    // makes a larger body acceptable here and not on a public one: the
    // body is buffered before any guard runs, so every exemption is a
    // memory cost somebody unauthenticated could otherwise impose.
    expect(src).not.toMatch(/WALLET_IMPORT_PREFIX = '\/(public|seller|store)/);
  });

  it('keeps the guard keyed on the document prefix, not on a method or a courier', () => {
    // Scoping by anything else would either miss a route or open all of
    // them; the prefix is what the three endpoints actually share.
    expect(src).toContain('.startsWith(DOCUMENT_WEBHOOK_PREFIX)');
  });
});
