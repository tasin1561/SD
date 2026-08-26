'use client';

import { Fragment, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Pencil } from 'lucide-react';
import { ApiError } from '@skydrop/api-client';
import type {
  SellerProfileView,
  UpdateSellerBankDetailsRequest,
  UpdateSellerProfileRequest,
} from '@skydrop/api-client';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  Select,
  StatusBadge,
  useToast,
} from '@skydrop/ui/components';
import {
  usePresignLogo,
  useRegisterLogo,
  useRemoveLogo,
  useSellerProfile,
  useUpdateSellerBankDetails,
  useUpdateSellerProfile,
  type SellerProfileWithBankChange,
} from '@/lib/api-hooks';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import { useSellerIdentity } from '@skydrop/auth/client';

/**
 * Seller profile — Phase 1B M19+M20.
 *
 * Two cards: Company info (editable in place) + Bank details (also
 * editable; flagged as Phase 1B). FE-2: server rejection surfaces
 * `[CODE] message` VERBATIM. View ↔ edit toggle per section so the
 * seller can update one card without scrolling the other.
 */
export default function ProfilePage(): ReactElement {
  const detail = useSellerProfile();

  if (detail.isLoading) {
    return (
      <>
        <PageHeader title="Profile" subtitle="Company info + bank details." />
        <LoadingState label="Loading profile…" />
      </>
    );
  }
  if (detail.isError) {
    return (
      <>
        <PageHeader title="Profile" subtitle="Company info + bank details." />
        <ErrorState
          message={detail.error?.message ?? 'Failed to load profile.'}
          retry={() => void detail.refetch()}
        />
      </>
    );
  }
  if (!detail.data) {
    return (
      <>
        <PageHeader title="Profile" subtitle="Company info + bank details." />
        <ErrorState message="Profile not loaded." />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Profile"
        subtitle="Company info + bank details. Edit a section by clicking the pencil."
      />
      <CompanyInfoSection profile={detail.data} />
      <LogoSection profile={detail.data} />
      <BankDetailsSection profile={detail.data} />
      <div className="text-text-faint text-xs">
        Account status:{' '}
        <span className="uppercase tracking-wide text-text-body">{detail.data.status}</span>
        {detail.data.approvedAt && (
          <> · approved {new Date(detail.data.approvedAt).toLocaleDateString()}</>
        )}
      </div>
    </div>
  );
}

function fmtError(e: unknown): string {
  if (e instanceof ApiError) {
    const b = e.body as { code?: unknown; message?: unknown } | null;
    const code = typeof b?.code === 'string' ? b.code : null;
    const msg = typeof b?.message === 'string' ? b.message : e.message;
    return code ? `[${code}] ${msg}` : msg;
  }
  return e instanceof Error ? e.message : 'Action failed';
}

function CompanyInfoSection({ profile }: { readonly profile: SellerProfileView }): ReactElement {
  const canManage = can(useSellerIdentity(), 'profile.manage');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    companyName: profile.companyName,
    contactPersonName: profile.contactPersonName,
    phone: profile.phone,
    whatsapp: profile.whatsapp ?? '',
    displayCurrency: profile.displayCurrency,
    displayLanguage: profile.displayLanguage as 'en' | 'bn',
  });
  const update = useUpdateSellerProfile();
  const toast = useToast();

  useEffect(() => {
    if (!editing) {
      setForm({
        companyName: profile.companyName,
        contactPersonName: profile.contactPersonName,
        phone: profile.phone,
        whatsapp: profile.whatsapp ?? '',
        displayCurrency: profile.displayCurrency,
        displayLanguage: profile.displayLanguage as 'en' | 'bn',
      });
    }
  }, [profile, editing]);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};

      if (form.contactPersonName !== profile.contactPersonName)
        body.contactPersonName = form.contactPersonName.trim();

      const ws = form.whatsapp.trim();
      const currentWs = profile.whatsapp ?? '';
      if (ws !== currentWs) body.whatsapp = ws === '' ? null : ws;
      if (form.displayCurrency !== profile.displayCurrency)
        body.displayCurrency = form.displayCurrency;
      if (form.displayLanguage !== profile.displayLanguage)
        body.displayLanguage = form.displayLanguage;
      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }
      await update.mutateAsync(body as UpdateSellerProfileRequest);
      toast.success('Profile updated.');
      setEditing(false);
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Company info"
        action={
          canManage &&
          !editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
            >
              <Pencil size={12} /> Edit
            </Button>
          )
        }
      />
      <CardBody>
        {!editing ? (
          <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[180px_1fr] gap-x-3 sm:gap-x-6 gap-y-2 text-sm">
            <dt className="text-text-muted">Company</dt>
            <dd className="text-text-body">{profile.companyName}</dd>
            <dt className="text-text-muted">Contact person</dt>
            <dd className="text-text-body">{profile.contactPersonName}</dd>
            <dt className="text-text-muted">Email</dt>
            <dd className="text-text-body font-mono text-xs">{profile.emailDisplay}</dd>
            <dt className="text-text-muted">Phone</dt>
            <dd className="text-text-body font-mono text-xs">{profile.phone}</dd>
            <dt className="text-text-muted">WhatsApp</dt>
            <dd className="text-text-body font-mono text-xs">{profile.whatsapp ?? '—'}</dd>
            <dt className="text-text-muted">Country</dt>
            <dd className="text-text-body">{profile.countryCode}</dd>
            <dt className="text-text-muted">Display currency</dt>
            <dd className="text-text-body">{profile.displayCurrency}</dd>
            <dt className="text-text-muted">Display language</dt>
            <dd className="text-text-body uppercase">{profile.displayLanguage}</dd>
          </dl>
        ) : (
          <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
            {/*
             * Company name and phone are FIXED. They are the identity
             * the account was approved on, so they are shown here as
             * facts rather than as inputs — the server drops both from
             * the update DTO and rejects a request carrying either, so
             * an editable box would only ever produce a refusal.
             */}
            <FormField label="Company name" hint="Fixed — contact support to change it.">
              <Input value={profile.companyName} disabled readOnly />
            </FormField>
            <FormField label="Contact person" required>
              <Input
                value={form.contactPersonName}
                onChange={(e) => setForm({ ...form, contactPersonName: e.target.value })}
                minLength={2}
                maxLength={120}
                required
              />
            </FormField>
            <FormField
              label="Phone (E.164 BD)"
              hint="Fixed — it is how the call centre reaches you. Contact support to change it."
            >
              <Input value={profile.phone} disabled readOnly />
            </FormField>
            <FormField label="WhatsApp" hint="Leave blank to remove">
              <Input
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="+8801712345678"
              />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Display currency">
                <Select
                  value={form.displayCurrency}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      displayCurrency: e.target.value as 'INR' | 'BDT',
                    })
                  }
                >
                  <option value="INR">INR</option>
                  <option value="BDT">BDT</option>
                </Select>
              </FormField>
              <FormField label="Display language">
                <Select
                  value={form.displayLanguage}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      displayLanguage: e.target.value as 'en' | 'bn',
                    })
                  }
                >
                  <option value="en">English</option>
                  <option value="bn">বাংলা</option>
                </Select>
              </FormField>
            </div>

            {error && (
              <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md" disabled={busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

/**
 * The six fields that make up a payable account, in form order.
 *
 * `serverLabel` is the wording the server uses in its
 * `BANK_DETAILS_INCOMPLETE` message, so the hint the seller reads before
 * saving and the refusal they read after are talking about the same
 * things. `label` is the display wording.
 */
const BANK_FIELDS = [
  { key: 'bankName', serverLabel: 'bank name', label: 'Bank name', mono: false },
  { key: 'bankBranchName', serverLabel: 'branch name', label: 'Branch', mono: false },
  {
    key: 'bankAccountName',
    serverLabel: 'account holder name',
    label: 'Account holder',
    mono: false,
  },
  {
    key: 'bankAccountNumber',
    serverLabel: 'account number',
    label: 'Account number',
    mono: true,
  },
  { key: 'bankRoutingNumber', serverLabel: 'routing number', label: 'Routing number', mono: true },
  { key: 'bankSwiftCode', serverLabel: 'SWIFT code', label: 'SWIFT code', mono: true },
] as const;

type BankFieldKey = (typeof BANK_FIELDS)[number]['key'];
type BankValues = Readonly<Record<BankFieldKey, string | null>>;

/**
 * The edit form starts from the live values, account number included.
 *
 * It used to leave that field blank because the read returned only the
 * mask, and prefilling would have shown a number that was not one — and
 * saved the bullets as the account if any other field was touched. The
 * read now returns it in full, so it behaves like every other field:
 * prefilled, and sent only when it actually differs.
 */
function bankFormFrom(profile: SellerProfileView): Record<BankFieldKey, string> {
  return {
    bankName: profile.bankName ?? '',
    bankBranchName: profile.bankBranchName ?? '',
    bankAccountName: profile.bankAccountName ?? '',
    bankAccountNumber: profile.bankAccountNumber ?? '',
    bankRoutingNumber: profile.bankRoutingNumber ?? '',
    bankSwiftCode: profile.bankSwiftCode ?? '',
  };
}

function liveBankValues(profile: SellerProfileView): BankValues {
  return {
    bankName: profile.bankName,
    bankBranchName: profile.bankBranchName,
    bankAccountName: profile.bankAccountName,
    bankAccountNumber: profile.bankAccountNumber,
    bankRoutingNumber: profile.bankRoutingNumber,
    bankSwiftCode: profile.bankSwiftCode,
  };
}

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * The six values as a description list. `compareTo` marks the rows that
 * differ from another set — used to point at what a pending request
 * would actually change, so the seller doesn't have to diff two columns
 * by eye.
 */
function BankValuesList({
  values,
  compareTo,
}: {
  readonly values: BankValues;
  readonly compareTo?: BankValues;
}): ReactElement {
  return (
    <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[180px_1fr] gap-x-3 sm:gap-x-6 gap-y-2 text-sm">
      {BANK_FIELDS.map((f) => {
        const value = values[f.key];
        const changed = compareTo !== undefined && (compareTo[f.key] ?? '') !== (value ?? '');
        return (
          <Fragment key={f.key}>
            <dt className="text-text-muted">{f.label}</dt>
            <dd className={f.mono ? 'text-text-body font-mono text-xs' : 'text-text-body'}>
              {value === null || value === '' ? '—' : value}
              {changed && (
                <span className="ml-2 font-sans text-[10px] uppercase tracking-wide text-accent">
                  changed
                </span>
              )}
            </dd>
          </Fragment>
        );
      })}
    </dl>
  );
}

function BankDetailsSection({
  profile,
}: {
  readonly profile: SellerProfileWithBankChange;
}): ReactElement {
  const canManage = can(useSellerIdentity(), 'profile.manage');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => bankFormFrom(profile));
  const update = useUpdateSellerBankDetails();
  const toast = useToast();

  useEffect(() => {
    if (!editing) {
      setForm(bankFormFrom(profile));
    }
  }, [profile, editing]);

  // `?? null` so a profile served by an API build that predates this
  // field degrades to "no request in flight" instead of crashing on it.
  const change = profile.latestBankChange ?? null;
  const pending = change?.status === 'PENDING';
  const live = liveBankValues(profile);
  // Whether there is anything to redirect is what decides the whole
  // shape of this card: a first add writes straight through, an edit
  // becomes a request. The seller with nothing on file is never shown
  // approval language, because none of it applies to them.
  const hasAccountOnFile = BANK_FIELDS.some((f) => (live[f.key] ?? '') !== '');
  const storedAccountNumber = profile.bankAccountNumber !== null;

  // The account number is satisfied by the one already on file — the
  // input is blank because we are never given the plaintext to prefill,
  // not because the seller cleared it.
  const satisfied = (key: BankFieldKey): boolean =>
    form[key].trim() !== '' || (key === 'bankAccountNumber' && storedAccountNumber);

  // FE-2: the SERVER refuses an incomplete account and its words are what
  // gets surfaced. This is the same rule stated ahead of the round trip
  // so the seller is told while they are still looking at the fields —
  // never a substitute for the server's verdict, which is why it only
  // ever softens a hint and never blocks the submit.
  const filled = BANK_FIELDS.filter((f) => satisfied(f.key));
  const missing = BANK_FIELDS.filter((f) => !satisfied(f.key));
  const incomplete = filled.length > 0 && missing.length > 0;

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      for (const f of BANK_FIELDS) {
        const next = form[f.key].trim();
        if (next === (profile[f.key] ?? '')) continue;
        body[f.key] = next === '' ? null : next;
      }
      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }
      const result = await update.mutateAsync(body as UpdateSellerBankDetailsRequest);
      setEditing(false);
      // Whether this saved or merely asked is the SERVER's answer, read
      // off what came back — never a client-side re-derivation of the
      // first-add-vs-edit rule.
      if (result.latestBankChange?.status === 'PENDING') {
        toast.info('Sent for approval. Your current account is unchanged.');
      } else {
        toast.success('Bank details saved.');
      }
    } catch (err) {
      setError(serverVerdict(err, 'Could not update bank details.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Bank details"
        action={
          canManage &&
          !editing &&
          // No Edit while a request is in review: the server allows one
          // at a time, so the form could only ever produce a refusal.
          !pending && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
            >
              <Pencil size={12} /> Edit
            </Button>
          )
        }
      />
      <CardBody>
        {!editing ? (
          !hasAccountOnFile && !pending ? (
            <div className="text-text-muted text-sm py-2">
              No bank details captured yet. Remittance requires this; add them before your first
              delivered order.
            </div>
          ) : (
            <div className="space-y-4">
              {change !== null && change.status === 'REJECTED' && (
                <div
                  role="status"
                  className="rounded-[5px] px-3 py-2 space-y-1.5 bg-[var(--status-failed-bg)] text-[var(--status-failed-fg)] border border-[var(--status-failed-ring)]"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge kind="failed" label="Change rejected" />
                    {change.decidedAt !== null && (
                      <span className="text-xs opacity-80">{whenLabel(change.decidedAt)}</span>
                    )}
                  </div>
                  {/* The admin's own words, verbatim — it is the whole
                      point of asking them for a reason. */}
                  <p className="text-xs">
                    {change.decisionReason ?? 'No reason was recorded with the rejection.'}
                  </p>
                  <p className="text-xs opacity-80">
                    Nothing changed — withdrawals still go to the account below. Edit it to send a
                    new request.
                  </p>
                </div>
              )}

              <section className="space-y-2">
                {pending && (
                  <h3 className="text-text-muted text-xs uppercase tracking-wide">
                    Current account · withdrawals go here
                  </h3>
                )}
                <BankValuesList values={live} />
              </section>

              {pending && change !== null && (
                <section className="rounded-[6px] px-3 py-3 space-y-3 bg-[var(--status-pending-bg)] border border-[var(--status-pending-ring)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge kind="pending" label="Awaiting approval" />
                    <span className="text-xs text-[var(--status-pending-fg)] opacity-80">
                      Sent {whenLabel(change.submittedAt)}
                    </span>
                  </div>
                  <p className="text-sm text-[var(--status-pending-fg)]">
                    These are the details you asked us to switch to. They are not live yet — an
                    admin has to approve them, and{' '}
                    <strong>withdrawals continue to the current account above until they do</strong>
                    .
                  </p>
                  <BankValuesList values={change.proposed} compareTo={live} />
                  <p className="text-xs text-[var(--status-pending-fg)] opacity-80">
                    Account numbers are only ever shown as their last four digits. One change can be
                    in review at a time, so these fields stay locked until this one is approved or
                    rejected.
                  </p>
                </section>
              )}
            </div>
          )
        ) : (
          <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
            <p className="text-text-muted text-xs mb-1">
              {hasAccountOnFile ? (
                <>
                  Changing a payable account does not take effect on save — it goes to an admin for
                  approval, and withdrawals keep going to your current account until then. All six
                  fields are needed together.
                </>
              ) : (
                <>
                  Used for remittance withdrawals. All six fields are needed together — a withdrawal
                  missing one is rejected at the bank, not here.
                </>
              )}
            </p>
            <FormField label="Bank name">
              <Input
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                maxLength={120}
                placeholder="e.g. Dutch-Bangla Bank Ltd."
              />
            </FormField>
            <FormField label="Branch name">
              <Input
                value={form.bankBranchName}
                onChange={(e) => setForm({ ...form, bankBranchName: e.target.value })}
                maxLength={120}
                placeholder="e.g. Gulshan Circle-1 Branch"
              />
            </FormField>
            <FormField label="Account holder name">
              <Input
                value={form.bankAccountName}
                onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
                maxLength={120}
                placeholder="As it appears on the bank statement"
              />
            </FormField>
            <FormField
              label="Account number"
              hint={
                storedAccountNumber
                  ? 'The account your withdrawals are sent to. Changing it goes to an admin for approval.'
                  : undefined
              }
            >
              <Input
                value={form.bankAccountNumber}
                onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                maxLength={64}
                placeholder={
                  storedAccountNumber ? 'Blank keeps the current number' : '123-4567-890123'
                }
              />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormField label="Routing number">
                <Input
                  value={form.bankRoutingNumber}
                  onChange={(e) => setForm({ ...form, bankRoutingNumber: e.target.value })}
                  maxLength={32}
                  placeholder="9-digit routing"
                />
              </FormField>
              <FormField label="SWIFT code">
                <Input
                  value={form.bankSwiftCode}
                  onChange={(e) => setForm({ ...form, bankSwiftCode: e.target.value })}
                  maxLength={16}
                  placeholder="DBBLBDDH"
                />
              </FormField>
            </div>

            {incomplete && (
              <div
                className="text-xs px-3 py-2 rounded-[5px] bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] border border-[var(--status-pending-ring)]"
                // Advisory, not a gate — the submit stays enabled and the
                // server's refusal is what the seller is finally shown.
                role="status"
              >
                Still needed: {missing.map((f) => f.serverLabel).join(', ')}. Submitting without
                these will be refused — a withdrawal needs the whole account.
              </div>
            )}

            {error && (
              <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
                {error}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              {/* The button says what the click actually does: an edit
                  raises a request for review, it does not save. */}
              <Button type="submit" variant="primary" size="md" disabled={busy}>
                {hasAccountOnFile
                  ? busy
                    ? 'Sending…'
                    : 'Send for approval'
                  : busy
                    ? 'Saving…'
                    : 'Save details'}
              </Button>
            </div>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function LogoSection({ profile }: { readonly profile: SellerProfileView }): ReactElement {
  const canManage = can(useSellerIdentity(), 'profile.manage');
  const presign = usePresignLogo();
  const register = useRegisterLogo();
  const remove = useRemoveLogo();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  function fmtErr(e: unknown): string {
    if (e instanceof ApiError) {
      const b = e.body as { code?: unknown; message?: unknown } | null;
      const code = typeof b?.code === 'string' ? b.code : null;
      const msg = typeof b?.message === 'string' ? b.message : e.message;
      return code ? `[${code}] ${msg}` : msg;
    }
    return e instanceof Error ? e.message : 'Action failed';
  }

  async function onPick(file: File): Promise<void> {
    setError(null);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Logo must be JPG, PNG, or WEBP');
      return;
    }
    if (file.size > 1_048_576) {
      setError('Logo must be under 1 MB');
      return;
    }
    setBusy(true);
    try {
      const ps = await presign.mutateAsync({
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      });
      // Direct PUT to Spaces — bypasses our /api/* proxy because the
      // presigned URL is to Spaces, not our origin.
      const put = await fetch(ps.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!put.ok) {
        throw new Error(`Spaces upload failed: ${put.status}`);
      }
      await register.mutateAsync({
        storageKey: ps.storageKey,
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      });
      toast.success('Logo updated.');
    } catch (e) {
      setError(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await remove.mutateAsync();
      toast.success('Logo removed.');
      setConfirmRemove(false);
    } catch (e) {
      setError(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Company logo" />
      <CardBody>
        {canManage ? (
          <>
            {/* Uploading or removing a logo is `profile.manage`; without it
            the card shows the logo and no controls, rather than buttons
            that refuse. */}
            <div className="flex items-start gap-4">
              {profile.logoUrl ? (
                <div className="w-24 h-24 rounded-[6px] border border-border bg-bg overflow-hidden shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={profile.logoUrl} alt="Logo" className="w-full h-full object-contain" />
                </div>
              ) : (
                <div className="w-24 h-24 rounded-[6px] border border-dashed border-border-strong bg-surface flex items-center justify-center text-text-faint text-xs shrink-0">
                  No logo
                </div>
              )}

              <div className="flex-1 space-y-2">
                <div className="text-text-muted text-xs">
                  JPG, PNG, or WEBP. Up to 1 MB. Recommended 256×256, square.
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <span className="px-3 py-1.5 rounded-[5px] text-sm bg-accent text-accent-fg hover:bg-accent-hover transition-colors">
                      {busy ? 'Uploading…' : 'Choose file'}
                    </span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void onPick(f);
                        e.target.value = '';
                      }}
                      className="hidden"
                    />
                  </label>
                  {profile.logoUrl && !confirmRemove && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => setConfirmRemove(true)}
                    >
                      Remove
                    </Button>
                  )}
                  {confirmRemove && (
                    <>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy}
                        onClick={() => void onRemove()}
                      >
                        Confirm remove
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
                {error && (
                  <div className="text-critical text-xs bg-[var(--color-critical-tint)] border border-[var(--color-critical-ring)] px-3 py-2 rounded-[5px]">
                    {error}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <p className="text-text-muted text-xs">Your role cannot change the company logo.</p>
        )}
      </CardBody>
    </Card>
  );
}
