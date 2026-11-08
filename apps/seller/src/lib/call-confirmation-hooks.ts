'use client';

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * Automatic confirmation calls, and the orders waiting on the client's say-so
 * when those calls are switched off.
 *
 * The two settings (`ops.call_confirmation_required`,
 * `ops.call_auto_confirm_ttl_hours`) are client-overridable settings; they are
 * read and written through `seller/order-defaults/confirmation-calls`, the same
 * controller that serves the delivery-fee default. The list and the send action
 * are `seller/orders/awaiting-confirmation` and `seller/orders/confirmation-calls`.
 * The server owns every rule here (FE-2); this file only carries shapes.
 */

export const TTL_MIN_HOURS = 1;
export const TTL_MAX_HOURS = 168;

export interface CallConfirmationSetting {
  /** `ops.call_confirmation_required` — true is the default and the safe state. */
  readonly callsRequired: boolean;
  /** `ops.call_auto_confirm_ttl_hours` — only meaningful while calls are off. */
  readonly ttlHours: number;
  readonly isOwnValue: boolean;
}

export interface AwaitingConfirmationRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly recipientName: string;
  readonly recipientCity: string;
  readonly codAmountInr: string;
  readonly itemCount: number;
  readonly createdAt: string;
  /** null when no auto-confirm clock is running for this order. */
  readonly confirmationDeadlineAt: string | null;
}

export interface AwaitingConfirmationPage {
  readonly items: ReadonlyArray<AwaitingConfirmationRow>;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/** One order's result from a send. Anything that is not queued/already-queued is a refusal. */
export interface ConfirmationCallOutcome {
  readonly orderId: string;
  readonly outcome: string;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

export interface ConfirmationCallsResult {
  readonly results: ReadonlyArray<ConfirmationCallOutcome>;
}

const SETTING_PATH = '/api/seller/order-defaults/confirmation-calls';

export function useCallConfirmationSetting(): UseQueryResult<CallConfirmationSetting> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-order-defaults', 'call-confirmation'],
    queryFn: () => client.request<CallConfirmationSetting>(SETTING_PATH),
  });
}

export function useSetCallConfirmationSetting(): UseMutationResult<
  CallConfirmationSetting,
  Error,
  { callsRequired: boolean; ttlHours: number }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<CallConfirmationSetting>(SETTING_PATH, { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-order-defaults'] });
      void queryClient.invalidateQueries({ queryKey: ['seller-awaiting-confirmation'] });
    },
  });
}

export function useAwaitingConfirmation(
  page: number,
  pageSize: number,
): UseQueryResult<AwaitingConfirmationPage> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['seller-awaiting-confirmation', page, pageSize],
    queryFn: () =>
      client.request<AwaitingConfirmationPage>(
        `/api/seller/orders/awaiting-confirmation?page=${page}&pageSize=${pageSize}`,
      ),
    // The list keeps its height while the re-read after a send is in flight,
    // so rows leaving never jolt what is below them.
    placeholderData: keepPreviousData,
  });
}

export function useSendConfirmationCalls(): UseMutationResult<
  ConfirmationCallsResult,
  Error,
  { orderIds: string[] }
> {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<ConfirmationCallsResult>('/api/seller/orders/confirmation-calls', {
        method: 'POST',
        body,
      }),
    // Nothing optimistic: the list is re-read from the server either way.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['seller-awaiting-confirmation'] });
    },
  });
}

/** Tally a send for honest reporting. */
export function tallyOutcomes(results: ReadonlyArray<ConfirmationCallOutcome>): {
  sent: number;
  already: number;
  refused: ReadonlyArray<ConfirmationCallOutcome>;
} {
  let sent = 0;
  let already = 0;
  const refused: ConfirmationCallOutcome[] = [];
  for (const r of results) {
    const o = r.outcome.toUpperCase();
    if (o === 'QUEUED' || o === 'SENT') sent += 1;
    else if (o === 'ALREADY_QUEUED') already += 1;
    else refused.push(r);
  }
  return { sent, already, refused };
}
