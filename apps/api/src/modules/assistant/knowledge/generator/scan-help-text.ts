import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkText, MIN_HELP_TEXT, parseMessageFile, parseSettingGuide } from './parse';
import { CONSOLES, type Console } from './scan-pages';

export type TextRow = readonly [key: string, text: string];

const MAX_PORTAL_TEXT = 900;

/** The long English strings of one console's own message catalogue (labels are skipped). */
export function scanPortalText(root: string): Record<Console, TextRow[]> {
  const out = {} as Record<Console, TextRow[]>;
  for (const c of CONSOLES) {
    const dir = join(root, 'apps', c, 'src', 'i18n', 'messages');
    const rows: TextRow[] = [];
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.ts')) continue;
      for (const m of parseMessageFile(readFileSync(join(dir, f), 'utf8'))) {
        if (m.en.length < MIN_HELP_TEXT) continue;
        rows.push([m.key, m.en.slice(0, MAX_PORTAL_TEXT)] as const);
      }
    }
    out[c] = rows;
  }
  return out;
}

/** Staff-only: the admin settings guide. */
export function scanSettings(root: string): TextRow[] {
  const file = join(root, 'apps/admin/src/lib/system-setting-guide.ts');
  if (!existsSync(file)) return [];
  return parseSettingGuide(readFileSync(file, 'utf8')).map((g) => [g.key, g.text] as const);
}

/** Staff-only: `docs/invariants/*.md`, chunked. The key is the doc's name. */
export function scanInternalDocs(root: string): TextRow[] {
  const dir = join(root, 'docs/invariants');
  const rows: TextRow[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.md')) continue;
    for (const c of chunkText(readFileSync(join(dir, f), 'utf8'))) {
      rows.push([f.replace(/\.md$/, ''), c] as const);
    }
  }
  return rows;
}
