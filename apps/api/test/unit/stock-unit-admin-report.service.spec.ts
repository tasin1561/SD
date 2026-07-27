import { StockUnitAdminReportService } from '../../src/modules/inventory-unit/services/stock-unit-admin-report.service';
import type { UnitDiscrepancyReport } from '../../src/modules/inventory-unit/services/stock-unit-report.service';

function report(over: Partial<UnitDiscrepancyReport> = {}): UnitDiscrepancyReport {
  return {
    sellerId: 'seller-1',
    generatedAt: new Date('2026-07-27T00:00:00.000Z'),
    thresholds: { stuckSlaHours: 48, dispatchedUnresolvedDays: 30 },
    stuckUnits: [],
    unresolvedDispatched: [],
    retiredUnits: [],
    countMismatches: [],
    ...over,
  };
}

/** N placeholder rows — only the COUNT matters to the summary. */
function rows(n: number): UnitDiscrepancyReport['stuckUnits'] {
  return Array.from({ length: n }, (_, i) => ({
    stockUnitId: `u-${i}`,
    serialBarcode: `SN-${i}`,
    variantId: 'v-1',
    skuCode: 'SKU-1',
    status: 'PICKED' as never,
    warehouseId: 'wh-1',
    hoursInStatus: 60,
    lastScanAt: null,
    shipmentId: null,
  }));
}

function make(
  perSeller: Record<string, UnitDiscrepancyReport>,
  opts: { sellerIds?: string[] } = {},
) {
  const ids = opts.sellerIds ?? Object.keys(perSeller);
  const forSeller = jest.fn(async (sellerId: string) => perSeller[sellerId] ?? report());
  const prisma = {
    client: {
      stockUnit: {
        groupBy: jest.fn(async () => ids.map((id) => ({ sellerId: id, _count: { _all: 1 } }))),
      },
      seller: {
        findMany: jest.fn(async () => ids.map((id) => ({ id, companyName: `Co ${id}` }))),
      },
    },
  };
  const svc = new StockUnitAdminReportService(prisma as never, { forSeller } as never);
  return { svc, forSeller, prisma };
}

/**
 * The admin triage answers a question the seller report structurally
 * cannot: "whose stock do I need to look at today?" — you cannot ask the
 * seller report that, because it takes a sellerId you do not yet have.
 */
describe('StockUnitAdminReportService.triage', () => {
  it('ranks sellers worst-first — a queue, not a directory', async () => {
    const { svc } = make({
      quiet: report({ stuckUnits: rows(1) }),
      loud: report({ stuckUnits: rows(5), countMismatches: [{} as never] }),
      middling: report({ unresolvedDispatched: rows(3) }),
    });
    const t = await svc.triage();
    expect(t.sellers.map((s) => s.sellerId)).toEqual(['loud', 'middling', 'quiet']);
    expect(t.sellers[0]?.needsAttention).toBe(6);
  });

  it('EXCLUDES retired units from the attention count', async () => {
    // A written-off or lost unit is a settled fact, not work. Counting
    // it would mean a seller's queue never reaches zero — and a number
    // that never reaches zero stops being read.
    const { svc } = make({ 'seller-1': report({ retiredUnits: rows(9) }) });
    const t = await svc.triage();
    expect(t.sellers[0]?.needsAttention).toBe(0);
    expect(t.totalNeedsAttention).toBe(0);
  });

  it("reports each seller's OWN thresholds, not a global one", async () => {
    // stuck_sla_hours is seller-overridable. Sweeping with one global
    // threshold would be cheaper and would misreport everyone who
    // customised it.
    const { svc } = make({
      strict: report({ thresholds: { stuckSlaHours: 12, dispatchedUnresolvedDays: 7 } }),
      lax: report({ thresholds: { stuckSlaHours: 96, dispatchedUnresolvedDays: 60 } }),
    });
    const t = await svc.triage();
    const byId = new Map(t.sellers.map((s) => [s.sellerId, s.thresholds]));
    expect(byId.get('strict')?.stuckSlaHours).toBe(12);
    expect(byId.get('lax')?.stuckSlaHours).toBe(96);
  });

  it('only sweeps sellers who actually hold serialized stock', async () => {
    // A NORMAL-mode seller has nothing to reconcile; listing them would
    // be a page of zero rows hiding the two that matter.
    const { svc, forSeller } = make({ 'has-units': report() }, { sellerIds: ['has-units'] });
    await svc.triage();
    expect(forSeller).toHaveBeenCalledTimes(1);
    expect(forSeller).toHaveBeenCalledWith('has-units', {});
  });

  it('says so when it truncated, rather than quietly showing a partial sweep', async () => {
    const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`s-${i}`, report()]));
    const { svc } = make(many);
    const t = await svc.triage();
    expect(t.examined).toBe(50);
    expect(t.truncated).toBe(true);
  });

  it('is not truncated when every seller fits', async () => {
    const { svc } = make({ a: report(), b: report() });
    const t = await svc.triage();
    expect(t.truncated).toBe(false);
    expect(t.examined).toBe(2);
  });

  it('passes the warehouse filter through to each seller report', async () => {
    const { svc, forSeller } = make({ a: report() });
    await svc.triage({ warehouseId: 'wh-9' });
    expect(forSeller).toHaveBeenCalledWith('a', { warehouseId: 'wh-9' });
  });

  it('survives a seller row that no longer resolves to a company name', async () => {
    const { svc, prisma } = make({ ghost: report({ stuckUnits: rows(2) }) });
    prisma.client.seller.findMany = jest.fn(async () => []);
    const t = await svc.triage();
    expect(t.sellers[0]?.companyName).toBeNull();
    expect(t.sellers[0]?.needsAttention).toBe(2);
  });
});
