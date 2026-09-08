import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  permissionsPolicy,
  staticSecurityHeaders,
  withHeader,
} from '../../../../packages/config/security-headers.mjs';

/**
 * The camera has to be allowed for THIS origin, and only here.
 *
 * `Permissions-Policy: camera=()` denies the feature to every origin
 * including our own, and it does it invisibly: `getUserMedia` rejects
 * with a `NotAllowedError` before the browser can prompt, so Chrome's
 * own site setting reads "Camera — allowed" while every call still
 * fails. That is what the pack bench and the handover bench shipped
 * with, and granting the permission by hand does not fix it because a
 * document-level policy is not something a site setting can override.
 *
 * These read the config rather than a rendered response on purpose: the
 * header is set at build time by `next.config.mjs`, so this is the
 * earliest place the mistake is visible, and a behavioural test would
 * need a browser to see it at all.
 */
describe('Permissions-Policy — the camera (FE-7)', () => {
  const config = readFileSync(join(__dirname, '../../next.config.mjs'), 'utf8');

  it('apps/admin allows the camera for its own origin', () => {
    expect(permissionsPolicy({ camera: true })).toContain('camera=(self)');
    // The config has to actually ASK for it — the shared default does not.
    expect(config).toMatch(/permissionsPolicy\(\{\s*camera:\s*true\s*\}\)/);
  });

  it('the shared default still denies it, for the apps that never scan', () => {
    const shared = staticSecurityHeaders.find((h) => h.key === 'Permissions-Policy');
    expect(shared?.value).toContain('camera=()');
  });

  it('allowing the camera widens nothing else', () => {
    // (self) grants no permission by itself — the browser still asks —
    // and every other capability stays denied outright.
    for (const feature of ['microphone', 'geolocation', 'payment', 'usb']) {
      expect(permissionsPolicy({ camera: true })).toContain(`${feature}=()`);
    }
  });

  it('withHeader replaces exactly one header and keeps the rest', () => {
    const swapped = withHeader(staticSecurityHeaders, 'Permissions-Policy', 'x=()');
    expect(swapped).toHaveLength(staticSecurityHeaders.length);
    expect(swapped.filter((h: { value: string }) => h.value === 'x=()')).toHaveLength(1);
    expect(swapped.find((h: { key: string }) => h.key === 'X-Frame-Options')?.value).toBe('DENY');
  });
});
