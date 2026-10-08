'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/** The signed-in person's own login — self-service, about themselves. */

export function useRequestEmailVerification(): UseMutationResult<{ ok: true }, Error, void> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ ok: true }>('/api/auth/store/email-verification/request', {
        method: 'POST',
      }),
  });
}

export function useSignOutEverywhere(): UseMutationResult<{ revokedCount: number }, Error, void> {
  const client = useApiClient();
  return useMutation({
    mutationFn: () =>
      client.request<{ revokedCount: number }>('/api/auth/store/logout-all', { method: 'POST' }),
  });
}
