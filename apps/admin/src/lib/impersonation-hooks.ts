'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';
import type {
  ImpersonationSessionSummary,
  ImpersonationSessionsQuery,
  StartImpersonationRequest,
  StartImpersonationResult,
  VerifyImpersonationResult,
} from '@skydrop/api-client';
import { usePermission } from './use-permission';

/**
 * The five support-impersonation calls, as TanStack wrappers.
 *
 * Same convention as the rest of `lib/` — `[domain, op, ...args]` keys,
 * endpoint knowledge at the app boundary rather than in the api-client
 * (FE-5). The shapes are read off `AdminImpersonationController`; two of
 * its answers are shapes a hand-written client would get wrong, so they
 * are worth naming here: both list routes return a BARE ARRAY rather
 * than a page, and the mode on the wire is the boolean `mayWrite`, not
 * an enum.
 *
 * ── THE READS SELF-GATE ─────────────────────────────────────────────
 * Both queries pass their permission to `enabled`. The review screen
 * would otherwise fire a request that 403s for everybody who is not a
 * reviewer, and a request nobody may make should never be sent — not
 * sent and have its refusal swallowed.
 */

/**
 * Every session anybody has opened, newest first — the review screen.
 *
 * `support.impersonate.review`, which is deliberately NOT the permission
 * that opens a session: oversight the overseen can grant themselves is
 * not oversight. Server-side cap is 200.
 */
export function useImpersonationSessions(
  query: ImpersonationSessionsQuery,
): UseQueryResult<readonly ImpersonationSessionSummary[]> {
  const client = useApiClient();
  const canReview = usePermission('support.impersonate.review');
  return useQuery({
    enabled: canReview,
    queryKey: ['admin-impersonation', 'list', query],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query.staffUserId !== undefined) sp.set('staffUserId', query.staffUserId);
      if (query.sellerId !== undefined) sp.set('sellerId', query.sellerId);
      if (query.storeId !== undefined) sp.set('storeId', query.storeId);
      if (query.limit !== undefined) sp.set('limit', String(query.limit));
      const qs = sp.toString();
      return client.request<readonly ImpersonationSessionSummary[]>(
        `/api/admin/impersonation${qs === '' ? '' : `?${qs}`}`,
      );
    },
    // A live session's request and write counts move while somebody is
    // watching the screen, and the reason a reviewer is on it at all is
    // usually that one is running right now.
    refetchInterval: 20_000,
  });
}

/**
 * Who is inside somebody's account RIGHT NOW — verified, not ended, not
 * past its deadline.
 *
 * Also `support.impersonate.review`: the endpoint returns EVERYBODY's
 * live sessions, not the caller's own, so it is the reviewer's question
 * rather than the operator's.
 */
export function useActiveImpersonations(): UseQueryResult<readonly ImpersonationSessionSummary[]> {
  const client = useApiClient();
  const canReview = usePermission('support.impersonate.review');
  return useQuery({
    enabled: canReview,
    queryKey: ['admin-impersonation', 'active'],
    queryFn: () =>
      client.request<readonly ImpersonationSessionSummary[]>('/api/admin/impersonation/active'),
    refetchInterval: 20_000,
  });
}

/**
 * Step one: open the session, and have a code mailed to yourself.
 *
 * Grants nothing. The result names the address the code went to, which
 * the dialog repeats back — a staff member with two addresses otherwise
 * waits at the wrong inbox.
 */
export function useStartImpersonation(): UseMutationResult<
  StartImpersonationResult,
  Error,
  StartImpersonationRequest
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<StartImpersonationResult>('/api/admin/impersonation/start', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-impersonation'] }),
  });
}

/**
 * Step two: the code, in exchange for the way in.
 *
 * The console hands the browser `handoff.redirectUrl` exactly as given
 * and does not rebuild it: the token lives in that URL's FRAGMENT so it
 * stays out of every server log, and reassembling the URL here is the
 * one mistake that would quietly put it in a query string. Five wrong
 * codes closes the session for good, which is the server's verdict and
 * shown verbatim (FE-2) rather than counted down in the UI.
 */
export function useVerifyImpersonation(): UseMutationResult<
  VerifyImpersonationResult,
  Error,
  { readonly sessionId: string; readonly code: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, code }) =>
      client.request<VerifyImpersonationResult>(
        `/api/admin/impersonation/${encodeURIComponent(sessionId)}/verify`,
        { method: 'POST', body: { code } },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-impersonation'] }),
  });
}

/**
 * End one, with an optional note for the review.
 *
 * The same endpoint for both people who may press it: somebody closing
 * their own session, and a reviewer closing somebody else's. Which of
 * the two this is, is a fact about the ROW and not about the route, so
 * the server decides — and the console does not model that twice.
 */
export function useEndImpersonation(): UseMutationResult<
  ImpersonationSessionSummary,
  Error,
  { readonly sessionId: string; readonly reason?: string }
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, reason }) =>
      client.request<ImpersonationSessionSummary>(
        `/api/admin/impersonation/${encodeURIComponent(sessionId)}/end`,
        { method: 'POST', body: reason === undefined ? {} : { reason } },
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-impersonation'] }),
  });
}
