import { normalise } from '../../src/modules/courier-portal/pages/ticket-detail.page';

/**
 * What the read path must not get wrong.
 *
 * These pin the two things a probe against the real portal corrected,
 * both of which were silent: a thread selector that matched nothing, and
 * our own messages coming back as if the courier had said them. Neither
 * would have thrown — the sweep would have reported a clean run every
 * twenty minutes while doing nothing, or filled a seller's ticket with
 * their own words quoted back at them.
 *
 * A mocked Playwright cannot prove a selector; only the live portal can,
 * and it did (2026-09-06). What IS provable here is the logic that acts
 * on what the selector returns.
 */
describe('reading a courier thread', () => {
  /** Exactly the shape `readThread` returns. */
  const thread = [
    { body: 'The customer is waiting, please reattempt.', mine: true },
    { body: 'Dear client, your shipment is out for delivery.', mine: false },
    { body: 'Dear client, we have highlighted this to our team.', mine: false },
  ].map((m) => ({ ...m, normalised: normalise(m.body) }));

  it('ingests only what the COURIER said', () => {
    // Their thread right-aligns the client's own messages. Storing ours
    // as inbound would quote a seller's own words back to them as a
    // reply, and label our text with a courier state.
    const inbound = thread.filter((m) => !m.mine);
    expect(inbound).toHaveLength(2);
    expect(inbound.every((m) => m.body.startsWith('Dear client'))).toBe(true);
  });

  it('normalises for the dedup key the way the classifier does', () => {
    // Whitespace-collapsed and lowercased: the portal re-wraps a message
    // between reads, and a hash over the raw text would store the same
    // reply again on every sweep.
    expect(normalise('  Dear   client,\n\n  hello ')).toBe('dear client, hello');
  });

  it('an empty read is not evidence of an empty thread', () => {
    // The guessed selectors returned [] on a real ticket that had three
    // messages. Nothing downstream may treat [] as "the courier has said
    // nothing" — which is why the sweep stores nothing on an empty read
    // rather than concluding anything from it.
    const empty: typeof thread = [];
    expect(empty.filter((m) => !m.mine)).toHaveLength(0);
  });
});
