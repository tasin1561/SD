import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SEED = readFileSync(join(__dirname, '../../../../packages/db/prisma/seed.ts'), 'utf8');
const SRC = join(__dirname, '../../src');

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8');
}

/**
 * Every courier we can write to needs its switch to EXIST as a row.
 *
 * `CourierWriteGuardService` derives its keys from the courier code —
 * `courier.<code>_live_writes_enabled` — which is what makes adding a
 * third courier a data change rather than a code change. The cost of
 * that convenience is that a missing row is invisible: the guard reads
 * `row?.valueBoolean === true`, so an absent setting fails CLOSED and
 * behaves perfectly. Nothing is broken, no test goes red, no log line
 * appears.
 *
 * What breaks is later, and quietly: the admin settings page lists what
 * is in `system_settings`, so a courier with no row has a switch that
 * can only be thrown by hand in psql. Shiprocket shipped exactly that
 * way and it was found by grep, not by a test.
 */
describe('every integrated courier has its settings seeded', () => {
  // The couriers the dispatchers can actually reach. Read from the
  // source rather than listed here, so adding a branch to the dispatcher
  // and forgetting the seed row fails HERE.
  const INTEGRATED = (() => {
    const dispatch = read('modules/courier-awb/services/courier-awb-dispatch.service.ts');
    const codes = new Set<string>();
    for (const m of dispatch.matchAll(/case '([a-z]+)':/g)) {
      const code = m[1];
      if (code !== undefined) codes.add(code);
    }
    return [...codes];
  })();

  it('finds the couriers it claims to check', () => {
    // A refactor that renamed the switch would otherwise empty this
    // list and the whole suite would pass vacuously.
    expect(INTEGRATED).toEqual(expect.arrayContaining(['delhivery', 'shiprocket']));
  });

  for (const code of INTEGRATED) {
    it(`${code} has a live-writes switch that an admin can see`, () => {
      expect(SEED).toContain(`key: 'courier.${code}_live_writes_enabled'`);
    });

    it(`${code} has a base URL, so stub vs real is a setting not a deploy`, () => {
      expect(SEED).toContain(`key: 'courier.${code}_api_base_url'`);
    });
  }

  it('every live-writes switch defaults to OFF', () => {
    for (const code of INTEGRATED) {
      // Anchored on `key:` — the bare string also appears inside other
      // settings' description prose ("...additionally requires
      // courier.delhivery_live_writes_enabled"), and matching that
      // reads the wrong block entirely.
      //
      // Defaulting one of these to true would arm real writes on a
      // fresh deploy, which is the one mistake here that costs money.
      const at = SEED.indexOf(`key: 'courier.${code}_live_writes_enabled'`);
      expect(at).toBeGreaterThan(-1);
      const block = SEED.slice(at, at + 400);
      expect(block).toContain('valueBoolean: false');
      expect(block).not.toContain('valueBoolean: true');
    }
  });

  /**
   * The CUR-10 per-category auto-pickup switch — the second axis
   * `PackService`'s post-commit hook reads before a box close is
   * allowed to ask a courier for a van on its own. Same reasoning as
   * the live-writes check above: a missing row fails closed and behaves
   * perfectly, right up until the settings page has no switch to show
   * for a courier that can otherwise be enabled by editing the row in
   * psql.
   */
  for (const code of INTEGRATED) {
    it(`${code} has an auto-pickup switch that an admin can see`, () => {
      expect(SEED).toContain(`key: 'courier.${code}_auto_pickup_enabled'`);
    });
  }

  it('every auto-pickup switch is a standing ON (2026-09-03) — the KILL SWITCH stays real', () => {
    // Reversed from its original default deliberately: CUR-10 amendment
    // #3's whole point is that the switch keeps working as an escape
    // hatch, not that it starts OFF. If this ever reads `false` again,
    // check whether that was a conscious decision or a seed regression —
    // a re-seed alone cannot make this true in a deployed database (the
    // value columns are create-only), which is why
    // 20260903200000_auto_pickup_standing_on exists as a real migration.
    for (const code of INTEGRATED) {
      const at = SEED.indexOf(`key: 'courier.${code}_auto_pickup_enabled'`);
      expect(at).toBeGreaterThan(-1);
      const block = SEED.slice(at, at + 400);
      expect(block).toContain('valueBoolean: true');
      expect(block).not.toContain('valueBoolean: false');
    }
  });
});

/**
 * A courier we can dispatch to needs a ROW, and the row's starting
 * state is a decision rather than a default.
 *
 * Shiprocket had no row at all until 2026-08-29, which made it off by
 * ACCIDENT: `CourierEnablementService` fails closed on an unknown
 * courier, so nothing could be booked with them — real safety that
 * nobody had decided, and that evaporates the moment somebody creates
 * the row by hand to test something.
 */
describe('every dispatchable courier is seeded as a row', () => {
  const SEED_COURIERS = SEED.slice(SEED.indexOf('async function seedCouriers()'));

  it('each courier the dispatcher can reach has a courier row', () => {
    const dispatch = read('modules/courier-awb/services/courier-awb-dispatch.service.ts');
    const codes = new Set<string>();
    for (const m of dispatch.matchAll(/case '([a-z]+)':/g)) {
      const c = m[1];
      if (c !== undefined) codes.add(c);
    }
    expect(codes.size).toBeGreaterThan(1);
    for (const code of codes) {
      // Without a row there is nothing for the console to toggle, and
      // the intake switch has no switch.
      expect(SEED_COURIERS).toContain(`code: '${code}'`);
    }
  });

  it('Shiprocket starts switched OFF', () => {
    const at = SEED_COURIERS.indexOf("code: 'shiprocket'");
    expect(at).toBeGreaterThan(-1);
    const block = SEED_COURIERS.slice(at, at + 700);
    // Nothing has ever been written against a real Shiprocket account.
    // Intake stays off until a controlled first parcel says otherwise.
    expect(block).toContain('isActive: false');
  });
});
