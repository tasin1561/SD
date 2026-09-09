import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Shiprocket's webhook can only reach us on a URL that does not name
 * them, with a header they choose.
 *
 * Two constraints, both theirs, both discovered from their Webhooks
 * screen rather than from a document:
 *
 *  1. Their form REFUSES a URL containing "shiprocket", "kartrocket",
 *     "sr" or "kr". So `/public/tracking/webhooks/shiprocket` — the
 *     obvious URL, and the one every other courier uses — cannot be
 *     saved on their side at all.
 *  2. They do not sign anything. The token is static and travels in a
 *     header whose NAME their form calls the "Auth Token Type", default
 *     `x-api-key`.
 *
 * Structural because neither is observable from our own behaviour: the
 * endpoint works perfectly with the wrong path, it just never receives
 * anything, and that silence looks exactly like a courier with no scans.
 */
const CONTROLLER = join(
  process.cwd(),
  'src/modules/tracking-ingestion/controllers/public-webhook.controller.ts',
);

/** Their banned keywords, verbatim from the form's own note. */
const BANNED = ['shiprocket', 'kartrocket', 'sr', 'kr'];

describe('the Shiprocket webhook path and header', () => {
  const src = readFileSync(CONTROLLER, 'utf8');

  it('maps an alias to shiprocket, so the URL never has to say their name', () => {
    expect(src).toMatch(/WEBHOOK_PATH_ALIASES/);
    expect(src).toMatch(/'carrier-b':\s*'shiprocket'/);
  });

  it('the alias itself carries none of the words their form rejects', () => {
    const alias = /'([a-z0-9-]+)':\s*'shiprocket'/.exec(src)?.[1] ?? '';
    expect(alias).not.toBe('');
    for (const word of BANNED) {
      expect(alias).not.toContain(word);
    }
  });

  it('the whole webhook path is clean, not just the alias segment', () => {
    // The prefix ships in the URL too. "tracking", "webhooks" and
    // "public" are fine today; a future rename could quietly break it.
    const prefix = /@Controller\('([^']+)'\)/.exec(src)?.[1] ?? '';
    for (const word of BANNED) {
      expect(`${prefix}/carrier-b`).not.toContain(word);
    }
  });

  it('accepts x-api-key as well as our own signature header', () => {
    expect(src).toMatch(/@Headers\('x-skydrop-signature'\)/);
    expect(src).toMatch(/@Headers\('x-api-key'\)/);
  });

  it('prefers OUR header when both arrive', () => {
    // A courier that starts sending the wrong header should fail closed
    // rather than be quietly accommodated.
    expect(src).toMatch(/skydropSignature\s*\?\?\s*apiKeyHeader/);
  });

  it('an unaliased code passes straight through', () => {
    // Every other courier keeps using its own name; the alias map is an
    // exception list, not a translation layer.
    expect(src).toMatch(/WEBHOOK_PATH_ALIASES\[lower\]\s*\?\?\s*lower/);
  });
});
