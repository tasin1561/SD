import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A structural check, because the failure it catches is invisible to
 * types and to every component test.
 *
 * `ApiClient.request` JSON-stringifies `init.body` itself. Pass it a
 * string and the request carries a JSON document containing a JSON
 * string — the server answers 400 "Unexpected token", and nothing in
 * TypeScript objects, because `body` is typed `unknown`.
 *
 * It shipped exactly that way: the wallet's automatic-withdrawal switch
 * reached production and could not be turned on.
 *
 * Raw `fetch` calls are the opposite — they MUST stringify — so this
 * only looks at calls going through the client.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('no hook pre-stringifies a body for ApiClient', () => {
  it('client.request() is never handed an already-encoded body', () => {
    const offenders: string[] = [];
    for (const file of walk(join(__dirname, '..'))) {
      const src = readFileSync(file, 'utf8');
      if (!src.includes('client.request')) continue;
      // Only within a client.request(...) call — a raw fetch elsewhere in
      // the same file is legitimate.
      for (const call of src.match(/client\.request[\s\S]{0,400}?\)\s*[,;)]/g) ?? []) {
        if (/body:\s*JSON\.stringify/.test(call)) {
          offenders.push(file.replace(/.*\/src\//, 'src/'));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
