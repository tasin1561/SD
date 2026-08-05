import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CourierMessageClassifierService } from '../../src/modules/courier-escalation/services/courier-message-classifier.service';

/**
 * The regex library, matched against the REAL canned replies.
 *
 * The four patterns are seeded from text captured verbatim from the
 * Delhivery One panel, so these tests are the closest thing to real-data
 * verification available before the channel is live. Anything invented
 * would only prove the regex matches the sentence I wrote it from.
 */

/** The four seeded templates, as `seedCourierMessageTemplates` writes them. */
const SEEDED = [
  {
    code: 'REQ_ALT_PHONE',
    pattern: 'share an alternate contact number for the consignee',
    state: 'ACTION_REQUIRED',
    action: 'ASK_SELLER_ALT_PHONE',
  },
  {
    code: 'NDR_ACK_24_48',
    pattern: 'trying our best to deliver.{0,40}within 24 to 48 hours',
    state: 'ACKNOWLEDGED',
    action: null,
  },
  {
    code: 'OFD_TODAY',
    pattern: 'out for delivery and should be delivered by the end of the day',
    state: 'OUT_FOR_DELIVERY',
    action: null,
  },
  {
    code: 'BEHAVIOUR_ACK',
    pattern: 'regret the unacceptable behavior of our delivery agent',
    state: 'ACKNOWLEDGED',
    action: null,
  },
];

function make(templates = SEEDED) {
  const upserts: unknown[] = [];
  const prisma = {
    client: {
      courierMessageTemplate: { findMany: jest.fn().mockResolvedValue(templates) },
      courierTemplateCandidate: {
        upsert: jest.fn().mockImplementation((a: unknown) => {
          upserts.push(a);
          return Promise.resolve({});
        }),
      },
    },
  };
  return { svc: new CourierMessageClassifierService(prisma as never), upserts };
}

describe('the four real canned replies', () => {
  it('NDR_ACK_24_48 — the holding reply', async () => {
    const { svc } = make();
    const out = await svc.classify(
      'Dear Customer, we are trying our best to deliver your shipment within 24 to 48 hours. Regards, Delhivery',
    );
    expect(out).toMatchObject({
      templateCode: 'NDR_ACK_24_48',
      state: 'ACKNOWLEDGED',
      action: null,
    });
  });

  it('OFD_TODAY — on a van today', async () => {
    const { svc } = make();
    const out = await svc.classify(
      'Your shipment is out for delivery and should be delivered by the end of the day.',
    );
    expect(out).toMatchObject({ templateCode: 'OFD_TODAY', state: 'OUT_FOR_DELIVERY' });
  });

  it('REQ_ALT_PHONE — the only one that asks us for something', async () => {
    const { svc } = make();
    const out = await svc.classify(
      'Please share an alternate contact number for the consignee by replying to this ticket.',
    );
    expect(out).toMatchObject({ state: 'ACTION_REQUIRED', action: 'ASK_SELLER_ALT_PHONE' });
  });

  it('BEHAVIOUR_ACK — and their American spelling is left alone', async () => {
    // "behavior" is how Delhivery writes it. Correcting the pattern to
    // "behaviour" would make it never match.
    const { svc } = make();
    const out = await svc.classify(
      'We sincerely regret the unacceptable behavior of our delivery agent and assure you that strict disciplinary action will be taken.',
    );
    expect(out).toMatchObject({ templateCode: 'BEHAVIOUR_ACK', state: 'ACKNOWLEDGED' });
  });
});

describe('matching is robust to how email arrives', () => {
  it('survives wrapped lines and collapsed whitespace', async () => {
    // Email clients hard-wrap. Without normalisation a soft line break
    // in the middle of the phrase makes a known template unmatched.
    const { svc } = make();
    const out = await svc.classify(
      'we are trying our best\r\n   to deliver your shipment\n within 24 to 48   hours',
    );
    expect(out.templateCode).toBe('NDR_ACK_24_48');
  });

  it('is case-insensitive', async () => {
    const { svc } = make();
    expect(
      (await svc.classify('OUT FOR DELIVERY AND SHOULD BE DELIVERED BY THE END OF THE DAY'))
        .templateCode,
    ).toBe('OFD_TODAY');
  });

  it('asks the DATABASE for priority order — first match wins, so the order is the rule', async () => {
    // Ordering is Postgres's job, so the honest assertion is that the
    // service requests it. Asserting "REQ_ALT_PHONE wins" against a
    // hand-ordered mock array would pass even if the orderBy were
    // deleted — it would be testing the fixture, not the code.
    const prisma = {
      client: {
        courierMessageTemplate: { findMany: jest.fn().mockResolvedValue([]) },
        courierTemplateCandidate: { upsert: jest.fn().mockResolvedValue({}) },
      },
    };
    await new CourierMessageClassifierService(prisma as never).classify('x');
    expect(prisma.client.courierMessageTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: [{ priority: 'asc' }, { code: 'asc' }],
      }),
    );
  });

  it('takes the FIRST match and stops', async () => {
    // Given the order above, an ACTION_REQUIRED pattern placed first
    // must win over a later acknowledgement in the same message.
    const { svc } = make();
    const out = await svc.classify(
      'We are trying our best to deliver your shipment within 24 to 48 hours. Meanwhile, please share an alternate contact number for the consignee.',
    );
    expect(out.templateCode).toBe('REQ_ALT_PHONE');
  });
});

describe('a miss is recorded, never dropped', () => {
  it('returns UNMATCHED and always routes to a human', async () => {
    const { svc } = make();
    const out = await svc.classify('Something Delhivery has never said before.');
    expect(out).toMatchObject({ source: 'UNMATCHED', state: null, needsReview: true });
  });

  it('adds the body to the promotion queue as UNMATCHED', async () => {
    // With the model off this is the ONLY way the corpus grows. If it
    // did nothing, the regex library would never learn what it misses.
    const { svc, upserts } = make();
    await svc.classify('A brand new canned reply.');
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      create: expect.objectContaining({ status: 'UNMATCHED' }),
      update: expect.objectContaining({ seenCount: { increment: 1 } }),
    });
  });

  it('a repeated miss becomes a COUNT, not a hundred rows', async () => {
    // The count is the signal for which pattern to write first.
    const { svc, upserts } = make();
    await svc.classify('Same unknown text');
    await svc.classify('Same unknown text');
    expect(upserts).toHaveLength(2);
    const hashes = upserts.map((u) => (u as { where: { bodyHash: string } }).where.bodyHash);
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('a failure to record the candidate does not fail the message', async () => {
    // The message itself is the thing that must be stored.
    const { svc } = make();
    const prismaFail = new CourierMessageClassifierService({
      client: {
        courierMessageTemplate: { findMany: jest.fn().mockResolvedValue([]) },
        courierTemplateCandidate: { upsert: jest.fn().mockRejectedValue(new Error('db down')) },
      },
    } as never);
    await expect(prismaFail.classify('x')).resolves.toMatchObject({ source: 'UNMATCHED' });
    void svc;
  });
});

describe('operator-editable patterns cannot break the pipeline', () => {
  it('an invalid regex is skipped, not thrown', async () => {
    // Patterns are DATA edited by a human, so a bad one is a
    // possibility rather than a bug — and it must not stop every other
    // template from being tried.
    const { svc } = make([
      { code: 'BAD', pattern: '([unclosed', state: 'X', action: null },
      ...SEEDED,
    ]);
    const out = await svc.classify(
      'Your shipment is out for delivery and should be delivered by the end of the day.',
    );
    expect(out.templateCode).toBe('OFD_TODAY');
  });
});

describe('the seeded library matches what these tests assert (structural)', () => {
  // Without this, every test above could pass against patterns that are
  // not the ones production seeds — the fixture and the seed would drift
  // and nothing would notice.
  const seed = readFileSync(join(__dirname, '../../../../packages/db/prisma/seed.ts'), 'utf8');

  it('seed.ts contains the courier template seeder', () => {
    expect(seed).toContain('seedCourierMessageTemplates');
  });

  for (const t of SEEDED) {
    it(`${t.code}: pattern and state match the seed`, () => {
      expect(seed).toContain(`code: '${t.code}'`);
      expect(seed).toContain(`pattern: '${t.pattern}'`);
      expect(seed).toContain(`state: '${t.state}'`);
    });
  }

  it('REQ_ALT_PHONE is seeded at a HIGHER priority than the acknowledgements', () => {
    // The one template that asks something of us must not lose to a
    // generic acknowledgement sharing the same message.
    const at = seed.indexOf("code: 'REQ_ALT_PHONE'");
    const block = seed.slice(at, at + 400);
    const priority = /priority:\s*(\d+)/.exec(block)?.[1];
    expect(Number(priority)).toBeLessThan(10);
  });
});

describe('the confidence gate', () => {
  it('is 0.85, in one place', () => {
    expect(CourierMessageClassifierService.confidenceGate).toBe(0.85);
  });

  it('a regex match is confidence 1 — it matched or it did not', () => {
    // Inventing a fractional confidence for a deterministic match would
    // make the gate meaningless.
    expect(CourierMessageClassifierService.modelAnswerNeedsReview(1)).toBe(false);
  });

  it('below the gate goes to a human', () => {
    expect(CourierMessageClassifierService.modelAnswerNeedsReview(0.84)).toBe(true);
    expect(CourierMessageClassifierService.modelAnswerNeedsReview(0.85)).toBe(false);
  });
});
