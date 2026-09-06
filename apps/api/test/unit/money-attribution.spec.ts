import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Every money record says WHO and WHEN.
 *
 * ── WHAT "AUDITABLE" HAS TO MEAN ─────────────────────────────────────
 * A ledger that records an amount and a timestamp is not auditable; it
 * is a list. The question asked afterwards is always "who did this, and
 * why", and it is asked when somebody is unhappy — a seller disputing a
 * charge, an accountant reconciling a quarter, or us working out whether
 * a payment went twice.
 *
 * `seller_wallet_entries` had this from the start: `actorType`,
 * `actorId`, `createdAt`, a note and a reason code, append-only.
 * `bank_entries` did NOT: it carried only `createdByStaffId`, and a null
 * there meant either "the system posted it" or "nobody knows". Ten of
 * the first eighteen production rows were null with nothing to separate
 * them. `actorType` closes that.
 *
 * ── STRUCTURAL, BECAUSE THE FAILURE IS AN ABSENCE ────────────────────
 * A missing note or a missing actor does not throw. Nothing fails, the
 * money is right, and the gap is only discovered by somebody trying to
 * answer a question months later — which is exactly when it cannot be
 * filled in. So the check reads the sources.
 */
const API = resolve(__dirname, '../..');

describe('the two money ledgers are attributable', () => {
  const schema = readFileSync(resolve(API, '../../packages/db/prisma/schema.prisma'), 'utf8');

  const model = (name: string): string => {
    const m = new RegExp(`^model ${name} \\{[\\s\\S]*?^\\}`, 'm').exec(schema);
    if (m === null) throw new Error(`no model ${name}`);
    return m[0];
  };

  it('a wallet entry records who, when, and why', () => {
    const m = model('SellerWalletEntry');
    for (const field of ['actorType', 'actorId', 'createdAt', 'note', 'reasonCode']) {
      expect(m).toContain(field);
    }
  });

  it('a bank entry records who — not merely which staff member, if any', () => {
    // The regression this closes: `createdByStaffId` alone cannot
    // distinguish "the system did it" from "we do not know".
    const m = model('BankEntry');
    for (const field of ['actorType', 'createdByStaffId', 'createdAt', 'occurredAt', 'note']) {
      expect(m).toContain(field);
    }
  });

  it('neither ledger can be edited or erased', () => {
    // Append-only is what makes the attribution worth anything: an
    // actor stamped on a row somebody can later rewrite proves nothing.
    for (const name of ['SellerWalletEntry', 'BankEntry']) {
      const m = model(name);
      expect(m).not.toContain('updatedAt');
      expect(m).not.toContain('deletedAt');
    }
  });

  it('nothing writes either ledger except its sole writer', () => {
    const offenders = globSync('src/modules/**/*.ts', { cwd: API }).filter((f) => {
      if (/wallet\.service\.ts$|bank-ledger\.service\.ts$/.test(f)) return false;
      const src = readFileSync(join(API, f), 'utf8');
      return /(sellerWalletEntry|bankEntry)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/.test(
        src,
      );
    });
    // WAL-1 and TRE-1. A second writer is how an entry appears with no
    // running balance, no actor, or no lock held.
    expect(offenders).toEqual([]);
  });
});
