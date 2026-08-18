'use client';

import Link from 'next/link';
import { useState, type ReactElement, type ReactNode } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorNote,
  FormField,
  Ident,
  LoadingState,
  Modal,
  ModalFooter,
  PageHeader,
  StatusBadge,
  Table,
  TBody,
  Td,
  Th,
  THead,
  Tr,
  Textarea,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  useApproveBankChange,
  useBankChangeRequests,
  useRejectBankChange,
  type BankChangeRequestView,
  type BankDetailsView,
} from '@/lib/ops-hooks';

/**
 * The review queue for a seller's payout destination.
 *
 * ── WHAT THE HUMAN IS ACTUALLY FOR ───────────────────────────────────
 * A seller's bank details are where their money is sent, so anyone who
 * gets into a seller account could redirect the payouts by editing six
 * fields. The first add writes straight through; every edit after that
 * stops HERE, and the live details do not move until somebody on this
 * page says so. Payouts keep flowing to the old account in the
 * meantime — a pending change is not yet a fact.
 *
 * That makes this screen's whole job the COMPARISON. An admin scanning
 * six pairs of values hunting for one altered digit is how a fraudulent
 * change gets waved through, so the diff is computed rather than left
 * to the eye: the count is in the card header, every changed field
 * carries a badge, and the untouched ones are dimmed out of the way.
 *
 * Same shape as the top-ups queue (`../topups`) because it is the same
 * job — a person weighing a submitted claim against what they can
 * verify, then accepting or refusing with a reason the other side
 * reads.
 */

/**
 * The six fields, ordered by how much they decide where money lands.
 *
 * Account name and number first: those two ARE the destination. Bank
 * and branch are context, routing and SWIFT are how it gets routed.
 */
const FIELDS: ReadonlyArray<readonly [key: keyof BankDetailsView, label: string, mono: boolean]> = [
  ['bankAccountName', 'Account name', false],
  ['bankAccountNumber', 'Account number', true],
  ['bankName', 'Bank', false],
  ['bankBranchName', 'Branch', false],
  ['bankRoutingNumber', 'Routing number', true],
  ['bankSwiftCode', 'SWIFT', true],
];

function changedKeys(req: BankChangeRequestView): ReadonlySet<keyof BankDetailsView> {
  const out = new Set<keyof BankDetailsView>();
  for (const [key] of FIELDS) {
    if (req.current[key] !== req.proposed[key]) out.add(key);
  }
  return out;
}

function renderValue(value: string, mono: boolean): ReactNode {
  if (value === '') return <span className="text-text-faint">—</span>;
  return mono ? <Ident value={value} /> : value;
}

type Intent = 'APPROVE' | 'REJECT';

export function BankChangesIndex(): ReactElement {
  const toast = useToast();
  const mayReview = usePermission('sellers.bank_change.approve');
  // The empty state's way out is the seller records — but reviewing
  // bank changes and browsing sellers are separate permissions, so
  // offer the link only to somebody the boundary would let through.
  const maySeeSellers = usePermission('sellers.view');
  const list = useBankChangeRequests('PENDING');
  const approve = useApproveBankChange();
  const reject = useRejectBankChange();

  const [reviewing, setReviewing] = useState<BankChangeRequestView | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function close(): void {
    setReviewing(null);
    setIntent(null);
    setReason('');
    setError(null);
  }

  function open(req: BankChangeRequestView, next: Intent): void {
    setReviewing(req);
    setIntent(next);
    setReason('');
    setError(null);
  }

  async function onConfirm(): Promise<void> {
    if (reviewing === null || intent === null) return;
    setError(null);
    try {
      if (intent === 'APPROVE') {
        await approve.mutateAsync({ requestId: reviewing.id });
        toast.success(`${reviewing.companyName} is now paid to the new account.`);
      } else {
        await reject.mutateAsync({ requestId: reviewing.id, reason: reason.trim() });
        toast.success('Rejected — the seller reads your reason.');
      }
      close();
    } catch (err) {
      // FE-2: the server's refusal, in its own words. A
      // BANK_CHANGE_ALREADY_DECIDED lands here when a second reviewer
      // got to the same request first, and that is exactly what the
      // operator needs told.
      setError(serverVerdict(err));
    }
  }

  // The server wants 10..500 on a rejection. Mirrored so the operator
  // learns it while typing rather than after submitting — the refusal
  // itself still comes from the server, verbatim, if it disagrees.
  const trimmed = reason.trim();
  const reasonTooShort = intent === 'REJECT' && trimmed.length < 10;
  const busy = approve.isPending || reject.isPending;
  const requests = list.data ?? [];

  return (
    <div>
      <PageHeader
        title="Bank detail changes"
        subtitle="Sellers asking us to send their payouts somewhere new. Their money keeps going to the account already on file until you approve one."
      />

      {list.isLoading ? (
        <LoadingState label="Loading bank change requests…" rows={3} />
      ) : list.isError ? (
        <ErrorNote
          message={serverVerdict(list.error, 'Failed to load bank change requests.')}
          retry={() => void list.refetch()}
        />
      ) : requests.length === 0 ? (
        <EmptyState
          title="Nothing waiting"
          description="A request appears here when a seller edits bank details they already had on file. A seller adding theirs for the first time does not need approval — check their profile on the seller record instead."
          action={
            maySeeSellers ? (
              <Link href="/sellers" className="text-accent text-xs hover:underline">
                Open the seller records
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {requests.map((req) => {
            const changed = changedKeys(req);
            // Masking is applied to BOTH sides, and two different
            // accounts can mask to the same string. So equal masks are
            // not evidence the account is unchanged, and saying so is
            // better than letting an admin infer it.
            const maskedAlike = req.current.bankAccountNumber === req.proposed.bankAccountNumber;

            return (
              <Card key={req.id}>
                <CardHeader
                  title={req.companyName}
                  subtitle={`Submitted ${new Date(req.submittedAt).toISOString().slice(0, 10)} · ${
                    // Zero is possible and is NOT a no-op request: the
                    // account number is masked on both sides, so a
                    // change confined to it shows up as no visible
                    // difference. Saying that is better than a bare
                    // "0 of 6" the reader has to explain to themselves.
                    changed.size === 0
                      ? 'nothing visibly different — read the note below'
                      : `${changed.size} of ${FIELDS.length} fields changed`
                  }`}
                  action={
                    mayReview ? (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button variant="primary" size="sm" onClick={() => open(req, 'APPROVE')}>
                          Approve
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => open(req, 'REJECT')}>
                          Reject
                        </Button>
                      </div>
                    ) : undefined
                  }
                />
                <CardBody className="p-0">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>Field</Th>
                        <Th>On file now</Th>
                        <Th>Proposed</Th>
                      </Tr>
                    </THead>
                    <TBody>
                      {FIELDS.map(([key, label, mono]) => {
                        const isChanged = changed.has(key);
                        return (
                          <Tr key={key}>
                            <Td className={isChanged ? 'text-text-body' : 'text-text-faint'}>
                              {label}
                            </Td>
                            <Td className={isChanged ? 'text-text-muted' : 'text-text-faint'}>
                              {renderValue(req.current[key], mono)}
                            </Td>
                            <Td className={isChanged ? 'text-text-strong' : 'text-text-faint'}>
                              <span className="flex flex-wrap items-center gap-2">
                                {renderValue(req.proposed[key], mono)}
                                {isChanged && <StatusBadge kind="pending" label="changed" />}
                              </span>
                            </Td>
                          </Tr>
                        );
                      })}
                    </TBody>
                  </Table>
                  {maskedAlike && (
                    <p className="text-text-muted border-border border-t px-4 py-2 text-xs leading-relaxed">
                      Both account numbers are masked, so matching masks do not prove it is the same
                      account. Read the account name and routing number before deciding.
                    </p>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={reviewing !== null}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        tone={intent === 'REJECT' ? 'critical' : 'default'}
        title={
          intent === 'APPROVE'
            ? `Pay ${reviewing?.companyName ?? 'this seller'} into the new account?`
            : `Reject ${reviewing?.companyName ?? 'this'} bank change?`
        }
      >
        {intent === 'APPROVE' ? (
          <>
            <p className="text-text-muted mb-3 text-sm leading-relaxed">
              From this moment every payout to {reviewing?.companyName ?? 'this seller'} goes to the
              account below, and the one they had before stops receiving money. Undoing it takes
              another change request and another approval — so approve it because you recognise the
              account, not because the form was filled in.
            </p>
            {reviewing !== null && (
              <div className="border-border mb-3 rounded-[7px] border px-3 py-2">
                <div className="text-text-faint mb-1 text-xs">New destination</div>
                <div className="text-text-strong text-sm">{reviewing.proposed.bankAccountName}</div>
                <div className="mt-0.5">
                  <Ident value={reviewing.proposed.bankAccountNumber} />
                </div>
                <div className="text-text-muted mt-0.5 text-xs">
                  {reviewing.proposed.bankName}
                  {reviewing.proposed.bankBranchName !== ''
                    ? ` · ${reviewing.proposed.bankBranchName}`
                    : ''}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-text-muted mb-3 text-sm leading-relaxed">
              Nothing moves — their payouts carry on to the account already on file. The seller
              reads your reason word for word, so write what did not match or what you need from
              them; “rejected” on its own just sends the same request back.
            </p>
            <FormField label="Reason the seller will read" required>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder="e.g. The account name does not match the business name we have on file. Send a bank statement header showing the account holder."
              />
            </FormField>
            <p className="text-text-faint mb-3 text-xs">
              {trimmed.length}/500 · at least 10 characters
            </p>
          </>
        )}

        {error !== null && <ErrorNote message={error} className="mb-3" />}

        <ModalFooter>
          <Button variant="secondary" size="md" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={intent === 'REJECT' ? 'destructive' : 'primary'}
            size="md"
            disabled={busy || reasonTooShort}
            onClick={() => void onConfirm()}
          >
            {busy
              ? 'Working…'
              : intent === 'APPROVE'
                ? 'Approve the new account'
                : 'Reject the change'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
