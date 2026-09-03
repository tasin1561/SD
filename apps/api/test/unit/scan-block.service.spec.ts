import { ConflictException } from '@nestjs/common';
import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import { ScanBlockService } from '../../src/modules/system-issues/services/scan-block.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { SystemIssueService } from '../../src/modules/system-issues/services/system-issue.service';

type AnyArgs = Record<string, unknown>;
const STAFF = 'packer-1';

function make(open: AnyArgs | null = null, findThrows = false) {
  const findFirst = jest.fn(async () => {
    if (findThrows) throw new Error('db down');
    return open;
  });
  const raise = jest.fn(async () => ({ id: 'issue-1', isNew: true }));
  const svc = new ScanBlockService(
    { client: { systemIssue: { findFirst } } } as unknown as PrismaService,
    { raise } as unknown as SystemIssueService,
  );
  return { svc, findFirst, raise };
}

describe('ScanBlockService — a repeated box stops the person who scanned it', () => {
  it('lets an unblocked operator through', async () => {
    const { svc } = make(null);
    await expect(svc.assertNotBlocked(STAFF)).resolves.toBeUndefined();
  });

  it('refuses a blocked operator and says who has to clear it', async () => {
    const { svc } = make({
      id: 'issue-1',
      title: 'SH-1 was scanned again at the packing bench',
      detail: 'go and look at the box',
      metadata: { shipmentNumber: 'SH-1' },
      firstSeenAt: new Date(),
    });
    await expect(svc.assertNotBlocked(STAFF)).rejects.toMatchObject({
      response: {
        code: 'SCAN_BLOCKED',
        message: expect.stringContaining('admin'),
        issueId: 'issue-1',
      },
    });
  });

  it('is scoped to ONE operator — the other three packers are not stopped', async () => {
    // Halting the building over one bench's duplicate costs more than
    // the duplicate. The query is keyed on the staff member, so this is
    // structural rather than a promise.
    const { svc, findFirst } = make(null);
    await svc.assertNotBlocked(STAFF);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blocksScanForStaffId: STAFF, resolvedAt: null },
      }),
    );
  });

  it('FAILS OPEN when the block cannot be read', async () => {
    // A warehouse that cannot pack because a query failed is a worse
    // outage than a missed duplicate — and the duplicate surfaces again
    // on the next scan anyway.
    const { svc } = make(null, true);
    await expect(svc.assertNotBlocked(STAFF)).resolves.toBeUndefined();
  });

  it('refuseDuplicate raises a blocking HIGH issue and always throws', async () => {
    const { svc, raise } = make(null);
    await expect(
      svc.refuseDuplicate({
        flow: 'PACK',
        staffId: STAFF,
        shipmentId: 'ship-1',
        shipmentNumber: 'SH-1',
        awbNumber: 'DLV-1',
        observed: 'packed',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(raise).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: SystemIssueKind.WAREHOUSE_SCAN,
        severity: SystemIssueSeverity.HIGH,
        // Keyed on the PARCEL: the same box scanned twice by two people
        // is one problem seen twice, not two problems.
        dedupeKey: 'duplicate-scan:PACK:ship-1',
        blocksScanForStaffId: STAFF,
      }),
    );
  });

  it('the refusal names the parcel, because "a duplicate" sends nobody anywhere', async () => {
    const { svc } = make(null);
    await expect(
      svc.refuseDuplicate({
        flow: 'HANDOVER',
        staffId: STAFF,
        shipmentId: 'ship-9',
        shipmentNumber: 'SH-9',
        awbNumber: 'DLV-9',
        observed: 'with the courier',
      }),
    ).rejects.toMatchObject({
      response: { code: 'DUPLICATE_SCAN', shipmentNumber: 'SH-9' },
    });
  });
});
