import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type React from 'react';
import type { StaffMe } from '@skydrop/api-client';
import { StaffRoleKey } from '@skydrop/db';
import { AuthProvider } from '../client/context';
import {
  useStaffIdentity,
  useApiClient,
  useHasAccessToken,
  hasStaffRole,
  useSetIdentity,
} from '../client/hooks';

const STAFF: StaffMe = {
  id: 'sx',
  email: 'a@b',
  emailDisplay: 'a@b',
  roleKey: StaffRoleKey.SUPER_ADMIN,
  roleName: 'Super admin',
  roleKeys: [StaffRoleKey.SUPER_ADMIN],
  roleNames: ['Super admin'],
  permissions: ['staff.view', 'rbac.manage'],
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Somebody the OLD gate could not see: an access tier plus a role this
 * operator invented. Neither had a spelling in the dropped enum, so the
 * single `role` field was null for them and every `hasStaffRole` check
 * answered false — while they plainly held `support`.
 */
const INVENTED_ROLE_STAFF: StaffMe = {
  ...STAFF,
  id: 'sy',
  roleKey: StaffRoleKey.SUPPORT,
  roleName: 'Support',
  roleKeys: [StaffRoleKey.SUPPORT, 'returns_desk'],
  roleNames: ['Support', 'Returns desk'],
};

function Probe(): React.ReactElement {
  const identity = useStaffIdentity();
  const client = useApiClient();
  const hasToken = useHasAccessToken();
  return (
    <div>
      <span data-testid="email">{identity?.email ?? 'none'}</span>
      <span data-testid="client">{client ? 'ok' : 'missing'}</span>
      <span data-testid="hasToken">{hasToken ? 'yes' : 'no'}</span>
      <span data-testid="hasRoleSuperAdmin">
        {hasStaffRole(identity, [StaffRoleKey.SUPER_ADMIN]) ? 'yes' : 'no'}
      </span>
      <span data-testid="hasRoleFinance">
        {hasStaffRole(identity, [StaffRoleKey.FINANCE]) ? 'yes' : 'no'}
      </span>
      <span data-testid="hasRoleSupport">
        {hasStaffRole(identity, [StaffRoleKey.SUPPORT]) ? 'yes' : 'no'}
      </span>
    </div>
  );
}

describe('AuthProvider + hooks', () => {
  it('SSR-hydrated identity flows through useStaffIdentity', () => {
    render(
      <AuthProvider<StaffMe> identityKind="staff" initialIdentity={STAFF}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('email').textContent).toBe('a@b');
    expect(screen.getByTestId('client').textContent).toBe('ok');
    expect(screen.getByTestId('hasToken').textContent).toBe('no'); // store empty until login
  });

  it('hasStaffRole is cosmetic: matches when allowed; SUPER_ADMIN is NOT auto-included for FINANCE-only', () => {
    render(
      <AuthProvider<StaffMe> identityKind="staff" initialIdentity={STAFF}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('hasRoleSuperAdmin').textContent).toBe('yes');
    expect(screen.getByTestId('hasRoleFinance').textContent).toBe('no');
  });

  it('hasStaffRole sees EVERY role held, not just the first', () => {
    // The gate reads `roleKeys`. Under the single enum this person was
    // invisible to it twice over: `support` is an access tier and
    // `returns_desk` was invented here, so neither could be spelled,
    // the field was null, and the first answer below was "no" for
    // somebody who plainly held Support.
    render(
      <AuthProvider<StaffMe> identityKind="staff" initialIdentity={INVENTED_ROLE_STAFF}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('hasRoleSupport').textContent).toBe('yes');
    expect(screen.getByTestId('hasRoleSuperAdmin').textContent).toBe('no');
  });

  it('null identity (logged-out layout) → hooks return null + hasStaffRole returns false', () => {
    render(
      <AuthProvider<StaffMe> identityKind="staff" initialIdentity={null}>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId('email').textContent).toBe('none');
    expect(screen.getByTestId('hasRoleSuperAdmin').textContent).toBe('no');
  });

  it('useSetIdentity replaces the identity after, e.g., a successful login mutation', () => {
    let setIdentity: ((next: StaffMe | null) => void) | null = null;
    function Capture(): React.ReactElement {
      setIdentity = useSetIdentity<StaffMe>();
      const identity = useStaffIdentity();
      return <span data-testid="email">{identity?.email ?? 'none'}</span>;
    }
    render(
      <AuthProvider<StaffMe> identityKind="staff" initialIdentity={null}>
        <Capture />
      </AuthProvider>,
    );
    expect(screen.getByTestId('email').textContent).toBe('none');
    act(() => {
      setIdentity!(STAFF);
    });
    expect(screen.getByTestId('email').textContent).toBe('a@b');
  });
});
