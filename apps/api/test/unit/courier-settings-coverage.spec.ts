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
});
