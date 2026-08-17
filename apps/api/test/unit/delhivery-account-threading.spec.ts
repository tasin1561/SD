import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every Delhivery call knows WHICH account it is made as.
 *
 * ── WHY THIS IS A STRUCTURAL TEST ────────────────────────────────────
 * R1 built CourierAccount, the seller links and the weighted routing,
 * and stamped `shipments.courier_account_id` — while every actual API
 * call still authenticated with whichever credential `findFirst`
 * returned. So a second account would have RECORDED shipments against
 * one account and CREATED them under another.
 *
 * That failure is invisible to behavioural tests in the worst way: the
 * call succeeds, the AWB is real, the parcel moves. Only the margin
 * report, the settlement matching and the audit trail are wrong — and
 * they are wrong *consistently*, agreeing with each other and with
 * nothing real.
 *
 * The account parameter is optional for the same reason `actor` is (a
 * live courier path must not throw over a missed argument) and dangerous
 * for the same reason: omitting it compiles, runs, and returns a
 * perfectly good answer from the wrong account. Worse than the actor
 * case, it is only wrong once a SECOND account exists — so the bug ships
 * quietly and surfaces on the day someone onboards an account, which is
 * exactly the day nobody wants to be debugging credentials.
 *
 * So this reads the sources, in the `delhivery-actor-threading.spec.ts`
 * idiom.
 *
 * ── THE INVARIANT IT ENCODES ─────────────────────────────────────────
 * The funnel. `DelhiveryHttpService` is the ONE place an outbound call
 * learns whose token it carries, so the rule is not "every method takes
 * an account" but:
 *
 *   1. the funnel resolves through `resolveCredential`, which is the one
 *      function that knows the explicit → default → legacy order;
 *   2. nothing else in the courier modules resolves a credential itself,
 *      because that would be a call whose account nobody chose;
 *   3. the three things that are physically per-account — waybills, the
 *      pickup location, the rate budget — are keyed on it.
 */

const SRC = join(__dirname, '../../src/modules');
const R = (p: string): string => readFileSync(join(SRC, p), 'utf8');

const HTTP = R('courier-delhivery/services/delhivery-http.service.ts');
const CREDS = R('courier-shared/services/courier-credential.service.ts');
const POOL = R('courier-delhivery/services/delhivery-waybill-pool.service.ts');
const RATE = R('courier-delhivery/services/delhivery-rate-limit.service.ts');
const AWB_SVC = R('courier-delhivery/services/delhivery-awb.service.ts');
const AWB_GEN = R('courier-awb/services/awb-generation.service.ts');
const REFILL = R('courier-delhivery/queue/waybill-refill.worker.ts');

describe('the funnel decides the account, once', () => {
  it('the HTTP layer resolves through resolveCredential', () => {
    // Not `getCredential`: that is the legacy no-accounts path, and
    // calling it directly here is precisely the bug — routing to an
    // account and then authenticating as whoever came first.
    expect(HTTP).toContain('this.credentials.resolveCredential(');
    expect(HTTP).not.toMatch(/this\.credentials\.getCredential\(/);
  });

  it('the request options carry the account, and pass it to authHeaders', () => {
    expect(HTTP).toMatch(/courierAccountId\?:\s*string \| null \| undefined;/);
    expect(HTTP).toContain('opts.courierAccountId ?? null');
  });

  it('resolveCredential goes explicit → default → legacy, in that order', () => {
    const body = CREDS.slice(
      CREDS.indexOf('async resolveCredential('),
      CREDS.indexOf('async getCredentialForAccount('),
    );
    const explicit = body.indexOf('courierAccountId !== null');
    const dflt = body.indexOf('isDefault: true');
    const legacy = body.indexOf('this.getCredential(');
    expect(explicit).toBeGreaterThan(-1);
    expect(dflt).toBeGreaterThan(explicit);
    expect(legacy).toBeGreaterThan(dflt);
  });

  it('refuses to guess when accounts exist but none is default', () => {
    // Picking one arbitrarily is how a parcel ends up on the wrong
    // account's bill with nothing in the logs to say why.
    expect(CREDS).toContain('NO_DEFAULT_COURIER_ACCOUNT');
  });

  it('nothing outside the funnel resolves a credential itself', () => {
    // A service reaching for a credential directly is a call whose
    // account nobody chose. The HTTP service and the credential service
    // are the only two files allowed to name these.
    const dir = join(SRC, 'courier-delhivery/services');
    const offenders: string[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      if (f === 'delhivery-http.service.ts') continue;
      const src = readFileSync(join(dir, f), 'utf8');
      if (/\.(getCredential|resolveCredential|getCredentialForAccount)\(/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the three things that are physically per-account', () => {
  it('a waybill is claimed only from its own account pool', () => {
    // A number bought by account A is invalid on account B's shipment.
    expect(POOL).toContain('courier_account_id = ${courierAccountId}::uuid');
    // And a null-provenance row is claimable ONLY by a null resolution —
    // "unknown" must not read as "anyone may take it".
    expect(POOL).toContain('courier_account_id IS NULL');
  });

  it('a refill stores numbers against the account that fetched them', () => {
    const store = POOL.slice(POOL.indexOf('private async store('));
    expect(store.slice(0, 900)).toContain('courierAccountId,');
    // The fetch and the store must agree, or the pool is mislabelled.
    expect(POOL).toMatch(/request<string \| string\[\]>\(\{[\s\S]{0,200}courierAccountId,/);
  });

  it('the low-water mark counts the pool that will actually be drawn from', () => {
    const refill = POOL.slice(POOL.indexOf('async refillIfNeeded('));
    expect(refill.slice(0, 1200)).toContain('courierAccountId,');
  });

  it('the refill worker tops up every account, isolating failures', () => {
    expect(REFILL).toContain('refillTargets()');
    // `[null]` only when no account exists; never accounts-plus-null,
    // which would keep an orphan pool alive and hide a null resolution.
    expect(REFILL).toContain('accounts.length === 0 ? [null]');
    expect(REFILL).toContain('others continue');
  });

  it('the rate budget is keyed per account', () => {
    // Delhivery limits per account; a shared key makes one account
    // throttle another, and the refusal looks identical to a real limit.
    expect(RATE).toContain('`dlv:rl:${courierAccountId}:${endpoint}:${window}`');
    expect(HTTP).toContain('this.rateLimit.consume(opts.endpoint, opts.courierAccountId ?? null)');
  });

  it('the pickup location prefers the account’s own registered name', () => {
    // Registered per account and matched exactly WITHIN it, so one
    // global name cannot describe two accounts.
    expect(AWB_SVC).toContain('pickupLocationName: true');
    expect(AWB_SVC).toContain('resolvePickupLocationName(courierAccountId ?? null)');
  });
});

describe('the account is chosen before it can matter', () => {
  it('AWB generation resolves the account BEFORE calling generateAwb', () => {
    // Resolved after, it can only be recorded — which is what it used to
    // be, and why a stamped shipment could disagree with the token that
    // created it.
    const resolveAt = AWB_GEN.indexOf('await this.resolveCourierAccountId(shipment)');
    const callAt = AWB_GEN.indexOf('await this.delhiveryAwb.generateAwb(');
    expect(resolveAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeLessThan(callAt);
  });

  it('and passes it into the call, not just onto the row', () => {
    const call = AWB_GEN.slice(AWB_GEN.indexOf('await this.delhiveryAwb.generateAwb('));
    expect(call.slice(0, 220)).toContain('courierAccountId');
  });

  it('the stale "traceability only" claim is gone', () => {
    // It described the old behaviour, and a comment that describes the
    // opposite of what the code does is worse than none.
    expect(AWB_GEN).not.toContain('for traceability only');
  });
});
