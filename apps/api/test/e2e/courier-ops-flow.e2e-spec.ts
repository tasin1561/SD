import request from 'supertest';
import { PickupRequestStatus, StaffRole } from '@skydrop/db';
import {
  bootTestApp,
  createTestStaff,
  flushTestRedis,
  resetAuthState,
  type AppHarness,
} from './app-harness';

/**
 * courier-ops HTTP surface (2026-07-27).
 *
 * These endpoints gave the D1–D7 Delhivery capability services their first
 * callers. Until this spec they had unit tests only — and unit tests could
 * not have caught the bug this file was written for.
 *
 * ── THE BUG THIS EXISTS TO PIN ───────────────────────────────────────
 * Delhivery accepts one OPEN pickup per location per day, and a second
 * "only when the existing pickup request is closed". The first
 * implementation used an UNCONDITIONAL unique on
 * (courier, warehouse, date), which enforced something stricter than the
 * courier does: once a morning collection was marked CLOSED, the warehouse
 * could not book an afternoon van at all.
 *
 * A unit test could not see it. The rule lives in a Postgres partial
 * unique, and a mocked Prisma has no index to violate — every unit test
 * asserted the duplicate-while-open case, which BOTH versions get right.
 * Only a real database says which one is correct, which is the argument
 * for this file existing.
 */
describe('courier-ops (e2e)', () => {
  let h: AppHarness;
  let staffAuth: { Authorization: string };
  let warehouseId: string;

  beforeAll(async () => {
    h = await bootTestApp();
  });
  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    await flushTestRedis();
    await resetAuthState(h.prisma, h.app);

    const staff = await createTestStaff(h.prisma, { role: StaffRole.SUPER_ADMIN });
    const login = await request(h.baseUrl)
      .post('/auth/staff/login')
      .send({ email: staff.email, password: staff.password })
      .expect(200);
    staffAuth = { Authorization: `Bearer ${login.body.accessToken}` };

    const whs = await request(h.baseUrl).get('/admin/warehouses').set(staffAuth).expect(200);
    warehouseId = (whs.body as Array<{ id: string; code: string }>)[0]!.id;

    // The pickup location name is what Delhivery matches on; without it
    // the endpoint refuses before reaching the wire.
    await h.prisma.systemSetting.update({
      where: { key: 'courier.delhivery_pickup_location' },
      data: { valueString: 'Skydrop' },
    });
  });

  function raisePickup(date: string, time = '16:00:00', count = 10) {
    return request(h.baseUrl).post('/admin/courier-ops/pickups').set(staffAuth).send({
      warehouseId,
      pickupDate: date,
      pickupTime: time,
      expectedPackageCount: count,
    });
  }

  describe('pickup requests — the one-OPEN-per-day rule', () => {
    it('refuses a second pickup while the first is still OPEN', async () => {
      await raisePickup('2026-08-01').expect(201);
      const dup = await raisePickup('2026-08-01', '18:00:00').expect(409);
      expect(dup.body.code).toBe('PICKUP_ALREADY_REQUESTED');
    });

    it('ALLOWS a second pickup once the first is CLOSED — the van already came', async () => {
      // The regression. Delhivery permits this; the original unconditional
      // unique did not, so a warehouse with an afternoon batch was stuck.
      const first = await raisePickup('2026-08-02').expect(201);

      await request(h.baseUrl)
        .patch(`/admin/courier-ops/pickups/${first.body.id}`)
        .set(staffAuth)
        .send({ status: 'CLOSED' })
        .expect(200);

      const second = await raisePickup('2026-08-02', '19:00:00', 3).expect(201);
      expect(second.body.status).toBe(PickupRequestStatus.REQUESTED);
      expect(second.body.id).not.toBe(first.body.id);
    });

    it('ALLOWS a second pickup once the first is CANCELLED — nothing is booked', async () => {
      const first = await raisePickup('2026-08-03').expect(201);
      await request(h.baseUrl)
        .patch(`/admin/courier-ops/pickups/${first.body.id}`)
        .set(staffAuth)
        .send({ status: 'CANCELLED' })
        .expect(200);
      await raisePickup('2026-08-03', '19:00:00', 2).expect(201);
    });

    it('a FAILED attempt still OCCUPIES the day', async () => {
      // Deliberate: when the call failed we cannot tell "they never got it"
      // from "they got it and the response was lost". Assuming the former
      // is how two vans arrive.
      const first = await raisePickup('2026-08-04').expect(201);
      await request(h.baseUrl)
        .patch(`/admin/courier-ops/pickups/${first.body.id}`)
        .set(staffAuth)
        .send({ status: 'FAILED' })
        .expect(200);

      const blocked = await raisePickup('2026-08-04', '19:00:00').expect(409);
      expect(blocked.body.code).toBe('PICKUP_ALREADY_REQUESTED');
    });

    it('a different DAY is never blocked', async () => {
      await raisePickup('2026-08-05').expect(201);
      await raisePickup('2026-08-06').expect(201);
    });

    it('refuses to release a day the courier acknowledged', async () => {
      // Stub mode returns a pickup id, i.e. it exists on their side.
      // Freeing our slot would book a second van against a live request.
      const first = await raisePickup('2026-08-07').expect(201);
      expect(first.body.courierPickupId).not.toBeNull();

      const res = await request(h.baseUrl)
        .post(`/admin/courier-ops/pickups/${first.body.id}/release-day`)
        .set(staffAuth)
        .send({ reason: 'checked their panel, nothing there' })
        .expect(409);
      expect(res.body.code).toBe('PICKUP_REGISTERED_WITH_COURIER');
    });

    it('refuses when the pickup location is unconfigured', async () => {
      await h.prisma.systemSetting.update({
        where: { key: 'courier.delhivery_pickup_location' },
        data: { valueString: '' },
      });
      const res = await raisePickup('2026-08-08').expect(400);
      expect(res.body.code).toBe('PICKUP_LOCATION_NOT_CONFIGURED');
    });

    it('rejects a malformed date before it reaches the courier', async () => {
      await request(h.baseUrl)
        .post('/admin/courier-ops/pickups')
        .set(staffAuth)
        .send({
          warehouseId,
          pickupDate: '01-08-2026',
          pickupTime: '16:00:00',
          expectedPackageCount: 5,
        })
        .expect(400);
    });
  });

  describe('read surfaces', () => {
    it('reports Delhivery ops status with the write guard OFF by default', async () => {
      const res = await request(h.baseUrl)
        .get('/admin/delhivery/status')
        .set(staffAuth)
        .expect(200);
      // Default-OFF is the safety property, so it is worth asserting
      // rather than assuming.
      expect(res.body.liveWritesEnabled).toBe(false);
      expect(res.body.rateBudgets.length).toBeGreaterThan(0);
      // The bulk-waybill budget is the tight one (5/5min, budgeted to 4).
      const bulk = res.body.rateBudgets.find(
        (b: { endpoint: string }) => b.endpoint === 'waybill_bulk',
      );
      expect(bulk.budget).toBeLessThanOrEqual(5);
    });

    it('returns an empty unit-discrepancy triage rather than erroring', async () => {
      const res = await request(h.baseUrl)
        .get('/admin/stock-units/triage')
        .set(staffAuth)
        .expect(200);
      expect(res.body.sellers).toEqual([]);
      expect(res.body.truncated).toBe(false);
    });

    it('returns an empty held-stock review queue', async () => {
      const res = await request(h.baseUrl)
        .get('/admin/early-reservation-reviews?status=OPEN')
        .set(staffAuth)
        .expect(200);
      expect(res.body).toEqual([]);
    });

    it('margin report says it priced nothing rather than implying a zero margin', async () => {
      const res = await request(h.baseUrl)
        .get('/admin/courier-ops/margin-report?limit=5')
        .set(staffAuth)
        .expect(200);
      expect(res.body.sampledShipments).toBe(0);
      expect(res.body.rows).toEqual([]);
    });
  });

  describe('RBAC', () => {
    it('a warehouse hand cannot raise a pickup — that summons a vehicle', async () => {
      const hand = await createTestStaff(h.prisma, { role: StaffRole.WAREHOUSE_STAFF });
      const login = await request(h.baseUrl)
        .post('/auth/staff/login')
        .send({ email: hand.email, password: hand.password })
        .expect(200);

      await request(h.baseUrl)
        .post('/admin/courier-ops/pickups')
        .set({ Authorization: `Bearer ${login.body.accessToken}` })
        .send({
          warehouseId,
          pickupDate: '2026-08-09',
          pickupTime: '16:00:00',
          expectedPackageCount: 5,
        })
        .expect(403);
    });

    it('a call agent cannot read the margin report — it is commercially sensitive', async () => {
      const agent = await createTestStaff(h.prisma, { role: StaffRole.CALL_AGENT });
      const login = await request(h.baseUrl)
        .post('/auth/staff/login')
        .send({ email: agent.email, password: agent.password })
        .expect(200);

      await request(h.baseUrl)
        .get('/admin/courier-ops/margin-report')
        .set({ Authorization: `Bearer ${login.body.accessToken}` })
        .expect(403);
    });

    it('an unauthenticated caller gets nothing', async () => {
      await request(h.baseUrl).get('/admin/courier-ops/pickups').expect(401);
    });
  });
});
