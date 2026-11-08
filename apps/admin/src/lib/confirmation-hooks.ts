'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * Orders waiting because their client switched OFF the confirmation call.
 *
 * Contract (built in parallel on the API side):
 *   GET  /admin/orders/awaiting-confirmation   paginated, newest first,
 *                                              filterable by client
 *   POST /admin/orders/confirmation-calls      { orderIds } (max 100) ->
 *                                              one outcome per order
 *
 * The permission for both is `callcenter.queue.manage` (the same key that
 * returns a declined order to the queue). The UI only mirrors it to hide
 * controls (FE-2); the API refuses regardless.
 */
export const CONFIRMATION_PERMISSION = 'callcenter.queue.manage';
export const MAX_SEND_BATCH = 100;

export interface AwaitingConfirmationRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly recipientName: string | null;
  readonly recipientCity: string | null;
  /** Decimal string in rupees, as the API serialises money. */
  readonly codAmountInr: string | null;
  readonly itemCount: number;
  readonly createdAt: string;
  /** Null when no timer is running (the client has calls on). */
  readonly confirmationDeadlineAt: string | null;
  /** True when the client has since switched calls back on. */
  readonly callsRequired: boolean;
}

export interface AwaitingConfirmationPage {
  readonly items: readonly AwaitingConfirmationRow[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface AwaitingConfirmationQuery {
  readonly sellerId?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
}

export function useAwaitingConfirmation(
  query: AwaitingConfirmationQuery,
  enabled = true,
): UseQueryResult<AwaitingConfirmationPage> {
  const client = useApiClient();
  return useQuery({
    enabled,
    queryKey: ['admin-awaiting-confirmation', query],
    queryFn: () => {
      const sp = new URLSearchParams();
      if (query.sellerId) sp.set('sellerId', query.sellerId);
      sp.set('page', String(query.page));
      sp.set('pageSize', String(query.pageSize));
      return client.request<AwaitingConfirmationPage>(
        `/api/admin/orders/awaiting-confirmation?${sp.toString()}`,
      );
    },
  });
}

/** How one order's send ended, after reading whatever the API called it. */
export type SendKind = 'sent' | 'already' | 'failed';

export interface SendResult {
  readonly orderId: string;
  readonly kind: SendKind;
  /** The server's own words for a refusal, shown verbatim. */
  readonly detail: string | null;
}

interface RawOutcome {
  readonly orderId?: string;
  readonly outcome?: string;
  readonly status?: string;
  readonly code?: string;
  readonly message?: string;
  readonly error?: string;
}

/**
 * The API returns one outcome per order. The label vocabulary is the
 * server's; only the three buckets the sentence needs are decided here:
 * queued, already queued, anything else. Anything else keeps its own
 * `[CODE] message` rather than being summarised.
 */
export function readOutcomes(body: unknown): readonly SendResult[] {
  const raw: unknown = Array.isArray(body)
    ? body
    : ((body as { results?: unknown; outcomes?: unknown } | null)?.results ??
      (body as { outcomes?: unknown } | null)?.outcomes ??
      []);
  if (!Array.isArray(raw)) return [];
  return (raw as RawOutcome[]).map((o) => {
    const label = (o.outcome ?? o.status ?? '').toUpperCase();
    const message = o.message ?? o.error ?? null;
    // The server's refusal vocabulary is `outcome` + `message`; some
    // shapes carry an explicit `code`. Show whichever it sent, as written.
    const codeWord = o.code ?? (label === '' ? undefined : label);
    const detail =
      codeWord !== undefined && message !== null
        ? `[${codeWord}] ${message}`
        : (message ?? (codeWord !== undefined ? `[${codeWord}]` : null));
    const kind: SendKind = label.startsWith('ALREADY')
      ? 'already'
      : ['QUEUED', 'ENQUEUED', 'SENT', 'SUCCESS', 'OK'].includes(label)
        ? 'sent'
        : 'failed';
    return { orderId: o.orderId ?? '', kind, detail };
  });
}

export function useSendForConfirmationCall(): UseMutationResult<
  readonly SendResult[],
  Error,
  readonly string[]
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (orderIds) =>
      readOutcomes(
        await client.request<unknown>('/api/admin/orders/confirmation-calls', {
          method: 'POST',
          body: { orderIds },
        }),
      ),
    // Nothing optimistic: the list is re-read from the server after the
    // action, whatever the outcome mix was.
    onSettled: () => void qc.invalidateQueries({ queryKey: ['admin-awaiting-confirmation'] }),
  });
}

export interface Remaining {
  readonly totalMinutes: number;
  readonly hours: number;
  readonly minutes: number;
  readonly overdue: boolean;
  /** calm > 12h, soon <= 12h, urgent <= 3h, overdue past the deadline. */
  readonly level: 'calm' | 'soon' | 'urgent' | 'overdue';
}

export function remainingUntil(deadlineIso: string, nowMs: number): Remaining {
  const diffMin = Math.floor((new Date(deadlineIso).getTime() - nowMs) / 60_000);
  if (diffMin <= 0) {
    return { totalMinutes: 0, hours: 0, minutes: 0, overdue: true, level: 'overdue' };
  }
  const level = diffMin <= 180 ? 'urgent' : diffMin <= 720 ? 'soon' : 'calm';
  return {
    totalMinutes: diffMin,
    hours: Math.floor(diffMin / 60),
    minutes: diffMin % 60,
    overdue: false,
    level,
  };
}
