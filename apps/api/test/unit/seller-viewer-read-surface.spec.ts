/**
 * WHICH controllers a VIEWER may read from.
 *
 * RBAC-1 makes VIEWER's reads an ALLOW-LIST: a controller is invisible
 * to the role until someone puts `@SellerViewerReadable()` on it. That
 * narrowing was a real fix, not housekeeping — "read-only" had meant
 * read-EVERYTHING, and the lowest-privilege seller login could pull the
 * wallet ledger, the profile's bank details, the team list, API keys and
 * the whole catalogue.
 *
 * The failure mode this spec exists for is SILENT: a new GET on an
 * already-opted-in controller joins the VIEWER surface by inheritance,
 * and nobody decides. `customer-lookup` did exactly that — a lookup TOOL
 * answering questions about arbitrary phone numbers, reachable by the
 * narrowest login there is, because it happened to be a GET on the
 * orders controller.
 *
 * So the readable GETs are pinned BY NAME. Adding one fails here until
 * someone writes it down, which is the point: the decision should cost a
 * line in this file, not nothing.
 *
 * (CLAUDE.md described this spec for some time before it existed. It
 * does now.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MODULES = join(__dirname, '../../src/modules');

function everyControllerSource(): Array<{ file: string; src: string }> {
  const out: Array<{ file: string; src: string }> = [];
  for (const mod of readdirSync(MODULES, { withFileTypes: true })) {
    if (!mod.isDirectory()) continue;
    const dir = join(MODULES, mod.name, 'controllers');
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.controller.ts')) continue;
      out.push({ file: n, src: readFileSync(join(dir, n), 'utf8') });
    }
  }
  return out;
}

/** Controllers a VIEWER may read from, and why each one is defensible. */
const OPTED_IN: Readonly<Record<string, string>> = {
  'seller-order.controller.ts': 'their own orders — the role exists to read these',
  'seller-tracking.controller.ts':
    'where those same parcels are; the nav already shows Tracking on orders.view, so refusing it would be a link to a 403',
};

/** GETs that opt-in reaches, listed so a new one is a decision. */
const READABLE_GETS: Readonly<Record<string, readonly string[]>> = {
  'seller-order.controller.ts': ['', ':id', ':id/events'],
  'seller-tracking.controller.ts': ['', 'order/:orderId', ':shipmentId'],
};

/**
 * GETs on an opted-in controller that a VIEWER may NOT make.
 *
 * Narrowed with a handler-level `@SellerRoles`, which wins over the
 * class opt-in. Listed here so removing that decorator is not silent.
 */
const NARROWED: Readonly<Record<string, readonly string[]>> = {
  'seller-order.controller.ts': ['customer-lookup'],
};

/**
 * Routes DECLARED, not routes mentioned.
 *
 * Comments are stripped first: seller-order carries a note reading "MUST
 * stay above @Get(':id')", and counting that would report a route twice.
 * Stripping rather than de-duplicating, because a genuinely duplicated
 * route is a real bug this should still surface.
 */
function getPaths(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...code.matchAll(/@Get\((?:'([^']*)')?\)/g)].map((m) => m[1] ?? '');
}

describe('the VIEWER read surface', () => {
  const controllers = everyControllerSource();

  it('only the controllers listed here are opted in', () => {
    const found = controllers
      .filter((c) => c.src.includes('@SellerViewerReadable()'))
      .map((c) => c.file)
      .sort();
    expect(found).toEqual(Object.keys(OPTED_IN).sort());
  });

  it('each opted-in controller opens exactly the GETs listed', () => {
    for (const [file, expected] of Object.entries(READABLE_GETS)) {
      const c = controllers.find((x) => x.file === file);
      expect(c).toBeDefined();
      const narrowed = NARROWED[file] ?? [];
      const open = getPaths(c?.src ?? '').filter((p) => !narrowed.includes(p));
      expect(open.sort()).toEqual([...expected].sort());
    }
  });

  it('the narrowed GETs still carry a handler-level @SellerRoles', () => {
    // Guard rule 1 — a handler-level list wins over the class opt-in.
    // Without it, customer-lookup silently rejoins the surface.
    for (const [file, paths] of Object.entries(NARROWED)) {
      const src = controllers.find((x) => x.file === file)?.src ?? '';
      for (const p of paths) {
        const at = src.indexOf(`@Get('${p}')`);
        expect(at).toBeGreaterThan(-1);
        // Within the decorator block that follows the route.
        expect(src.slice(at, at + 700)).toContain('@SellerRoles');
      }
    }
  });
});
