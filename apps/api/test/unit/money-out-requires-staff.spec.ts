import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Nothing pays a seller without a human deciding twice.
 *
 * The automation added around withdrawals removes COPYING — a
 * remittance id no longer has to be pasted between two screens — and
 * must never remove DECIDING. This pins the shape of that, because the
 * dangerous version of every convenience here looks like a small
 * refactor: a cron that approves "obviously fine" requests, a seller
 * endpoint that records its own payment, a bank-details PATCH that
 * writes the live column.
 *
 * Structural, because the property is about which code paths EXIST.
 * A behavioural test passes just as happily on a system with a second,
 * unguarded door.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}
const SRC = walk(join(__dirname, '../../src'));
const read = (p: string): string => readFileSync(p, 'utf8');

describe('money leaving the platform needs staff, twice', () => {
  it('a remittance can be created from exactly ONE endpoint, and it is staff-guarded', () => {
    const callers = SRC.filter((f) => /\bsvc\.create\(body/.test(read(f)) && /remittance/i.test(f));
    expect(callers).toHaveLength(1);
    const controller = read(callers[0] as string);
    expect(controller).toContain("@RequirePermissions('money.remittances.manage')");
    expect(controller).toContain('StaffJwtGuard');
  });

  it('no scheduler, worker or listener creates a remittance', () => {
    // A cron with the power to pay is the whole risk in one line.
    const automated = SRC.filter((f) => /\.(worker|queue|sweep|cron|listener)\.ts$/.test(f));
    for (const f of automated) {
      expect(read(f)).not.toMatch(/RemittanceService|remittance\.create/);
    }
  });

  it('the auto-withdrawal sweep raises a REQUEST and cannot approve or pay it', () => {
    const sweep = read(
      join(
        __dirname,
        '../../src/modules/seller-wallet-withdrawal/services/auto-withdrawal-sweep.service.ts',
      ),
    );
    expect(sweep).toContain('createAuto');
    // Both would turn an automatic request into automatic money.
    expect(sweep).not.toMatch(/\.approve\(/);
    expect(sweep).not.toMatch(/markPaid/);
  });

  it('paying a request requires it to have been approved first', () => {
    const svc = read(
      join(
        __dirname,
        '../../src/modules/seller-wallet-withdrawal/services/withdrawal-request.service.ts',
      ),
    );
    // Approval is where the balance is re-checked against what is about
    // to be sent; skipping it pays on a figure that may have moved.
    expect(svc).toContain('WITHDRAWAL_REQUEST_NOT_APPROVED');
    expect(svc).toMatch(/status !== WithdrawalRequestStatus\.APPROVED/);
  });

  it('approving re-reads the balance rather than trusting the request', () => {
    const svc = read(
      join(
        __dirname,
        '../../src/modules/seller-wallet-withdrawal/services/withdrawal-request.service.ts',
      ),
    );
    expect(svc).toContain('WITHDRAWAL_BALANCE_NO_LONGER_COVERS');
  });

  it('a seller changing bank details does NOT move the live account', () => {
    // The fraud path this closes: change the payout account, then
    // withdraw. The live columns stay until staff approve, so money
    // keeps going where it was already going.
    const profile = read(
      join(__dirname, '../../src/modules/seller-profile/services/seller-profile.service.ts'),
    );
    expect(profile).toContain('Deliberately NO seller.update');
    const bankChange = read(
      join(__dirname, '../../src/modules/seller-bank-change/services/bank-change.service.ts'),
    );
    expect(bankChange).toMatch(/async approve\(/);
  });

  it('the auto-link closes a request but never creates money', () => {
    const remittance = read(
      join(__dirname, '../../src/modules/admin-remittance/services/remittance.service.ts'),
    );
    // It marks an existing request paid against a remittance that has
    // already committed. It must not write a wallet entry of its own.
    const fn = remittance.slice(remittance.indexOf('closeMatchingWithdrawal'));
    const body = fn.slice(0, fn.indexOf('\n  async create('));
    expect(body).toContain('markPaid');
    expect(body).not.toMatch(/applyEntry|bank\.post|\.create\(/);
  });
});
