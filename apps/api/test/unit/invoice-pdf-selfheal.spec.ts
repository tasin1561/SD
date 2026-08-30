import { InvoiceService } from '../../src/modules/invoice/services/invoice.service';

/**
 * A presigned URL signs a KEY. It says nothing about whether an object
 * is at that key, so a row pointing at a vanished object produces a
 * NoSuchKey XML page in the seller's browser — the same shape of
 * failure as the AccessDenied it replaced, and just as silent.
 *
 * Production carried exactly one: an invoice row claiming 2604 bytes
 * with nothing in the bucket. The PDF is DERIVED data — `payloadSnapshot`
 * is the invoice as issued — so the fix rebuilds it rather than
 * apologising.
 */
describe('InvoiceService.ensurePdfObject', () => {
  const SNAPSHOT = { invoiceNumber: 'SD/INV/2026-27/000001' };

  function make(opts: {
    row: { id: string; pdfStorageKey: string | null; payloadSnapshot: unknown } | null;
    head: { size: number } | null;
    renderThrows?: boolean;
  }) {
    const update = jest.fn().mockResolvedValue({});
    const putObject = jest.fn().mockResolvedValue(undefined);
    const render = jest.fn(
      opts.renderThrows === true
        ? () => Promise.reject(new Error('render exploded'))
        : () => Promise.resolve(Buffer.from('%PDF-1.4 rebuilt')),
    );
    const prisma = {
      client: { invoice: { findUnique: jest.fn().mockResolvedValue(opts.row), update } },
    };
    const spaces = { headObject: jest.fn().mockResolvedValue(opts.head), putObject };
    const svc = new InvoiceService(
      prisma as never,
      spaces as never,
      {} as never,
      { render } as never,
      {} as never,
      {} as never,
    );
    return { svc, render, putObject, update, spaces };
  }

  it('does nothing when the object is already there', async () => {
    const { svc, render, putObject } = make({
      row: { id: 'inv-1', pdfStorageKey: 'invoices/s/a.pdf', payloadSnapshot: SNAPSHOT },
      head: { size: 2604 },
    });
    await expect(svc.ensurePdfObject('inv-1')).resolves.toBe(true);
    expect(render).not.toHaveBeenCalled();
    expect(putObject).not.toHaveBeenCalled();
  });

  it('rebuilds from the snapshot when the object is missing, and records the new size', async () => {
    const { svc, render, putObject, update } = make({
      row: { id: 'inv-1', pdfStorageKey: 'invoices/s/a.pdf', payloadSnapshot: SNAPSHOT },
      head: null,
    });
    await expect(svc.ensurePdfObject('inv-1')).resolves.toBe(true);
    expect(render).toHaveBeenCalledWith(SNAPSHOT);
    // Rebuilt in place: the key never changes, so every stored pointer
    // and every link already handed out stays correct.
    expect(putObject).toHaveBeenCalledWith(
      'invoices/s/a.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: { pdfSizeBytes: 16 },
    });
  });

  it('reports false rather than throwing when the rebuild fails', async () => {
    const { svc, update } = make({
      row: { id: 'inv-1', pdfStorageKey: 'invoices/s/a.pdf', payloadSnapshot: SNAPSHOT },
      head: null,
      renderThrows: true,
    });
    await expect(svc.ensurePdfObject('inv-1')).resolves.toBe(false);
    // A failed rebuild must not claim a size it did not write.
    expect(update).not.toHaveBeenCalled();
  });

  it('cannot rebuild without a snapshot, and says so instead of guessing', async () => {
    const { svc, render } = make({
      row: { id: 'inv-1', pdfStorageKey: 'invoices/s/a.pdf', payloadSnapshot: null },
      head: null,
    });
    await expect(svc.ensurePdfObject('inv-1')).resolves.toBe(false);
    // Re-deriving from live order rows would produce a DIFFERENT
    // invoice — prices and charges move after issue.
    expect(render).not.toHaveBeenCalled();
  });

  it('is false for an unknown invoice and for a row with no key', async () => {
    const { svc: a } = make({ row: null, head: null });
    await expect(a.ensurePdfObject('nope')).resolves.toBe(false);
    const { svc: b, spaces } = make({
      row: { id: 'inv-2', pdfStorageKey: null, payloadSnapshot: SNAPSHOT },
      head: null,
    });
    await expect(b.ensurePdfObject('inv-2')).resolves.toBe(false);
    expect(spaces.headObject).not.toHaveBeenCalled();
  });
});
