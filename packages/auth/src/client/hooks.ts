/**
 * Identity-typed convenience hooks. Apps wrap their own thin aliases
 * (e.g., `useStaff = () => useStaffIdentity()`) for ergonomics, but
 * these are the canonical entry points.
 *
 * The RBAC helpers here are COSMETIC per FE-2 — hiding a control
 * somebody cannot use is UX, not security. The server's permission
 * guard is the only enforcement boundary; these just keep the UI
 * honest, so nobody fills in a form they were never allowed to submit.
 */
'use client';

import type { StaffRole } from '@skydrop/db';
import type { ApiClient, StaffMe, SellerMe } from '@skydrop/api-client';
import { useAuthCtx } from './context';

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
 * Cosmetic role gate.
 *
 * DEPRECATED in favour of `hasPermission`. A check against a role NAME
 * cannot see a role somebody invented — the whole point of roles being
 * data — so a custom "Warehouse manager" holding every warehouse
 * permission would still be hidden from a control gated this way.
 */
export function hasStaffRole(identity: StaffMe | null, allowed: readonly StaffRole[]): boolean {
  if (identity === null) return false;
  return allowed.includes(identity.role);
}

/**
 * Whether this person holds ANY of the given permissions.
 *
 * The cosmetic half of the permission system: it decides what to RENDER.
 * The server decides what happens, and refuses regardless of what was
 * shown — so a stale identity here is a slightly wrong menu, never an
 * escalation. Pair every hidden control with the permission its endpoint
 * declares, or the two drift and someone sees a button that 403s.
 */
export function hasPermission(
  identity: { readonly permissions: readonly string[] } | null,
  ...anyOf: readonly string[]
): boolean {
  if (identity === null) return false;
  return anyOf.some((p) => identity.permissions.includes(p));
}
