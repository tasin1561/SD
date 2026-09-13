'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  DescriptionList,
  EmptyState,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Money,
  PageHeader,
  Section,
  Select,
  SkeletonRows,
  Table,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
} from '@skydrop/ui/components';
import {
  usePostWalletTransfer,
  usePreviewWalletTransfer,
  useWalletTransferContext,
  useWalletTransfers,
  useWalletTransferSellers,
  type WalletTransferBody,
  type WalletTransferDirection,
  type WalletTransferPreviewView,
} from '@/lib/wallet-transfer-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Debit a seller's wallet into our bank, or credit it from our bank, with a
 * reason the seller reads on their wallet history.
 *
 * Preview first, then an explicit confirm. Every rule — the reason's
 * length, the account's currency, whether our money there covers a credit
 * — is the SERVER's, and its refusal is shown verbatim (FE-2).
 */
export function WalletTransfersIndex({
  initialSellerId,
}: {
  readonly initialSellerId: string | null;
}): ReactElement {
  const [sellerId, setSellerId] = useState<string | null>(initialSellerId);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet transfers"
        subtitle="Take money out of a seller's wallet into our bank, or put ours into theirs. The cash moves with it, and the seller reads your reason on their wallet history."
      />
      <Section
        title="New transfer"
        subtitle="Not a correction: this moves real money between the seller and us."
      >
        {sellerId === null ? (
          <SellerPicker onPick={setSellerId} />
        ) : (
          <TransferForm
            key={sellerId}
            sellerId={sellerId}
            onChangeSeller={() => setSellerId(null)}
          />
        )}
      </Section>
      <Section
        title="History"
        subtitle={sellerId === null ? 'Every staff transfer.' : 'This seller’s staff transfers.'}
      >
        <TransferHistory sellerId={sellerId} />
      </Section>
    </div>
  );
}

function SellerPicker({ onPick }: { readonly onPick: (id: string) => void }): ReactElement {
  const [q, setQ] = useState('');
  const found = useWalletTransferSellers(q);
  const items = found.data?.items ?? [];
  return (
    <div className="space-y-3">
      <FormField label="Find a seller" htmlFor="wt-seller-q">
        <Input
          id="wt-seller-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Company name or email"
          autoComplete="off"
        />
      </FormField>
      {found.isLoading ? (
        <SkeletonRows rows={3} cols={2} />
      ) : found.isError ? (
        <ErrorNote message={serverVerdict(found.error)} retry={() => void found.refetch()} />
      ) : items.length === 0 ? (
        <p className="text-text-muted text-sm">
          No approved or suspended seller matches. Try part of the company name or email.
        </p>
      ) : (
        <ul className="divide-border border-border divide-y rounded-[var(--radius-2)] border">
          {items.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s.id)}
                className="hover:bg-surface-raised flex w-full flex-wrap items-baseline gap-x-2 px-3 py-2 text-left"
              >
                <span className="text-text-body text-sm">{s.companyName}</span>
                <span className="text-text-faint text-xs">{s.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TransferForm({
  sellerId,
  onChangeSeller,
}: {
  readonly sellerId: string;
  readonly onChangeSeller: () => void;
}): ReactElement {
  const context = useWalletTransferContext(sellerId);
  const preview = usePreviewWalletTransfer();
  const post = usePostWalletTransfer();

  const [direction, setDirection] = useState<WalletTransferDirection>('DEBIT');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [reason, setReason] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [shown, setShown] = useState<WalletTransferPreviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // One key per opening of the form, kept across retries (IDEM-1): a
  // retried post is answered with the transfer already recorded.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // Any edit makes a preview stale: what was confirmed must be what is sent.
  function edited(): void {
    setShown(null);
    setError(null);
    setDone(null);
  }

  /** The request without its key: a preview writes nothing, so it is not idempotent. */
  function previewBody(): WalletTransferBody {
    return {
      sellerId,
      direction,
      amountInr: amount.trim(),
      ...(direction === 'CREDIT' && accountId !== '' ? { bankAccountId: accountId } : {}),
      reason: reason.trim(),
      ...(internalNote.trim() === '' ? {} : { internalNote: internalNote.trim() }),
    };
  }

  function body(): WalletTransferBody {
    return { ...previewBody(), idempotencyKey };
  }

  async function runPreview(): Promise<void> {
    setError(null);
    setDone(null);
    try {
      setShown(await preview.mutateAsync(previewBody()));
    } catch (err) {
      setShown(null);
      setError(serverVerdict(err));
    }
  }

  async function confirm(): Promise<void> {
    setConfirmError(null);
    try {
      const out = await post.mutateAsync(body());
      setConfirming(false);
      setShown(null);
      setAmount('');
      setReason('');
      setInternalNote('');
      setIdempotencyKey(crypto.randomUUID());
      setDone(
        out.replayed
          ? 'Already recorded — this form had been posted before, so nothing moved twice.'
          : 'Transfer posted. The seller can see it on their wallet history now.',
      );
    } catch (err) {
      setConfirmError(serverVerdict(err));
    }
  }

  if (context.isLoading) return <SkeletonRows rows={4} cols={2} />;
  if (context.isError || context.data === undefined) {
    return (
      <ErrorNote
        message={serverVerdict(context.error, 'Could not read this seller.')}
        retry={() => void context.refetch()}
      />
    );
  }
  const ctx = context.data;
  const chosen = ctx.accounts.find((a) => a.accountId === accountId) ?? null;

  return (
    <div className="space-y-4">
      <Card className="p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-text-body text-sm font-medium">{ctx.seller.companyName}</div>
            <div className="text-text-faint text-xs">{ctx.seller.status.toLowerCase()}</div>
          </div>
          <Button variant="ghost" onClick={onChangeSeller}>
            Change seller
          </Button>
        </div>
        <DescriptionList
          className="mt-3"
          items={[
            {
              label: 'Wallet',
              value: <Money amount={ctx.walletInr} convert={false} />,
            },
            {
              label: 'Their cash held with us',
              value: <Money amount={ctx.heldInr} convert={false} />,
            },
          ]}
        />
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <FormField label="Which way" htmlFor="wt-direction" required>
          <Select
            id="wt-direction"
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value === 'CREDIT' ? 'CREDIT' : 'DEBIT');
              edited();
            }}
          >
            <option value="DEBIT">Debit — take from the seller’s wallet into our bank</option>
            <option value="CREDIT">Credit — give from our bank into the seller’s wallet</option>
          </Select>
        </FormField>
        <FormField label="Amount (₹)" htmlFor="wt-amount" required>
          <Input
            id="wt-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              edited();
            }}
            placeholder="0.00"
            autoComplete="off"
          />
        </FormField>
      </div>

      {direction === 'CREDIT' ? (
        <div className="space-y-2">
          <FormField label="From which of our rupee accounts" htmlFor="wt-account" required>
            <Select
              id="wt-account"
              value={accountId}
              onChange={(e) => {
                setAccountId(e.target.value);
                edited();
              }}
            >
              <option value="">Choose an account…</option>
              {ctx.accounts.map((a) => (
                <option key={a.accountId} value={a.accountId}>
                  {a.label}
                </option>
              ))}
            </Select>
          </FormField>
          {chosen !== null && (
            <DescriptionList
              items={[
                {
                  label: 'Ours there',
                  value: <Money amount={chosen.capitalInr} convert={false} />,
                },
                {
                  label: `${ctx.seller.companyName}’s there`,
                  value: <Money amount={chosen.sellerInr} convert={false} />,
                },
              ]}
            />
          )}
        </div>
      ) : (
        <p className="text-text-muted text-sm">
          A debit takes the seller’s money where it already sits with us — rupees first, then any
          taka at the rate it was credited. The preview shows which account. Anything beyond what
          they hold is not in any bank: their wallet goes negative and they owe it to us.
        </p>
      )}

      <FormField
        label="Reason"
        htmlFor="wt-reason"
        hint="The seller sees this on their wallet history, word for word."
        required
      >
        <Textarea
          id="wt-reason"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            edited();
          }}
          rows={3}
          maxLength={500}
          placeholder="e.g. Carton 3 of CN-2026-08-000003 was lost by your forwarder before it reached us"
        />
      </FormField>
      <FormField
        label="Internal note"
        htmlFor="wt-note"
        hint="Only staff see this. It is kept with the audit record."
      >
        <Textarea
          id="wt-note"
          value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)}
          rows={2}
          maxLength={2000}
        />
      </FormField>

      {error !== null && <ErrorNote message={error} />}
      {done !== null && <p className="text-success text-sm">{done}</p>}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={() => void runPreview()}
          disabled={preview.isPending || amount.trim() === ''}
        >
          {preview.isPending ? 'Working it out…' : 'Preview'}
        </Button>
        {shown !== null && (
          <Button
            onClick={() => {
              setConfirmError(null);
              setConfirming(true);
            }}
          >
            Post transfer
          </Button>
        )}
      </div>

      {shown !== null && <PreviewCard preview={shown} />}

      <Modal
        open={confirming && shown !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
        title="Post this transfer?"
        description="It moves real money and cannot be undone — a mistake is put right with a transfer the other way."
      >
        {shown !== null && <p className="text-text-body text-sm">{shown.sentence}</p>}
        {confirmError !== null && <ErrorNote className="mt-3" message={confirmError} />}
        <ModalFooter>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={post.isPending}>
            {post.isPending ? 'Posting…' : 'Yes, post it'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function PreviewCard({ preview }: { readonly preview: WalletTransferPreviewView }): ReactElement {
  const debit = preview.direction === 'DEBIT';
  return (
    <Card className="space-y-3 p-3">
      <p className="text-text-body text-sm" data-testid="wallet-transfer-sentence">
        {preview.sentence}
      </p>
      <DescriptionList
        items={[
          {
            label: 'Wallet',
            value: (
              <span className="inline-flex flex-wrap items-baseline gap-1">
                <Money amount={preview.walletBeforeInr} convert={false} /> →{' '}
                <Money amount={preview.walletAfterInr} convert={false} />
              </span>
            ),
          },
          {
            label: 'Their cash held with us',
            value: (
              <span className="inline-flex flex-wrap items-baseline gap-1">
                <Money amount={preview.heldBeforeInr} convert={false} /> →{' '}
                <Money amount={preview.heldAfterInr} convert={false} />
              </span>
            ),
          },
          {
            label: debit ? 'Cash that becomes ours' : 'Our cash that becomes theirs',
            value: (
              <Money
                amount={preview.cashMovedInr}
                convert={false}
                direction={debit ? 'credit' : 'debit'}
              />
            ),
          },
          {
            label: debit ? 'Owed to us with no cash behind it' : 'Clears what they owed us',
            value: <Money amount={preview.withoutCashInr} convert={false} />,
          },
        ]}
      />
      {preview.accounts.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <THead>
              <Tr>
                <Th>Account</Th>
                <Th>Moving</Th>
                <Th>Theirs: before → after</Th>
                <Th>Ours: before → after</Th>
              </Tr>
            </THead>
            <TBody>
              {preview.accounts.map((a) => (
                <Tr key={a.accountId}>
                  <Td>{a.label}</Td>
                  <Td>
                    <Money amount={a.units} currency={a.currency} convert={false} />
                  </Td>
                  <Td>
                    <Money amount={a.sellerBefore} currency={a.currency} convert={false} /> →{' '}
                    <Money amount={a.sellerAfter} currency={a.currency} convert={false} />
                  </Td>
                  <Td>
                    <Money amount={a.capitalBefore} currency={a.currency} convert={false} /> →{' '}
                    <Money amount={a.capitalAfter} currency={a.currency} convert={false} />
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function TransferHistory({ sellerId }: { readonly sellerId: string | null }): ReactElement {
  const list = useWalletTransfers(sellerId);
  if (list.isLoading) return <SkeletonRows rows={4} cols={6} />;
  if (list.isError || list.data === undefined) {
    return (
      <ErrorNote
        message={serverVerdict(list.error, 'Could not read past transfers.')}
        retry={() => void list.refetch()}
      />
    );
  }
  const items = list.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        bare
        title="No staff transfers yet"
        description="A transfer you post above appears here, with its reason and who posted it."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <Tr>
            <Th>When</Th>
            <Th>Seller</Th>
            <Th>Amount</Th>
            <Th>Wallet after</Th>
            <Th>Reason (seller sees)</Th>
            <Th>Internal note</Th>
            <Th>By</Th>
            <Th>Cash</Th>
          </Tr>
        </THead>
        <TBody>
          {items.map((r) => (
            <Tr key={r.id}>
              <Td className="text-xs">{new Date(r.createdAt).toLocaleString()}</Td>
              <Td>{r.companyName}</Td>
              <Td>
                <Money
                  amount={r.direction === 'DEBIT' ? `-${r.amountInr}` : r.amountInr}
                  direction={r.direction === 'DEBIT' ? 'debit' : 'credit'}
                  convert={false}
                />
              </Td>
              <Td>
                <Money amount={r.walletAfterInr} convert={false} />
              </Td>
              <Td className="text-xs">{r.reason ?? '—'}</Td>
              <Td className="text-text-muted text-xs">{r.internalNote ?? '—'}</Td>
              <Td className="text-xs">{r.staff ?? '—'}</Td>
              <Td className="text-xs">
                {r.accounts.length === 0
                  ? 'No cash moved'
                  : r.accounts.map((a) => `${a.label} ${a.amount}`).join(', ')}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
