import { CourierTemplateReviewService } from '../../src/modules/courier-escalation/services/courier-template-review.service';

/**
 * Promotion, and the one mistake that would look like success.
 *
 * A pattern promoted from a candidate it does not match compiles fine,
 * saves fine, and then silently never fires — or worse, over-matches
 * something else. Nothing fails; the library just quietly labels messages
 * wrong, and the label is what a seller is shown. So the check that it
 * MATCHES THE BODY is the load-bearing test here, not the compile check.
 */

const CANDIDATE = {
  id: 'cand-1',
  body: 'Your shipment 1234567890 has been rescheduled for delivery within 24-48 hours.',
  seenCount: 12,
};

function make(opts: { candidate?: typeof CANDIDATE | null } = {}) {
  const audits: Record<string, unknown>[] = [];
  const candidateUpdates: Record<string, unknown>[] = [];

  const prisma = {
    client: {
      courierTemplateCandidate: {
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.candidate === undefined ? CANDIDATE : opts.candidate),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
          candidateUpdates.push(a.data);
          return Promise.resolve({});
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      courierMessageTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockImplementation((a: { create: Record<string, unknown> }) =>
          Promise.resolve({
            id: 'tpl-1',
            code: a.create.code,
            pattern: a.create.pattern,
            state: a.create.state,
            action: a.create.action ?? null,
            priority: a.create.priority ?? 50,
            isActive: true,
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
    },
  };

  const audit = {
    log: jest.fn().mockImplementation((row: Record<string, unknown>) => {
      audits.push(row);
      return Promise.resolve();
    }),
  };

  const svc = new CourierTemplateReviewService(prisma as never, audit as never);
  return { svc, prisma, audits, candidateUpdates };
}

const base = {
  candidateId: 'cand-1',
  code: 'NDR_ACK_24_48',
  state: 'ACKNOWLEDGED',
  staffId: 'staff-1',
};

describe('CourierTemplateReviewService.promote', () => {
  it('saves a pattern that matches the message it came from', async () => {
    const { svc, prisma, candidateUpdates, audits } = make();

    const tpl = await svc.promote({ ...base, pattern: 'rescheduled for delivery within 24-48' });

    expect(tpl).toMatchObject({ code: 'NDR_ACK_24_48', state: 'ACKNOWLEDGED' });
    expect(prisma.client.courierMessageTemplate.upsert).toHaveBeenCalled();
    // The candidate is marked, not deleted: the body is the evidence for
    // why the pattern exists.
    expect(candidateUpdates[0]).toMatchObject({ status: 'PROMOTED', reviewedByStaffId: 'staff-1' });
    expect(audits[0]).toMatchObject({ action: 'courier.template.promoted', severity: 'MEDIUM' });
  });

  it('matches case-insensitively, the way the classifier will', async () => {
    const { svc } = make();
    await expect(
      svc.promote({ ...base, pattern: 'RESCHEDULED FOR DELIVERY' }),
    ).resolves.toBeDefined();
  });

  it('refuses a pattern that does not match the body — the invisible mistake', async () => {
    const { svc, prisma } = make();

    await expect(svc.promote({ ...base, pattern: 'out for delivery today' })).rejects.toMatchObject(
      { response: { code: 'PATTERN_DOES_NOT_MATCH' } },
    );

    // Nothing saved. A stored pattern that never fires is an outage with
    // no error anywhere.
    expect(prisma.client.courierMessageTemplate.upsert).not.toHaveBeenCalled();
  });

  it('refuses a pattern that will not compile, at entry rather than at match time', async () => {
    const { svc, prisma } = make();

    await expect(svc.promote({ ...base, pattern: '(unclosed[' })).rejects.toMatchObject({
      response: { code: 'PATTERN_INVALID' },
    });
    expect(prisma.client.courierMessageTemplate.upsert).not.toHaveBeenCalled();
  });

  it('404s on a candidate that is gone', async () => {
    const { svc } = make({ candidate: null });
    await expect(svc.promote({ ...base, pattern: 'anything' })).rejects.toMatchObject({
      response: { code: 'CANDIDATE_NOT_FOUND' },
    });
  });
});

describe('CourierTemplateReviewService.reject', () => {
  it('records who looked and decided against it', async () => {
    const { svc, prisma } = make();
    await svc.reject({
      candidateId: 'cand-1',
      staffId: 'staff-1',
      notes: 'one-off, typed by hand',
    });

    const call = prisma.client.courierTemplateCandidate.updateMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    // Guarded in the WHERE, not read-then-write: a candidate somebody else
    // promoted a moment ago must not be flipped to REJECTED.
    expect(call.where).toMatchObject({ status: { not: 'PROMOTED' } });
    expect(call.data).toMatchObject({ status: 'REJECTED', reviewedByStaffId: 'staff-1' });
  });

  it('refuses when the row moved under it', async () => {
    const { svc, prisma } = make();
    prisma.client.courierTemplateCandidate.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.reject({ candidateId: 'cand-1', staffId: 'staff-1' })).rejects.toMatchObject({
      response: { code: 'CANDIDATE_NOT_REJECTABLE' },
    });
  });
});
