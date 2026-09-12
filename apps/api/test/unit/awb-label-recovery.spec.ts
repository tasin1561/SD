import { ActorType, ShipmentStatus } from '@skydrop/db';
import {
  AwbGenerationService,
  type LabelOnlyOutcome,
} from '../../src/modules/courier-awb/services/awb-generation.service';
import { AwbLabelRecoveryService } from '../../src/modules/courier-awb/services/awb-label-recovery.service';
import { makeTestEnv } from '../helpers/env';

/**
 * CUR-6 — a waybill with no stored label, found and fixed.
 *
 * Production on 2026-09-12: 2 of 2 saga-booked waybills had a label, and
 * 26 waybills written by the tracking-test seeding script had none. The
 * label leg itself was only ever tried inside the AWB job, which gave up
 * after ~20 seconds and never asked again. These pin the label-ONLY path
 * that asks later: it stores, it skips what it must, and it can never book.
 */

type AnyArgs = Record<string, unknown>;
const PDF = Buffer.from('%PDF-1.4\n% label\n%%EOF\n');

function shipment(over: AnyArgs = {}): AnyArgs {
  return {
    awbNumber: '38061110523994',
    courierShipmentId: null,
    courierCode: 'delhivery',
    courierAccountId: 'acct-1',
    isManualCourier: false,
    deletedAt: null,
    supersededAt: null,
    awbLabels: [],
    ...over,
  };
}

function makeGeneration(
  opts: {
    row?: AnyArgs | null;
    label?: { bytes: Buffer; mimeType: string };
    production?: boolean;
    stub?: boolean;
  } = {},
) {
  const txAwbLabelCreate = jest.fn(async (_args: AnyArgs) => ({}));
  const txClient = { awbLabel: { create: txAwbLabelCreate, updateMany: jest.fn() } };
  const client = {
    shipment: { findUnique: jest.fn(async () => (opts.row === undefined ? shipment() : opts.row)) },
    awbLabel: { findFirst: jest.fn(async () => null) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(txClient),
  };
  const putObject = jest.fn(async (_k: string, _b: Buffer, _m: string) => undefined);
  const auditLog = jest.fn(async (_e: AnyArgs, _tx?: unknown) => 'a');
  const dispatch = {
    // The booking call. Present so a test can prove it is NEVER reached.
    generate: jest.fn(),
    fetchLabel: jest.fn(async () => opts.label ?? { bytes: PDF, mimeType: '' }),
    isStubMode: jest.fn(async () => opts.stub ?? false),
    hasAdapter: (c: string): boolean => c === 'delhivery' || c === 'shiprocket',
  };
  const svc = new AwbGenerationService(
    { client } as never,
    makeTestEnv(opts.production ? { NODE_ENV: 'production' } : {}),
    { putObject } as never,
    { log: auditLog } as never,
    dispatch as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc, dispatch, putObject, txAwbLabelCreate, auditLog };
}

describe('AwbGenerationService.persistLabelForExistingAwb', () => {
  it('fetches through the dispatcher, stores the PDF, and never calls the booking API', async () => {
    const { svc, dispatch, putObject, txAwbLabelCreate, auditLog } = makeGeneration();
    const out = await svc.persistLabelForExistingAwb('ship-1', {
      type: ActorType.STAFF,
      id: 'staff-1',
    });

    expect(out).toMatchObject({ status: 'STORED', labelVersion: 1 });
    expect(dispatch.generate).not.toHaveBeenCalled();
    expect(dispatch.fetchLabel).toHaveBeenCalledWith(
      expect.objectContaining({ courierCode: 'delhivery', awbNumber: '38061110523994' }),
      expect.anything(),
    );
    // Delhivery sends an EMPTY Content-Type; the bytes say it is a PDF.
    expect(putObject).toHaveBeenCalledWith(
      'awb-labels/ship-1/v1-38061110523994.pdf',
      PDF,
      'application/pdf',
    );
    expect(txAwbLabelCreate.mock.calls[0]?.[0]).toMatchObject({
      data: { mimeType: 'application/pdf', isCurrent: true, generatedByStaffId: 'staff-1' },
    });
    expect(auditLog.mock.calls.map(([e]) => e.action)).toEqual(['awb.label_persisted']);
  });

  it.each<[string, AnyArgs | null, string]>([
    [
      'a shipment with no waybill — it must never be booked from here',
      { awbNumber: null },
      'NO_AWB',
    ],
    [
      'a manual courier (a paper docket has no PDF)',
      { isManualCourier: true, courierCode: 'manual' },
      'MANUAL_COURIER',
    ],
    ['a courier with no adapter', { courierCode: 'bluedart' }, 'NO_LABEL_ADAPTER'],
    ['one that already has a current label', { awbLabels: [{ id: 'l1' }] }, 'ALREADY_HAS_LABEL'],
    ['a superseded shipment', { supersededAt: new Date() }, 'RETIRED'],
    ['a voided shipment', { deletedAt: new Date() }, 'RETIRED'],
  ])('skips %s', async (_what, over, reason) => {
    const { svc, dispatch, putObject } = makeGeneration({ row: shipment(over ?? {}) });
    const out = await svc.persistLabelForExistingAwb('ship-1');
    expect(out).toEqual({ status: 'SKIPPED', shipmentId: 'ship-1', reason });
    expect(dispatch.generate).not.toHaveBeenCalled();
    expect(dispatch.fetchLabel).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('skips a missing shipment', async () => {
    const { svc } = makeGeneration({ row: null });
    expect(await svc.persistLabelForExistingAwb('nope')).toMatchObject({
      status: 'SKIPPED',
      reason: 'SHIPMENT_NOT_FOUND',
    });
  });

  it('in production, never stores a STUBBED courier’s fabricated label for a real waybill', async () => {
    const { svc, dispatch } = makeGeneration({
      row: shipment({ courierCode: 'shiprocket', courierShipmentId: '1567937481' }),
      production: true,
      stub: true,
    });
    expect(await svc.persistLabelForExistingAwb('ship-1')).toMatchObject({
      status: 'SKIPPED',
      reason: 'COURIER_STUBBED',
    });
    expect(dispatch.fetchLabel).not.toHaveBeenCalled();
  });

  it('refuses a download that is not a label — an HTML page stays PENDING and nothing is stored', async () => {
    const { svc, putObject, txAwbLabelCreate } = makeGeneration({
      label: { bytes: Buffer.from('<html>Access Denied</html>'), mimeType: 'text/html' },
    });
    const out = await svc.persistLabelForExistingAwb('ship-1');
    expect(out.status).toBe('PENDING');
    expect(out.status === 'PENDING' ? out.errorMessage : '').toMatch(/^LABEL_NOT_A_PDF/);
    expect(putObject).not.toHaveBeenCalled();
    expect(txAwbLabelCreate).not.toHaveBeenCalled();
  });
});

describe('AwbGenerationService.labelMimeType', () => {
  it('trusts the bytes over the header', () => {
    expect(AwbGenerationService.labelMimeType(PDF, '')).toBe('application/pdf');
    expect(AwbGenerationService.labelMimeType(PDF, 'binary/octet-stream')).toBe('application/pdf');
  });
  it('keeps an honestly-typed image', () => {
    expect(AwbGenerationService.labelMimeType(Buffer.from([0x89, 0x50]), 'image/png')).toBe(
      'image/png',
    );
  });
  it('refuses anything else', () => {
    expect(() => AwbGenerationService.labelMimeType(Buffer.from('{}'), '')).toThrow(
      /LABEL_NOT_A_PDF.*unlabelled content/,
    );
  });
});

describe('AwbLabelRecoveryService', () => {
  function missingRow(id: string, courierCode = 'delhivery'): AnyArgs {
    return {
      id,
      shipmentNumber: `SH-${id}`,
      awbNumber: `AWB-${id}`,
      courierCode,
      status: ShipmentStatus.DELIVERED,
      awbGeneratedAt: null,
      createdAt: new Date('2026-08-27T15:11:17Z'),
      orderShipments: [{ order: { id: `ord-${id}`, orderNumber: `SD-${id}` } }],
    };
  }

  function makeRecovery(rows: AnyArgs[], outcomes: Record<string, LabelOnlyOutcome | Error>) {
    const findMany = jest.fn(async (_args: AnyArgs) => rows);
    const auditLog = jest.fn(async (_e: AnyArgs) => 'a');
    const persistLabelForExistingAwb = jest.fn(async (id: string) => {
      const o = outcomes[id];
      if (o instanceof Error) throw o;
      return (
        o ?? { status: 'SKIPPED' as const, shipmentId: id, reason: 'ALREADY_HAS_LABEL' as const }
      );
    });
    const generateForShipment = jest.fn();
    const svc = new AwbLabelRecoveryService(
      { client: { shipment: { findMany } } } as never,
      { log: auditLog } as never,
      { persistLabelForExistingAwb, generateForShipment } as never,
      { hasAdapter: (c: string): boolean => c === 'delhivery' || c === 'shiprocket' } as never,
    );
    return { svc, findMany, auditLog, persistLabelForExistingAwb, generateForShipment };
  }

  it('looks only at live, non-manual waybills with no CURRENT label, oldest first', async () => {
    const { svc, findMany } = makeRecovery([], {});
    await svc.findMissing({ scope: 'PRE_DISPATCH', limit: 10 });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        awbNumber: { not: null },
        isManualCourier: false,
        deletedAt: null,
        supersededAt: null,
        awbLabels: { none: { isCurrent: true } },
        status: ShipmentStatus.CREATED,
      },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    await svc.findMissing({ scope: 'ALL', limit: 10 });
    expect((findMany.mock.calls[1]?.[0] as { where: AnyArgs }).where.status).toBeUndefined();
  });

  it('drops a courier with no adapter — there is no label to fetch', async () => {
    const { svc } = makeRecovery([missingRow('a'), missingRow('b', 'manual-xpress')], {});
    const found = await svc.findMissing({ scope: 'ALL', limit: 10 });
    expect(found.map((m) => m.shipmentId)).toEqual(['a']);
  });

  it('a DRY RUN lists what it would fetch and calls nobody', async () => {
    const { svc, persistLabelForExistingAwb, auditLog } = makeRecovery([missingRow('a')], {});
    const r = await svc.backfill({ scope: 'ALL', limit: 25, dryRun: true, staffId: 'staff-1' });
    expect(r).toMatchObject({ dryRun: true, considered: 1, stored: 0 });
    expect(r.rows[0]).toMatchObject({ shipmentId: 'a', result: 'WOULD_FETCH' });
    expect(persistLabelForExistingAwb).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('a real run stores, isolates each failure, never books, and audits the run', async () => {
    const { svc, persistLabelForExistingAwb, generateForShipment, auditLog } = makeRecovery(
      [missingRow('a'), missingRow('b'), missingRow('c')],
      {
        a: {
          status: 'STORED',
          shipmentId: 'a',
          awbNumber: 'AWB-a',
          labelSpacesKey: 'k',
          labelVersion: 1,
        },
        b: new Error('socket hang up'),
        c: { status: 'SKIPPED', shipmentId: 'c', reason: 'ALREADY_HAS_LABEL' },
      },
    );
    const r = await svc.backfill({ scope: 'ALL', limit: 25, dryRun: false, staffId: 'staff-1' });

    expect(r).toMatchObject({ considered: 3, stored: 1, pending: 1, skipped: 1 });
    expect(r.rows.find((x) => x.shipmentId === 'b')).toMatchObject({
      result: 'PENDING',
      detail: 'socket hang up',
    });
    expect(persistLabelForExistingAwb).toHaveBeenCalledTimes(3);
    expect(persistLabelForExistingAwb).toHaveBeenCalledWith('a', {
      type: ActorType.STAFF,
      id: 'staff-1',
    });
    expect(generateForShipment).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'awb.label_backfill_run',
        entityId: null,
        severity: 'MEDIUM',
        metadata: expect.objectContaining({ stored: 1, pending: 1, skipped: 1 }),
      }),
    );
  });
});
