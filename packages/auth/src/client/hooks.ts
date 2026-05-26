/**
 * Identity-typed convenience hooks. Apps wrap their own thin aliases
 * (e.g., `useStaff = () => useStaffIdentity()`) for ergonomics, but
 * these are the canonical entry points.
 *
 * RBAC helper (`hasStaffRole`) is COSMETIC per FE-2 — UI hiding of a
 * control the role can't use is UX, not security. The server's
 * `requireStaffRoles` is the only enforcement boundary; this helper
 * just keeps the UI honest.
 */
'use client';

import type { StaffRole } from '@skydrop/db';
import type { ApiClient, StaffMe, SellerMe } from '@skydrop/api-client';
import { useAuthCtx } from './context.js';

export function useApiClient(): ApiClient {
  return useAuthCtx<unknown>().client;
}

/** Staff identity (or null). Returns null on the unauthenticated
 *  layout (e.g., /login). Most callers should mount under the
 *  authed route group where it is non-null by SSR construction. */
export function useStaffIdentity(): StaffMe | null {
  return useAuthCtx<StaffMe>().identity;
}

export function useSellerIdentity(): SellerMe | null {
  return useAuthCtx<SellerMe>().identity;
}

export function useSetIdentity<Identity>(): (next: Identity | null) => void {
  return useAuthCtx<Identity>().setIdentity;
}

export function useHasAccessToken(): boolean {
  return useAuthCtx<unknown>().hasAccessToken;
}

/**
 * Cosmetic role gate. ALWAYS pair with a server-enforced
 * requireStaffRoles call on the underlying endpoint — the UI must
 * never be the trust boundary. SUPER_ADMIN is NOT auto-allowed
 * (matches the API helper's discipline).
 */
export function hasStaffRole(
  identity: StaffMe | null,
  allowed: readonly StaffRole[],
): boolean {
  if (identity === null) return false;
  return allowed.includes(identity.role);
}
