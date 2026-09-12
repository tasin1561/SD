import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * WAL-7, enforced rather than remembered.
 *
 * ── THE RULE, AND WHY IT IS NOT OBVIOUS ──────────────────────────────
 * Every money path that must happen once per order guards itself the
 * same way: read `seller_wallet_entries` for an existing entry, and
 * write only if there is none. Inside a transaction that FEELS safe. It
 * is not.
 *
 * Under READ COMMITTED two concurrent transactions each take their own
 * snapshot, each find no row, and each insert. A transaction gives no
 * protection against a row that does not exist yet — there is nothing to
 * lock. The advisory lock inside `WalletService.applyEntry` serialises
 * the WRITES, but by then both callers have already concluded they were
 * first, so the second happily charges the seller again.
 *
 * WAL-7 already says this: "any future money guard that reads a balance
 * or COUNTS ROWS before writing must hold this same lock inside the same
 * transaction". `WithdrawalRequestService` honoured it. FIVE accrual and
 * refund paths did not — COD credit, order charges, the RTO fee, the
 * charges refund and the inbound-freight amortisation — every one of
 * them a double-charge or a double-credit waiting for the right
 * interleaving.
 *
 * ── WHY STRUCTURAL ───────────────────────────────────────────────────
 * A behavioural test cannot see it: a mocked Prisma has no concurrency
 * and no isolation level, so both the safe and the unsafe version pass.
 * Only a real database under real contention tells them apart, and by
 * then it is a seller's balance. So the check is on the SOURCE, the same
 * technique as `worker-role` and `drain-hooks`.
 */
const API = resolve(__dirname, '../..');

/** Any read of the wallet ledger — the guard's "is there already an entry?". */
const LEDGER_READ = /sellerWalletEntry\.(findFirst|findMany|count|groupBy|aggregate)\(/;

/** Files that guard a money write by reading the wallet ledger first. */
function guardedFiles(): string[] {
  return globSync('src/modules/**/*.ts', { cwd: API }).filter((f) => {
    const src = readFileSync(join(API, f), 'utf8');
    // The guard shape: a read of the ledger AND a write through it. EVERY
    // read shape counts — a guard rewritten from `findFirst` to `count` or
    // `findMany` (charges and refunds pair up since 2026-09-12) dropped out
    // of this check silently while it stayed green.
    return LEDGER_READ.test(src) && /wallet\.applyEntry\(/.test(src);
  });
}

describe('every money guard that reads before writing holds the wallet lock', () => {
  const files = guardedFiles();

  it('finds the guarded money paths to check', () => {
    // Guards against the filter matching nothing, which would make the
    // suite below pass by testing air.
    expect(files.length).toBeGreaterThanOrEqual(4);
  });

  it.each(files)('%s takes the WALLET advisory lock', (file) => {
    const src = readFileSync(join(API, file), 'utf8');
    expect(src).toContain('AdvisoryLock.WALLET');
    expect(src).toContain('takeAdvisoryLock');
  });

  it.each(files)('%s takes it BEFORE the idempotency read', (file) => {
    const src = readFileSync(join(API, file), 'utf8');
    // Order is the entire property. Locking after the read serialises
    // nothing that matters — both callers have already decided.
    // The CALL, not the import line at the top of the file — matching the
    // bare name made every file pass this by its import.
    const lockAt = src.indexOf('takeAdvisoryLock(');
    const readAt = src.search(LEDGER_READ);
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(readAt);
  });
});
