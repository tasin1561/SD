/**
 * The roles screen with the list production now has.
 *
 * It was built for seven and is shown ten — the three access tiers
 * joined the seeded job functions. The thing worth pinning is that every
 * one of them is on the screen: the grouping is cosmetic, so the way it
 * could cost something is a role quietly falling between two headings.
 *
 * The people count is also checked, because its MEANING changed: it
 * comes from the join table now, so somebody holding three roles is
 * counted in all three and the column no longer adds up to the size of
 * the team. The screen says so, in words, under the tables.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { RolesIndex } from '@/app/(authed)/roles/_components/roles-index';
import { buildFetchMock, renderWithProviders } from './helpers';
import { CATALOGUE, ROLES } from './role-fixtures';

function mount(roles: readonly unknown[] = ROLES) {
  const fetchImpl = buildFetchMock([
    { match: /\/admin\/staff-roles\/catalogue$/, responses: [{ status: 200, body: CATALOGUE }] },
    { match: /\/admin\/staff-roles$/, responses: [{ status: 200, body: roles }] },
  ]);
  return renderWithProviders(
    <ToastProvider>
      <RolesIndex />
    </ToastProvider>,
    { fetchImpl },
  );
}

describe('roles screen — ten roles on two axes', () => {
  it('shows every role, under a heading', async () => {
    mount();
    for (const r of ROLES) {
      expect(await screen.findByText(r.name)).toBeInTheDocument();
    }
    for (const heading of ['Access tiers', 'Job functions', 'Roles you created']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    }
  });

  it('counts the roles in the header', async () => {
    mount();
    expect(await screen.findByText(String(ROLES.length))).toBeInTheDocument();
  });

  it('explains that one person is counted once per role they hold', async () => {
    mount();
    expect(await screen.findByText(/counted once per role they hold/i)).toBeInTheDocument();
  });

  it('offers a next step when nobody has invented a role yet', async () => {
    mount(ROLES.filter((r) => r.isSystem));
    expect(await screen.findByRole('heading', { name: 'Roles you created' })).toBeInTheDocument();
    expect(
      screen.getByText(/combination of permissions the seeded roles do not cover/i),
    ).toBeInTheDocument();
  });

  it('a seeded role with an unfamiliar key is still on the screen', async () => {
    mount([
      ...ROLES,
      {
        id: 'r-night',
        key: 'night_shift',
        name: 'Night shift',
        description: 'Seeded next release.',
        isSystem: true,
        isSuperAdmin: false,
        permissions: ['warehouse.pick'],
        staffCount: 0,
      },
    ]);
    expect(await screen.findByText('Night shift')).toBeInTheDocument();
  });
});
