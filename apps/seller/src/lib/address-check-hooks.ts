'use client';

import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * The client console's half of the Solustation address check.
 *
 * A NEW file rather than an addition to `api-hooks.ts`, because
 * everything here belongs to `/orders/new-v2` alone and the old order
 * page must keep importing a file this change never touched.
 *
 * Every call goes to our own origin and is proxied server-side
 * (FE-3). The Solustation key lives in the API's env and is never sent
 * to a browser, so there is nothing here that could leak it.
 */

/** What the page is told about one address. The API decides this; the
 *  browser is handed a verdict, not a payload to interpret. */
export interface AddressCheckView {
  readonly referenceId: string;
  /** False when the check could not be made at all. */
  readonly available: boolean;
  readonly status: string;
  readonly action: 'approve' | 'confirm_with_customer' | 'reject';
  readonly score: number | null;
  readonly poConfidence: string | null;
  readonly completedAddress: string | null;
  readonly issues: ReadonlyArray<{ code: string; message: string }>;
  readonly suggestions: ReadonlyArray<{
    field: string;
    candidates: readonly string[];
    reason?: string;
  }>;
  readonly extracted: Readonly<Record<string, string | null>>;
  readonly fieldSource: Readonly<Record<string, string>>;
  readonly rtoRisk: number | null;
  readonly rtoRiskStatus: string | null;
  readonly rechecked: boolean;
}

export interface PincodeView {
  readonly pincode: string;
  readonly valid: boolean;
  readonly district: string | null;
  readonly state: string | null;
  readonly sub_districts: readonly string[];
  /** `type` is null for every row today — a known gap at their end.
   *  Render the name alone until it is not. */
  readonly post_offices: ReadonlyArray<{ name: string; type: string | null }>;
}

/** Whether this account is in the pilot. Cosmetic (FE-2): the server
 *  404s every other route regardless of what this says. */
export function useOrderPageV2Enabled(): UseQueryResult<{ enabled: boolean }> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['order-page-v2-enabled'],
    queryFn: () => client.request<{ enabled: boolean }>('/api/seller/address-check/enabled'),
    // The answer changes only when somebody edits a setting, and a
    // stale `true` costs nothing: the API is the real gate.
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

/**
 * District, state and post offices for a pincode.
 *
 * Free at their end, so this may run on every complete pincode — but
 * only on a COMPLETE one: six digits, which is what `enabled` pins.
 * React Query caches per pincode for the session, which is the
 * per-pincode cache the brief asks for and costs nothing to keep.
 */
export function usePincodeLookup(pincode: string): UseQueryResult<PincodeView | null> {
  const client = useApiClient();
  return useQuery({
    queryKey: ['address-check-pincode', pincode],
    queryFn: () =>
      client.request<PincodeView | null>(
        `/api/seller/address-check/pincode/${encodeURIComponent(pincode)}`,
      ),
    enabled: /^[1-9]\d{5}$/.test(pincode),
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
}

export interface CheckAddressBody {
  readonly referenceId: string;
  readonly address: string;
  readonly pincode: string;
  readonly landmark?: string;
  readonly paymentType: 'cod' | 'prepaid';
}

/**
 * The billable one — a mutation, never a query, and that is the point.
 *
 * Their billing is one unit per `reference_id` per month, so this must
 * fire when the OPERATOR asks for it or when a field they finished
 * editing settles, never because a component re-rendered or a cache
 * went stale. A `useQuery` here would spend money on a window focus.
 */
export function useCheckAddress(): UseMutationResult<AddressCheckView, Error, CheckAddressBody> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<AddressCheckView>('/api/seller/address-check/check', {
        method: 'POST',
        body,
      }),
  });
}
