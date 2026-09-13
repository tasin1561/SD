import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useApiClient } from '@skydrop/auth/client';

/**
 * Staff wallet transfers — `/admin/wallet-transfers`, every endpoint behind
 * `money.wallet.transfer`. A debit takes a seller's money into ours, a
 * credit gives ours to them; the cash moves with it (TRE-8) and the seller
 * reads the reason on their ledger.
 */

export type WalletTransferDirection = 'DEBIT' | 'CREDIT';

/** Exactly the fields `WalletTransferDto` declares — the API refuses any other. */
export interface WalletTransferBody {
  sellerId: string;
  direction: WalletTransferDirection;
  amountInr: string;
  bankAccountId?: string;
  reason: string;
  internalNote?: string;
  idempotencyKey?: string;
}

export interface WalletTransferAccountMoveView {
  readonly accountId: string;
  readonly label: string;
  readonly currency: 'INR' | 'BDT';
  readonly units: string;
  readonly inr: string;
  readonly sellerBefore: string;
  readonly sellerAfter: string;
  readonly capitalBefore: string;
  readonly capitalAfter: string;
}

export interface WalletTransferPreviewView {
  readonly sellerId: string;
  readonly companyName: string;
  readonly direction: WalletTransferDirection;
  readonly amountInr: string;
  readonly walletBeforeInr: string;
  readonly walletAfterInr: string;
  readonly heldBeforeInr: string;
  readonly heldAfterInr: string;
  readonly cashMovedInr: string;
  readonly withoutCashInr: string;
  readonly accounts: readonly WalletTransferAccountMoveView[];
  readonly sentence: string;
}

export interface WalletTransferResultView {
  readonly walletEntryId: string;
  readonly replayed: boolean;
  readonly walletAfterInr: string;
  readonly preview: WalletTransferPreviewView | null;
}

export interface WalletTransferContextView {
  readonly seller: { readonly id: string; readonly companyName: string; readonly status: string };
  readonly walletInr: string;
  readonly heldInr: string;
  readonly accounts: ReadonlyArray<{
    readonly accountId: string;
    readonly label: string;
    readonly capitalInr: string;
    readonly sellerInr: string;
  }>;
}

export interface WalletTransferRowView {
  readonly id: string;
  readonly sellerId: string;
  readonly companyName: string;
  readonly direction: WalletTransferDirection;
  readonly amountInr: string;
  readonly walletAfterInr: string;
  readonly reason: string | null;
  readonly internalNote: string | null;
  readonly staff: string | null;
  readonly accounts: ReadonlyArray<{ readonly label: string; readonly amount: string }>;
  readonly createdAt: string;
}

const KEY = 'admin-wallet-transfers';

export function useWalletTransferSellers(
  q: string,
): UseQueryResult<{ items: ReadonlyArray<{ id: string; companyName: string; email: string }> }> {
  const client = useApiClient();
  return useQuery({
    queryKey: [KEY, 'sellers', q],
    queryFn: () =>
      client.request<{ items: Array<{ id: string; companyName: string; email: string }> }>(
        `/api/admin/wallet-transfers/sellers?q=${encodeURIComponent(q)}`,
      ),
  });
}

export function useWalletTransferContext(
  sellerId: string | null,
): UseQueryResult<WalletTransferContextView> {
  const client = useApiClient();
  return useQuery({
    queryKey: [KEY, 'context', sellerId],
    enabled: sellerId !== null,
    queryFn: () =>
      client.request<WalletTransferContextView>(
        `/api/admin/wallet-transfers/sellers/${sellerId ?? ''}/context`,
      ),
  });
}

export function useWalletTransfers(
  sellerId: string | null,
): UseQueryResult<{ items: readonly WalletTransferRowView[] }> {
  const client = useApiClient();
  return useQuery({
    queryKey: [KEY, 'list', sellerId],
    queryFn: () =>
      client.request<{ items: WalletTransferRowView[] }>(
        sellerId === null
          ? '/api/admin/wallet-transfers'
          : `/api/admin/wallet-transfers?sellerId=${encodeURIComponent(sellerId)}`,
      ),
  });
}

/** What the transfer would do. Writes nothing. */
export function usePreviewWalletTransfer(): UseMutationResult<
  WalletTransferPreviewView,
  Error,
  WalletTransferBody
> {
  const client = useApiClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WalletTransferPreviewView>('/api/admin/wallet-transfers/preview', {
        method: 'POST',
        body,
      }),
  });
}

/** Post it. The body's `idempotencyKey` makes a retry answer with the original. */
export function usePostWalletTransfer(): UseMutationResult<
  WalletTransferResultView,
  Error,
  WalletTransferBody
> {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      client.request<WalletTransferResultView>('/api/admin/wallet-transfers', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [KEY] });
      void qc.invalidateQueries({ queryKey: ['admin-treasury'] });
    },
  });
}
