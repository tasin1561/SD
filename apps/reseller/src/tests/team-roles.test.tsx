import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StoreMe } from '@skydrop/api-client';
import TeamPage from '../app/(authed)/team/page';
import { makeStoreUser, renderStoreScreen } from './helpers';

/**
 * A store user holds SEVERAL roles and their permissions are the union.
 * Four things that follow from that are pinned here, because each of
 * them was wrong while one role was the only shape there was:
 *
 *  - every role somebody holds is SHOWN, not the first one;
 *  - a save states the WHOLE set (`roleKeys`), so nothing is implied by
 *    a role being absent;
 *  - the empty set is SENT and whatever refusal comes back is read
 *    verbatim (FE-2) — the DTO catches it as `BAD_REQUEST` and the
 *    service calls it `NO_ROLES`, so a client-side mirror would have to
 *    predict which, and be wrong about the wording either way;
 *  - "am I an owner?" is asked of every role held, never of `roleKey`,
 *    which is the first grant and reads as `finance` for somebody who is
 *    Finance AND Owner.
 */

const ME = '019fad84-0000-7000-8000-000000000001';
const PRIYA = '019fad84-0000-7000-8000-00000000000a';
const RAVI = '019fad84-0000-7000-8000-00000000000b';

const ROLES = [
  { key: 'owner', name: 'Owner', description: 'Everything, including permissions added later.' },
  { key: 'admin', name: 'Admin', description: 'Everything an owner can do today.' },
  { key: 'ops', name: 'Operations', description: 'Day-to-day work.' },
  { key: 'finance', name: 'Finance', description: 'The money side.' },
  { key: 'viewer', name: 'Viewer', description: 'Read-only.' },
];

function member(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: PRIYA,
    email: 'priya@kurtacorner.example',
    fullName: 'Priya Sharma',
    roleKey: 'ops',
    roleName: 'Operations',
    roleKeys: ['ops'],
    roleNames: ['Operations'],
    isOwner: false,
    lastLoginAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

const MANAGER = makeStoreUser({
  id: ME,
  permissions: ['team.view', 'team.manage'],
  roleKey: 'admin',
  roleName: 'Admin',
  roleKeys: ['admin'],
  roleNames: ['Admin'],
});

/**
 * Finance AND Owner — the shape that breaks a `roleKey === 'owner'`
 * gate. `roleKey` is the FIRST grant, so it says `finance`.
 */
const OWNER_SECOND = makeStoreUser({
  id: ME,
  permissions: ['team.view', 'team.manage'],
  roleKey: 'finance',
  roleName: 'Finance',
  roleKeys: ['finance', 'owner'],
  roleNames: ['Finance', 'Owner'],
});

/** A fetch that answers the team read, and whatever `writes` says next. */
function stubFetch(
  members: readonly Record<string, unknown>[],
  writes: (url: string, init?: { method?: string }) => Response | undefined = () => undefined,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: { method?: string }) => {
    const mine = writes(url, init);
    if (mine !== undefined) return mine;
    if (url.includes('/api/store/team') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ members, invitations: [], roles: ROLES }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
}

function bodyOf(call: readonly unknown[]): Record<string, unknown> {
  const init = call[1] as { body?: string };
  return JSON.parse(init.body ?? '{}') as Record<string, unknown>;
}

async function openRolesDialog(name = 'Change roles'): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name }));
  return screen.findByRole('dialog');
}

function render(identity: StoreMe, fetchImpl: ReturnType<typeof vi.fn>): void {
  renderStoreScreen(<TeamPage />, { identity, fetchImpl });
}

describe('store team — several roles per person', () => {
  it('shows EVERY role somebody holds, not the first one', async () => {
    render(
      MANAGER,
      stubFetch([member({ roleKeys: ['ops', 'finance'], roleNames: ['Operations', 'Finance'] })]),
    );
    const row = (await screen.findByText('Priya Sharma')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('Operations')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText('Finance')).toBeInTheDocument();
  });

  it('sends the WHOLE set to /roles, so nothing is implied by an absence', async () => {
    const fetchImpl = stubFetch([member()], (url, init) =>
      url.endsWith(`/members/${PRIYA}/roles`) && init?.method === 'PATCH'
        ? new Response(
            JSON.stringify(
              member({ roleKeys: ['ops', 'finance'], roleNames: ['Operations', 'Finance'] }),
            ),
            { status: 200 },
          )
        : undefined,
    );
    render(MANAGER, fetchImpl);
    const dialog = await openRolesDialog();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Finance/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }));

    await waitFor(() => {
      const patch = fetchImpl.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(String(patch?.[0])).toContain(`/api/store/team/members/${PRIYA}/roles`);
      // In the server's own order, and the whole set — not a delta.
      expect(bodyOf(patch as readonly unknown[])).toEqual({ roleKeys: ['ops', 'finance'] });
    });
  });

  /**
   * The empty set is SENT, and whatever comes back is read verbatim.
   *
   * Both refusals are exercised on purpose. An empty `roleKeys` is
   * caught by the DTO's `ArrayMinSize(1)` and reaches the browser as
   * `BAD_REQUEST` carrying class-validator's own wording; `NO_ROLES` is
   * the service's words for the same thing. The screen cannot know
   * which answers, which is exactly why it predicts neither — and a
   * test pinning one of them would pass against a hardcoded string.
   */
  it.each([
    ['BAD_REQUEST', 'roleKeys must contain at least 1 elements'],
    ['NO_ROLES', 'Somebody must hold at least one role. With none they cannot sign in.'],
  ])('submits an EMPTY set and reads [%s] back verbatim (FE-2)', async (code, message) => {
    const fetchImpl = stubFetch([member()], (url, init) =>
      url.endsWith(`/members/${PRIYA}/roles`) && init?.method === 'PATCH'
        ? new Response(JSON.stringify({ code, message }), { status: 400 })
        : undefined,
    );
    render(MANAGER, fetchImpl);
    const dialog = await openRolesDialog();
    // Untick the only role they hold. The screen does NOT refuse this.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Operations/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(`[${code}] ${message}`);
    await waitFor(() => {
      const patch = fetchImpl.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH',
      );
      expect(bodyOf(patch as readonly unknown[])).toEqual({ roleKeys: [] });
    });
  });

  it('reads [MEMBER_CHANGED] back verbatim when the list went stale', async () => {
    const fetchImpl = stubFetch([member()], (url, init) =>
      url.endsWith(`/members/${PRIYA}/roles`) && init?.method === 'PATCH'
        ? new Response(
            JSON.stringify({
              code: 'MEMBER_CHANGED',
              message: 'This person changed while you were looking. Try again.',
            }),
            { status: 409 },
          )
        : undefined,
    );
    render(MANAGER, fetchImpl);
    const dialog = await openRolesDialog();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Viewer/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save roles' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[MEMBER_CHANGED] This person changed while you were looking. Try again.',
    );
  });

  it('invites onto SEVERAL roles, sending roleKeys', async () => {
    const fetchImpl = stubFetch([], (url, init) =>
      url.endsWith('/api/store/team/invitations') && init?.method === 'POST'
        ? new Response(JSON.stringify({ id: 'inv-1' }), { status: 201 })
        : undefined,
    );
    render(MANAGER, fetchImpl);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite a colleague' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Name/, { selector: 'input' }), {
      target: { value: 'Ravi Kumar' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Email/, { selector: 'input' }), {
      target: { value: 'ravi@kurtacorner.example' },
    });
    // Opens on Operations; Finance as well, which is the whole point.
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Finance/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => {
      const post = fetchImpl.mock.calls.find(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(bodyOf(post as readonly unknown[])).toEqual({
        email: 'ravi@kurtacorner.example',
        fullName: 'Ravi Kumar',
        roleKeys: ['ops', 'finance'],
      });
    });
  });
});

describe('store team — who may touch an owner', () => {
  it('lets somebody who is Finance AND Owner edit an owner', async () => {
    render(
      OWNER_SECOND,
      stubFetch([
        member({
          id: RAVI,
          fullName: 'Ravi Kumar',
          roleKeys: ['owner'],
          roleNames: ['Owner'],
          isOwner: true,
        }),
      ]),
    );
    // A `roleKey === 'owner'` gate would read `finance` here and hide
    // this button from a real owner.
    expect(await screen.findByRole('button', { name: 'Change roles' })).toBeInTheDocument();
    const dialog = await openRolesDialog();
    expect(within(dialog).getByRole('checkbox', { name: /Owner/ })).toBeEnabled();
  });

  it('shows an owner read-only to a non-owner, and says why Owner cannot be ticked', async () => {
    render(
      MANAGER,
      stubFetch([
        member({
          id: RAVI,
          fullName: 'Ravi Kumar',
          roleKeys: ['owner'],
          roleNames: ['Owner'],
          isOwner: true,
        }),
        member(),
      ]),
    );
    const ownerRow = (await screen.findByText('Ravi Kumar')).closest('tr') as HTMLElement;
    expect(within(ownerRow).queryByRole('button', { name: 'Change roles' })).toBeNull();

    // On somebody they MAY edit, Owner is offered but not grantable.
    const priyaRow = screen.getByText('Priya Sharma').closest('tr') as HTMLElement;
    fireEvent.click(within(priyaRow).getByRole('button', { name: 'Change roles' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: /Owner/ })).toBeDisabled();
    expect(
      within(dialog).getByText('Only an owner of this store can make somebody an owner.'),
    ).toBeInTheDocument();
  });
});
