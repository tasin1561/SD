import { BadRequestException } from '@nestjs/common';
import { CourierMessageClassifierService } from '../../src/modules/courier-escalation/services/courier-message-classifier.service';
import { CourierTemplateReviewService } from '../../src/modules/courier-escalation/services/courier-template-review.service';
import { hasNestedQuantifier } from '../../src/modules/courier-escalation/services/regex-safety';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * `courier_message_templates.pattern` is operator-editable data run against
 * an inbound email body of up to 500 KB, in the request thread, with no
 * timeout available. Two halves bound it: the pattern cannot be one that
 * backtracks exponentially (refused at the WRITE, where a person can be
 * told why), and the text it is matched against is capped.
 */
describe('hasNestedQuantifier', () => {
  it.each([
    ['(a+)+', 'plus inside plus'],
    ['(a*)*', 'star inside star'],
    ['(\\s+)*', 'escaped class, quantified twice'],
    ['([a-z]+)+', 'character class inside a quantified group'],
    ['^(x|y+)+$', 'alternation with a quantified branch'],
    ['(ab+c){2,}', 'open-ended counted repeat of a quantified group'],
    ['prefix(\\d+)+suffix', 'nested in the middle of a longer pattern'],
  ])('refuses %s (%s)', (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(true);
  });

  it.each([
    ['delivery attempted', 'no quantifiers at all'],
    ['(a|b)+', 'quantified group with no inner quantifier'],
    ['\\s*out for delivery\\s*', 'quantifiers, but not nested'],
    ['(abc)+', 'plain quantified group'],
    ['(a+)?', 'the outer repeat cannot repeat unboundedly'],
    ['(a+){2}', 'a fixed count is not unbounded'],
    ['\\(a+\\)+', 'escaped parens are literal text, not a group'],
    ['[(+)]+', 'quantifier chars inside a character class'],
    ['(rto|dto) initiated', 'the real shape of a seeded template'],
  ])('allows %s (%s)', (pattern) => {
    expect(hasNestedQuantifier(pattern)).toBe(false);
  });
});

describe('CourierTemplateReviewService.promote — PATTERN_UNSAFE', () => {
  function make() {
    const candidate = {
      id: 'c1',
      body: 'aaaaaaaa delivery attempted',
      seenCount: 3,
      status: 'UNMATCHED',
      suggestedRegex: null,
      suggestedState: null,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    };
    const upsert = jest.fn(async () => ({
      id: 't1',
      code: 'DLV_ATTEMPTED',
      pattern: 'delivery attempted',
      state: 'ATTEMPTED',
      action: null,
      priority: 50,
      isActive: true,
    }));
    const client = {
      courierTemplateCandidate: {
        findUnique: jest.fn(async () => candidate),
        update: jest.fn(async () => candidate),
      },
      courierMessageTemplate: { upsert },
    };
    const svc = new CourierTemplateReviewService(
      { client } as unknown as PrismaService,
      { log: jest.fn(async () => 'a1') } as never,
    );
    return { svc, upsert };
  }

  const base = {
    candidateId: 'c1',
    code: 'DLV_ATTEMPTED',
    state: 'ATTEMPTED',
    staffId: 'st1',
  };

  it('refuses a nested-quantifier pattern and writes nothing', async () => {
    const { svc, upsert } = make();

    await expect(
      svc.promote({ ...base, pattern: '(a+)+ delivery attempted' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.promote({ ...base, pattern: '(a+)+ delivery attempted' }),
    ).rejects.toMatchObject({ response: { code: 'PATTERN_UNSAFE' } });

    // The refusal is before the write — a pattern that only fails at match
    // time is an outage nobody can see.
    expect(upsert).not.toHaveBeenCalled();
  });

  it('still refuses an invalid regex, on its own code', async () => {
    const { svc } = make();
    await expect(svc.promote({ ...base, pattern: '(unclosed' })).rejects.toMatchObject({
      response: { code: 'PATTERN_INVALID' },
    });
  });

  it('accepts a safe pattern that matches the candidate body', async () => {
    const { svc, upsert } = make();
    await svc.promote({ ...base, pattern: 'delivery attempted' });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});

describe('CourierMessageClassifierService — the matched text is bounded', () => {
  function make(pattern: string) {
    const client = {
      courierMessageTemplate: {
        findMany: jest.fn(async () => [{ code: 'T1', pattern, state: 'ATTEMPTED', action: null }]),
      },
      courierTemplateCandidate: {
        upsert: jest.fn<Promise<unknown>, [{ create: { body: string } }]>(async () => ({})),
      },
    };
    return {
      svc: new CourierMessageClassifierService({ client } as unknown as PrismaService),
      client,
    };
  }

  const CAP = CourierMessageClassifierService.maxMatchChars;

  it('matches a phrase inside the cap', async () => {
    const { svc } = make('delivery attempted');
    const body = `${'x'.repeat(100)} delivery attempted`;
    await expect(svc.classify(body)).resolves.toMatchObject({
      templateCode: 'T1',
      source: 'REGEX',
    });
  });

  it('does not run patterns over text past the cap', async () => {
    const { svc } = make('delivery attempted');
    // The phrase sits beyond the cap, so the patterns never see it.
    const body = `${'x'.repeat(CAP + 10)} delivery attempted`;
    await expect(svc.classify(body)).resolves.toMatchObject({
      templateCode: null,
      source: 'UNMATCHED',
      needsReview: true,
    });
  });

  it('records the WHOLE body as a candidate, not the truncated copy', async () => {
    const { svc, client } = make('nothing matches this');
    const tail = 'delivery attempted';
    const body = `${'x'.repeat(CAP + 10)} ${tail}`;

    await svc.classify(body);

    const arg = client.courierTemplateCandidate.upsert.mock.calls[0]?.[0];
    expect(arg?.create.body).toContain(tail);
    expect(arg?.create.body.length).toBeGreaterThan(CAP);
  });
});
