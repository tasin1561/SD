import { Prisma } from '@skydrop/db';
import {
  CourierEscalationIngestService,
  minuteBucketOf,
} from '../../src/modules/courier-escalation/services/courier-escalation-ingest.service';

/**
 * The dedup key, and the verbatim rule.
 *
 * The minute bucket is the part that looks like over-engineering and is
 * not: Delhivery's canned replies repeat BYTE-IDENTICALLY across days, so
 * a (escalation, bodyHash) key would treat tomorrow's genuine reply as a
 * duplicate of today's and drop it. That failure is invisible — the
 * thread just stops updating, and a stuck parcel looks quiet.
 */

const AT = new Date('2026-08-06T10:15:30Z');

function make(opts: { escalation?: { id: string } | null; createThrows?: unknown } = {}) {
  const created: Prisma.CourierEscalationMessageCreateArgs['data'][] = [];
  const escalationUpdates: Record<string, unknown>[] = [];

  const prisma = {
    client: {
      courierEscalation: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.escalation === undefined ? { id: 'esc-1' } : opts.escalation),
        update: jest.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
          escalationUpdates.push(a.data);
          return Promise.resolve({});
        }),
      },
      courierEscalationMessage: {
        create: jest.fn().mockImplementation((a: { data: never }) => {
          if (opts.createThrows !== undefined) throw opts.createThrows;
          created.push(a.data);
          return Promise.resolve({ id: 'msg-1' });
        }),
      },
    },
  };

  const classifier = {
    hashBody: jest.fn().mockReturnValue('hash-abc'),
    classify: jest.fn().mockResolvedValue({
      templateCode: 'NDR_ACK_24_48',
      state: 'ACKNOWLEDGED',
      action: null,
      confidence: 1,
      needsReview: false,
      source: 'REGEX',
    }),
  };

  const svc = new CourierEscalationIngestService(prisma as never, classifier as never);
  return { svc, created, escalationUpdates, classifier, prisma };
}

const message = (body: string, at = AT) => ({
  externalTicketId: 'TKT-1',
  body,
  occurredAt: at,
  channel: 'EMAIL' as never,
});

describe('minuteBucketOf', () => {
  it('collapses everything inside one minute', () => {
    expect(minuteBucketOf(new Date('2026-08-06T10:15:00Z'))).toBe(
      minuteBucketOf(new Date('2026-08-06T10:15:59Z')),
    );
  });

  it('separates adjacent minutes', () => {
    expect(minuteBucketOf(new Date('2026-08-06T10:15:59Z'))).not.toBe(
      minuteBucketOf(new Date('2026-08-06T10:16:00Z')),
    );
  });

  it('separates the SAME text a day apart — the reason the bucket exists', () => {
    // Delhivery sends the identical 24-to-48-hours reply again tomorrow.
    // Same hash, different bucket, so it is a new message and not a
    // swallowed duplicate.
    const today = minuteBucketOf(new Date('2026-08-06T10:15:30Z'));
    const tomorrow = minuteBucketOf(new Date('2026-08-07T10:15:30Z'));
    expect(today).not.toBe(tomorrow);
    expect(tomorrow - today).toBe(1440n); // exactly one day of minutes
  });
});

describe('CourierEscalationIngestService', () => {
  it('stores the body VERBATIM — the seller reads what the courier wrote', async () => {
    const body = '  We are trying our BEST to deliver   within 24 to 48 hours.\n\n';
    const { svc, created } = make();
    await svc.ingest(message(body));
    expect(created[0]?.body).toBe(body);
  });

  it('writes the dedup key as (escalation, hash, minute)', async () => {
    const { svc, created } = make();
    await svc.ingest(message('anything'));
    expect(created[0]).toMatchObject({
      escalationId: 'esc-1',
      bodyHash: 'hash-abc',
      minuteBucket: minuteBucketOf(AT),
    });
  });

  it('treats the unique-violation as SUCCESS, not failure', async () => {
    // A re-delivered webhook and a polled re-read are both normal. The
    // index is the guard; catching P2002 is how that guard reports.
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const { svc } = make({ createThrows: p2002 });
    await expect(svc.ingest(message('x'))).resolves.toMatchObject({ kind: 'DEDUPED' });
  });

  it('rethrows anything that is NOT the dedup violation', async () => {
    // Swallowing every error here would turn a broken database into a
    // silently empty thread.
    const { svc } = make({ createThrows: new Error('connection reset') });
    await expect(svc.ingest(message('x'))).rejects.toThrow('connection reset');
  });

  it('does not invent an escalation for an unknown ticket', async () => {
    // Fabricating one from an email would attach a courier conversation
    // to a guessed seller.
    const { svc, created } = make({ escalation: null });
    const out = await svc.ingest(message('x'));
    expect(out).toMatchObject({ kind: 'NO_ESCALATION' });
    expect(created).toHaveLength(0);
  });

  it('advances the escalation state from a classified message', async () => {
    const { svc, escalationUpdates } = make();
    await svc.ingest(message('x'));
    expect(escalationUpdates[0]).toMatchObject({ state: 'ACKNOWLEDGED', lastMessageAt: AT });
  });

  it('an UNMATCHED message flags review but does NOT erase a known state', async () => {
    // The thread has not become less understood because one reply was
    // unrecognised; nulling the state would lose real information.
    const { svc, escalationUpdates, classifier } = make();
    classifier.classify.mockResolvedValueOnce({
      templateCode: null,
      state: null,
      action: null,
      confidence: 0,
      needsReview: true,
      source: 'UNMATCHED',
    });
    await svc.ingest(message('something new'));
    expect(escalationUpdates[0]).not.toHaveProperty('state');
    expect(escalationUpdates[0]).toHaveProperty('needsReviewAt');
  });
});
