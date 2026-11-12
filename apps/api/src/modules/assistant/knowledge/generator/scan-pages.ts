import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseMessageFile } from './parse';

export const CONSOLES = ['admin', 'seller', 'reseller', 'associate'] as const;
export type Console = (typeof CONSOLES)[number];

/** [route, title, permission-or-null]. Dynamic segments stay as `[id]`. */
export type PageRow = readonly [route: string, title: string, permission: string | null];

function walkPages(dir: string, prefix: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name.startsWith('_')) continue;
      const seg = /^\(.*\)$/.test(name) ? '' : `/${name}`;
      walkPages(full, prefix + seg, out);
    } else if (name === 'page.tsx') {
      out.push(prefix === '' ? '/' : prefix);
    }
  }
}

/** Does a page-access pattern cover this route? `*` and `[x]` match any one segment. */
function covers(pattern: string, route: string): boolean {
  const pat = pattern.split('/');
  const got = route.split('/');
  if (got.length < pat.length) return false;
  return pat.every((seg, i) => {
    const g = got[i] ?? '';
    return seg === '*' || (seg === g && true) || (g.startsWith('[') && seg === '*');
  });
}

/** The permission a route needs under a console's own `page-access.ts` table. */
export function permissionFor(
  table: ReadonlyArray<readonly [string, string]>,
  route: string,
): string | null {
  let best: readonly [string, string] | null = null;
  for (const entry of table) {
    if (!covers(entry[0], route)) continue;
    const depth = entry[0].split('/').length;
    const bestDepth = best === null ? -1 : best[0].split('/').length;
    if (depth > bestDepth || (depth === bestDepth && entry[0].length > (best?.[0].length ?? 0))) {
      best = entry;
    }
  }
  return best?.[1] ?? null;
}

export function parsePageAccess(src: string): Array<readonly [string, string]> {
  const block = src.slice(src.indexOf('PAGE_PERMISSIONS'));
  const end = block.indexOf('\n];');
  const body = end < 0 ? block : block.slice(0, end);
  const rows: Array<readonly [string, string]> = [];
  for (const m of body.matchAll(/\[\s*'(\/[^']*)',\s*'([A-Za-z0-9_.]+)'\s*\]/g)) {
    rows.push([m[1] ?? '', m[2] ?? ''] as const);
  }
  return rows;
}

/** `href: '/x'` followed by `label: t('some.key')` in the console's shell. */
export function parseNav(src: string): Map<string, string> {
  const nav = new Map<string, string>();
  const hrefs = [...src.matchAll(/href:\s*'(\/[^']*)'/g)];
  hrefs.forEach((h, idx) => {
    const from = (h.index ?? 0) + h[0].length;
    const to = hrefs[idx + 1]?.index ?? Math.min(src.length, from + 400);
    const label = /label:\s*t\('([^']+)'\)/.exec(src.slice(from, to));
    if (label !== null && !nav.has(h[1] ?? '')) nav.set(h[1] ?? '', label[1] ?? '');
  });
  return nav;
}

function humanize(seg: string): string {
  const s = seg.replace(/-/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function scanPages(root: string): Record<Console, PageRow[]> {
  const result = {} as Record<Console, PageRow[]>;
  for (const c of CONSOLES) {
    const app = join(root, 'apps', c);
    const routes: string[] = [];
    const authed = join(app, 'src', 'app', '(authed)');
    if (existsSync(authed)) walkPages(authed, '', routes);

    const table = parsePageAccess(readFileSync(join(app, 'src', 'lib', 'page-access.ts'), 'utf8'));
    const english = new Map<string, string>();
    const msgDir = join(app, 'src', 'i18n', 'messages');
    for (const f of readdirSync(msgDir).sort()) {
      if (!f.endsWith('.ts')) continue;
      for (const m of parseMessageFile(readFileSync(join(msgDir, f), 'utf8'))) {
        if (!english.has(m.key)) english.set(m.key, m.en);
      }
    }
    const shell = join(app, 'src', 'app', '(authed)', '_components', 'authed-shell.tsx');
    const nav = existsSync(shell) ? parseNav(readFileSync(shell, 'utf8')) : new Map();
    const navTitle = (route: string): string | null => {
      const key = nav.get(route);
      return key === undefined ? null : (english.get(key) ?? null);
    };

    const titleOf = (route: string): string => {
      const direct = navTitle(route);
      if (direct !== null) return direct;
      const segs = route.split('/').filter(Boolean);
      const last = segs[segs.length - 1] ?? '';
      const dynamic = last.startsWith('[');
      const staticSegs = segs.filter((s) => !s.startsWith('['));
      const parentRoute = `/${staticSegs.slice(0, dynamic ? staticSegs.length : -1).join('/')}`;
      const parent = staticSegs.length > 0 ? navTitle(parentRoute) : null;
      if (dynamic)
        return `${parent ?? humanize(staticSegs[staticSegs.length - 1] ?? 'Page')} (detail)`;
      if (segs.length === 0) return 'Home';
      const own = humanize(last);
      return parent === null ? own : `${parent} · ${own}`;
    };

    result[c] = routes
      .sort()
      .map((route) => [route, titleOf(route), permissionFor(table, route)] as const);
  }
  return result;
}
