import { Prisma } from '@skydrop/db';
import { ShiprocketCostSyncService } from '../../src/modules/shiprocket-cost-sync/services/shiprocket-cost-sync.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';
import type { ShiprocketHttpService } from '../../src/modules/courier-shiprocket/services/shiprocket-http.service';

/**
 * The nightly Shiprocket API sync. It reads each parcel's charges and
 * CHECKS their final bill against the cost the wallet ledger recorded —
 * the passbook sync is the only thing that writes a Shiprocket cost.
 */
type Ship = {
  id: string;
  awbNumber: string;
  courierOrderId: string;
  actualCourierCostInr: Prisma.Decimal | null;
  actualRtoCostInr: Prisma.Decimal | null;
};

function makeSut(opts: {
  enabled?: boolean;
  stub?: boolean;
  balance?: string;
  previousBalance?: string | null;
  shipments?: Ship[];
  orders?: Record<string, unknown>;
  failOn?: string;
  heldReadings?: Record<string, { fingerprint: string; provisionalInr: Prisma.Decimal | null }>;
}) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const readings: Array<Record<string, unknown>> = [];
  const snapshots: Array<Record<string, unknown>> = [];
  const held = { ...(opts.heldReadings ?? {}) };
  const client = {
    systemSetting: {
      findUnique: async () => ({ valueBoolean: opts.enabled ?? true }),
    },
    courierAccount: { findMany: async () => [{ id: 'acct-sr', label: 'Shiprocket - primary' }] },
    courierWalletBalance: {
      findFirst: async () =>
        opts.previousBalance === undefined || opts.previousBalance === null
          ? null
          : { balanceInr: new Prisma.Decimal(opts.previousBalance) },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        snapshots.push(data);
        return data;
      },
    },
    shipment: {
      findMany: async () =>
        (opts.shipments ?? []).map((s) => ({
          ...s,
          orderShipments: [{ order: { orderNumber: `SD-${s.id}` } }],
        })),
      // Present so a regression that writes a cost is caught, not crashed.
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return {};
      },
    },
    courierCostReading: {
      findFirst: async ({ where }: { where: { shipmentId: string } }) =>
        held[where.shipmentId] ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        readings.push(data);
        held[data['shipmentId'] as string] = {
          fingerprint: data['fingerprint'] as string,
          provisionalInr:
            data['provisionalInr'] === null
              ? null
              : new Prisma.Decimal(data['provisionalInr'] as string),
        };
        return data;
      },
    },
  };
  const http = {
    isStubMode: async () => opts.stub ?? false,
    request: async ({ path }: { path: string }) => {
      if (path.endsWith('wallet-balance'))
        return { data: { balance_amount: opts.balance ?? '1641.41' } };
      const id = decodeURIComponent(path.split('/').pop() ?? '');
      if (opts.failOn === id) throw new Error('Shiprocket GET failed (500)');
      return { data: opts.orders?.[id] };
    },
  };
  const audit = { log: jest.fn(async () => 'a1') };
  const issues = {
    raise: jest.fn(async () => ({ id: 'i', isNew: true })),
    resolveByKey: jest.fn(async () => 0),
  };
  const svc = new ShiprocketCostSyncService(
    { client } as unknown as PrismaService,
    http as unknown as ShiprocketHttpService,
    audit as unknown as AuditLogService,
    issues as unknown as SystemIssueService,
  );
  return { svc, updates, readings, snapshots, audit, issues };
}

const ship = (id: string, fwd: string | null = null, rto: string | null = null): Ship => ({
  id,
  awbNumber: `AWB-${id}`,
  courierOrderId: `SR-${id}`,
  actualCourierCostInr: fwd === null ? null : new Prisma.Decimal(fwd),
  actualRtoCostInr: rto === null ? null : new Prisma.Decimal(rto),
});
const srOrder = (status: string, charges: Record<string, unknown>) => ({
  status,
  awb_data: { awb: 'AWB', charges },
});

describe('ShiprocketCostSyncService', () => {
  it('does nothing while switched off, or while Shiprocket is a stub', async () => {
    expect((await makeSut({ enabled: false }).svc.sync('SCHEDULE')).skipped).toBe('DISABLED');
    expect((await makeSut({ stub: true }).svc.sync('SCHEDULE')).skipped).toBe('STUB_MODE');
  });

  it('never writes a cost — the wallet ledger is the only writer', async () => {
    // A returned parcel the ledger costed whole on the return column, and
    // a parcel Shiprocket has not billed yet.
    const s = makeSut({
      shipments: [ship('back', '0', '163.40'), ship('unbilled')],
      orders: {
        'SR-back': srOrder('RTO DELIVERED', {
          cod_charges: 47,
          charged_weight_amount: '114.40',
          charged_weight_amount_rto: '96.00',
          billing_amount: '163.40',
        }),
        'SR-unbilled': srOrder('DELIVERED', {
          freight_charges: 90.36,
          cod_charges: 42,
          billing_amount: '',
        }),
      },
    });

    const run = await s.svc.sync('MANUAL');

    expect(s.updates).toHaveLength(0);
    expect(run.accounts[0]).toMatchObject({
      finalCount: 1,
      provisionalOnly: 1,
      readingsStored: 2,
      ledgerAgrees: 1,
      ledgerDisagrees: 0,
    });
    expect(s.issues.resolveByKey).toHaveBeenCalledWith(
      'shiprocket-bill-vs-ledger:acct-sr',
      expect.any(String),
    );
  });

  it('names a final bill that disagrees with the wallet ledger, and says so', async () => {
    const s = makeSut({
      shipments: [ship('p', '90.00')],
      orders: {
        'SR-p': srOrder('DELIVERED', { freight_charges: '94.00', billing_amount: '94.00' }),
      },
    });
    const run = await s.svc.sync('MANUAL');
    expect(run.accounts[0]).toMatchObject({ ledgerDisagrees: 1 });
    expect(run.accounts[0]?.disagreements[0]).toMatchObject({
      awbNumber: 'AWB',
      orderNumber: 'SD-p',
      billedInr: '94.00',
      ledgerInr: '90.00',
    });
    expect(s.issues.raise).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'shiprocket-bill-vs-ledger:acct-sr' }),
    );
    expect(s.updates).toHaveLength(0);
  });

  it('a final bill the ledger has not costed yet is uncovered, not a disagreement', async () => {
    const s = makeSut({
      shipments: [ship('q')],
      orders: {
        'SR-q': srOrder('DELIVERED', { freight_charges: '94.00', billing_amount: '94.00' }),
      },
    });
    const run = await s.svc.sync('MANUAL');
    expect(run.accounts[0]).toMatchObject({ ledgerUncovered: 1, ledgerDisagrees: 0 });
    expect(s.issues.raise).not.toHaveBeenCalled();
  });

  it('stores a reading only when something changed', async () => {
    const orders = {
      'SR-p': srOrder('DELIVERED', { freight_charges: '94.00', billing_amount: '' }),
    };
    const s = makeSut({ shipments: [ship('p')], orders });
    await s.svc.sync('SCHEDULE');
    await s.svc.sync('SCHEDULE');
    expect(s.readings).toHaveLength(1);
  });

  it('one order that will not load does not stop the others', async () => {
    const s = makeSut({
      shipments: [ship('bad'), ship('good', '94.00')],
      failOn: 'SR-bad',
      orders: {
        'SR-good': srOrder('DELIVERED', { freight_charges: '94.00', billing_amount: '94.00' }),
      },
    });
    const run = await s.svc.sync('SCHEDULE');
    expect(run.accounts[0]).toMatchObject({ failed: 1, finalCount: 1, ledgerAgrees: 1 });
  });

  it('snapshots the wallet and reports what our parcels do not explain', async () => {
    // Balance fell 200; our one parcel's charges rose 94 → 106 unexplained.
    const s = makeSut({
      balance: '1441.41',
      previousBalance: '1641.41',
      shipments: [ship('p')],
      orders: { 'SR-p': srOrder('DELIVERED', { freight_charges: '94.00', billing_amount: '' }) },
    });
    const run = await s.svc.sync('SCHEDULE');
    expect(s.snapshots[0]?.['balanceInr']?.toString()).toBe('1441.41');
    expect(run.accounts[0]).toMatchObject({
      balanceChangeInr: '-200.00',
      parcelChargeChangeInr: '94.00',
      unexplainedInr: '-106.00',
    });
  });

  it('records every run in the audit trail, which is what the page reads', async () => {
    const s = makeSut({ shipments: [] });
    await s.svc.sync('MANUAL');
    expect(s.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'courier.shiprocket_cost.synced', entityId: null }),
    );
  });
});
