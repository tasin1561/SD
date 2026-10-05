/**
 * FE-2 boundary — setting the roles a team member holds.
 *
 * This is the seller-side write where a client-side mirror of the policy
 * is most tempting, because there are two rules a UI would love to
 * enforce itself and neither is knowable here:
 *
 *   - An EMPTY SET. A person must hold at least one role, because
 *     somebody with none cannot sign in at all. A disabled submit button
 *     would look like the same thing and would be a second copy of the
 *     rule.
 *   - The LAST OWNER. Moving the final owner off that role would leave
 *     nobody able to manage the account. Only the server can count the
 *     owners left — it counts them through the join table, inside the
 *     write's own transaction, and somebody holding Owner as one of
 *     several roles still counts as one. A greyed-out option here would
 *     be a guess made from stale data.
 *
 * ── THE CODES BELOW ARE FIXTURES, NOT A CONTRACT ──────────────────
 * What the server actually answers for an empty set moved while this was
 * being built — a DTO minimum, a service check and the guard can each
 * produce it, with different codes and different statuses. That is
 * exactly why the UI must not know: these tests feed back arbitrary
 * `{code, message}` pairs and assert the screen reproduces them
 * CHARACTER FOR CHARACTER. A test that asserted one specific code would
 * be pinning the server's vocabulary from the client, which is the same
 * mistake in test form. The companion source scan
 * (`team-roles-are-not-an-enum.test.ts`) asserts the opposite direction:
 * no error code appears in the components at all.
 *
 * The happy path pins the request SHAPE: `PATCH …/members/:id/roles`
 * carrying the whole `roleIds` set.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { TeamManagementIndex } from '@/app/(authed)/team/_components/team-management-index';
import { buildFetchMock, renderWithProviders } from './helpers';

const ROLES = [
  {
    id: 'role-owner',
    key: 'owner',
    name: 'Owner',
    description: null,
    isSystem: true,
    isOwner: true,
    permissions: ['*'],
    memberCount: 1,
  },
  {
    id: 'role-ops',
    key: 'ops',
    name: 'Ops',
    description: 'Orders, catalogue, tracking',
    isSystem: true,
    isOwner: false,
    permissions: ['orders.view', 'orders.create'],
    memberCount: 1,
  },
  {
    id: 'role-finance',
    key: 'finance',
    name: 'Finance',
    description: 'Wallet and remittance',
    isSystem: true,
    isOwner: false,
    permissions: ['wallet.view'],
    memberCount: 0,
  },
  // A role this company built itself. It has no legacy enum spelling,
  // which is the whole reason the screens read `roleNames`.
  {
    id: 'role-returns',
    key: 'returns-desk',
    name: 'Returns desk',
    description: 'Handles RTO only',
    isSystem: false,
    isOwner: false,
    permissions: ['orders.view'],
    memberCount: 1,
  },
];

/** Holds TWO roles, one of them invented by this company. */
const MEMBER = {
  id: 'member-1',
  email: 'jo@example.com',
  emailDisplay: 'jo@example.com',
  fullName: 'Jo Rahman',
  // Null, as the server returns for somebody whose roles have no enum
  // spelling between them. Nothing on the screen may read it.
  role: null,
  roleId: 'role-ops',
  roleName: 'Ops',
  roleIds: ['role-ops', 'role-returns'],
  roleNames: ['Ops', 'Returns desk'],
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: '2026-02-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  isYou: false,
};

function mockTeam(patch: ReadonlyArray<{ status: number; body?: unknown }>) {
  return buildFetchMock([
    {
      match: /\/api\/seller\/roles\/catalogue/,
      responses: [{ status: 200, body: { groups: [], permissions: [] } }],
    },
    { match: /\/api\/seller\/roles$/, responses: [{ status: 200, body: ROLES }] },
    {
      match: /\/api\/seller\/team\/invitations$/,
      responses: [{ status: 200, body: { items: [], total: 0 } }],
    },
    { match: /\/api\/seller\/team\/members$/, responses: [{ status: 200, body: [MEMBER] }] },
    { match: /\/api\/seller\/team\/members\/member-1\/roles$/, responses: patch },
  ]);
}

/** The screen under its real chrome's toast provider (as `authed-shell` gives it). */
function mountTeam(fetchImpl: ReturnType<typeof buildFetchMock>): void {
  renderWithProviders(
    <ToastProvider>
      <TeamManagementIndex />
    </ToastProvider>,
    { fetchImpl },
  );
}

async function openRoleDialog(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const open = await screen.findByRole('button', { name: /Change roles for Jo Rahman/i });
  await user.click(open);
  await screen.findByRole('button', { name: /Save roles/i });
}

describe('the team screen — every role a person holds', () => {
  it('shows BOTH roles in the row, including the one this company invented', async () => {
    mountTeam(mockTeam([]));

    // Not "Ops" alone: access is the union, so one of them is not a
    // summary of it.
    expect(await screen.findByText('Ops')).toBeTruthy();
    expect(await screen.findByText('Returns desk')).toBeTruthy();
  });
});

describe('FE-2 boundary — seller sets a team member’s roles', () => {
  it('server-rejection VERBATIM: clearing every role → the UI reproduces whatever the server answered, and stays open', async () => {
    const user = userEvent.setup();
    // A deliberately UNFAMILIAR code. The screen has never heard of it
    // and must still render it exactly — which is the property, rather
    // than "it recognises the empty-set refusal".
    const rejection = {
      code: 'SOME_REFUSAL_THE_UI_HAS_NEVER_HEARD_OF',
      message: 'A person must hold at least one role. Somebody with none cannot sign in at all.',
    };
    mountTeam(mockTeam([{ status: 400, body: rejection }]));

    await openRoleDialog(user);

    // Take both roles away. The UI does NOT refuse this — a disabled
    // button here would be a second copy of the server's rule, and the
    // point is that the server is the one that owns it.
    await user.click(screen.getByRole('button', { name: /Remove Ops/i }));
    await user.click(screen.getByRole('button', { name: /Remove Returns desk/i }));

    const save = screen.getByRole('button', { name: /Save roles/i });
    expect(save).not.toBeDisabled();
    await user.click(save);

    const verdict = await screen.findByText(/SOME_REFUSAL_THE_UI_HAS_NEVER_HEARD_OF/);
    expect(verdict.textContent).toContain(`[${rejection.code}]`);
    expect(verdict.textContent).toContain(rejection.message);

    // Still open, so the choice can be corrected rather than remade from
    // scratch.
    expect(screen.getByRole('button', { name: /Save roles/i })).toBeTruthy();
  });

  it('server-rejection VERBATIM: the last-owner refusal is SHOWN, not pre-empted by a greyed-out option', async () => {
    const user = userEvent.setup();
    // Whatever this one is called today. The owner option is offered
    // regardless, because the count that decides lives in the server's
    // transaction.
    const rejection = {
      code: 'LAST_OWNER',
      message:
        'This is the last owner. Moving them off that role would leave nobody able to manage the account.',
    };
    mountTeam(mockTeam([{ status: 400, body: rejection }]));

    await openRoleDialog(user);
    await user.click(screen.getByRole('button', { name: /Save roles/i }));

    const verdict = await screen.findByText(new RegExp(rejection.code));
    expect(verdict.textContent).toContain(`[${rejection.code}]`);
    expect(verdict.textContent).toContain(rejection.message);
  });

  it('happy path: PATCHes …/members/:id/roles with the WHOLE set of roleIds', async () => {
    const user = userEvent.setup();
    const fetchImpl = mockTeam([
      {
        status: 200,
        body: {
          id: 'member-1',
          roleIds: ['role-ops', 'role-returns', 'role-finance'],
          roleNames: ['Ops', 'Returns desk', 'Finance'],
        },
      },
    ]);
    mountTeam(fetchImpl);

    await openRoleDialog(user);

    // Add a third role on top of the two already held.
    const field = screen.getByRole('combobox', { name: /Roles/i });
    await user.click(field);
    await user.type(field, 'Finance');
    await user.click(await screen.findByRole('option', { name: /Finance/i }));

    await user.click(screen.getByRole('button', { name: /Save roles/i }));

    await waitFor(() => {
      const call = fetchImpl.mock.calls.find(
        (c: readonly unknown[]) =>
          String(c[0]).includes('/team/members/member-1/roles') &&
          (c[1] as { method?: string } | undefined)?.method === 'PATCH',
      );
      expect(call).toBeTruthy();
      const body = JSON.parse(String((call?.[1] as { body?: unknown }).body)) as {
        roleIds: string[];
      };
      // REPLACE, not merge: the whole set goes up, so taking a role
      // away is expressible at all.
      expect(body.roleIds).toEqual(['role-ops', 'role-returns', 'role-finance']);
    });
  });
});
