import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Pending invitations" means pending.
 *
 * ── THE BUG ──────────────────────────────────────────────────────────
 * Both invitation lists returned every row that was not soft-deleted,
 * under a heading that said "Pending invitations". So an accepted
 * invitation stayed on the screen forever, and the staff page showed one
 * person twice: an active Call agent in the table above, and an
 * outstanding SUPER_ADMIN invitation below — because the role had been
 * changed after the invite was accepted. The screen could not explain
 * itself, and the honest reading of it was wrong.
 *
 * ── WHY A SOURCE TEST ────────────────────────────────────────────────
 * A behavioural test would need a used invitation, an unused one and an
 * expired one in a real database, which is an e2e. What actually goes
 * wrong here is a missing clause in one `where`, and that is visible in
 * the source: the filter either says `usedAt: null` or it does not.
 *
 * ── WHAT MUST NOT BE ADDED ───────────────────────────────────────────
 * `expiresAt` is deliberately NOT filtered. An invitation nobody
 * accepted in time still needs a decision — resend it or revoke it —
 * and hiding it is how a colleague waits a week for a link that was
 * never going to work.
 */

const CASES = [
  {
    what: 'staff invitations',
    file: 'src/modules/staff-invitation/services/staff-invitation.service.ts',
    method: 'async list()',
  },
  {
    what: 'seller team invitations',
    file: 'src/modules/seller-team/services/seller-team.service.ts',
    method: 'async listInvitations(',
  },
];

describe('invitation lists show only what is still pending', () => {
  for (const c of CASES) {
    it(`${c.what}: the query excludes accepted ones`, () => {
      const src = readFileSync(join(__dirname, '../..', c.file), 'utf8');
      const at = src.indexOf(c.method);
      // -1 here means the method was renamed and this test is watching nothing.
      expect(at).toBeGreaterThan(-1);

      // The findMany immediately inside the method.
      const body = src.slice(at, at + 900);
      const where = /where: \{([^}]*)\}/.exec(body)?.[1];
      expect(where).toBeDefined();
      expect(where).toContain('usedAt: null');
    });

    it(`${c.what}: an expired invitation is still listed`, () => {
      // Filtering on expiry would hide the rows that most need acting on.
      const src = readFileSync(join(__dirname, '../..', c.file), 'utf8');
      const at = src.indexOf(c.method);
      const where = /where: \{([^}]*)\}/.exec(src.slice(at, at + 900))?.[1] ?? '';
      expect(where).not.toContain('expiresAt');
    });
  }
});
