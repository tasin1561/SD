import {
  TicketDetailPage,
  normalise,
} from '../../src/modules/courier-portal/pages/ticket-detail.page';

/**
 * Read before write, read back after.
 *
 * This is the single property that makes a browser timeout survivable. A
 * comment post is not idempotent: if the click lands and the response is
 * lost, a retry duplicates a message in a thread the customer reads, and
 * we cannot see that it happened.
 *
 * The page object is driven by a fake Playwright `Page` — enough of the
 * locator surface to exercise the DECISIONS, which is where the safety
 * lives. It cannot tell us whether the selectors match the real DOM;
 * nothing short of the real portal can, and that is flagged as the
 * outstanding guess.
 */

interface FakeNode {
  readonly text: string;
}

/**
 * A page whose thread contents we control, recording whether a post was
 * actually attempted.
 */
function fakePage(opts: {
  threadBefore: FakeNode[];
  /** What the thread looks like after a post. Defaults to before + posted. */
  threadAfter?: FakeNode[];
  /** Simulates a selector that matches nothing. */
  blindSelectors?: boolean;
}) {
  const state = { posted: null as string | null, filled: null as string | null, clicked: 0 };
  let phase: 'before' | 'after' = 'before';

  const nodesFor = (): FakeNode[] => {
    if (opts.blindSelectors === true) return [];
    if (phase === 'before') return opts.threadBefore;
    return (
      opts.threadAfter ??
      (state.posted === null ? opts.threadBefore : [...opts.threadBefore, { text: state.posted }])
    );
  };

  const locator = (sel: string): unknown => {
    const isThread = /message|comment/.test(sel);
    const isBox = /textarea|textbox/.test(sel);
    const isSubmit = /Submit|Send|submit/.test(sel);
    const isResolve = /Resolve|Close ticket/.test(sel);

    return {
      count: async () => (isThread ? nodesFor().length : isBox || isSubmit || isResolve ? 1 : 0),
      nth: (i: number) => ({ innerText: async () => nodesFor()[i]?.text ?? '' }),
      innerText: async () =>
        nodesFor()
          .map((n) => n.text)
          .join('\n'),
      first: () => ({
        fill: async (v: string) => {
          state.filled = v;
        },
        click: async () => {
          state.clicked += 1;
          if (state.filled !== null) {
            state.posted = state.filled;
            phase = 'after';
          }
        },
        count: async () => 1,
      }),
    };
  };

  const page = {
    goto: async () => undefined,
    url: () => 'https://one.delhivery.com/support/TKT1',
    waitForLoadState: async () => undefined,
    locator,
    fill: async () => undefined,
    click: async () => undefined,
  };
  return { page, state };
}

const detail = (page: unknown): TicketDetailPage => new TicketDetailPage(page as never);

describe('normalise', () => {
  it('collapses whitespace and case so a wrapped repost still matches', () => {
    expect(normalise('  We  are\r\n LOOKING into it. ')).toBe('we are looking into it.');
  });
});

describe('postComment — read before write', () => {
  it('returns ALREADY_PRESENT and does NOT post when the text is in the thread', async () => {
    // The whole point: this turns "did my last attempt land?" from a
    // guess into a lookup, which is what makes a retry safe.
    const { page, state } = fakePage({ threadBefore: [{ text: 'We are looking into it.' }] });
    const out = await detail(page).postComment('We are looking into it.', false);
    expect(out.kind).toBe('ALREADY_PRESENT');
    expect(state.clicked).toBe(0);
  });

  it('matches a message the portal DECORATED — a false absent is what duplicates', async () => {
    // Our text wrapped in a signature must still count as present.
    const { page, state } = fakePage({
      threadBefore: [{ text: 'Skydrop wrote:\nWe are looking into it.\n-- sent via portal' }],
    });
    const out = await detail(page).postComment('We are looking into it.', false);
    expect(out.kind).toBe('ALREADY_PRESENT');
    expect(state.clicked).toBe(0);
  });

  it('posts when the text is genuinely absent, then CONFIRMS by reading back', async () => {
    const { page, state } = fakePage({ threadBefore: [{ text: 'Ticket opened' }] });
    const out = await detail(page).postComment('Please share an update.', false);
    expect(state.clicked).toBe(1);
    expect(out.kind).toBe('CONFIRMED');
  });
});

describe('postComment — read back after', () => {
  it('returns SENT_UNVERIFIED when the read-back cannot see it', async () => {
    // Never CONFIRMED on a hope. The outbox keeps it SENT_UNCONFIRMED and
    // the reconciler owns it.
    const { page } = fakePage({
      threadBefore: [{ text: 'Ticket opened' }],
      threadAfter: [{ text: 'Ticket opened' }], // post vanished
    });
    const out = await detail(page).postComment('Please share an update.', false);
    expect(out.kind).toBe('SENT_UNVERIFIED');
  });

  it('an EMPTY read-back is SENT_UNVERIFIED, not CONFIRMED', async () => {
    // A broken selector reads as an empty thread. Treating that as
    // success would put a permanent tick on an unverified write.
    const { page } = fakePage({ threadBefore: [], blindSelectors: true });
    const out = await detail(page).postComment('anything', false);
    expect(out.kind).toBe('SENT_UNVERIFIED');
  });
});

describe('SHADOW mode', () => {
  it('reads the real thread and decides, but never clicks', async () => {
    // Shadow is not a no-op — everything up to the click happens against
    // the real page, which is what makes a shadow run evidence.
    const { page, state } = fakePage({ threadBefore: [{ text: 'Ticket opened' }] });
    const out = await detail(page).postComment('Please share an update.', true);
    expect(out.kind).toBe('SHADOW');
    expect(state.clicked).toBe(0);
  });

  it('still short-circuits on ALREADY_PRESENT rather than reporting SHADOW', async () => {
    // Ordering matters: a shadow run should report "nothing to do" when
    // there is nothing to do, or every shadow cycle logs a phantom action.
    const { page } = fakePage({ threadBefore: [{ text: 'Already said this' }] });
    const out = await detail(page).postComment('Already said this', true);
    expect(out.kind).toBe('ALREADY_PRESENT');
  });
});
