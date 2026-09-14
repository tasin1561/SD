import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PAGE_PERMISSIONS, canSeePath, permissionForPath } from '@/lib/page-access';

/**
 * The reseller page table names only real store permissions, and gates
 * what it says it gates (RS-2). Cosmetic (FE-2), but a gate naming a key
 * the API has never heard of hides a page from everyone.
 */
const API_PERMISSIONS = join(__dirname, '../../../api/src/common/auth/store-permissions.ts');

describe('reseller page access', () => {
  it('every permission it names is in the API store catalogue', () => {
    const src = readFileSync(API_PERMISSIONS, 'utf8');
    const known = new Set(Array.from(src.matchAll(/key: '([^']+)'/g), (m) => m[1]));
    expect(known.size).toBeGreaterThanOrEqual(4);
    expect(PAGE_PERMISSIONS.map(([, p]) => p).filter((p) => !known.has(p))).toEqual([]);
  });

  it('leaves the landing page and your own account open to everyone', () => {
    expect(permissionForPath('/dashboard')).toBeNull();
    expect(permissionForPath('/account')).toBeNull();
    expect(canSeePath({ permissions: [] }, '/dashboard')).toBe(true);
  });

  it('gates the team and the settings on the permission their reads need', () => {
    expect(permissionForPath('/team')).toBe('team.view');
    expect(permissionForPath('/settings')).toBe('store.profile.view');
    expect(canSeePath({ permissions: ['store.profile.view'] }, '/team')).toBe(false);
    expect(canSeePath({ permissions: ['team.view'] }, '/team')).toBe(true);
  });
});
