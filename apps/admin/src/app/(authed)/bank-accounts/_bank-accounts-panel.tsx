'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorNote,
  FormField,
  Input,
  Modal,
  ModalFooter,
  Select,
  SkeletonRows,
  StatusBadge,
  Table,
  TableEmpty,
  TBody,
  Td,
  Textarea,
  Th,
  THead,
  Tr,
  useToast,
  PageHeader,
} from '@skydrop/ui/components';
import { useCourierAccounts } from '@/lib/ops-hooks';
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
  const courierAccounts = useCourierAccounts();
  const create = useCreateBankAccount();
  const update = useUpdateBankAccount();
  const retire = useRetireBankAccount();

  const [editing, setEditing] = useState<PlatformBankAccountView | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<UpsertBankAccountBody>(EMPTY);
  const [error, setError] = useState<string | null>(null);

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
      ...(a.courierAccountId === null ? {} : { courierAccountId: a.courierAccountId }),
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
      ...(form.courierAccountId !== undefined && form.courierAccountId !== ''
        ? { courierAccountId: form.courierAccountId }
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
    }
  }

  const rows = accounts.data ?? [];
  const busy = create.isPending || update.isPending;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bank accounts"
        subtitle="Our own bank accounts — where a seller sends money to top up their wallet. A seller reads these details off their screen and types them into their bank, so anything wrong here becomes a payment nobody can match against a statement."
      />
      <Card>
        <CardHeader
          title="Accounts offered to sellers"
          subtitle="Retiring one keeps every past top-up that names it."
          action={
            mayManage ? (
              <Button variant="secondary" size="sm" onClick={openNew}>
                Add account
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {error !== null && <ErrorNote message={error} />}

          {accounts.isLoading ? (
            <SkeletonRows rows={3} />
          ) : accounts.isError ? (
            <ErrorNote
              message={serverVerdict(accounts.error)}
              retry={() => void accounts.refetch()}
            />
          ) : (
            <Table>
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
                    No bank accounts. Until one exists a seller has nowhere to send money and cannot
                    top up at all.
                  </TableEmpty>
                ) : (
                  rows.map((a) => (
                    <Tr key={a.id}>
                      <Td>{a.label}</Td>
                      <Td>{a.bankName}</Td>
                      <Td>
                        <span className="font-mono text-xs">{a.accountNumber}</span>
                        {(a.branchName !== null || a.routingNumber !== null) && (
                          <div className="text-text-faint text-xs">
                            {[a.branchName, a.district].filter(Boolean).join(' · ')}
                            {a.routingNumber === null ? '' : ` · ${a.routingNumber}`}
                          </div>
                        )}
                        {a.branchCode !== null && (
                          <span className="text-text-faint ml-2 font-mono text-xs">
                            {a.branchCode}
                          </span>
                        )}
                      </Td>
                      <Td>{a.currency}</Td>
                      <Td>
                        <StatusBadge
                          kind={a.isActive ? 'confirmed' : 'cancelled'}
                          label={a.isActive ? 'offered' : 'hidden'}
                        />
                      </Td>
                      {mayManage && (
                        <Td align="right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => openEdit(a)}>
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={retire.isPending}
                              onClick={() => void onRetire(a)}
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
        </CardBody>

        <Modal
          open={open}
          onOpenChange={(next) => {
            if (!next) setOpen(false);
          }}
          title={editing === null ? 'Add a bank account' : `Edit ${editing.label}`}
        >
          <p className="text-text-muted mb-3 text-sm">
            Sellers read these details off their own screen and type them into their bank. Anything
            wrong here becomes a payment nobody can match against a statement.
          </p>

          <div className="space-y-3">
            <FormField
              label="Label"
              required
              hint="What the seller picks from, e.g. “HDFC — current”"
            >
              <Input value={form.label} onChange={(e) => set('label', e.target.value)} />
            </FormField>
            <FormField label="Bank name" required>
              <Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} />
            </FormField>
            <FormField label="Account holder" required>
              <Input
                value={form.accountName}
                onChange={(e) => set('accountName', e.target.value)}
              />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Account number" required>
                <Input
                  value={form.accountNumber}
                  onChange={(e) => set('accountNumber', e.target.value)}
                />
              </FormField>
              <FormField label="IFSC / SWIFT" hint="Optional">
                <Input
                  value={form.branchCode ?? ''}
                  onChange={(e) => set('branchCode', e.target.value)}
                />
              </FormField>
            </div>
            {/* A Bangladeshi transfer is made against the BRANCH: the
              routing number is branch-specific, several banks have a
              branch of the same name in more than one district, and the
              counter asks for all three. They used to share one
              "IFSC / SWIFT" box, so whoever filled it in had to choose
              which one to lose. */}
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Branch" hint="Optional">
                <Input
                  value={form.branchName ?? ''}
                  onChange={(e) => set('branchName', e.target.value)}
                />
              </FormField>
              <FormField label="District" hint="Optional">
                <Input
                  value={form.district ?? ''}
                  onChange={(e) => set('district', e.target.value)}
                />
              </FormField>
              <FormField label="Routing number" hint="9 digits (Bangladesh)">
                <Input
                  inputMode="numeric"
                  value={form.routingNumber ?? ''}
                  onChange={(e) => set('routingNumber', e.target.value)}
                />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Currency" required>
                <Select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
                  <option value="INR">INR</option>
                  <option value="BDT">BDT</option>
                </Select>
              </FormField>
              <FormField label="Order" hint="Lower sorts first on the seller's form.">
                <Input
                  inputMode="numeric"
                  value={String(form.displayOrder ?? 100)}
                  onChange={(e) => set('displayOrder', Number(e.target.value) || 0)}
                />
              </FormField>
            </div>
            {/* Create only. An account added without its balance starts
                at zero and every figure derived from it reads as zero
                with nothing saying it is merely unentered. On EDIT the
                field is absent on purpose: a balance is corrected by
                reconciling against a statement, which files the change
                as a dated, reasoned entry rather than a silent
                overwrite. */}
            {editing === null && (
              <FormField
                label={`Balance today (${form.currency})`}
                hint="What is in the account right now. Recorded as an opening balance against our own money — leave blank for a new, empty account."
              >
                <Input
                  type="number"
                  step="0.01"
                  value={form.openingBalance ?? ''}
                  onChange={(e) => set('openingBalance', e.target.value)}
                  placeholder="0.00"
                />
              </FormField>
            )}
            {/*
             * TRE-3 resolves a settlement's receiving account through
             * this link. Until it was here, recording a courier payout
             * failed with "link one under Network → Bank accounts" and
             * there was nowhere to do it — the money path was closed by
             * a field the product never exposed.
             */}
            <FormField
              label="Receives payouts from"
              hint="The courier account whose COD payouts land here. Required before a settlement for that courier can be recorded."
            >
              <Select
                value={form.courierAccountId ?? ''}
                onChange={(e) => set('courierAccountId', e.target.value)}
              >
                <option value="">Not a courier payout account</option>
                {(courierAccounts.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label} · {c.courierCode}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="What it is for"
              hint="Free text — an account estate changes shape faster than a fixed list."
            >
              <Input
                value={form.purpose ?? ''}
                onChange={(e) => set('purpose', e.target.value)}
                maxLength={120}
                placeholder="COD receipts, seller top-ups, operating…"
              />
            </FormField>
            <FormField
              label="Transfer instructions"
              hint="Anything the seller must put in the transfer — a reference format, a note field."
            >
              <Textarea
                value={form.instructions ?? ''}
                onChange={(e) => set('instructions', e.target.value)}
                rows={3}
                maxLength={1000}
              />
            </FormField>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive ?? true}
                onChange={(e) => set('isActive', e.target.checked)}
              />
              <span>Offer this account to sellers</span>
            </label>
          </div>

          <ModalFooter>
            <Button variant="secondary" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!complete || busy}
              onClick={() => void submit()}
            >
              {busy ? 'Saving…' : editing === null ? 'Add account' : 'Save changes'}
            </Button>
          </ModalFooter>
        </Modal>
      </Card>
    </div>
  );
}
