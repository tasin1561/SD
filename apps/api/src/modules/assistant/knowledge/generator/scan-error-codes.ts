import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * [code, domains, message-or-null], sorted by code. `domains` are the module
 * folders that throw it, sorted and comma-joined (a code can be thrown from
 * several modules).
 */
export type ErrorCodeRow = readonly [code: string, domains: string, message: string | null];

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

/** End index (exclusive) of the `${ ... }` that opens at `i` (pointing at `$`). */
function skipInterpolation(src: string, i: number): number {
  let depth = 0;
  let j = i + 1; // at '{'
  for (; j < src.length; j++) {
    const ch = src[j] ?? '';
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return j + 1;
    } else if (ch === "'" || ch === '"') {
      const q = ch;
      j++;
      while (j < src.length && src[j] !== q) j += src[j] === '\\' ? 2 : 1;
    } else if (ch === '`') {
      j = skipTemplate(src, j) - 1;
    }
  }
  return j;
}

/** End index (exclusive) of the template literal opening at `i` (a backtick). */
function skipTemplate(src: string, i: number): number {
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j] ?? '';
    if (ch === '\\') j += 2;
    else if (ch === '$' && src[j + 1] === '{') j = skipInterpolation(src, j);
    else if (ch === '`') return j + 1;
    else j++;
  }
  return j;
}

/** One string-ish operand: a literal (placeholders kept as `{…}`) or null if it is code. */
function readOperand(src: string, from: number): { text: string; end: number } | null {
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
      out += next === 'n' ? ' ' : next;
      i += 2;
      continue;
    }
    if (quote === '`' && ch === '$' && src[i + 1] === '{') {
      out += '{…}';
      i = skipInterpolation(src, i);
      continue;
    }
    if (ch === quote) return { text: out, end: i + 1 };
    out += ch;
    i++;
  }
  return null;
}

/** Skips a non-literal operand up to the next top-level `,` `+` or closing bracket. */
function skipCode(src: string, from: number): number {
  let depth = 0;
  let i = from;
  while (i < src.length) {
    const ch = src[i] ?? '';
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) {
      if (depth === 0) return i;
      depth--;
    } else if ((ch === ',' || ch === '+') && depth === 0) return i;
    else if (ch === "'" || ch === '"') {
      i++;
      while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1;
    } else if (ch === '`') {
      i = skipTemplate(src, i) - 1;
    }
    i++;
  }
  return i;
}

/** `'a' + \`b ${x}\` + c` after a `message:` key → "a b {…}{…}", or null if it starts as code. */
export function readMessageExpr(src: string, from: number): string | null {
  const first = readOperand(src, from);
  if (first === null) return null;
  let text = first.text;
  let i = first.end;
  for (;;) {
    while (i < src.length && /\s/.test(src[i] ?? '')) i++;
    if (src[i] !== '+') break;
    i++;
    const next = readOperand(src, i);
    if (next !== null) {
      text += next.text;
      i = next.end;
    } else {
      text += '{…}';
      i = skipCode(src, i);
    }
  }
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length === 0 ? null : cleaned;
}

/** The text of the `message:` key in the object that holds the code at `at`, or null. */
function messageNear(src: string, at: number): string | null {
  // Walk back to the unmatched '{' that opens this object (naive count is enough here).
  let depth = 0;
  let start = -1;
  for (let i = at; i >= Math.max(0, at - 500); i--) {
    const ch = src[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  const from = start < 0 ? at : start;
  const window = src.slice(from, at + 900);
  const m = /\bmessage:\s*/.exec(window);
  if (m === null) return null;
  return readMessageExpr(window, m.index + m[0].length);
}

export function scanErrorCodes(apiSrcDir: string): ErrorCodeRow[] {
  const files: string[] = [];
  walk(apiSrcDir, files);
  const byCode = new Map<string, { domains: Set<string>; message: string | null }>();
  for (const file of files) {
    const rel = relative(apiSrcDir, file).split(/[\\/]/);
    const domain =
      rel[0] === 'modules' && rel.length > 2
        ? (rel[1] ?? 'common')
        : rel.length > 1
          ? (rel[0] ?? 'common')
          : 'common';
    const src = readFileSync(file, 'utf8');
    const re = /code: '([A-Z][A-Z0-9_]+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const code = m[1] ?? '';
      const message = messageNear(src, m.index);
      const prev = byCode.get(code);
      if (prev === undefined) byCode.set(code, { domains: new Set([domain]), message });
      else {
        prev.domains.add(domain);
        if (prev.message === null && message !== null) prev.message = message;
      }
    }
  }
  return [...byCode.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, v]) => [code, [...v.domains].sort().join(','), v.message] as const);
}
