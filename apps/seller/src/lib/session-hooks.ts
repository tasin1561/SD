'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * The signed-in person's own sessions.
 *
 * `POST /auth/seller/logout-all` is reachable by every role, and the
 * mechanism matters: `SellerAuthController` carries `@SellerSelfService()`
 * at the class, which is what makes the permission gate skip it. It is
 * NOT that the endpoint forgot to declare one — an endpoint declaring
 * nothing is refused outright (SellerJwtGuard rule 4,
 * ENDPOINT_NOT_AUTHORIZED), so reading it that way invites someone to
 * "fix" it by adding a permission and lock a VIEWER out of the one
 * control that matters after they lose a laptop.
 *
 * So nothing here gates on a permission (FE-2 — gate on what the server
 * enforces, and here it enforces authentication and nothing more).
 */

/** What the controller returns. Nothing else is in the body. */
export interface LogoutEverywhereResult {
  readonly revokedCount: number;
}

/**
 * Ends every refresh session for this account, including this browser's
 * — the handler clears the `__Host-sellerRefresh` cookie on its way out.
 *
 * The handler takes NO `@Body`, so this sends none. `ApiClient.doFetch`
 * omits the body (and the Content-Type) when `body` is undefined, which
 * is what we want: the API runs `forbidNonWhitelisted`, and a stray
 * `{}` on a route with no DTO is at best noise on the wire.
 *
 * No cache invalidation on success, deliberately: nothing cached
 * describes a session, and every other query in the app is about to
 * belong to a signed-out person anyway. The caller sends them to
 * /login, which reloads the page and wipes the in-memory access token
 * (FE-1).
 */
export function useLogoutEverywhere(): UseMutationResult<LogoutEverywhereResult, Error, void> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<LogoutEverywhereResult>('/api/auth/seller/logout-all', { method: 'POST' }),
  });
}

/**
 * Ask for a fresh email-verification link.
 *
 * The confirm half has always had a page (the link in the email lands
 * there); the REQUEST half had no caller, so a seller whose verification
 * email was lost, filtered or sent before they finished setting up had
 * no way to get another one and no way to tell anybody.
 *
 * Self-service like the rest of this controller — it verifies the
 * address on the account you are already signed in as, so it takes no
 * body and there is nothing to authorise beyond being logged in.
 */
export function useRequestEmailVerification(): UseMutationResult<{ ok: true }, Error, void> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ ok: true }>('/api/auth/seller/email-verification/request', {
        method: 'POST',
      }),
  });
}
