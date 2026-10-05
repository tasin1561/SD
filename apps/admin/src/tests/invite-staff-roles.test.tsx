/**
 * Inviting staff onto roles.
 *
 * ── THE HOLE THIS PINS SHUT ──────────────────────────────────────────
 * The form offered a HARDCODED list of the seven seeded roles, because
 * the field was the `StaffRole` enum. So nobody could be invited onto a
 * role the team invented, or onto one of the three access tiers — the
 * only route was to invite somebody as one of the seven and re-role them
 * afterwards. That is a feature half-built: the roles screen let you
 * describe exactly the person you were hiring, and the invite form then
 * made you hand them somebody else's job.
 *
 * So the first test asks for a CUSTOM role by name. It would pass with
 * any list that happens to contain it and fail with any list that
 * cannot; the second test is the other direction, and asserts the
 * options are the server's list rather than a list of our own that
 * happens to overlap.
 *
 * The third is FE-2: submitting with nothing chosen is the server's
 * refusal to make, and its words are shown unchanged. The code string in
 * the fixture is the server's business — this file asserts the
 * `[CODE] message` SHAPE reached the DOM, never which code it was.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { InviteStaffModal } from '@/app/(authed)/staff/_components/invite-staff-modal';
import { buildFetchMock, renderWithProviders, type MockResponseBody } from './helpers';
import { ROLES } from './role-fixtures';

function mount(create: readonly MockResponseBody[], roles: unknown = ROLES) {
  const fetchImpl = buildFetchMock([
    { match: /\/admin\/staff\/invitations$/, responses: create },
    { match: /\/admin\/staff-roles$/, responses: [{ status: 200, body: roles }] },
  ]);
  return renderWithProviders(
    <ToastProvider>
      <InviteStaffModal onClose={() => {}} onSuccess={() => {}} />
    </ToastProvider>,
    { fetchImpl },
  );
}

function createCalls(fetchImpl: ReturnType<typeof buildFetchMock>) {
  return fetchImpl.mock.calls.filter(
    (c) =>
      /\/admin\/staff\/invitations$/.test(String(c[0])) &&
      (c[1] as { method?: string } | undefined)?.method === 'POST',
  );
}

async function pick(label: string): Promise<void> {
  const user = userEvent.setup();
  const combo = await screen.findByRole('combobox');
  await user.click(combo);
  await user.type(combo, `${label}{Enter}`);
}

describe('invite staff — roles come from the server, and there may be several', () => {
  it('invites onto a role the team invented, alongside an access tier', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = mount([
      {
        status: 201,
        body: {
          id: 'inv-1',
          email: 'new@skydrop.test',
          role: null,
          roleIds: ['r-returns', 'r-support'],
          roleNames: ['Returns desk', 'Support'],
          invitedById: 'staff-1',
          acceptedById: null,
          expiresAt: '2026-02-01T00:00:00.000Z',
          usedAt: null,
          createdAt: '2026-01-25T00:00:00.000Z',
          deletedAt: null,
          token: 't',
          inviteUrl: 'https://admin.skydrop.online/invite/t',
        },
      },
    ]);

    await user.type(screen.getByLabelText(/email/i), 'new@skydrop.test');
    // `Returns desk` is `isSystem: false` — invented here. Under the old
    // hardcoded seven there was no way to name it at all.
    await pick('Returns desk');
    await pick('Support');

    await user.click(screen.getByRole('button', { name: /create invitation/i }));

    await waitFor(() => {
      const calls = createCalls(fetchImpl);
      expect(calls.length, 'no invitation was created').toBe(1);
      const body = JSON.parse(String((calls[0]![1] as { body?: unknown }).body)) as {
        email: string;
        roleIds: string[];
      };
      expect(body.email).toBe('new@skydrop.test');
      expect([...body.roleIds].sort()).toEqual(['r-returns', 'r-support']);
      // The legacy enum must not reappear anywhere in the body — it is
      // what made a custom role unreachable.
      expect(JSON.stringify(body)).not.toMatch(/SUPER_ADMIN|CALL_AGENT|WAREHOUSE_STAFF/);
    });
  });

  it('offers exactly what the server sent — no list of its own', async () => {
    const user = userEvent.setup();
    // ONE role, named nothing like the seeded seven.
    mount([], [{ ...ROLES[7]!, id: 'r-only', name: 'Night shift' }]);
    const combo = await screen.findByRole('combobox');
    await user.click(combo);
    expect(await screen.findByRole('option', { name: /Night shift/i })).toBeInTheDocument();
    // If a hardcoded list came back, these would be here too.
    expect(screen.queryByRole('option', { name: /Call agent/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Super admin/i })).not.toBeInTheDocument();
  });
});

describe('FE-2 — an invitation with no roles is the SERVER’s refusal', () => {
  it('submits it and shows the verdict verbatim', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = mount([
      {
        status: 400,
        body: { code: 'BAD_REQUEST', message: 'roleIds must contain at least 1 elements' },
      },
    ]);
    await user.type(screen.getByLabelText(/email/i), 'new@skydrop.test');

    const submit = screen.getByRole('button', { name: /create invitation/i });
    // The warning on screen is guidance; the control is not the gate.
    expect(await screen.findByText(/choose at least one role/i)).toBeInTheDocument();
    expect(submit).not.toBeDisabled();
    await user.click(submit);

    await waitFor(() => {
      expect(createCalls(fetchImpl).length, 'the refusal was pre-empted client-side').toBe(1);
    });
    expect(
      await screen.findByText('[BAD_REQUEST] roleIds must contain at least 1 elements'),
    ).toBeInTheDocument();
  });
});
