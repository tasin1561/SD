import { Prisma } from '@skydrop/db';
import { CourierEscalationService } from '../../src/modules/courier-escalation/services/courier-escalation.service';

/**
 * The entry point, and the two properties that are easy to lose.
 *
 * ── WHY THIS SPEC EXISTS AT ALL ──────────────────────────────────────
 * Phases 2 to 5 built a read pipeline, an outbox, an ops console and a
 * browser worker, and nothing created a `CourierEscalation`. Every gate
 * was green because each piece was correct in isolation and the pipeline
 * was joined to two missing ends. So the tests here are deliberately
 * about the JOIN — that opening is idempotent, that ownership is checked
 * through the ticket, and that a reply is visible before it is deliverable
 * rather than the other way round.
 */

const ESC = {
  id: 'esc-1',
  ticketId: 'tkt-1',
  externalTicketId: null as string | null,
  awbNumber: '1234567890',
  state: null as string | null,
  lastMessageAt: null as Date | null,
  needsReviewAt: null as Date | null,
  ticket: { sellerId: 'seller-1' },
  messages: [],
  outbox: [{ id: 'ob-1' }, { id: 'ob-2' }],
};

function make(
  opts: {
    existing?: { id: string } | null;
    createThrows?: unknown;
    enqueueThrows?: unknown;
    escalation?: typeof ESC | null;
  } = {},
) {
  const messagesCreated: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];

  const prisma = {
    client: {
      courierEscalation: {
        findUnique: jest.fn().mockImplementation((args: { where: Record<string, unknown> }) => {
          // `openForTicket` looks up by ticketId; `thread` by id.
          if ('ticketId' in args.where) {
            return Promise.resolve(opts.existing ?? null);
          }
          return Promise.resolve(opts.escalation === undefined ? ESC : opts.escalation);
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'esc-raced' }),
        create: jest.fn().mockImplementation(() => {
          if (opts.createThrows !== undefined) throw opts.createThrows;
          return Promise.resolve({ id: 'esc-new' });
        }),
      },
      courierEscalationMessage: {
        create: jest.fn().mockImplementation((a: { data: Record<string, unknown> }) => {
          messagesCreated.push(a.data);
          return Promise.resolve({ id: 'msg-1' });
        }),
      },
    },
  };

  const outbox = {
    enqueue: jest.fn().mockImplementation(() => {
      if (opts.enqueueThrows !== undefined) throw opts.enqueueThrows;
      return Promise.resolve({ id: 'ob-new' });
    }),
  };

  const classifier = { hashBody: jest.fn().mockReturnValue('hash-abc') };

  const audit = {
    log: jest.fn().mockImplementation((row: Record<string, unknown>) => {
      audits.push(row);
      return Promise.resolve();
    }),
  };

  const svc = new CourierEscalationService(
    prisma as never,
    outbox as never,
    classifier as never,
    audit as never,
  );
  return { svc, prisma, outbox, audit, audits, messagesCreated };
}

describe('CourierEscalationService.openForTicket', () => {
  it('returns the existing conversation rather than starting a second one', async () => {
    const { svc, prisma } = make({ existing: { id: 'esc-existing' } });

    const result = await svc.openForTicket({ ticketId: 'tkt-1' });

    expect(result).toEqual({ id: 'esc-existing', created: false });
    // The NDR poller can escalate the same shipment on two consecutive
    // nights; a second row would split one conversation across two
    // threads and each would look half-answered.
    expect(prisma.client.courierEscalation.create).not.toHaveBeenCalled();
  });

  it('creates one when there is none, and says so', async () => {
    const { svc, audits } = make({ existing: null });

    const result = await svc.openForTicket({
      ticketId: 'tkt-1',
      awbNumber: '999',
      courierCode: 'delhivery',
    });

    expect(result).toEqual({ id: 'esc-new', created: true });
    expect(audits[0]).toMatchObject({ action: 'courier.escalation.opened' });
  });

  it('treats losing the unique-index race as success, not as an error', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { svc, prisma } = make({ existing: null, createThrows: p2002 });

    const result = await svc.openForTicket({ ticketId: 'tkt-1' });

    // The index is the guard. Two concurrent escalations of the same
    // ticket must both end up pointing at the one conversation.
    expect(result).toEqual({ id: 'esc-raced', created: false });
    expect(prisma.client.courierEscalation.findUniqueOrThrow).toHaveBeenCalled();
  });

  it('does not swallow a real failure', async () => {
    const { svc } = make({ existing: null, createThrows: new Error('connection reset') });
    await expect(svc.openForTicket({ ticketId: 'tkt-1' })).rejects.toThrow('connection reset');
  });
});

describe('CourierEscalationService.thread', () => {
  it('counts undelivered outbound messages as pending', async () => {
    const { svc } = make();
    const view = await svc.thread('esc-1', 'seller-1');
    expect(view.pendingOutbound).toBe(2);
  });

  it('answers another seller exactly as it answers a miss', async () => {
    const { svc } = make();

    // Same code and same message for both, so the reply cannot be used to
    // learn whether the escalation exists.
    const notYours = await svc.thread('esc-1', 'seller-2').catch((e: unknown) => e);
    const missing = await make({ escalation: null })
      .svc.thread('nope', 'seller-1')
      .catch((e: unknown) => e);

    const body = (e: unknown): unknown => (e as { response?: unknown }).response;
    expect(body(notYours)).toEqual({
      code: 'ESCALATION_NOT_FOUND',
      message: 'No such escalation.',
    });
    expect(body(missing)).toEqual(body(notYours));
  });

  it('lets an operator read any conversation', async () => {
    const { svc } = make();
    await expect(svc.thread('esc-1')).resolves.toMatchObject({ id: 'esc-1' });
  });
});

describe('CourierEscalationService.postReply', () => {
  it('stores the message VERBATIM and only then queues delivery', async () => {
    const { svc, messagesCreated, outbox } = make();

    const body = '  Customer says the address is  wrong.\n\nPlease reattempt tomorrow.  ';
    await svc.postReply({ escalationId: 'esc-1', body, sellerId: 'seller-1' });

    // Trimmed at the ends, untouched inside: the double space and the
    // blank line are what the person wrote.
    expect(messagesCreated[0]?.body).toBe(
      'Customer says the address is  wrong.\n\nPlease reattempt tomorrow.',
    );
    expect(messagesCreated[0]?.direction).toBe('OUTBOUND');
    // Our own words are not classified — labelling them with a courier
    // state would pollute the escalation's state.
    expect(messagesCreated[0]?.needsReview).toBe(false);
    expect(outbox.enqueue).toHaveBeenCalled();
  });

  it('raises a ticket first and comments after one exists', async () => {
    const first = make();
    await first.svc.postReply({ escalationId: 'esc-1', body: 'hello', sellerId: 'seller-1' });
    expect(first.outbox.enqueue.mock.calls[0]?.[0]).toMatchObject({ kind: 'RAISE_TICKET' });

    const later = make({ escalation: { ...ESC, externalTicketId: 'DLV-99' } });
    await later.svc.postReply({ escalationId: 'esc-1', body: 'hello', sellerId: 'seller-1' });
    expect(later.outbox.enqueue.mock.calls[0]?.[0]).toMatchObject({ kind: 'COMMENT' });
  });

  it('keeps the message when the enqueue fails', async () => {
    const { svc, messagesCreated } = make({ enqueueThrows: new Error('redis down') });

    const result = await svc.postReply({
      escalationId: 'esc-1',
      body: 'please reattempt',
      sellerId: 'seller-1',
    });

    // Visible-vs-silent: an undelivered message sitting in the thread is
    // recoverable and obvious. Throwing would tell the seller their words
    // vanished when the row is right there.
    expect(messagesCreated).toHaveLength(1);
    expect(result.outboxItemId).toBeNull();
  });

  it('audits the fingerprint, never the text', async () => {
    const { svc, audits } = make();
    await svc.postReply({ escalationId: 'esc-1', body: 'private detail', sellerId: 'seller-1' });

    const row = audits[0];
    expect(row).toMatchObject({ action: 'courier.escalation.reply_queued' });
    expect(JSON.stringify(row)).not.toContain('private detail');
  });

  it('refuses an empty message', async () => {
    const { svc } = make();
    await expect(
      svc.postReply({ escalationId: 'esc-1', body: '   \n ', sellerId: 'seller-1' }),
    ).rejects.toMatchObject({ response: { code: 'EMPTY_MESSAGE' } });
  });

  it('will not let one seller write into another seller’s conversation', async () => {
    const { svc, messagesCreated } = make();
    await expect(
      svc.postReply({ escalationId: 'esc-1', body: 'hi', sellerId: 'seller-2' }),
    ).rejects.toMatchObject({ response: { code: 'ESCALATION_NOT_FOUND' } });
    expect(messagesCreated).toHaveLength(0);
  });
});
