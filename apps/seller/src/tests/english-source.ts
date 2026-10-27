import { readFileSync } from 'node:fs';
import { CATALOGS } from '@/i18n/catalog';

/**
 * A component's source with every `t('ns.key')` call replaced by the English
 * sentence behind it.
 *
 * Several structural specs pin WORDS that used to sit in the JSX ("Add the
 * missing variants", "we never received"). The words now live in the message
 * catalogue, so a spec that greps the raw file would be asserting the wording
 * of a key name. Reading the source through this keeps those specs about the
 * copy the person actually reads, in English, which is the thing they pin.
 */
function expandCalls(src: string): string {
  let out = '';
  let i = 0;
  const re = /(?<![\w.])t\(\s*'([\w.]+)'/g;
  for (;;) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (m === null) {
      out += src.slice(i);
      return out;
    }
    const key = m[1] as keyof typeof CATALOGS.en;
    const en = CATALOGS.en[key];
    if (en === undefined) {
      out += src.slice(i, m.index + m[0].length);
      i = m.index + m[0].length;
      continue;
    }
    // find the matching ")" of this call
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      j++;
    }
    out += src.slice(i, m.index) + en;
    i = j;
  }
}

/** Whatever is left after the calls are expanded: a key chosen by a ternary, e.g. `n === 1 ? 'a.one' : 'a.many'`. */
function expandKeys(src: string): string {
  return src.replace(/'([A-Za-z][A-Za-z0-9]*\.[A-Za-z0-9.]+)'/g, (whole, key: string) => {
    const en = (CATALOGS.en as Record<string, string>)[key];
    return en === undefined ? whole : `'${en}'`;
  });
}

export function readEnglish(path: string, _encoding?: string): string {
  return expandKeys(expandCalls(readFileSync(path, 'utf8')));
}
