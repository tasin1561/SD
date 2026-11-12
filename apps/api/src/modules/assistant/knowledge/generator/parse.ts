/**
 * Pure text parsers shared by the knowledge generators and the help
 * service. NO filesystem access here: this file is imported at runtime
 * (from `dist`), where the repository checkout does not exist.
 */

const MIN_TEXT = 40;
const CHUNK = 700;

/** Reads one quoted literal starting at `from` (after whitespace). Null if there is none. */
export function readStringLiteral(
  src: string,
  from: number,
): { value: string; end: number } | null {
  let i = from;
  while (i < src.length && /\s/.test(src[i] ?? '')) i++;
  const quote = src[i];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  i++;
  let out = '';
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (ch === '\\') {
      const next = src[i + 1] ?? '';
      if (next === 'n') out += '\n';
      else if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
        out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
        i += 4;
      } else out += next;
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && src[i + 1] === '{') return null;
    if (ch === quote) return { value: out, end: i + 1 };
    out += ch;
    i++;
  }
  return null;
}

/** `'key': ['english', 'bangla']` entries of a defineMessages() file. */
export function parseMessageFile(src: string): Array<{ key: string; en: string; bn: string }> {
  const out: Array<{ key: string; en: string; bn: string }> = [];
  const re = /'([A-Za-z0-9_.-]+)':\s*\[/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const en = readStringLiteral(src, re.lastIndex);
    if (en === null) continue;
    let j = en.end;
    while (j < src.length && /[\s,]/.test(src[j] ?? '')) j++;
    const bn = readStringLiteral(src, j);
    if (bn === null) continue;
    out.push({ key: m[1] ?? '', en: en.value, bn: bn.value });
  }
  return out;
}

/** `'setting.key': { name, what, example }` entries of the settings guide. */
export function parseSettingGuide(src: string): Array<{ key: string; text: string }> {
  const out: Array<{ key: string; text: string }> = [];
  const re = /^ {2}'([a-z0-9_.]+)': \{\n/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const end = src.indexOf('\n  },', re.lastIndex);
    if (end < 0) continue;
    const body = src.slice(re.lastIndex, end);
    const parts: string[] = [];
    for (const field of ['name', 'what', 'example']) {
      const at = body.search(new RegExp(`\\n? {4}${field}:`));
      if (at < 0) continue;
      const lit = readStringLiteral(body, body.indexOf(':', at) + 1);
      if (lit !== null) parts.push(lit.value);
    }
    if (parts.length > 0) out.push({ key: m[1] ?? '', text: parts.join(' — ') });
  }
  return out;
}

/** Paragraph-aware chunks of at most ~700 characters (markdown prose). */
export function chunkText(text: string): string[] {
  const pieces: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.replace(/\s+/g, ' ').trim();
    if (p.length < MIN_TEXT) continue;
    if (p.length <= CHUNK) {
      pieces.push(p);
      continue;
    }
    let cur = '';
    for (const sentence of p.split(/(?<=[.!?])\s+/)) {
      if (cur.length + sentence.length > CHUNK && cur.length > 0) {
        pieces.push(cur);
        cur = '';
      }
      cur += (cur ? ' ' : '') + sentence;
    }
    if (cur.length >= MIN_TEXT) pieces.push(cur);
  }
  return pieces;
}

const STOP = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'to',
  'of',
  'in',
  'on',
  'for',
  'and',
  'or',
  'how',
  'do',
  'i',
  'my',
  'what',
  'can',
  'me',
  'it',
  'this',
  'that',
  'with',
  'be',
  'you',
  'your',
  'does',
]);

export function tokenize(q: string): string[] {
  return [...q.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)]
    .map((m) => m[0])
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export const MIN_HELP_TEXT = MIN_TEXT;
