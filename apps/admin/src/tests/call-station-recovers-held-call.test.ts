import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The agent station must recover a call the agent is already holding.
 *
 * The held assignment used to live only in React state seeded from the
 * pull response. A reload lost it while the queue entry stayed ASSIGNED
 * in the database, so the station showed "Waiting for the next call"
 * over a call the agent still held, every pull returned
 * AGENT_AT_CAPACITY, and no screen offered a way to record an outcome or
 * release it. The only escapes were the CC-7 expiry timer or an admin
 * reassigning the row — a dead end reachable by pressing reload.
 *
 * Structural, deliberately: the defect is "state that does not survive a
 * remount", and a component test that mounts once and never reloads
 * cannot see it. What distinguishes correct from broken is whether the
 * station asks the server what it is holding at all.
 */
const STATION = 'src/app/(authed)/call-center/_components/call-center-station.tsx';

describe('call-centre station', () => {
  const src = readFileSync(join(process.cwd(), STATION), 'utf8');

  it('asks the server what the agent already holds', () => {
    expect(src).toMatch(/useCurrentCalls\(\)/);
  });

  it('adopts the held assignment into station state', () => {
    // The whole point: the answer must reach the same state the pull
    // response feeds, or the panel still will not render.
    expect(src).toMatch(/setAssignment\(held\)/);
  });

  it('does not pull before that check has answered', () => {
    // Pulling first guarantees an AGENT_AT_CAPACITY error on every load
    // for an agent mid-call.
    expect(src).toMatch(/bootstrapped/);
    expect(src).toMatch(/isAvailable && bootstrapped && assignment === null/);
  });

  it('reads the recipient from the NESTED block the server sends', () => {
    // The panel used to cast an `unknown` payload to the flat DATABASE
    // COLUMN names (recipientName, recipientPhoneE164), which exist on
    // no payload the server has ever sent — so the one screen whose
    // purpose is phoning customers showed no phone number.
    expect(src).toMatch(/order\.recipient/);
    expect(src).not.toMatch(/recipientPhoneE164\?:/);
    expect(src).not.toMatch(/readonly order: unknown/);
  });

  it('does not add 1 to a counter pullNext already incremented', () => {
    // pullNext returns the post-update row, so `+ 1` displayed
    // "attempt #2" on an agent's first call.
    expect(src).not.toMatch(/scheduledAttempts \+ 1/);
  });
});
