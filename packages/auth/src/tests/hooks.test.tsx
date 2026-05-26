import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type React from 'react';
import type { StaffMe } from '@skydrop/api-client';
import { AuthProvider } from '../client/context.js';
import {
  useStaffIdentity,
  useApiClient,
  useHasAccessToken,
  hasStaffRole,
  useSetIdentity,
} from '../client/hooks.js';

const STAFF: StaffMe = {
  id: 'sx',
  email: 'a@b',
  emailDisplay: 'a@b',
  // The role enum is a string at runtime; the imported StaffRole
  // type is a TS enum — using SUPER_ADMIN literal is fine.
  role: 'SUPER_ADMIN' as StaffMe['role'],
  emailVerifiedAt: null,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
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
        {hasStaffRole(identity, ['SUPER_ADMIN' as StaffMe['role']]) ? 'yes' : 'no'}
      </span>
      <span data-testid="hasRoleFinance">
        {hasStaffRole(identity, ['FINANCE' as StaffMe['role']]) ? 'yes' : 'no'}
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
