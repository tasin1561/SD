import { LabelReprintRequestStatus, LabellingSite } from '@skydrop/db';
import {
  LABEL_REPRINT_APPROVER_PERMISSION,
  LABEL_REPRINT_REQUESTED_TOPIC,
  LabelReprintRequestService,
  REPRINT_APPROVAL_TTL_MS,
  reprintState,
} from '../../src/modules/consignment/services/label-reprint-request.service';
import type { ConsignmentLabelService } from '../../src/modules/consignment/services/consignment-label.service';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import type { AuditLogService } from '../../src/modules/auth-common/services/audit-log.service';
import type { NotificationDispatchService } from '../../src/modules/notification-audience/services/notification-dispatch.service';

type AnyArgs = Record<string, unknown>;

const REQ = 'req-1';
const CONS = 'cons-1';
const ASKER = 'staff-asker';
const APPROVER = 'staff-approver';
const REASON = 'Label torn off in the carton during transit; unit itself is intact.';
const CTX = { ipAddress: null, userAgent: null, requestId: null } as never;
const HOUR = 60 * 60 * 1000;

function row(over: AnyArgs = {}): AnyArgs {
  return {
    id: REQ,
    consignmentId: CONS,
    sellerId: 'seller-1',
    serials: ['SDU-AAA'],
    reason: REASON,
    status: LabelReprintRequestStatus.PENDING,
    requestedByStaffId: ASKER,
    decidedByStaffId: null,
    decidedAt: null,
    decisionNote: null,
    printedAt: null,
    createdAt: new Date('2026-09-15T08:00:00Z'),
    consignment: { consignmentNumber: 'CN-1' },
    requestedBy: { id: ASKER, emailDisplay: 'asker@skydrop.online' },
    decidedBy: null,
    ...over,
  };
}

function approved(hoursAgo: number, over: AnyArgs = {}): AnyArgs {
  return row({
    status: LabelReprintRequestStatus.APPROVED,
    decidedByStaffId: APPROVER,
    decidedAt: new Date(Date.now() - hoursAgo * HOUR),
    decidedBy: { id: APPROVER, emailDisplay: 'approver@skydrop.online' },
    ...over,
  });
}

function make(
  current: AnyArgs | null = row(),
  opts: { open?: AnyArgs[]; claimed?: number; dispatchFails?: boolean } = {},
) {
  const findMany = jest.fn(async () => opts.open ?? []);
  const create = jest.fn(async () => ({ id: REQ }));
  const findUnique = jest.fn(async () => current);
  const updateMany = jest.fn(async () => ({ count: opts.claimed ?? 1 }));
  const executeRaw = jest.fn(async () => 1);
  const client: AnyArgs = {
    labelReprintRequest: { findMany, create, findUnique, updateMany },
    $executeRaw: executeRaw,
  };
  client.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(client);

  const sheet = { consignmentNumber: 'CN-1', labels: [{ serialBarcode: 'SDU-AAA' }] };
  const unitsForReprint = jest.fn(async () => ({
    consignment: {
      id: CONS,
      consignmentNumber: 'CN-1',
      sellerId: 'seller-1',
      labellingSite: LabellingSite.IN,
    },
    serials: ['SDU-AAA'],
    units: [{ serialBarcode: 'SDU-AAA' }],
  }));
  const recordReprint = jest.fn(async () => undefined);
  const sheetFor = jest.fn(() => sheet);
  const auditLog = jest.fn(async () => 'a');
  const dispatch = jest.fn(async () => {
    if (opts.dispatchFails) throw new Error('mail server down');
    return { groupId: 'g', recipients: 2, delivered: 2, skipped: 0, failures: 0 };
  });

  const svc = new LabelReprintRequestService(
    { client } as unknown as PrismaService,
    { log: auditLog } as unknown as AuditLogService,
    { unitsForReprint, recordReprint, sheetFor } as unknown as ConsignmentLabelService,
    { dispatch } as unknown as NotificationDispatchService,
  );
  return {
    svc,
    findMany,
    create,
    updateMany,
    executeRaw,
    unitsForReprint,
    recordReprint,
    auditLog,
    dispatch,
    sheet,
  };
}

describe('reprintState — an approval lapses after 24 hours, and nothing stores that', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const at = (ms: number) => new Date(now.getTime() - ms);

  it('an approval is still good one minute before the window closes', () => {
    const s = {
      status: LabelReprintRequestStatus.APPROVED,
      decidedAt: at(REPRINT_APPROVAL_TTL_MS - 60_000),
    };
    expect(reprintState(s, now)).toBe(LabelReprintRequestStatus.APPROVED);
  });

  it('is EXPIRED once 24 hours have passed', () => {
    const s = {
      status: LabelReprintRequestStatus.APPROVED,
      decidedAt: at(REPRINT_APPROVAL_TTL_MS),
    };
    expect(reprintState(s, now)).toBe('EXPIRED');
  });

  it('only an approval lapses — a pending request waits however old it is', () => {
    const s = { status: LabelReprintRequestStatus.PENDING, decidedAt: null };
    expect(reprintState(s, now)).toBe(LabelReprintRequestStatus.PENDING);
  });
});

describe('LabelReprintRequestService.request — asking prints nothing', () => {
  it('checks the serials at the bench, holds the consignment lock, records the request', async () => {
    const { svc, unitsForReprint, executeRaw, create, recordReprint, auditLog } = make();
    const view = await svc.request(ASKER, CONS, ['SDU-AAA', 'SDU-AAA'], REASON, CTX);

    expect(unitsForReprint).toHaveBeenCalledWith(CONS, ['SDU-AAA', 'SDU-AAA']);
    expect(executeRaw).toHaveBeenCalled(); // the LABEL_REPRINT advisory lock
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          consignmentId: CONS,
          serials: ['SDU-AAA'],
          requestedByStaffId: ASKER,
        }),
      }),
    );
    expect(recordReprint).not.toHaveBeenCalled();
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consignment.label_reprint.requested',
        entityId: REQ,
        severity: 'MEDIUM',
      }),
      expect.anything(),
    );
    expect(view.state).toBe(LabelReprintRequestStatus.PENDING);
  });

  it('tells everyone who can approve, in-app, once per request', async () => {
    const { svc, dispatch } = make();
    await svc.request(ASKER, CONS, ['SDU-AAA'], REASON, CTX);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: LABEL_REPRINT_REQUESTED_TOPIC,
        audience: [{ kind: 'STAFF_PERMISSION', permission: LABEL_REPRINT_APPROVER_PERMISSION }],
        eventId: `label_reprint:${REQ}:requested`,
      }),
    );
  });

  it('a failed notice never fails the request', async () => {
    const { svc } = make(row(), { dispatchFails: true });
    await expect(svc.request(ASKER, CONS, ['SDU-AAA'], REASON, CTX)).resolves.toMatchObject({
      id: REQ,
    });
  });

  it('refuses a serial already on an open request, by name', async () => {
    const { svc, create } = make(row(), { open: [{ serials: ['SDU-AAA'] }] });
    await expect(svc.request(ASKER, CONS, ['SDU-AAA'], REASON, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_ALREADY_REQUESTED', message: expect.stringContaining('SDU-AAA') },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('counts only PENDING and still-good approvals as open', async () => {
    const { svc, findMany } = make();
    await svc.request(ASKER, CONS, ['SDU-AAA'], REASON, CTX);
    const where = (findMany.mock.calls[0] as unknown as [{ where: AnyArgs }])[0].where;
    expect(where).toMatchObject({
      consignmentId: CONS,
      serials: { hasSome: ['SDU-AAA'] },
      OR: [
        { status: LabelReprintRequestStatus.PENDING },
        {
          status: LabelReprintRequestStatus.APPROVED,
          decidedAt: { gt: expect.any(Date) },
        },
      ],
    });
  });
});

describe('LabelReprintRequestService.approve / reject — a SECOND person', () => {
  it('refuses the person who asked: a second person cannot be the same person', async () => {
    const { svc, updateMany } = make();
    await expect(svc.approve(ASKER, REQ, undefined, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_SELF_APPROVAL' },
    });
    await expect(svc.reject(ASKER, REQ, 'No, not like this', CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_SELF_APPROVAL' },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('approves with a write guarded on PENDING and on not being the requester, audited HIGH', async () => {
    const { svc, updateMany, auditLog } = make();
    await svc.approve(APPROVER, REQ, 'Checked the box', CTX);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: REQ,
        status: LabelReprintRequestStatus.PENDING,
        requestedByStaffId: { not: APPROVER },
      },
      data: expect.objectContaining({
        status: LabelReprintRequestStatus.APPROVED,
        decidedByStaffId: APPROVER,
        decisionNote: 'Checked the box',
      }),
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consignment.label_reprint.approved',
        severity: 'HIGH',
        metadata: expect.objectContaining({ requestedByStaffId: ASKER }),
      }),
      expect.anything(),
    );
  });

  it('two approvers at once: the one who loses the write is told it was decided', async () => {
    const { svc, auditLog } = make(row(), { claimed: 0 });
    await expect(svc.approve(APPROVER, REQ, undefined, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_ALREADY_DECIDED' },
    });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('refuses to decide a request twice', async () => {
    const { svc } = make(row({ status: LabelReprintRequestStatus.REJECTED }));
    await expect(svc.approve(APPROVER, REQ, undefined, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_ALREADY_DECIDED' },
    });
  });

  it('rejects with the reason the requester will read', async () => {
    const { svc, updateMany, auditLog } = make();
    await svc.reject(APPROVER, REQ, '  That serial is on the shelf, intact  ', CTX);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: LabelReprintRequestStatus.REJECTED,
          decisionNote: 'That serial is on the shelf, intact',
        }),
      }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consignment.label_reprint.rejected' }),
      expect.anything(),
    );
  });
});

describe('LabelReprintRequestService.print — once, by the person who asked', () => {
  it('the APPROVER cannot print it: neither person can make a sticker alone', async () => {
    const { svc, updateMany } = make(approved(1));
    await expect(svc.print(APPROVER, REQ, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_NOT_REQUESTER' },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses before anybody has approved it', async () => {
    const { svc } = make(row());
    await expect(svc.print(ASKER, REQ, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_NOT_APPROVED' },
    });
  });

  it('refuses a rejected request', async () => {
    const { svc } = make(row({ status: LabelReprintRequestStatus.REJECTED, decisionNote: 'no' }));
    await expect(svc.print(ASKER, REQ, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_REJECTED' },
    });
  });

  it('refuses an approval older than 24 hours, and writes nothing', async () => {
    const { svc, updateMany, recordReprint } = make(approved(25));
    await expect(svc.print(ASKER, REQ, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_APPROVAL_EXPIRED' },
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordReprint).not.toHaveBeenCalled();
  });

  it('prints: claims APPROVED → PRINTED inside the window, records on the unit ledger, audits HIGH', async () => {
    const { svc, updateMany, recordReprint, auditLog, sheet } = make(approved(2));
    const out = await svc.print(ASKER, REQ, CTX);

    expect(out).toBe(sheet);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: REQ,
        status: LabelReprintRequestStatus.APPROVED,
        requestedByStaffId: ASKER,
        decidedAt: { gt: expect.any(Date) },
      },
      data: expect.objectContaining({
        status: LabelReprintRequestStatus.PRINTED,
        printedByStaffId: ASKER,
      }),
    });
    expect(recordReprint).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ serials: ['SDU-AAA'], reason: REASON, staffId: ASKER }),
    );
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'consignment.labels_reprinted',
        severity: 'HIGH',
        metadata: expect.objectContaining({
          reprintRequestId: REQ,
          requestedByStaffId: ASKER,
          approvedByStaffId: APPROVER,
          serials: ['SDU-AAA'],
        }),
      }),
      expect.anything(),
    );
  });

  it('prints ONCE: a second press is refused', async () => {
    const { svc } = make(
      approved(2, {
        status: LabelReprintRequestStatus.PRINTED,
        printedAt: new Date('2026-09-15T09:00:00Z'),
      }),
    );
    await expect(svc.print(ASKER, REQ, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_ALREADY_PRINTED', message: expect.stringContaining('2026-09-15') },
    });
  });

  it('two presses at once: the loser records nothing on the unit ledger', async () => {
    const { svc, recordReprint } = make(approved(2), { claimed: 0 });
    await expect(svc.print(ASKER, REQ, CTX)).rejects.toMatchObject({
      response: { code: 'REPRINT_ALREADY_PRINTED' },
    });
    expect(recordReprint).not.toHaveBeenCalled();
  });
});

describe('LabelReprintRequestService.list', () => {
  it('shows a lapsed approval as EXPIRED, with when it lapsed', async () => {
    const r = approved(30);
    const { svc } = make(null, { open: [r] });
    const [view] = await svc.list(CONS);
    expect(view?.state).toBe('EXPIRED');
    expect(view?.approvalExpiresAt).toEqual(
      new Date((r['decidedAt'] as Date).getTime() + REPRINT_APPROVAL_TTL_MS),
    );
  });
});
