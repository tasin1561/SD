import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every reseller page has a way in — the seller and admin apps' guard,
 * for the third frontend. A page nothing links to is indistinguishable
 * from one never shipped.
 */
const APP = join(__dirname, '../app/(authed)');
const SRC = join(__dirname, '..');

function routes(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory() || entry.startsWith('_')) continue;
    const path = `${prefix}${entry.startsWith('(') ? '' : `/${entry}`}`;
    if (readdirSync(full).includes('page.tsx') && path !== '') out.push(path);
    out.push(...routes(full, path));
  }
  return out;
}

function sources(dir: string, skip: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full !== skip) out.push(...sources(full, skip));
    } else if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) {
      out.push(readFileSync(full, 'utf8'));
    }
  }
  return out;
}

describe('every reseller page can be reached from another page', () => {
  const all = routes(APP).filter((r) => !r.includes('['));

  it('found the routes (the walker still works)', () => {
    expect(all.length).toBeGreaterThanOrEqual(4);
  });

  it.each(all)('%s is linked from somewhere', (route) => {
    const text = sources(SRC, join(APP, ...route.split('/').filter(Boolean))).join('\n');
    expect(text.includes(`'${route}'`) || text.includes(`"${route}"`)).toBe(true);
  });
});
