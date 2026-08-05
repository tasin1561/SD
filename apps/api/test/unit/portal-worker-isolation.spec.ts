import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The browser never runs inside the API process.
 *
 * ── WHY THIS IS A TEST AND NOT A CONVENTION ──────────────────────────
 * The prerequisite for Phase 5 existing at all is that a long-lived
 * Chromium does not live in the process serving customer HTTP: it holds a
 * decrypted portal login for the life of the process, it is the heaviest
 * thing in the system by memory, and a crash in it must not take the API
 * down.
 *
 * That isolation is invisible in the source. Adding
 * `CourierPortalModule` to `AppModule`'s imports to "expose a trigger
 * endpoint" would compile, boot, pass every other test — and quietly put
 * a browser in the API. Nothing would fail until production ran out of
 * memory or a portal credential appeared in an API heap dump.
 *
 * So the wiring is asserted directly.
 */

const SRC = join(__dirname, '../../src');

/** Every import specifier in a file, however it was written. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  return [...src.matchAll(/from\s+'([^']+)'|import\s*\(\s*'([^']+)'/g)].map(
    (m) => m[1] ?? m[2] ?? '',
  );
}

/** Resolve a relative specifier to a .ts path, or null if it is a package. */
function resolveLocal(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(fromFile, '..', spec);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * Everything AppModule can reach, transitively.
 *
 * Walks the real import graph rather than checking AppModule's own file:
 * the dangerous version of this mistake is indirect — a module already in
 * AppModule importing the portal module three hops down.
 */
function appModuleReachable(): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [join(SRC, 'app.module.ts')];

  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of importsOf(file)) {
      const local = resolveLocal(file, spec);
      if (local === null) {
        if (spec !== '') packages.add(spec);
        continue;
      }
      if (!files.has(local)) queue.push(local);
    }
  }
  return { files, packages };
}

describe('the portal worker is isolated from the API process', () => {
  const { files, packages } = appModuleReachable();

  it('walked a real graph — not an empty one', () => {
    // A resolver bug would make every assertion below vacuously true.
    expect(files.size).toBeGreaterThan(200);
  });

  it('AppModule cannot reach CourierPortalModule', () => {
    const reachable = [...files].filter((f) => f.includes('courier-portal'));
    expect(reachable).toEqual([]);
  });

  it('AppModule never pulls in playwright', () => {
    // The load-bearing assertion: the API process must not so much as
    // require the package, let alone launch a browser.
    const pw = [...packages].filter((p) => p === 'playwright' || p.startsWith('playwright/'));
    expect(pw).toEqual([]);
  });

  it('the portal entry point exists and is separate from workers-main', () => {
    // workers-main boots the whole AppModule; the portal must not, or it
    // would run every other cron a second time (SCALE-1).
    const portalMain = readFileSync(join(SRC, 'portal-worker-main.ts'), 'utf8');
    expect(portalMain).toContain('CourierPortalModule');
    // Assert on the IMPORT, not the word: the file mentions AppModule in
    // a comment explaining why it deliberately does not use it, and a
    // substring check on the name failed on its own documentation.
    expect(importsOf(join(SRC, 'portal-worker-main.ts'))).not.toContain('./app.module');
  });

  it('nothing outside courier-portal imports the portal module', () => {
    // Catches the indirect version: a controller elsewhere importing a
    // portal service directly, which would drag the module in with it.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;
        if (full.includes('courier-portal')) continue;
        if (full.endsWith('portal-worker-main.ts')) continue;
        if (importsOf(full).some((s) => s.includes('courier-portal'))) offenders.push(full);
      }
    };
    walk(join(SRC, 'modules'));
    expect(offenders).toEqual([]);
  });
});
