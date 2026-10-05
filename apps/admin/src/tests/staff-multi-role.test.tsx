/**
 * Staff roles — several per person, and the server is the one that
 * refuses.
 *
 * ── WHAT THIS PINS, AND WHY EACH PART ────────────────────────────────
 * (a) The LIST names every role somebody holds. It used to be a
 *     `<Select>` showing exactly one, which for a person holding a job
 *     function AND an access tier is a wrong answer that looks like a
 *     right one — nothing on screen said there was more.
 *
 * (b) A person holding NO live role is called out rather than shown
 *     blank. It is a real state (every role they held was soft-deleted)
 *     and its consequence is that they cannot sign in at all, so an
 *     empty cell reads as "still loading".
 *
 * (c) The request is `PATCH .../roles` with `{ roleIds: [...] }` — the
 *     PLURAL route and body. The singular `/role` survives on the server
 *     only as a transitional alias, so asserting the URL is asserting we
 *     are not building against scaffolding.
 *
 * (d) **FE-2.** Clearing every role is submitted, not blocked, and
 *     whatever the server answers is rendered VERBATIM. The assertion
 *     is deliberately in two halves — the request WAS issued, and the
 *     verdict reached the DOM unchanged — because a UI that greys the
 *     button out would pass a "no bad state was saved" test while having
 *     moved the enforcement client-side, which is exactly the FE-2
 *     erosion mode. The fixture's code string is the SERVER's business:
 *     this file never asserts which code, only that the one that arrived
 *     is shown as `[CODE] message`.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { StaffManagementIndex } from '@/app/(authed)/staff/_components/staff-management-index';
import { buildFetchMock, renderWithProviders, type MockResponseBody } from './helpers';
import { CATALOGUE, NO_INVITATIONS, ROLES, USERS } from './role-fixtures';

function repeat(body: unknown, times = 4): MockResponseBody[] {
  return Array.from({ length: times }, () => ({ status: 200, body }));
}

function mount(patch: readonly MockResponseBody[]) {
  const fetchImpl = buildFetchMock([
    // Most specific first — `users$` is anchored so it cannot swallow
    // the roles URL, but relying on anchoring alone is how the next
    // route added here becomes a silent mismatch.
    { match: /\/admin\/staff\/users\/[^/]+\/roles$/, responses: patch },
    { match: /\/admin\/staff-roles\/catalogue$/, responses: repeat(CATALOGUE) },
    { match: /\/admin\/staff-roles$/, responses: repeat(ROLES) },
    { match: /\/admin\/staff\/users$/, responses: repeat(USERS) },
    { match: /\/admin\/staff\/invitations$/, responses: repeat(NO_INVITATIONS) },
  ]);
  return renderWithProviders(
    <ToastProvider>
      <StaffManagementIndex />
    </ToastProvider>,
    { fetchImpl },
  );
}

function patchCalls(fetchImpl: ReturnType<typeof buildFetchMock>) {
  return fetchImpl.mock.calls.filter(
    (c) =>
      /\/admin\/staff\/users\/[^/]+\/roles$/.test(String(c[0])) &&
      (c[1] as { method?: string } | undefined)?.method === 'PATCH',
  );
}

async function openRolesDialog(): Promise<void> {
  const user = userEvent.setup();
  const row = await screen.findByText('u-two-roles@skydrop.test');
  const buttons = await screen.findAllByRole('button', { name: /change roles/i });
  expect(row).toBeInTheDocument();
  await user.click(buttons[0]!);
  await screen.findByRole('button', { name: 'Save roles' });
}

describe('staff list — every role a person holds', () => {
  it('names both of a two-role person’s roles, not just the first', async () => {
    mount([]);
    const cell = await screen.findByText('u-two-roles@skydrop.test');
    const row = cell.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Call agent')).toBeInTheDocument();
    expect(within(row!).getByText('Support')).toBeInTheDocument();
  });

  it('says a person with no live roles cannot sign in, rather than leaving the cell blank', async () => {
    mount([]);
    const cell = await screen.findByText('u-no-roles@skydrop.test');
    const row = cell.closest('tr');
    expect(within(row!).getByText(/no roles — cannot sign in/i)).toBeInTheDocument();
  });
});

describe('changing roles — the plural route and body', () => {
  it('PATCHes .../roles with every chosen roleId', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = mount([
      {
        status: 200,
        body: {
          id: 'u-two-roles',
          roleIds: ['r-call', 'r-support', 'r-fin'],
          roleNames: ['Call agent', 'Support', 'Finance'],
        },
      },
    ]);
    await openRolesDialog();

    // Add a third via the combobox: typing filters, Enter toggles the
    // active row and keeps the list open.
    const combo = screen.getByRole('combobox');
    await user.click(combo);
    await user.type(combo, 'Finance{Enter}');

    await user.click(screen.getByRole('button', { name: 'Save roles' }));

    await waitFor(() => {
      const calls = patchCalls(fetchImpl);
      expect(calls.length, 'no PATCH was issued').toBe(1);
      expect(String(calls[0]![0])).toMatch(/\/api\/admin\/staff\/users\/u-two-roles\/roles$/);
      const body = JSON.parse(String((calls[0]![1] as { body?: unknown }).body)) as {
        roleIds: string[];
      };
      expect([...body.roleIds].sort()).toEqual(['r-call', 'r-fin', 'r-support']);
    });
  });

  it('offers a role the team invented — not a hardcoded list of the seeded ones', async () => {
    const user = userEvent.setup();
    mount([]);
    await openRolesDialog();
    const combo = screen.getByRole('combobox');
    await user.click(combo);
    await user.type(combo, 'Returns');
    expect(await screen.findByRole('option', { name: /Returns desk/i })).toBeInTheDocument();
  });
});

describe('FE-2 — removing every role is the SERVER’s refusal to make', () => {
  it('submits an empty set and renders the server’s verdict verbatim', async () => {
    const user = userEvent.setup();
    // The shape the API's own exception filter produces. Which code it is
    // is not this test's business — only that it arrives unchanged.
    const refusal = {
      status: 400,
      body: { code: 'BAD_REQUEST', message: 'roleIds must contain at least 1 elements' },
    };
    const { fetchImpl } = mount([refusal]);
    await openRolesDialog();

    // Take every chip off. Each one has its own named remove button.
    await user.click(screen.getByRole('button', { name: 'Remove Call agent' }));
    await user.click(screen.getByRole('button', { name: 'Remove Support' }));

    const save = screen.getByRole('button', { name: 'Save roles' });
    // THE LOAD-BEARING ASSERTION. A disabled button here would make this
    // screen the thing enforcing the rule, and the test below would pass
    // for the wrong reason.
    expect(save).not.toBeDisabled();
    await user.click(save);

    await waitFor(() => {
      expect(patchCalls(fetchImpl).length, 'the refusal was pre-empted client-side').toBe(1);
    });
    expect(
      await screen.findByText('[BAD_REQUEST] roleIds must contain at least 1 elements'),
    ).toBeInTheDocument();
  });

  it('renders the last-super-admin refusal verbatim too', async () => {
    const user = userEvent.setup();
    const { fetchImpl } = mount([
      {
        status: 400,
        body: {
          code: 'LAST_SUPER_ADMIN',
          message:
            'This is the last super admin. Moving them off that role would leave nobody able to manage roles or staff.',
        },
      },
    ]);
    await openRolesDialog();
    const combo = screen.getByRole('combobox');
    await user.click(combo);
    await user.type(combo, 'Read-only{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save roles' }));

    await waitFor(() => expect(patchCalls(fetchImpl).length).toBe(1));
    expect(
      await screen.findByText(/^\[LAST_SUPER_ADMIN\] This is the last super admin\./),
    ).toBeInTheDocument();
  });
});
