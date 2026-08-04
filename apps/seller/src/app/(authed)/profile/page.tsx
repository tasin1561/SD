'use client';

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
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
  useToast,
} from '@skydrop/ui/components';
import {
  usePresignLogo,
  useRegisterLogo,
  useRemoveLogo,
  useSellerProfile,
  useUpdateSellerBankDetails,
  useUpdateSellerProfile,
} from '@/lib/api-hooks';
import { can } from '@/lib/page-access';
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
      if (form.companyName !== profile.companyName) body.companyName = form.companyName.trim();
      if (form.contactPersonName !== profile.contactPersonName)
        body.contactPersonName = form.contactPersonName.trim();
      if (form.phone !== profile.phone) body.phone = form.phone.trim();
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
            <FormField label="Company name" required>
              <Input
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                minLength={2}
                maxLength={120}
                required
              />
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
            <FormField label="Phone (E.164 BD)" required hint="e.g. +8801712345678">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+8801712345678"
                required
              />
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

function BankDetailsSection({ profile }: { readonly profile: SellerProfileView }): ReactElement {
  const canManage = can(useSellerIdentity(), 'profile.manage');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    bankName: profile.bankName ?? '',
    bankAccountName: profile.bankAccountName ?? '',
    bankAccountNumber: profile.bankAccountNumber ?? '',
    bankRoutingNumber: profile.bankRoutingNumber ?? '',
    bankSwiftCode: profile.bankSwiftCode ?? '',
  });
  const update = useUpdateSellerBankDetails();
  const toast = useToast();

  useEffect(() => {
    if (!editing) {
      setForm({
        bankName: profile.bankName ?? '',
        bankAccountName: profile.bankAccountName ?? '',
        bankAccountNumber: profile.bankAccountNumber ?? '',
        bankRoutingNumber: profile.bankRoutingNumber ?? '',
        bankSwiftCode: profile.bankSwiftCode ?? '',
      });
    }
  }, [profile, editing]);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = {};
      const map: Array<{ key: keyof typeof form; current: string | null }> = [
        { key: 'bankName', current: profile.bankName },
        { key: 'bankAccountName', current: profile.bankAccountName },
        { key: 'bankAccountNumber', current: profile.bankAccountNumber },
        { key: 'bankRoutingNumber', current: profile.bankRoutingNumber },
        { key: 'bankSwiftCode', current: profile.bankSwiftCode },
      ];
      for (const { key, current } of map) {
        const next = form[key].trim();
        if (next === (current ?? '')) continue;
        body[key] = next === '' ? null : next;
      }
      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }
      await update.mutateAsync(body as UpdateSellerBankDetailsRequest);
      toast.success('Bank details updated.');
      setEditing(false);
    } catch (err) {
      setError(fmtError(err));
    } finally {
      setBusy(false);
    }
  }

  const masked = (v: string | null): string => {
    if (!v) return '—';
    if (v.length <= 4) return v;
    return `${'•'.repeat(Math.min(v.length - 4, 12))}${v.slice(-4)}`;
  };

  return (
    <Card>
      <CardHeader
        title="Bank details"
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
          profile.bankName === null && profile.bankAccountNumber === null ? (
            <div className="text-text-muted text-sm py-2">
              No bank details captured yet. Remittance requires this; add them before your first
              delivered order.
            </div>
          ) : (
            <dl className="grid grid-cols-[minmax(84px,36%)_1fr] sm:grid-cols-[180px_1fr] gap-x-3 sm:gap-x-6 gap-y-2 text-sm">
              <dt className="text-text-muted">Bank name</dt>
              <dd className="text-text-body">{profile.bankName ?? '—'}</dd>
              <dt className="text-text-muted">Account holder</dt>
              <dd className="text-text-body">{profile.bankAccountName ?? '—'}</dd>
              <dt className="text-text-muted">Account number</dt>
              <dd className="text-text-body font-mono text-xs">
                {masked(profile.bankAccountNumber)}
              </dd>
              <dt className="text-text-muted">Routing number</dt>
              <dd className="text-text-body font-mono text-xs">
                {profile.bankRoutingNumber ?? '—'}
              </dd>
              <dt className="text-text-muted">SWIFT code</dt>
              <dd className="text-text-body font-mono text-xs">{profile.bankSwiftCode ?? '—'}</dd>
            </dl>
          )
        ) : (
          <form className="space-y-3" onSubmit={(e) => void onSubmit(e)}>
            <p className="text-text-muted text-xs mb-1">
              Used for remittance payouts. Leave a field blank to remove it.
            </p>
            <FormField label="Bank name">
              <Input
                value={form.bankName}
                onChange={(e) => setForm({ ...form, bankName: e.target.value })}
                maxLength={120}
                placeholder="e.g. Dutch-Bangla Bank Ltd."
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
            <FormField label="Account number">
              <Input
                value={form.bankAccountNumber}
                onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                maxLength={64}
                placeholder="123-4567-890123"
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
