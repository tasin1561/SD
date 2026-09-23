'use client';

import { History, Landmark, Plus } from 'lucide-react';

import { useState, type ReactElement } from 'react';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { Checkbox } from '@skydrop/ui/app/checkbox';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { EmptyState, ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { useToast } from '@skydrop/ui/app/toast';
import { Table, TableEmpty, TBody, Td, Th, THead, Tr } from '@skydrop/ui/app/data-table';
import { serverVerdict } from '@/lib/server-verdict';
import { usePermission } from '@/lib/use-permission';
import {
  useCreateBankAccount,
  usePlatformBankAccounts,
  useRetireBankAccount,
  useUpdateBankAccount,
  type PlatformBankAccountView,
  type UpsertBankAccountBody,
} from '@/lib/bank-account-hooks';
import { LinkButton, MoSection, Notice } from '../treasury/_components/money-parts';
import './bank-accounts.css';

/**
 * Where sellers are told to send money.
 *
 * This sits on the top-ups screen rather than in its own corner of the
 * nav because it is the same job: a top-up is a seller saying "I paid
 * into one of these", and the person matching those against a statement
 * is the person who knows when an account is wrong.
 *
 * It had a controller and no screen, so an account could only arrive by
 * a direct INSERT and — the part that actually bites — could not be
 * corrected or withdrawn once sellers were already paying into it. A
 * wrong branch code or a closing account is exactly the record you need
 * to change under time pressure, and every hour it stays on the transfer
 * page is another payment sent somewhere nobody can match.
 *
 * Retiring is a SOFT delete on the server. A past top-up names the
 * account it went to and that has to keep resolving long after we stop
 * offering it, so the row survives — this only takes it off the seller's
 * transfer page.
 */

const EMPTY: UpsertBankAccountBody = {
  label: '',
  bankName: '',
  accountName: '',
  accountNumber: '',
  currency: 'INR',
  isActive: true,
  displayOrder: 100,
};

export function BankAccountsPanel(): ReactElement | null {
  const toast = useToast();
  const mayManage = usePermission('money.bank_accounts.manage');
  const accounts = usePlatformBankAccounts();
  const create = useCreateBankAccount();
  const update = useUpdateBankAccount();
  const retire = useRetireBankAccount();

  const [editing, setEditing] = useState<PlatformBankAccountView | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<UpsertBankAccountBody>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  // The account a Retire click is asking about, while it is confirmed.
  const [retiring, setRetiring] = useState<PlatformBankAccountView | null>(null);

  function set<K extends keyof UpsertBankAccountBody>(k: K, v: UpsertBankAccountBody[K]): void {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function openNew(): void {
    setEditing(null);
    setForm(EMPTY);
    setError(null);
    setOpen(true);
  }

  function openEdit(a: PlatformBankAccountView): void {
    setEditing(a);
    // Seed at open rather than in an effect — an effect would wipe what
    // was typed the moment a background refetch landed.
    setForm({
      label: a.label,
      bankName: a.bankName,
      accountName: a.accountName,
      accountNumber: a.accountNumber,
      ...(a.branchCode === null ? {} : { branchCode: a.branchCode }),
      ...(a.branchName === null ? {} : { branchName: a.branchName }),
      ...(a.district === null ? {} : { district: a.district }),
      ...(a.routingNumber === null ? {} : { routingNumber: a.routingNumber }),
      currency: a.currency,
      ...(a.instructions === null ? {} : { instructions: a.instructions }),
      ...(a.purpose === null ? {} : { purpose: a.purpose }),
      isActive: a.isActive,
      displayOrder: a.displayOrder,
    });
    setError(null);
    setOpen(true);
  }

  const complete =
    form.label.trim() !== '' &&
    form.bankName.trim() !== '' &&
    form.accountName.trim() !== '' &&
    form.accountNumber.trim() !== '';

  async function submit(): Promise<void> {
    setError(null);
    // An empty optional is an ABSENT key, not `''` — the DTO's
    // @IsOptional skips undefined, and '' would be stored as a real
    // (blank) branch code the seller then sees on the transfer page.
    const body: UpsertBankAccountBody = {
      label: form.label.trim(),
      bankName: form.bankName.trim(),
      accountName: form.accountName.trim(),
      accountNumber: form.accountNumber.trim(),
      currency: form.currency,
      isActive: form.isActive ?? true,
      displayOrder: form.displayOrder ?? 100,
      ...(form.branchName !== undefined && form.branchName.trim() !== ''
        ? { branchName: form.branchName.trim() }
        : {}),
      ...(form.district !== undefined && form.district.trim() !== ''
        ? { district: form.district.trim() }
        : {}),
      ...(form.routingNumber !== undefined && form.routingNumber.trim() !== ''
        ? { routingNumber: form.routingNumber.trim() }
        : {}),
      ...(form.branchCode !== undefined && form.branchCode.trim() !== ''
        ? { branchCode: form.branchCode.trim() }
        : {}),
      ...(form.instructions !== undefined && form.instructions.trim() !== ''
        ? { instructions: form.instructions.trim() }
        : {}),
      ...(form.purpose !== undefined && form.purpose.trim() !== ''
        ? { purpose: form.purpose.trim() }
        : {}),
    };
    try {
      if (editing === null) {
        await create.mutateAsync(body);
        toast.success(`${body.label} added — sellers can transfer to it now.`);
      } else {
        await update.mutateAsync({ id: editing.id, body });
        toast.success(`${body.label} updated.`);
      }
      setOpen(false);
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  async function onRetire(a: PlatformBankAccountView): Promise<void> {
    setError(null);
    try {
      await retire.mutateAsync({ id: a.id });
      toast.info(`${a.label} retired — it is off the seller transfer page. Past top-ups keep it.`);
    } catch (err) {
      setError(serverVerdict(err));
      // Keeps the confirm open with the verdict on it.
      throw err;
    }
  }

  const rows = accounts.data ?? [];
  const busy = create.isPending || update.isPending;

  return (
    <div className="mo-page">
      <PageHeader
        title="Bank accounts"
        subtitle="Our own bank accounts — where a seller sends money to top up their wallet. A seller reads these details off their screen and types them into their bank, so anything wrong here becomes a payment nobody can match against a statement."
      />
      <MoSection
        title="Accounts offered to sellers"
        note="Retiring one keeps every past top-up that names it."
        flush
        action={
          <div className="mo-row">
            {/* Reachable from the thing it is about, rather than only
                from the nav: the question "who changed this account"
                is asked while looking at the account. */}
            <LinkButton
              href="/bank-accounts/history"
              variant="ghost"
              size="sm"
              icon={<History size={14} />}
            >
              Change history
            </LinkButton>
            {mayManage ? (
              <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={openNew}>
                Add account
              </Button>
            ) : null}
          </div>
        }
      >
        {error !== null && !open && retiring === null && (
          <div className="mo-card__pad">
            <Notice tone="bad" role="alert">
              <p>{error}</p>
            </Notice>
          </div>
        )}

        {accounts.isLoading ? (
          <div className="mo-card__pad">
            <SkeletonRows rows={3} cols={mayManage ? 6 : 5} label="Loading bank accounts" />
          </div>
        ) : accounts.isError ? (
          <div className="mo-card__pad">
            <ErrorState
              message={serverVerdict(accounts.error)}
              retry={() => void accounts.refetch()}
            />
          </div>
        ) : (
          <Table caption="Bank accounts offered to sellers">
            <THead>
              <Tr>
                <Th>Label</Th>
                <Th>Bank</Th>
                <Th>Account</Th>
                <Th>Currency</Th>
                <Th>Offered</Th>
                {mayManage && <Th align="right">Actions</Th>}
              </Tr>
            </THead>
            <TBody>
              {rows.length === 0 ? (
                <TableEmpty colSpan={mayManage ? 6 : 5}>
                  <EmptyState
                    bare
                    title="No bank accounts"
                    description="Until one exists a seller has nowhere to send money and cannot top up at all."
                  />
                </TableEmpty>
              ) : (
                rows.map((a) => (
                  <Tr key={a.id}>
                    <Td className="mo-strong">{a.label}</Td>
                    <Td>{a.bankName}</Td>
                    <Td>
                      <span className="sk-ident">{a.accountNumber}</span>
                      {a.branchCode !== null && (
                        <span className="sk-ident ba-code">{a.branchCode}</span>
                      )}
                      {(a.branchName !== null || a.routingNumber !== null) && (
                        <span className="mo-sub">
                          {[a.branchName, a.district].filter(Boolean).join(' · ')}
                          {a.routingNumber === null ? '' : ` · ${a.routingNumber}`}
                        </span>
                      )}
                    </Td>
                    <Td>{a.currency}</Td>
                    <Td>
                      <StatusChip
                        kind={a.isActive ? 'confirmed' : 'cancelled'}
                        label={a.isActive ? 'offered' : 'hidden'}
                        size="sm"
                      />
                    </Td>
                    {mayManage && (
                      <Td align="right">
                        <div className="mo-row mo-row--end">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={retire.isPending}
                            onClick={() => {
                              setError(null);
                              setRetiring(a);
                            }}
                          >
                            Retire
                          </Button>
                        </div>
                      </Td>
                    )}
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
        )}
      </MoSection>

      <ConfirmDialog
        open={retiring !== null}
        onOpenChange={(next) => {
          if (!next) {
            setRetiring(null);
            setError(null);
          }
        }}
        title="Retire this bank account?"
        entity={
          retiring === null
            ? ''
            : `${retiring.label} · ${retiring.bankName} ${retiring.accountNumber}`
        }
        consequence="It comes off the seller transfer page at once. Past top-ups keep it, and it is not deleted."
        confirmLabel="Retire"
        destructive
        onConfirm={() => (retiring === null ? undefined : onRetire(retiring))}
        error={retiring !== null ? (error ?? undefined) : undefined}
      />

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false);
        }}
        icon={<Landmark size={18} />}
        size="lg"
        title={editing === null ? 'Add a bank account' : `Edit ${editing.label}`}
        description="Sellers read these details off their own screen and type them into their bank. Anything wrong here becomes a payment nobody can match against a statement."
        footer={
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <AsyncButton
              labels={{
                idle: editing === null ? 'Add account' : 'Save changes',
                busy: 'Saving…',
                done: 'Saved',
              }}
              disabled={!complete || busy}
              state={busy ? 'busy' : undefined}
              onClick={() => void submit()}
            />
          </DialogFooter>
        }
      >
        <div className="mo-fields">
          <TextField
            label="Label"
            requiredMark
            hint="What the seller picks from, e.g. “HDFC — current”"
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
          />
          <TextField
            label="Bank name"
            requiredMark
            value={form.bankName}
            onChange={(e) => set('bankName', e.target.value)}
          />
          <TextField
            label="Account holder"
            requiredMark
            value={form.accountName}
            onChange={(e) => set('accountName', e.target.value)}
          />
          <div className="mo-fields" data-cols="2">
            <TextField
              label="Account number"
              requiredMark
              inputClassName="sk-ident"
              value={form.accountNumber}
              onChange={(e) => set('accountNumber', e.target.value)}
            />
            <TextField
              label="IFSC / SWIFT"
              hint="Optional"
              inputClassName="sk-ident"
              value={form.branchCode ?? ''}
              onChange={(e) => set('branchCode', e.target.value)}
            />
          </div>
          {/* A Bangladeshi transfer is made against the BRANCH: the
            routing number is branch-specific, several banks have a
            branch of the same name in more than one district, and the
            counter asks for all three. They used to share one
            "IFSC / SWIFT" box, so whoever filled it in had to choose
            which one to lose. */}
          <div className="ba-grid-3">
            <TextField
              label="Branch"
              hint="Optional"
              value={form.branchName ?? ''}
              onChange={(e) => set('branchName', e.target.value)}
            />
            <TextField
              label="District"
              hint="Optional"
              value={form.district ?? ''}
              onChange={(e) => set('district', e.target.value)}
            />
            <TextField
              label="Routing number"
              hint="9 digits (Bangladesh)"
              inputMode="numeric"
              inputClassName="sk-ident"
              value={form.routingNumber ?? ''}
              onChange={(e) => set('routingNumber', e.target.value)}
            />
          </div>
          <div className="mo-fields" data-cols="2">
            <Select
              label="Currency"
              requiredMark
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
            >
              <option value="INR">INR</option>
              <option value="BDT">BDT</option>
            </Select>
            <TextField
              label="Order"
              hint="Lower sorts first on the seller's form."
              inputMode="numeric"
              value={String(form.displayOrder ?? 100)}
              onChange={(e) => set('displayOrder', Number(e.target.value) || 0)}
            />
          </div>
          {/* Create only. An account added without its balance starts
              at zero and every figure derived from it reads as zero
              with nothing saying it is merely unentered. On EDIT the
              field is absent on purpose: a balance is corrected by
              reconciling against a statement, which files the change
              as a dated, reasoned entry rather than a silent
              overwrite. */}
          {editing === null && (
            <TextField
              label={`Balance today (${form.currency})`}
              hint="What is in the account right now. Recorded as an opening balance against our own money — leave blank for a new, empty account."
              type="number"
              inputMode="decimal"
              step="0.01"
              inputClassName="sk-figure"
              value={form.openingBalance ?? ''}
              onChange={(e) => set('openingBalance', e.target.value)}
              placeholder="0.00"
            />
          )}
          <TextField
            label="What it is for"
            hint="Free text — an account estate changes shape faster than a fixed list."
            value={form.purpose ?? ''}
            onChange={(e) => set('purpose', e.target.value)}
            maxLength={120}
            showCount
            placeholder="COD receipts, seller top-ups, operating…"
          />
          <TextArea
            label="Transfer instructions"
            hint="Anything the seller must put in the transfer — a reference format, a note field."
            value={form.instructions ?? ''}
            onChange={(e) => set('instructions', e.target.value)}
            rows={3}
            maxLength={1000}
            showCount
          />
          <Checkbox
            checked={form.isActive ?? true}
            onChange={(e) => set('isActive', e.target.checked)}
            label="Offer this account to sellers"
          />
          {error !== null && open && (
            <p className="mo-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
    </div>
  );
}
