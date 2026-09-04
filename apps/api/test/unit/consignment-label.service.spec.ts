import { ConflictException } from '@nestjs/common';
import { ConsignmentLeg, LabellingSite } from '@skydrop/db';
import { ConsignmentLabelService } from '../../src/modules/consignment/services/consignment-label.service';
import { encodeCode128B } from '../../src/common/barcode/code128';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { ConsignmentService } from '../../src/modules/consignment/services/consignment.service';
import type { ConsignmentEventService } from '../../src/modules/consignment-core/services/consignment-event.service';
import type { InventoryModeService } from '../../src/modules/inventory-shared/inventory-mode.service';
import type { StockUnitService } from '../../src/modules/inventory-shared/stock-unit.service';

type AnyArgs = Record<string, unknown>;
const CONS = 'cons-1';
const STAFF = 'staff-1';
const CTX = { ipAddress: null, userAgent: null, requestId: null } as never;

function unitRow(serial: string): AnyArgs {
  return {
    serialBarcode: serial,
    batch: { expiresAt: null },
    variant: { skuCode: 'W-1', variantLabel: null, product: { name: 'Widget' } },
  };
}

function make(
  opts: {
    labelsPrintedAt?: Date | null;
    units?: AnyArgs[];
    site?: LabellingSite;
  } = {},
) {
  const consignment = {
    id: CONS,
    consignmentNumber: 'CN-1',
    sellerId: 'seller-1',
    labellingSite: opts.site ?? LabellingSite.IN,
    labelsPrintedAt: opts.labelsPrintedAt ?? null,
    // legIdsForSite reads `receipts`; one COMPLETED India leg is enough.
    receipts: [{ id: 'gr-in', leg: ConsignmentLeg.IN_FINAL, status: 'COMPLETED' }],
  };
  const stockUnitFindMany = jest.fn(async () => opts.units ?? [unitRow('SDU-AAA')]);
  const client: AnyArgs = {
    stockUnit: { findMany: stockUnitFindMany },
    consignment: { updateMany: jest.fn(async () => ({ count: 1 })) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  const auditLog = jest.fn(async () => 'a');
  const recordLabelReprint = jest.fn(async () => (opts.units ?? [unitRow('SDU-AAA')]).length);
  const svc = new ConsignmentLabelService(
    { client } as unknown as PrismaService,
    { log: auditLog } as unknown as AuditLogService,
    { requireById: async () => consignment } as unknown as ConsignmentService,
    { append: jest.fn(async () => undefined) } as unknown as ConsignmentEventService,
    {} as unknown as InventoryModeService,
    { recordLabelReprint } as unknown as StockUnitService,
  );
  return { svc, auditLog, recordLabelReprint, stockUnitFindMany };
}

describe('ConsignmentLabelService — a unique serial is printed ONCE', () => {
  it('prints the sheet the first time', async () => {
    const { svc } = make({ labelsPrintedAt: null });
    const sheet = await svc.print(STAFF, CONS, CTX);
    expect(sheet.labels).toHaveLength(1);
    // Scannable, not a string somebody has to type at every gate.
    expect(sheet.labels[0]?.barcodeWidths).toEqual(encodeCode128B('SDU-AAA'));
  });

  it('REFUSES a second sheet, because that is a second sticker on every unit', async () => {
    // The ledger cannot even hold two units with one serial
    // (@@unique(sellerId, serialBarcode)), so a duplicate does not
    // announce itself — it surfaces later as a unit already picked for
    // a different parcel, at the bench, with a customer waiting.
    const { svc } = make({ labelsPrintedAt: new Date('2026-09-01T10:00:00Z') });
    await expect(svc.print(STAFF, CONS, CTX)).rejects.toMatchObject({
      response: { code: 'LABELS_ALREADY_PRINTED' },
    });
  });

  it('the refusal says WHEN it was labelled, not just no', async () => {
    const { svc } = make({ labelsPrintedAt: new Date('2026-09-01T10:00:00Z') });
    await expect(svc.print(STAFF, CONS, CTX)).rejects.toMatchObject({
      response: { message: expect.stringContaining('2026-09-01') },
    });
  });
});

describe('ConsignmentLabelService.reprintUnits — the damaged sticker', () => {
  const REASON = 'Label torn off in the carton during transit; unit itself is intact.';

  it('reprints only the named unit, and records it on that unit’s ledger', async () => {
    const { svc, recordLabelReprint } = make({
      labelsPrintedAt: new Date(),
      units: [unitRow('SDU-AAA')],
    });
    const sheet = await svc.reprintUnits(STAFF, CONS, ['SDU-AAA'], REASON, CTX);
    expect(sheet.labels).toHaveLength(1);
    // On the UNIT, because the question asked later is "has THIS serial
    // been printed twice?" — a question about the unit, not the sheet.
    expect(recordLabelReprint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serials: ['SDU-AAA'], reason: REASON }),
    );
  });

  it('audits HIGH with the serials, so "how often" has an answer', async () => {
    const { svc, auditLog } = make({ labelsPrintedAt: new Date() });
    await svc.reprintUnits(STAFF, CONS, ['SDU-AAA'], REASON, CTX);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consignment.labels_reprinted',
        severity: 'HIGH',
        metadata: expect.objectContaining({ serials: ['SDU-AAA'], reason: REASON }),
      }),
    );
  });

  it('NAMES a serial this consignment does not own rather than dropping it', async () => {
    // Printing four of the five somebody asked for, with no comment, is
    // how the fifth box stays unlabelled.
    const { svc } = make({ labelsPrintedAt: new Date(), units: [unitRow('SDU-AAA')] });
    await expect(
      svc.reprintUnits(STAFF, CONS, ['SDU-AAA', 'SDU-GHOST'], REASON, CTX),
    ).rejects.toMatchObject({
      response: {
        code: 'SERIAL_NOT_ON_CONSIGNMENT',
        message: expect.stringContaining('SDU-GHOST'),
      },
    });
  });

  it('refuses when the sheet was never printed — there is nothing to reprint', async () => {
    const { svc } = make({ labelsPrintedAt: null });
    await expect(svc.reprintUnits(STAFF, CONS, ['SDU-AAA'], REASON, CTX)).rejects.toMatchObject({
      response: { code: 'LABELS_NOT_PRINTED_YET' },
    });
  });

  it('de-duplicates a serial asked for twice', async () => {
    const { svc, recordLabelReprint } = make({ labelsPrintedAt: new Date() });
    await svc.reprintUnits(STAFF, CONS, ['SDU-AAA', 'SDU-AAA'], REASON, CTX);
    expect(recordLabelReprint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serials: ['SDU-AAA'] }),
    );
  });

  it('rejects an empty list rather than printing nothing quietly', async () => {
    const { svc } = make({ labelsPrintedAt: new Date() });
    await expect(svc.reprintUnits(STAFF, CONS, ['  '], REASON, CTX)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
