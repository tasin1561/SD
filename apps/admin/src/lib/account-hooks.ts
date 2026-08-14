'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type { StaffMe } from '@skydrop/api-client';

/**
 * The signed-in staff member's own account.
 *
 * ── NOT PERMISSION-GATED, AND THAT IS THE POINT ──────────────────────
 * Both endpoints below sit under the auth controller's
 * `@StaffSelfService()` — the API's named opt-out for "endpoints every
 * authenticated staff member may reach BECAUSE they are about
 * themselves". So there is no permission to mirror here (FE-2): the
 * server's gate is "are you signed in", which is the same gate the
 * whole `(authed)` route group already passes.
 *
 * ── WHY A QUERY WHEN THE SHELL ALREADY HAS THE IDENTITY ──────────────
 * `useStaffIdentity()` returns the SSR-hydrated snapshot taken when the
 * page booted. On a security screen the interesting fields are the ones
 * that move — `lastLoginAt` above all — so this refetches rather than
 * reading a copy that could be an hour old and look authoritative.
 */

const KEY = ['admin-account'];

/** `GET /auth/staff/me` — the fresh copy of the caller's own identity. */
export function useAccountIdentity(): UseQueryResult<StaffMe> {
  const client = useApiClient();
  return useQuery({
    queryKey: [...KEY, 'me'],
    queryFn: () => client.meStaff(),
    staleTime: 30 * 1000,
  });
}

export interface LogoutAllResult {
  /**
   * How many refresh sessions were revoked — INCLUDING the one making
   * the request. The server clears this browser's `__Host-staffRefresh`
   * on the way out, so a successful call always ends with the caller
   * signed out too.
   */
  readonly revokedCount: number;
}

/**
 * `POST /auth/staff/logout-all` — end every refresh session for this
 * staff member.
 *
 * ── NO REQUEST BODY. NONE. ───────────────────────────────────────────
 * The handler takes no `@Body()` and there is no DTO, and the API runs
 * `ValidationPipe({ forbidNonWhitelisted: true })` — so one invented
 * field would turn every call into a 400. `client.request` omits both
 * the body and the Content-Type header when `body` is undefined, which
 * is exactly what this endpoint wants.
 *
 * ── THE CACHE IS ABOUT TO BE MEANINGLESS ─────────────────────────────
 * Every session including this one is now dead, so the react-query
 * cache holds answers nobody may ask for again. We clear it rather than
 * invalidate: an invalidate would REFETCH, and each refetch would 401,
 * burn a doomed silent-refresh, and paint errors over a screen the
 * operator is leaving. The caller then hard-navigates to /login, which
 * also drops the in-memory access token (FE-1) by construction.
 */
export function useLogoutAllSessions(): UseMutationResult<LogoutAllResult, Error, void> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request<LogoutAllResult>('/api/auth/staff/logout-all', { method: 'POST' }),
    onSuccess: () => qc.clear(),
  });
}

/**
 * Ask for a fresh email-verification link.
 *
 * The page has always SHOWN "not verified" and offered nothing to do
 * about it — the confirm half has a page (the link in the email lands
 * there), the request half had no caller. So a staff member whose
 * verification email was filtered could read that their address was
 * unconfirmed and had no way to change it.
 *
 * `@StaffSelfService()` like the rest of this controller: it verifies
 * the address on the account you are already signed in as.
 */
export function useRequestEmailVerification(): UseMutationResult<{ ok: true }, Error, void> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ ok: true }>('/api/auth/staff/email-verification/request', {
        method: 'POST',
      }),
  });
}
