import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * RS-10 — the public tracking page shows a reseller store's logo as a
 * short-lived presigned GET straight from Spaces. apps/track's CSP is
 * the tightest of the apps, and a blocked image fails SILENTLY (the logo
 * simply is not there, and the CSP spec only counts violations on pages
 * it loads, which carry no reseller parcel). So the policy is pinned at
 * its source: images from Spaces, and nothing else widened.
 */
const TRACK_MIDDLEWARE = readFileSync(join(__dirname, '../../../track/src/middleware.ts'), 'utf8');

describe('apps/track CSP admits the store logo (RS-10)', () => {
  it('img-src includes the Spaces host', () => {
    expect(TRACK_MIDDLEWARE).toMatch(
      /createCspMiddleware\(\{\s*imgExtra:\s*\['https:\/\/\*\.digitaloceanspaces\.com'\]\s*\}\)/,
    );
  });

  it('connect-src is NOT widened — the page never fetches from the bucket', () => {
    expect(TRACK_MIDDLEWARE).not.toMatch(/connectExtra/);
  });
});
