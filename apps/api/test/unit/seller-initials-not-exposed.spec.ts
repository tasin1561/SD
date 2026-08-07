import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A seller may READ their code in exactly one place, and may never
 * WRITE it.
 *
 * The original rule was "cannot see or change". The read half was
 * relaxed deliberately when the code became a visible prefix on the
 * recipient name — shown on the order form the way +91 is shown on the
 * phone field — which only works if the seller app can read it. So
 * `/auth/seller/me` returns it, and nothing else does.
 *
 * The WRITE half is unchanged and is the half that matters: the code
 * goes on totes, manifests and waybills, so a seller renaming it
 * invalidates paperwork that already exists in the physical world.
 * Staff move it, with an audit row.
 *
 * A behavioural test cannot pin this. It could only assert that today's
 * endpoints behave; the way it breaks is somebody adding `initials` to
 * another seller-facing select next month. So this reads the SOURCE, in
 * the same idiom as `worker-role.spec.ts`.
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

/**
 * The one sanctioned read. Anything else that starts selecting the
 * column into a seller response has to be added here CONSCIOUSLY, which
 * is the entire point of the list.
 */
const ALLOWED_READS = ['seller-auth/seller-auth.service.ts'];

describe('seller initials are read-once, write-never, structurally', () => {
  it('only the sanctioned file selects or returns the column', () => {
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
        const rel = file.replace(`${SRC}/`, '');
        // The generator is allowed to name it; what is governed is
        // putting it in a Prisma select or a response object.
        if (rel.includes('seller-initials')) continue;
        if (ALLOWED_READS.includes(rel)) continue;
        const src = readFileSync(file, 'utf8');
        src.split('\n').forEach((line, i) => {
          const isSelect = /\binitials\s*:\s*true\b/.test(line);
          const isReturned = /\binitials\s*:\s*(seller|s|user)\./.test(line);
          if (isSelect || isReturned) {
            offenders.push(`${rel}:${i + 1} → ${line.trim()}`);
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });

  it('no seller-facing CONTROLLER mentions the column at all', () => {
    // The threat is a seller ENDPOINT that changes the code — the write
    // half of the original rule, and the half that still stands. Aimed
    // at controllers rather than services on purpose: seller-auth's
    // service legitimately writes it ONCE, at registration, where it is
    // generated rather than chosen. A route is the only way a seller
    // reaches it, so a route is what must stay clean. Staff have their
    // own path in admin-seller, which this does not scan.
    const offenders: string[] = [];
    for (const mod of SELLER_FACING) {
      let files: string[];
      try {
        files = filesUnder(join(SRC, mod));
      } catch {
        continue;
      }
      for (const file of files.filter((f) => f.endsWith('.controller.ts'))) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/\binitials\b/.test(line)) {
              offenders.push(`${file.replace(`${SRC}/`, '')}:${i + 1} → ${line.trim()}`);
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
    // If /me ever switches from an explicit select to spreading the row,
    // the scan above stops meaning anything. Pin the shape it depends on.
    const svc = readFileSync(join(SRC, 'seller-auth/seller-auth.service.ts'), 'utf8');
    const sellerSelect = svc.slice(svc.indexOf('        seller: {'));
    expect(sellerSelect).toMatch(/select: \{/);
    // It DOES carry initials now, deliberately — that is the one read.
    expect(sellerSelect).toMatch(/\binitials: true\b/);
  });
});
