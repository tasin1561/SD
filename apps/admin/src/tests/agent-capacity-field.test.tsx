/**
 * The capacity field on an agent's detail panel.
 *
 * TWO FAULTS, one root. The panel's capacity input rendered
 * `maxActiveCalls === '' ? String(agent.settings.maxActiveCalls) : …`,
 * using the empty string as a sentinel for "not edited" — so the field
 * COULD NOT BE EMPTIED. Clearing it put the current cap straight back,
 * and the next keystroke landed BESIDE the value rather than replacing
 * it: a supervisor clearing "1" and typing "3" saved THIRTEEN, with the
 * button enabled and no error anywhere. It was found by filming this
 * screen (I2) — the recorder cleared the field, typed 3, saved, and the
 * row behind the panel read "1 of 13".
 *
 * And the panel took the agent it was OPENED with as a snapshot, so
 * after a successful save it still showed the old cap and kept the Save
 * button enabled. Reading the live row from the list fixes both: the
 * field owns its own value, and the comparison the button is disabled
 * on is made against what the server now holds.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgentsIndex } from '@/app/(authed)/call-center/agents/_components/agents-index';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

const AGENT_ID = '019fad84-7acd-754e-8ee4-43cf858fed44';

function agent(maxActiveCalls: number): unknown {
  return {
    agentId: AGENT_ID,
    email: 'imran.shaikh@skydrop.local',
    activeAssigned: 1,
    settings: {
      agentId: AGENT_ID,
      maxActiveCalls,
      isAvailable: true,
      workingHoursStart: '09:00',
      workingHoursEnd: '18:00',
      workingDays: [1, 2, 3, 4, 5],
      timezone: 'Asia/Kolkata',
      languages: ['en', 'hi'],
      canHandleHighRisk: false,
      canHandleHighValue: false,
    },
  };
}

const METRICS = {
  agentId: AGENT_ID,
  totalAttempts: 0,
  byOutcome: {},
  confirmedCount: 0,
  currentAssigned: 1,
  holds: {
    holdsCompleted: 0,
    holdsDropped: 0,
    dropsByReason: {},
    avgSecondsToOutcome: null,
    longestDroppedSeconds: null,
  },
};

describe('the agent capacity field', () => {
  it('can be cleared, so a two-digit cap is the number that was typed', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      { match: /\/agents\/[^/]+\/metrics$/, responses: [{ status: 200, body: METRICS }] },
      {
        match: /\/agents$/,
        responses: [
          { status: 200, body: [agent(1)] },
          { status: 200, body: [agent(1)] },
          { status: 200, body: [agent(10)] },
        ],
      },
      {
        match: /\/agents\/[^/]+\/settings$/,
        responses: [{ status: 200, body: agent(10) }],
      },
    ]);
    renderWithProviders(<AgentsIndex />, {
      fetchImpl,
      identity: makeStaff(undefined, ['callcenter.agents.view', 'callcenter.agents.manage']),
    });

    await user.click(await screen.findByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText(/^Maximum concurrent calls\*?$/);

    await user.clear(field);
    // THE WHOLE POINT: an emptied field stays empty. Before the fix it
    // snapped back to "1" and this typed "10" onto the end of it.
    expect(field).toHaveValue(null);
    await user.type(field, '10');
    expect(field).toHaveValue(10);

    await user.click(within(dialog).getByRole('button', { name: 'Save capacity' }));

    await waitFor(() => {
      const patch = fetchImpl.mock.calls.find(
        (c) =>
          /\/settings$/.test(String(c[0])) && (c[1] as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ maxActiveCalls: 10 });
    });
  });

  it('stops offering to save once the server holds what was typed', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      { match: /\/agents\/[^/]+\/metrics$/, responses: [{ status: 200, body: METRICS }] },
      {
        match: /\/agents$/,
        responses: [
          { status: 200, body: [agent(1)] },
          { status: 200, body: [agent(3)] },
          { status: 200, body: [agent(3)] },
        ],
      },
      { match: /\/agents\/[^/]+\/settings$/, responses: [{ status: 200, body: agent(3) }] },
    ]);
    renderWithProviders(<AgentsIndex />, {
      fetchImpl,
      identity: makeStaff(undefined, ['callcenter.agents.view', 'callcenter.agents.manage']),
    });

    await user.click(await screen.findByRole('button', { name: 'Details' }));
    const dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText(/^Maximum concurrent calls\*?$/));
    await user.type(within(dialog).getByLabelText(/^Maximum concurrent calls\*?$/), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Save capacity' }));

    // The panel is reading the LIST's row, not the snapshot it opened
    // with — so once the refetch lands, saving the same figure again is
    // no longer offered.
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: /Save capacity/ })).toBeDisabled();
    });
  });
});
