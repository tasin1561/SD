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
const LEDGER_READ =
  /(?:sellerWalletEntry|storeWalletEntry)\.(findFirst|findMany|count|groupBy|aggregate)\(/;

/**
 * Any read of a BALANCE — the rule's OTHER half.
 *
 * WAL-7 says "reads a BALANCE **or** counts rows", and only the counting
 * half was ever enforced. That gap is how `WithdrawalRequestService.approve`
 * came to re-read `withdrawableBalance` outside any transaction, with no
 * lock, and then claim the request from what it read: two operators
 * approving two requests on one seller at the same instant each saw the
 * whole balance, each passed, and each claimed a DIFFERENT row — so the
 * guarded `updateMany` (which only ever protected the SAME request from
 * being approved twice) matched for both. APPROVED is the instruction to
 * send money, so that is two real transfers out of one balance.
 *
 * The file selection below deliberately does NOT require a ledger read any
 * more: a balance read is a guard in its own right.
 */
const BALANCE_READ =
  /\b(balanceLive|withdrawableBalance|groupBalance|ownerBalance|storeWalletBalance|storeWalletBalances|storeWithdrawable|storeExposure)\s*\(/;

/**
 * The write the guard is guarding: a wallet entry, or a guarded status claim
 * (`updateMany` on the status the read decided from — the house shape for
 * "somebody else got there first").
 */
const GUARDED_WRITE = /\.applyEntry\(|\.applyStore\(|\.updateMany\(/;

/**
 * Taking the lock — through `takeAdvisoryLock` directly, or through one of
 * the named wrappers around it (`StoreWalletService.lockSeller`,
 * `ResellerOrderMoneyService.lock`, `lockAccountsForPosting`). Matching only
 * the raw helper would report every one of those as unlocked.
 */
const LOCK_TAKEN = /\b(?:takeAdvisoryLock|lock(?:[A-Z]\w*)?)\s*\(/;

/**
 * A method HANDED a transaction client runs inside its caller's transaction,
 * and the CONTRACT throughout this codebase is that the caller holds the
 * lock (`StoreWalletService.storeCanSpend`, `CodCreditService.creditForOrder`
 * and `ResellerOrderMoneyService.reverseRow` all say so in as many words).
 * The top of every such chain is a method that opens its own transaction —
 * and that one IS checked below, which is what keeps the skip honest.
 */
const HANDED_TX = /\b(?:tx|db)\b\s*\??\s*:/;

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

/**
 * ── THE SAME RULE, PER METHOD ────────────────────────────────────────
 *
 * The file-level check above asks whether the FILE locks before its FIRST
 * read, which is true of a file whose first method locks and whose second
 * does not — and that is exactly the shape `approve()` had:
 * `createInternal` a few hundred lines above it opens a transaction and
 * takes the wallet lock, so every file-level assertion passed while the
 * method that decides whether to send a seller money read the balance on
 * the global client with nothing held.
 *
 * So the check is sliced per `async` method. A method qualifies when it
 * BOTH reads (ledger or balance) and WRITES, and is not handed a
 * transaction by its caller.
 */
interface MethodSlice {
  readonly name: string;
  readonly params: string;
  readonly body: string;
}

/** The parameter list, matched by paren depth — signatures span lines. */
function paramList(src: string, from: number): string {
  let depth = 1;
  for (let i = from; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(from, i);
    }
  }
  return src.slice(from);
}

function asyncMethods(src: string): MethodSlice[] {
  const re =
    /^[ \t]*(?:(?:public|private|protected|static|readonly)\s+)*async\s+([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\(/gm;
  const hits = [...src.matchAll(re)];
  return hits.map((m, i) => {
    const start = m.index ?? 0;
    const end = i + 1 < hits.length ? (hits[i + 1]?.index ?? src.length) : src.length;
    return {
      name: m[1] ?? '(anonymous)',
      params: paramList(src, start + m[0].length),
      body: src.slice(start, end),
    };
  });
}

function guardedMethods(): Array<{ file: string; method: string; body: string }> {
  const out: Array<{ file: string; method: string; body: string }> = [];
  for (const file of globSync('src/modules/**/*.ts', { cwd: API })) {
    const src = readFileSync(join(API, file), 'utf8');
    const reads = LEDGER_READ.test(src) || BALANCE_READ.test(src);
    if (!reads || !GUARDED_WRITE.test(src)) continue;
    for (const m of asyncMethods(src)) {
      if (!GUARDED_WRITE.test(m.body)) continue;
      const at = [m.body.search(LEDGER_READ), m.body.search(BALANCE_READ)].filter((n) => n >= 0);
      if (at.length === 0) continue;
      if (HANDED_TX.test(m.params)) continue;
      out.push({ file, method: m.name, body: m.body });
    }
  }
  return out;
}

describe('every money guard that reads before writing holds the lock — per METHOD', () => {
  const methods = guardedMethods();

  it('finds the guarded methods to check', () => {
    // The filter matching nothing would make the suite below pass on air.
    expect(methods.length).toBeGreaterThanOrEqual(6);
  });

  it.each(methods.map((m) => [`${m.file} :: ${m.method}`, m.body] as const))(
    '%s takes a lock BEFORE the balance / ledger read it decides from',
    (_label, body) => {
      const readAt = Math.min(
        ...[body.search(LEDGER_READ), body.search(BALANCE_READ)].filter((n) => n >= 0),
      );
      const lockAt = body.search(LOCK_TAKEN);
      expect(lockAt).toBeGreaterThan(-1);
      expect(lockAt).toBeLessThan(readAt);
    },
  );
});
