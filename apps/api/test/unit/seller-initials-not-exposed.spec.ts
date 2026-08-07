import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `initials` must never reach a seller.
 *
 * The requirement is explicit — staff set it, sellers cannot see or
 * change it — and the reason is not privacy but stability: the code goes
 * on totes and manifests, so a seller renaming it invalidates paperwork
 * that already exists in the physical world.
 *
 * A behavioural test cannot prove this. It could only assert that the
 * endpoints which exist today do not return the field, and the way this
 * breaks is somebody adding `initials: true` to a seller-facing `select`
 * next month, or writing a new seller endpoint that spreads the whole
 * row. So this reads the SOURCE, in the same idiom as
 * `worker-role.spec.ts` — the structural properties in this codebase are
 * pinned by tests that look at files rather than at behaviour.
 */

const SRC = join(__dirname, '../../src/modules');

/** Modules whose HTTP surface is authenticated as a SELLER. */
const SELLER_FACING = [
  'seller-auth',
  'seller-profile',
  'seller-team',
  'seller-wallet-withdrawal',
  'seller-wallet-accrual',
];

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

describe('seller initials are staff-only, structurally', () => {
  it('no seller-facing module selects or returns the column', () => {
    const offenders: string[] = [];

    for (const mod of SELLER_FACING) {
      const dir = join(SRC, mod);
      let files: string[];
      try {
        files = filesUnder(dir);
      } catch {
        continue; // module renamed or removed — not this test's business
      }
      for (const file of files) {
        const src = readFileSync(file, 'utf8');
        // The generator lives in seller-auth and is allowed to name it;
        // what is forbidden is putting it in a Prisma select or a
        // response object.
        if (file.includes('seller-initials')) continue;
        const lines = src.split('\n');
        lines.forEach((line, i) => {
          const isSelect = /\binitials\s*:\s*true\b/.test(line);
          const isReturned = /\binitials\s*:\s*(seller|s)\./.test(line);
          if (isSelect || isReturned) {
            offenders.push(`${file.replace(SRC, '')}:${i + 1} → ${line.trim()}`);
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('only staff routes expose it, and the write is permission-gated', () => {
    const controller = readFileSync(join(SRC, 'admin-seller/admin-seller.controller.ts'), 'utf8');
    // The rename exists…
    expect(controller).toMatch(/@Patch\('.*:id\/initials'\)/);
    // …and is not reachable without a staff permission.
    const idx = controller.indexOf("':id/initials'");
    const window = controller.slice(idx, idx + 400);
    expect(window).toMatch(/@RequirePermissions\(/);
  });

  it('the seller /me projection is an allow-list, which is what makes the above hold', () => {
    // If /me ever switches from an explicit select to returning the row,
    // this test's premise dies quietly. Pin the shape it depends on.
    const svc = readFileSync(join(SRC, 'seller-auth/seller-auth.service.ts'), 'utf8');
    const sellerSelect = svc.slice(svc.indexOf('        seller: {'));
    expect(sellerSelect).toMatch(/select: \{/);
    expect(sellerSelect.slice(0, 600)).not.toMatch(/\binitials\b/);
  });
});
