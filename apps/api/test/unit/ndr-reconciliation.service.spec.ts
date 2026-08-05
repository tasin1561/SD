import { NdrReconciliationService } from '../../src/modules/courier-ndr-runner/services/ndr-reconciliation.service';

/**
 * The only check that can tell "Delhivery acted" from "Delhivery said
 * yes and did nothing".
 *
 * takeAction returns a UPL id. The UPL poll says CONFIRMED. The tracking
 * feed keeps flowing. All three are green whether or not a van moved.
 * This job asks the one question that separates them, so its failure
 * modes matter more than its happy path.
 */

type Ctx = {
  rows?: { id: string; shipmentId: string; submittedAt: Date }[];
  /** attempts recorded after submit, per shipment */
  newAttempts?: Record<string, number>;
  threshold?: number;
  alertEmail?: string;
};

function make(ctx: Ctx = {}) {
  const audits: { action: string; severity: string; metadata: unknown }[] = [];
  const enqueue = jest.fn().mockResolvedValue('job-1');
  const updates: Record<string, unknown>[] = [];

  const prisma = {
    client: {
      ndrActionRequest: {
        findMany: jest.fn().mockResolvedValue(ctx.rows ?? []),
        update: jest.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
          updates.push(a.data);
          return Promise.resolve({});
        }),
      },
      deliveryAttempt: {
        count: jest
          .fn()
          .mockImplementation((a: { where: { shipmentId: string } }) =>
            Promise.resolve(ctx.newAttempts?.[a.where.shipmentId] ?? 0),
          ),
      },
    },
  };

  const svc = new NdrReconciliationService(
    prisma as never,
    {
      reconcileWindowHours: jest.fn().mockResolvedValue(48),
      reconcileAlertPercent: jest.fn().mockResolvedValue(ctx.threshold ?? 25),
      alertEmail: jest.fn().mockResolvedValue(ctx.alertEmail ?? 'ops@example.com'),
    } as never,
    { enqueue } as never,
    {
      log: jest
        .fn()
        .mockImplementation((a: { action: string; severity: string; metadata: unknown }) => {
          audits.push(a);
          return Promise.resolve(undefined);
        }),
    } as never,
  );
  return { svc, enqueue, audits, updates };
}

const rows = (n: number): { id: string; shipmentId: string; submittedAt: Date }[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `req-${i}`,
    shipmentId: `ship-${i}`,
    submittedAt: new Date('2026-08-01T00:00:00Z'),
  }));

describe('NdrReconciliationService', () => {
  it('counts a new attempt scan as the courier having acted', async () => {
    const { svc, updates } = make({ rows: rows(1), newAttempts: { 'ship-0': 1 } });
    const out = await svc.reconcile();
    expect(out.acted).toBe(1);
    expect(out.notActed).toBe(0);
    expect(updates[0]?.['newAttemptSeen']).toBe(true);
  });

  it('counts no new attempt as NOT acted, and records it on the row', async () => {
    // Persisted rather than recomputed so the trend is queryable.
    const { svc, updates } = make({ rows: rows(1), newAttempts: {} });
    const out = await svc.reconcile();
    expect(out.notActed).toBe(1);
    expect(updates[0]?.['newAttemptSeen']).toBe(false);
  });

  it('does NOT alert on isolated misses below the threshold', async () => {
    // A parcel delivered before the re-attempt ran is normal. Alerting
    // per parcel trains everyone to ignore the alert.
    const { svc, enqueue } = make({
      rows: rows(10),
      newAttempts: Object.fromEntries(rows(9).map((r) => [r.shipmentId, 1])),
      threshold: 25,
    });
    const out = await svc.reconcile();
    expect(out.notActedPercent).toBe(10);
    expect(out.alerted).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('ALERTS above the threshold — the systematic-failure signal', async () => {
    const { svc, enqueue, audits } = make({ rows: rows(10), newAttempts: {}, threshold: 25 });
    const out = await svc.reconcile();
    expect(out.notActedPercent).toBe(100);
    expect(out.alerted).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(
      audits.some(
        (a) => a.action === 'courier.ndr.reconciliation_alert' && a.severity === 'CRITICAL',
      ),
    ).toBe(true);
  });

  it('writes the CRITICAL audit row BEFORE sending — a mail outage must not erase the finding', async () => {
    const { svc, audits } = make({ rows: rows(4), newAttempts: {}, alertEmail: '' });
    await svc.reconcile();
    expect(audits.some((a) => a.action === 'courier.ndr.reconciliation_alert')).toBe(true);
  });

  it('with no alert address it still records, and does not invent one', async () => {
    // An alert delivered nowhere is worse than one with no destination:
    // the first looks exactly like everything being fine.
    const { svc, enqueue, audits } = make({ rows: rows(4), newAttempts: {}, alertEmail: '' });
    const out = await svc.reconcile();
    expect(out.alerted).toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
    expect(audits.length).toBe(1);
  });

  it('an email failure does not fail the job — it stays re-runnable', async () => {
    const { svc, enqueue } = make({ rows: rows(4), newAttempts: {} });
    enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(svc.reconcile()).resolves.toMatchObject({ alerted: true });
  });

  it('an empty window never alerts — 0 of 0 is not 100%', async () => {
    // Guards the arithmetic: a quiet night must not read as total failure.
    const { svc, enqueue } = make({ rows: [], newAttempts: {} });
    const out = await svc.reconcile();
    expect(out.notActedPercent).toBe(0);
    expect(out.alerted).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('exactly at the threshold does not alert — only ABOVE it does', async () => {
    const { svc } = make({
      rows: rows(4),
      newAttempts: Object.fromEntries(rows(3).map((r) => [r.shipmentId, 1])),
      threshold: 25,
    });
    const out = await svc.reconcile();
    expect(out.notActedPercent).toBe(25);
    expect(out.alerted).toBe(false);
  });
});
