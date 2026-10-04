/**
 * FE-2 boundary — collapsing a warehouse's bins.
 *
 * `BinCollapseService` had four endpoints and NO caller outside the
 * e2e suite, so merging every bin into FLOOR — after which where
 * anything was exists only in a snapshot — needed API access, and the
 * snapshot it takes could be listed by nobody. A backup nobody can see
 * is a backup nobody trusts.
 *
 * The screen's chrome is GRAVITY, not enforcement. Every one of the
 * guardrails it shows is a SERVER gate (BIN-4): reason ≥ 30 chars, a
 * six-digit code emailed to the actor and claimed by a guarded
 * `updateMany`, the warehouse code typed exactly, SUPER_ADMIN only.
 * This file pins both halves — that the chrome works, and that when
 * the server refuses, its verdict is shown VERBATIM rather than
 * pre-empted by a client-side mirror of its policy.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CollapseDialog,
  SnapshotList,
} from '@/app/(authed)/warehouse/collapse/_components/bin-collapse-index';
import { buildFetchMock, renderWithProviders, makeStaff } from './helpers';

const REASON = 'Racking is being ripped out on Saturday and re-laid from scratch next week.';
const noop = (): void => undefined;

const CHALLENGE = {
  challengeId: '01a0a457-023b-7a35-9fc9-130a9a2a3547',
  expiresAt: '2026-10-01T12:10:00.000Z',
  sentToEmail: 'ops@skydrop.global',
  binsAffected: 47,
  unitsAffected: 1203,
};

describe('FE-2 boundary — bin collapse', () => {
  it('will not ask for a code until a reason is given and the risk acknowledged', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <CollapseDialog
        open
        onOpenChange={noop}
        warehouseId="wh-1"
        warehouseCode="BLR-1"
        onDone={noop}
      />,
    );

    const go = screen.getByRole('button', { name: /what this would move/i });
    expect(go).toBeDisabled();

    // A reason alone is not enough.
    await user.type(screen.getByLabelText(/^Why/i), REASON);
    expect(go).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(go).toBeEnabled());
  });

  it('says what would move BEFORE it asks anyone to confirm it', async () => {
    // A form asking for a confirmation code before telling you what you
    // are confirming is asking somebody to agree to an unknown. The
    // counts only exist after step one, which is why it is two steps.
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      { match: /collapse\/request/, responses: [{ status: 200, body: CHALLENGE }] },
    ]);
    renderWithProviders(
      <CollapseDialog
        open
        onOpenChange={noop}
        warehouseId="wh-1"
        warehouseCode="BLR-1"
        onDone={noop}
      />,
      { fetchImpl },
    );

    await user.type(screen.getByLabelText(/^Why/i), REASON);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /what this would move/i }));

    await waitFor(() => {
      expect(screen.getByText(/47 bin\(s\) holding 1203 unit\(s\)/i)).toBeInTheDocument();
    });
    // And it names where the code went, so a person who did not get one
    // knows which inbox to look in rather than assuming it failed.
    expect(screen.getByText(/ops@skydrop\.online/)).toBeInTheDocument();
  });

  it('surfaces the server VERBATIM when it refuses a reason the UI let through', async () => {
    // The counter is UX guidance; the server is the law. Its own
    // trimming can disagree with the browser's, and when it does the
    // operator must read the server's words and not ours.
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /collapse\/request/,
        responses: [
          {
            status: 400,
            body: {
              code: 'COLLAPSE_REASON_TOO_SHORT',
              message:
                'Give a reason of at least 30 characters — this is the only explanation anyone will have later',
            },
          },
        ],
      },
    ]);
    renderWithProviders(
      <CollapseDialog
        open
        onOpenChange={noop}
        warehouseId="wh-1"
        warehouseCode="BLR-1"
        onDone={noop}
      />,
      { fetchImpl },
    );

    await user.type(screen.getByLabelText(/^Why/i), REASON);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /what this would move/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/\[COLLAPSE_REASON_TOO_SHORT\].*only explanation anyone will have later/),
      ).toBeInTheDocument();
    });
  });

  it('surfaces a refused CODE verbatim, and does not collapse', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      { match: /collapse\/request/, responses: [{ status: 200, body: CHALLENGE }] },
      {
        match: /collapse\/confirm/,
        responses: [
          {
            status: 409,
            body: {
              code: 'COLLAPSE_CHALLENGE_INVALID',
              message: 'That code is wrong, expired, or already used. Request a new one.',
            },
          },
        ],
      },
    ]);
    let collapsed = false;
    renderWithProviders(
      <CollapseDialog
        open
        onOpenChange={noop}
        warehouseId="wh-1"
        warehouseCode="BLR-1"
        onDone={() => {
          collapsed = true;
        }}
      />,
      { fetchImpl },
    );

    await user.type(screen.getByLabelText(/^Why/i), REASON);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /what this would move/i }));
    await waitFor(() => screen.getByLabelText(/code from your email/i));

    await user.type(screen.getByLabelText(/code from your email/i), '123456');
    await user.type(screen.getByLabelText(/Type BLR-1 to confirm/i), 'BLR-1');
    await user.click(screen.getByRole('button', { name: /Collapse 47 bin/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/\[COLLAPSE_CHALLENGE_INVALID\].*Request a new one/),
      ).toBeInTheDocument();
    });
    expect(collapsed).toBe(false);
  });

  it('refuses to submit until the warehouse code is typed exactly', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      { match: /collapse\/request/, responses: [{ status: 200, body: CHALLENGE }] },
    ]);
    renderWithProviders(
      <CollapseDialog
        open
        onOpenChange={noop}
        warehouseId="wh-1"
        warehouseCode="BLR-1"
        onDone={noop}
      />,
      { fetchImpl },
    );

    await user.type(screen.getByLabelText(/^Why/i), REASON);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: /what this would move/i }));
    await waitFor(() => screen.getByLabelText(/code from your email/i));

    await user.type(screen.getByLabelText(/code from your email/i), '123456');
    const submit = screen.getByRole('button', { name: /Collapse 47 bin/i });

    // Close is not exact.
    await user.type(screen.getByLabelText(/Type BLR-1 to confirm/i), 'blr-1');
    expect(submit).toBeDisabled();

    await user.clear(screen.getByLabelText(/Type BLR-1 to confirm/i));
    await user.type(screen.getByLabelText(/Type BLR-1 to confirm/i), 'BLR-1');
    await waitFor(() => expect(submit).toBeEnabled());
  });
});

describe('the backup is visible, and so is when it goes', () => {
  const SNAPSHOT = {
    id: '01a0a457-023b-7a35-9fc9-130a9a2a3548',
    reason: 'Racking ripped out and re-laid.',
    lineCount: 214,
    totalQty: 1203,
    restoredAt: null,
    // 40 days and an hour: the screen FLOORS the remainder, so an exact
    // 40-day offset reads as 39 by the time the component renders.
    expiresAt: new Date(Date.now() + 40 * 86_400_000 + 3_600_000).toISOString(),
    createdAt: new Date(Date.now() - 50 * 86_400_000).toISOString(),
  };

  it('lists a snapshot with how long it has left', async () => {
    // A backup nobody can see is a backup nobody trusts, and one whose
    // expiry is invisible is one somebody reaches for on the day after
    // the sweep took it.
    const fetchImpl = buildFetchMock([
      { match: /bin-ops\/snapshots$/, responses: [{ status: 200, body: [SNAPSHOT] }] },
    ]);
    renderWithProviders(<SnapshotList warehouseId="wh-1" mayRestore />, {
      fetchImpl,
      identity: makeStaff('SUPER_ADMIN' as never, ['warehouse.view', 'warehouse.bins.collapse']),
    });

    await waitFor(() => {
      expect(screen.getByText(/Racking ripped out and re-laid/)).toBeInTheDocument();
    });
    expect(screen.getByText(/40 day\(s\) left/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Put the layout back/i })).toBeInTheDocument();
  });

  it('names every line a restore could NOT put back', async () => {
    // Best-effort by design: stock sells between the collapse and the
    // restore. Reporting only the successes would make a partial
    // recovery read as a complete one.
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      { match: /bin-ops\/snapshots$/, responses: [{ status: 200, body: [SNAPSHOT] }] },
      {
        match: /snapshots\/.*\/restore/,
        responses: [
          {
            status: 200,
            body: {
              snapshotId: SNAPSHOT.id,
              restoredLines: 200,
              skippedLines: [{ binCode: 'A-01-03', variantId: 'v-1', why: 'sold since the merge' }],
            },
          },
        ],
      },
    ]);
    renderWithProviders(<SnapshotList warehouseId="wh-1" mayRestore />, {
      fetchImpl,
      identity: makeStaff('SUPER_ADMIN' as never, ['warehouse.view', 'warehouse.bins.collapse']),
    });

    await waitFor(() => screen.getByRole('button', { name: /Put the layout back/i }));
    await user.click(screen.getByRole('button', { name: /Put the layout back/i }));
    await user.click(screen.getByRole('button', { name: /^Put it back$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Put back 200 line\(s\)/)).toBeInTheDocument();
    });
    expect(screen.getByText(/sold since the merge/)).toBeInTheDocument();
  });
});
