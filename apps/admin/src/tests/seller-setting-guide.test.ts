import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SELLER_SETTING_GUIDE,
  SETTING_GROUP_ORDER,
  fallbackSettingName,
} from '@/lib/seller-setting-guide';

/**
 * Every seller-overridable key gets a plain-English name, and the guide
 * names no key the seed does not mark overridable. Read from the seed
 * rather than the API: it is the declaration every environment is built
 * from, and a key added there without words would otherwise reach the
 * seller page as a bare code.
 */
const here = dirname(fileURLToPath(import.meta.url));
const seed = readFileSync(join(here, '../../../../packages/db/prisma/seed.ts'), 'utf8');

function overridableKeys(): string[] {
  const lines = seed.split('\n');
  const keys: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes('sellerOverridable: true')) return;
    for (let j = i; j >= Math.max(0, i - 60); j--) {
      const m = /key:\s*'([^']+)'/.exec(lines[j] ?? '');
      if (m?.[1] !== undefined) {
        keys.push(m[1]);
        return;
      }
    }
  });
  return keys;
}

describe('seller setting guide', () => {
  const keys = overridableKeys();

  it('finds the overridable keys in the seed', () => {
    expect(keys.length).toBeGreaterThan(30);
  });

  it('names every seller-overridable key', () => {
    expect(keys.filter((k) => SELLER_SETTING_GUIDE[k] === undefined)).toEqual([]);
  });

  it('names no key the seed does not mark overridable', () => {
    const known = new Set(keys);
    expect(Object.keys(SELLER_SETTING_GUIDE).filter((k) => !known.has(k))).toEqual([]);
  });

  it('gives every entry a known group, an explanation and an example', () => {
    for (const [key, g] of Object.entries(SELLER_SETTING_GUIDE)) {
      expect(SETTING_GROUP_ORDER, key).toContain(g.group);
      expect(g.name.length, key).toBeGreaterThan(3);
      expect(g.what.length, key).toBeGreaterThan(20);
      expect(g.example.length, key).toBeGreaterThan(20);
    }
  });

  it('falls back to a readable name for an unknown key', () => {
    expect(fallbackSettingName('wallet.some_new_limit_inr')).toBe('Some new limit inr');
  });
});
