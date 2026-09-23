'use client';

import { useState, type ReactElement } from 'react';
import { ArrowLeftRight, CircleCheck, Search, Send, Wallet } from 'lucide-react';
import { Money } from '@skydrop/ui/components';
import { PageHeader, SectionHeading } from '@skydrop/ui/app/page-header';
import { Table, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Select } from '@skydrop/ui/app/select';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
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
import {
  MkCallout,
  MkCard,
  MkDl,
  MkSection,
  MkAlert,
} from '../../seller-wallets/_components/money-parts';

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
    <div className="mk-page">
      <PageHeader
        title="Wallet transfers"
        subtitle="Take money out of a seller's wallet into our bank, or put ours into theirs. The cash moves with it, and the seller reads your reason on their wallet history."
      />
      <MkSection>
        <SectionHeading
          title="New transfer"
          note="Not a correction: this moves real money between the seller and us."
        />
        {sellerId === null ? (
          <SellerPicker onPick={setSellerId} />
        ) : (
          <TransferForm
            key={sellerId}
            sellerId={sellerId}
            onChangeSeller={() => setSellerId(null)}
          />
        )}
      </MkSection>
      <MkSection>
        <SectionHeading
          title="History"
          note={sellerId === null ? 'Every staff transfer.' : 'This seller’s staff transfers.'}
        />
        <TransferHistory sellerId={sellerId} />
      </MkSection>
    </div>
  );
}

function SellerPicker({ onPick }: { readonly onPick: (id: string) => void }): ReactElement {
  const [q, setQ] = useState('');
  const found = useWalletTransferSellers(q);
  const items = found.data?.items ?? [];
  return (
    <MkCard>
      <TextField
        id="wt-seller-q"
        label="Find a seller"
        icon={<Search />}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Company name or email"
        autoComplete="off"
      />
      {found.isLoading ? (
        <SkeletonRows rows={3} cols={2} label="Looking for sellers…" />
      ) : found.isError ? (
        <ErrorState message={serverVerdict(found.error)} retry={() => void found.refetch()} />
      ) : items.length === 0 ? (
        <p className="mk-muted">
          No approved or suspended seller matches. Try part of the company name or email.
        </p>
      ) : (
        <ul className="mk-picks">
          {items.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s.id)} className="mk-pick">
                <span className="mk-strong">{s.companyName}</span>
                <span className="mk-faint">{s.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </MkCard>
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
      throw err;
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
      throw err;
    }
  }

  if (context.isLoading) return <SkeletonRows rows={4} cols={2} label="Reading this seller…" />;
  if (context.isError || context.data === undefined) {
    return (
      <ErrorState
        message={serverVerdict(context.error, 'Could not read this seller.')}
        retry={() => void context.refetch()}
      />
    );
  }
  const ctx = context.data;
  const chosen = ctx.accounts.find((a) => a.accountId === accountId) ?? null;

  return (
    <div className="mk-stack">
      <MkCard
        icon={<Wallet size={18} />}
        title={ctx.seller.companyName}
        subtitle={ctx.seller.status.toLowerCase()}
        aside={
          <Button variant="ghost" size="sm" onClick={onChangeSeller}>
            Change seller
          </Button>
        }
      >
        <MkDl
          grid
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
      </MkCard>

      <MkCard>
        <div className="mk-form mk-form--2">
          <Select
            id="wt-direction"
            label="Which way"
            requiredMark
            icon={<ArrowLeftRight />}
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value === 'CREDIT' ? 'CREDIT' : 'DEBIT');
              edited();
            }}
          >
            <option value="DEBIT">Debit — take from the seller’s wallet into our bank</option>
            <option value="CREDIT">Credit — give from our bank into the seller’s wallet</option>
          </Select>
          <TextField
            id="wt-amount"
            label="Amount (₹)"
            requiredMark
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              edited();
            }}
            placeholder="0.00"
            autoComplete="off"
          />
        </div>

        {direction === 'CREDIT' ? (
          <div className="mk-stack mk-stack--tight">
            <Select
              id="wt-account"
              label="From which of our rupee accounts"
              requiredMark
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
            {chosen !== null && (
              <MkDl
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
          <p className="mk-muted">
            A debit takes the seller’s money where it already sits with us — rupees first, then any
            taka at the rate it was credited. The preview shows which account. Anything beyond what
            they hold is not in any bank: their wallet goes negative and they owe it to us.
          </p>
        )}

        <TextArea
          id="wt-reason"
          label="Reason"
          hint="The seller sees this on their wallet history, word for word."
          requiredMark
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            edited();
          }}
          rows={3}
          maxLength={500}
          showCount
          placeholder="e.g. Carton 3 of CN-2026-08-000003 was lost by your forwarder before it reached us"
        />
        <TextArea
          id="wt-note"
          label="Internal note"
          hint="Only staff see this. It is kept with the audit record."
          value={internalNote}
          onChange={(e) => setInternalNote(e.target.value)}
          rows={2}
          maxLength={2000}
          showCount
        />

        {error !== null && <MkAlert>{error}</MkAlert>}
        {done !== null && (
          <MkCallout tone="good" icon={<CircleCheck size={16} />} role="status">
            <p>{done}</p>
          </MkCallout>
        )}

        <div className="mk-form__actions">
          <AsyncButton
            variant="secondary"
            disabled={amount.trim() === ''}
            labels={{
              idle: 'Preview',
              busy: 'Working it out…',
              done: 'Worked out',
              error: 'Refused',
            }}
            onAction={runPreview}
          />
          {shown !== null && (
            <Button
              icon={<Send size={15} />}
              onClick={() => {
                setConfirmError(null);
                setConfirming(true);
              }}
            >
              Post transfer
            </Button>
          )}
        </div>
      </MkCard>

      {shown !== null && <PreviewCard preview={shown} />}

      <ConfirmDialog
        open={confirming && shown !== null}
        onOpenChange={(next) => {
          if (!next) setConfirming(false);
        }}
        title="Post this transfer?"
        entity={ctx.seller.companyName}
        amount={
          shown === null ? undefined : (
            <Money
              amount={shown.amountInr}
              direction={shown.direction === 'DEBIT' ? 'debit' : 'credit'}
              convert={false}
            />
          )
        }
        consequence="It moves real money and cannot be undone — a mistake is put right with a transfer the other way."
        confirmLabel="Yes, post it"
        closeOnSuccess={false}
        onConfirm={confirm}
        error={confirmError}
      >
        {shown !== null && <p className="mk-body">{shown.sentence}</p>}
      </ConfirmDialog>
    </div>
  );
}

function PreviewCard({ preview }: { readonly preview: WalletTransferPreviewView }): ReactElement {
  const debit = preview.direction === 'DEBIT';
  return (
    <MkCard title="Preview" subtitle="Nothing has moved yet. Check it, then post it.">
      <p className="mk-body" data-testid="wallet-transfer-sentence">
        {preview.sentence}
      </p>
      <MkDl
        items={[
          {
            label: 'Wallet',
            value: (
              <span className="mk-balances">
                <Money amount={preview.walletBeforeInr} convert={false} /> →{' '}
                <Money amount={preview.walletAfterInr} convert={false} />
              </span>
            ),
          },
          {
            label: 'Their cash held with us',
            value: (
              <span className="mk-balances">
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
        <div className="mk-scroll">
          <Table caption="Where the cash moves">
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
    </MkCard>
  );
}

function TransferHistory({ sellerId }: { readonly sellerId: string | null }): ReactElement {
  const list = useWalletTransfers(sellerId);
  if (list.isLoading) return <SkeletonRows rows={4} cols={8} label="Loading past transfers…" />;
  if (list.isError || list.data === undefined) {
    return (
      <ErrorState
        message={serverVerdict(list.error, 'Could not read past transfers.')}
        retry={() => void list.refetch()}
      />
    );
  }
  const items = list.data.items;
  if (items.length === 0) {
    return (
      <EmptyState
        title="No staff transfers yet"
        description="A transfer you post above appears here, with its reason and who posted it."
      />
    );
  }
  return (
    <MkCard flush>
      <Table caption="Staff wallet transfers">
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
              <Td className="mk-when sk-figure">{new Date(r.createdAt).toLocaleString()}</Td>
              <Td className="mk-strong">{r.companyName}</Td>
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
              <Td className="mk-small mk-body">{r.reason ?? '—'}</Td>
              <Td className="mk-small">{r.internalNote ?? '—'}</Td>
              <Td className="mk-small">{r.staff ?? '—'}</Td>
              <Td className="mk-small">
                {r.accounts.length === 0
                  ? 'No cash moved'
                  : r.accounts.map((a) => `${a.label} ${a.amount}`).join(', ')}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </MkCard>
  );
}
