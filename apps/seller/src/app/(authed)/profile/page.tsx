'use client';

import { Fragment, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import {
  BadgeCheck,
  Banknote,
  Building2,
  CircleAlert,
  Clock,
  Coins,
  Hash,
  ImageUp,
  Landmark,
  Languages,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  Trash2,
  User,
  XCircle,
} from 'lucide-react';
import type {
  SellerStatusValue,
  SellerProfileView,
  UpdateSellerBankDetailsRequest,
  UpdateSellerProfileRequest,
} from '@skydrop/api-client';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { KpiCard, type KpiTone } from '@skydrop/ui/app/kpi-card';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { Button, buttonClassName } from '@skydrop/ui/app/button';
import { AsyncButton, useAsyncState } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
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
import { verdict } from '@/i18n/verdict';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  SetCallout,
  SetFact,
  SetPageHeader,
  phaseOf,
} from '../settings/_components/settings-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const crumbsOf = (t: Translate<MessageKey>) => [
  { label: t('profile.clientConsole') },
  { label: t('profile.account') },
  { label: t('profile.profile') },
];

/**
 * Seller profile — Phase 1B M19+M20.
 *
 * Three sections: Company info (editable in place), Company logo, and
 * Bank details (editable; an edit to an account on file goes to an admin
 * for approval). FE-2: server rejection surfaces `[CODE] message`
 * VERBATIM. View ↔ edit toggle per section so the seller can update one
 * without scrolling the other.
 *
 * Saving bank details asks first, restating the account and what the
 * save does, then sends exactly the request the form always sent. So
 * does removing the logo.
 */
export default function ProfilePage(): ReactElement {
  const t = useT();
  const detail = useSellerProfile();

  if (detail.isLoading) {
    return (
      <div className="set-page">
        <SetPageHeader
          crumbs={crumbsOf(t)}
          title={t('profile.profile')}
          subtitle={t('profile.companyInfoBankDetails')}
        />
        <div className="set-kpis" aria-busy="true">
          <span className="set-sr">{t('profile.loadingProfile')}</span>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={112} />
          ))}
        </div>
        <div className="set-card">
          <Skeleton width="30%" height={16} />
          <Skeleton width="60%" height={14} />
          <Skeleton width="45%" height={14} />
        </div>
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="set-page">
        <SetPageHeader
          crumbs={crumbsOf(t)}
          title={t('profile.profile')}
          subtitle={t('profile.companyInfoBankDetails')}
        />
        <ErrorState
          message={detail.error?.message ?? t('profile.failedToLoadProfile')}
          retry={() => void detail.refetch()}
        />
      </div>
    );
  }
  if (!detail.data) {
    return (
      <div className="set-page">
        <SetPageHeader
          crumbs={crumbsOf(t)}
          title={t('profile.profile')}
          subtitle={t('profile.companyInfoBankDetails')}
        />
        <ErrorState message={t('profile.profileNotLoaded')} />
      </div>
    );
  }

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={crumbsOf(t)}
        title={t('profile.profile')}
        subtitle={t('profile.yourCompanyAsWe')}
        /*
          The comp's chip row here reads VERIFIED ENTITY, L-4
          INSTITUTIONAL VERIFIED, SOC-2 TYPE II, FEMA/BB COMPLIANT and a
          KYC tier. We run no KYC tiering, hold no certifications and
          have no compliance grade to report — and a compliance badge is
          exactly the kind of thing a seller would reasonably act on. So
          the row says the two things that ARE recorded: whether the
          account is approved, and which currency they read in.
        */
        meta={
          <span className="set-meta">
            <SetFact tone={detail.data.status === 'APPROVED' ? 'good' : 'warn'}>
              {humaniseStatus(t, detail.data.status)}
            </SetFact>
            <SetFact>
              {richMessage(t('profile.readsIn'), { displayCurrency: detail.data.displayCurrency })}
            </SetFact>
            {detail.data.emailVerifiedAt === null && (
              <SetFact tone="warn">{t('profile.emailNotVerified')}</SetFact>
            )}
          </span>
        }
      />

      {/* ── The account at a glance ─────────────────────────────────
             Four standing facts, each a column on the seller row. The
             comp puts KYC tier, an FX spread model, a SOC-2 grade and
             an escrow protocol here; none of the four exists, so these
             are the four that do. */}
      <div className="set-kpis">
        <KpiCard
          label={t('profile.accountStatus')}
          icon={<BadgeCheck size={14} />}
          figure={<span className="set-kpi-text">{humaniseStatus(t, detail.data.status)}</span>}
          tone={kpiTone(statusTone(detail.data.status))}
          hint={
            detail.data.approvedAt === null
              ? t('profile.notApprovedYet')
              : t('profile.approved', {
                  approvedAt: new Date(detail.data.approvedAt).toLocaleDateString(),
                })
          }
        />
        <KpiCard
          label={t('profile.youReadAmountsIn')}
          icon={<Coins size={14} />}
          figure={<span className="set-kpi-text">{detail.data.displayCurrency}</span>}
          tone="neutral"
          // INR is the canonical currency everything is STORED in; BDT
          // is a display conversion. Saying so here stops "my wallet is
          // in taka" becoming a belief about where the money sits.
          hint={
            detail.data.displayCurrency === 'INR'
              ? t('profile.balancesAreHeldIn')
              : t('profile.convertedForDisplayBalances')
          }
        />
        <KpiCard
          label={t('profile.payoutsGoTo')}
          icon={<Banknote size={14} />}
          figure={
            detail.data.bankName === null || detail.data.bankName === '' ? (
              <span className="set-kpi-text set-kpi-faint">{t('profile.notSet')}</span>
            ) : (
              <span className="set-kpi-text">{detail.data.bankName}</span>
            )
          }
          tone={
            detail.data.bankName === null || detail.data.bankName === '' ? 'pending' : 'neutral'
          }
          // Last four only. The full number is on the card below, where
          // you went looking for it — a tile is read over a shoulder.
          hint={maskedAccount(detail.data.bankAccountNumber) ?? t('profile.addOneSoWithdrawals')}
        />
        <KpiCard
          label={t('profile.signInEmail')}
          icon={<Mail size={14} />}
          figure={
            <span className="set-kpi-text sk-ident sk-ident--wrap">{detail.data.emailDisplay}</span>
          }
          tone={detail.data.emailVerifiedAt === null ? 'pending' : 'neutral'}
          hint={
            detail.data.emailVerifiedAt === null
              ? t('profile.notVerifiedYet')
              : t('profile.verified')
          }
        />
      </div>

      <CompanyInfoSection profile={detail.data} />
      <LogoSection profile={detail.data} />
      <BankDetailsSection profile={detail.data} />
    </div>
  );
}

function fmtError(t: Translate<MessageKey>, e: unknown): string {
  return verdict(e, t, t('profile.actionFailed'));
}

/** The status tone, as the glow a figure card takes. Display only. */
function kpiTone(tone: 'neutral' | 'warn' | 'bad' | 'good'): KpiTone {
  switch (tone) {
    case 'good':
      return 'credit';
    case 'warn':
      return 'pending';
    case 'bad':
      return 'debit';
    case 'neutral':
      return 'neutral';
    default: {
      const exhaustive: never = tone;
      return exhaustive;
    }
  }
}

/**
 * The four seller statuses, said as a person would.
 *
 * EXHAUSTIVE over `SellerStatusValue` (the F2 discipline) so a fifth
 * status cannot quietly render as raw SCREAMING_SNAKE on the one screen
 * that tells a seller whether their account works.
 */
function humaniseStatus(t: Translate<MessageKey>, status: SellerStatusValue): string {
  switch (status) {
    case 'APPROVED':
      return t('profile.approved2');
    case 'PENDING':
      return t('profile.awaitingApproval');
    case 'REJECTED':
      return t('profile.rejected');
    case 'SUSPENDED':
      return t('profile.suspended');
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

function statusTone(status: SellerStatusValue): 'neutral' | 'warn' | 'bad' | 'good' {
  switch (status) {
    case 'APPROVED':
      return 'good';
    case 'PENDING':
      return 'warn';
    case 'REJECTED':
    case 'SUSPENDED':
      return 'bad';
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

/**
 * `•••• 5298`, or nothing at all.
 *
 * Returns undefined rather than a masked placeholder when there is no
 * number: "•••• ••••" reads as a number we are withholding, when the
 * truth is that none has been given yet, and the two want different
 * responses from the seller.
 */
function maskedAccount(value: string | null): string | undefined {
  if (value === null) return undefined;
  const digits = value.replace(/\s/g, '');
  if (digits.length < 4) return undefined;
  return `•••• ${digits.slice(-4)}`;
}

function CompanyInfoSection({ profile }: { readonly profile: SellerProfileView }): ReactElement {
  const t = useT();
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
      toast.success(t('profile.profileUpdated'));
      setEditing(false);
    } catch (err) {
      setError(fmtError(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="set-section">
      <SectionHeading
        title={t('profile.companyInfo')}
        note={t('profile.whatWeCallYou')}
        action={
          canManage &&
          !editing && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Pencil size={13} />}
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
            >
              {t('profile.edit')}
            </Button>
          )
        }
      />
      <div className="set-card">
        {!editing ? (
          <dl className="set-dl">
            <dt>{t('profile.company')}</dt>
            <dd>{profile.companyName}</dd>
            <dt>{t('profile.contactPerson')}</dt>
            <dd>{profile.contactPersonName}</dd>
            <dt>{t('profile.email')}</dt>
            <dd className="sk-ident sk-ident--wrap">{profile.emailDisplay}</dd>
            <dt>{t('profile.phone')}</dt>
            <dd className="sk-ident">{profile.phone}</dd>
            <dt>{t('profile.whatsapp')}</dt>
            <dd className="sk-ident">{profile.whatsapp ?? '—'}</dd>
            <dt>{t('profile.country')}</dt>
            <dd>{profile.countryCode}</dd>
            <dt>{t('profile.displayCurrency')}</dt>
            <dd>{profile.displayCurrency}</dd>
            <dt>{t('profile.displayLanguage')}</dt>
            <dd>{profile.displayLanguage.toUpperCase()}</dd>
          </dl>
        ) : (
          <form className="set-form-grid" onSubmit={(e) => void onSubmit(e)}>
            {/*
             * Company name and phone are FIXED. They are the identity
             * the account was approved on, so they are shown here as
             * facts rather than as inputs — the server drops both from
             * the update DTO and rejects a request carrying either, so
             * an editable box would only ever produce a refusal.
             */}
            <TextField
              label={t('profile.companyName')}
              icon={<Building2 size={15} />}
              hint={t('profile.fixedContactSupportTo')}
              value={profile.companyName}
              disabled
              readOnly
            />
            <TextField
              label={t('profile.contactPerson')}
              icon={<User size={15} />}
              value={form.contactPersonName}
              onChange={(e) => setForm({ ...form, contactPersonName: e.target.value })}
              minLength={2}
              maxLength={120}
              showCount
              required
            />
            <TextField
              label={t('profile.phoneE164Bd')}
              icon={<Phone size={15} />}
              hint={t('profile.fixedItIsHow')}
              value={profile.phone}
              disabled
              readOnly
              inputClassName="sk-ident"
            />
            <TextField
              label={t('profile.whatsapp')}
              icon={<MessageCircle size={15} />}
              hint={t('profile.leaveBlankToRemove')}
              value={form.whatsapp}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              placeholder="+8801712345678"
              inputClassName="sk-ident"
            />
            <div className="set-form-grid" data-cols="2">
              <Select
                label={t('profile.displayCurrency')}
                icon={<Coins size={15} />}
                value={form.displayCurrency}
                onChange={(e) =>
                  setForm({
                    ...form,
                    displayCurrency: e.target.value as 'INR' | 'BDT',
                  })
                }
              >
                <option value="INR">{t('profile.inr')}</option>
                <option value="BDT">{t('profile.bdt')}</option>
              </Select>
              <Select
                label={t('profile.displayLanguage')}
                icon={<Languages size={15} />}
                value={form.displayLanguage}
                onChange={(e) =>
                  setForm({
                    ...form,
                    displayLanguage: e.target.value as 'en' | 'bn',
                  })
                }
              >
                <option value="en">{t('profile.english')}</option>
                <option value="bn">বাংলা</option>
              </Select>
            </div>

            {error && (
              <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
                <p>{error}</p>
              </SetCallout>
            )}

            <div className="set-buttons">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                {t('profile.cancel')}
              </Button>
              <AsyncButton
                type="submit"
                variant="primary"
                size="md"
                labels={{
                  idle: t('profile.saveChanges'),
                  busy: t('profile.saving'),
                  error: t('profile.notSaved'),
                }}
                state={phaseOf(busy, error)}
                disabled={busy}
              />
            </div>
          </form>
        )}
      </div>
    </section>
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
  { key: 'bankName', serverLabel: 'bank name', labelKey: 'profile.bankNameLabel', mono: false },
  {
    key: 'bankBranchName',
    serverLabel: 'branch name',
    labelKey: 'profile.branchLabel',
    mono: false,
  },
  {
    key: 'bankAccountName',
    serverLabel: 'account holder name',
    labelKey: 'profile.accountHolderLabel',
    mono: false,
  },
  {
    key: 'bankAccountNumber',
    serverLabel: 'account number',
    labelKey: 'profile.accountNumberLabel',
    mono: true,
  },
  {
    key: 'bankRoutingNumber',
    serverLabel: 'routing number',
    labelKey: 'profile.routingNumberLabel',
    mono: true,
  },
  {
    key: 'bankSwiftCode',
    serverLabel: 'SWIFT code',
    labelKey: 'profile.swiftCodeLabel',
    mono: true,
  },
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
  const t = useT();
  return (
    <dl className="set-dl">
      {BANK_FIELDS.map((f) => {
        const value = values[f.key];
        const changed = compareTo !== undefined && (compareTo[f.key] ?? '') !== (value ?? '');
        return (
          <Fragment key={f.key}>
            <dt>{t(f.labelKey)}</dt>
            <dd>
              <span className={f.mono ? 'sk-ident' : undefined}>
                {value === null || value === '' ? '—' : value}
              </span>
              {changed && <span className="set-changed">{t('profile.changed')}</span>}
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
  const t = useT();
  const canManage = can(useSellerIdentity(), 'profile.manage');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => bankFormFrom(profile));
  // The change waiting on its confirmation — exactly the body the form
  // will send once confirmed.
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);
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

  function onSubmit(e: FormEvent): void {
    e.preventDefault();
    setError(null);
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
    setPendingBody(body);
  }

  async function send(body: Record<string, unknown>): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const result = await update.mutateAsync(body as UpdateSellerBankDetailsRequest);
      setEditing(false);
      // Whether this saved or merely asked is the SERVER's answer, read
      // off what came back — never a client-side re-derivation of the
      // first-add-vs-edit rule.
      if (result.latestBankChange?.status === 'PENDING') {
        toast.info(t('profile.sentForApprovalYour'));
      } else {
        toast.success(t('profile.bankDetailsSaved'));
      }
    } catch (err) {
      setError(verdict(err, t, t('profile.couldNotUpdateBank')));
    } finally {
      setBusy(false);
    }
  }

  // What the confirmation restates: the account as it will read after
  // the save, and which of the six fields the save touches.
  const nextName = form.bankName.trim() === '' ? live.bankName : form.bankName.trim();
  const nextNumber =
    form.bankAccountNumber.trim() === '' ? live.bankAccountNumber : form.bankAccountNumber.trim();
  const changedLabels =
    pendingBody === null
      ? []
      : BANK_FIELDS.filter((f) => f.key in pendingBody).map((f) => t(f.labelKey));

  return (
    <section className="set-section">
      <SectionHeading
        title={t('profile.bankDetails')}
        note={t('profile.whereAWithdrawalActually')}
        action={
          canManage &&
          !editing &&
          // No Edit while a request is in review: the server allows one
          // at a time, so the form could only ever produce a refusal.
          !pending && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Pencil size={13} />}
              onClick={() => {
                setError(null);
                setEditing(true);
              }}
            >
              {t('profile.edit')}
            </Button>
          )
        }
      />
      <div className="set-card">
        {!editing ? (
          !hasAccountOnFile && !pending ? (
            <p className="set-text">{t('profile.noBankDetailsCaptured')}</p>
          ) : (
            <div className="set-form-grid">
              {change !== null && change.status === 'REJECTED' && (
                <SetCallout
                  tone="critical"
                  icon={<XCircle size={15} />}
                  role="status"
                  title={
                    <span className="set-chips">
                      <StatusChip kind="failed" label={t('profile.changeRejected')} size="sm" />
                      {change.decidedAt !== null && (
                        <span className="set-callout__aside">{whenLabel(change.decidedAt)}</span>
                      )}
                    </span>
                  }
                >
                  {/* The admin's own words, verbatim — it is the whole
                      point of asking them for a reason. */}
                  <p>{change.decisionReason ?? t('profile.noReasonWasRecorded')}</p>
                  <p className="set-callout__aside">
                    {t('profile.nothingChangedWithdrawalsStill')}
                  </p>
                </SetCallout>
              )}

              <div className="set-form-grid">
                {pending && (
                  <h3 className="set-heading">{t('profile.currentAccountWithdrawalsGo')}</h3>
                )}
                <BankValuesList values={live} />
              </div>

              {pending && change !== null && (
                <SetCallout
                  tone="warn"
                  icon={<Clock size={15} />}
                  title={
                    <span className="set-chips">
                      <StatusChip kind="pending" label={t('profile.awaitingApproval')} size="sm" />
                      <span className="set-callout__aside">
                        {richMessage(t('profile.sent'), {
                          submittedAt: whenLabel(change.submittedAt),
                        })}
                      </span>
                    </span>
                  }
                >
                  <p>
                    {richMessage(t('profile.theseAreTheDetails'), {
                      strong: <strong>{t('profile.withdrawalsContinueToThe')}</strong>,
                    })}
                  </p>
                  <BankValuesList values={change.proposed} compareTo={live} />
                  <p className="set-callout__aside">{t('profile.accountNumbersAreOnly')}</p>
                </SetCallout>
              )}
            </div>
          )
        ) : (
          <form className="set-form-grid" onSubmit={onSubmit}>
            <p className="set-muted">
              {hasAccountOnFile ? (
                <>{t('profile.changingAPayableAccount')}</>
              ) : (
                <>{t('profile.usedForRemittanceWithdrawals')}</>
              )}
            </p>
            <TextField
              label={t('profile.bankName')}
              icon={<Landmark size={15} />}
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
              maxLength={120}
              placeholder={t('profile.eGDutchBangla')}
            />
            <TextField
              label={t('profile.branchName')}
              icon={<Building2 size={15} />}
              value={form.bankBranchName}
              onChange={(e) => setForm({ ...form, bankBranchName: e.target.value })}
              maxLength={120}
              placeholder={t('profile.eGGulshanCircle')}
            />
            <TextField
              label={t('profile.accountHolderName')}
              icon={<User size={15} />}
              value={form.bankAccountName}
              onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
              maxLength={120}
              placeholder={t('profile.asItAppearsOn')}
            />
            <TextField
              label={t('profile.accountNumber')}
              icon={<Hash size={15} />}
              hint={storedAccountNumber ? t('profile.theAccountYourWithdrawals') : undefined}
              value={form.bankAccountNumber}
              onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
              maxLength={64}
              placeholder={
                storedAccountNumber ? t('profile.blankKeepsTheCurrent') : '123-4567-890123'
              }
              inputClassName="sk-ident"
            />
            <div className="set-form-grid" data-cols="2">
              <TextField
                label={t('profile.routingNumber')}
                icon={<Hash size={15} />}
                value={form.bankRoutingNumber}
                onChange={(e) => setForm({ ...form, bankRoutingNumber: e.target.value })}
                maxLength={32}
                placeholder={t('profile.9DigitRouting')}
                inputClassName="sk-ident"
              />
              <TextField
                label={t('profile.swiftCode')}
                icon={<Hash size={15} />}
                value={form.bankSwiftCode}
                onChange={(e) => setForm({ ...form, bankSwiftCode: e.target.value })}
                maxLength={16}
                placeholder={t('profile.dbblbddh')}
                inputClassName="sk-ident"
              />
            </div>

            {incomplete && (
              // Advisory, not a gate — the submit stays enabled and the
              // server's refusal is what the seller is finally shown.
              <SetCallout tone="warn" icon={<CircleAlert size={15} />} role="status">
                <p>
                  {richMessage(t('profile.stillNeededSubmittingWithout'), {
                    serverLabel: missing.map((f) => f.serverLabel).join(', '),
                  })}
                </p>
              </SetCallout>
            )}

            {error && (
              <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
                <p>{error}</p>
              </SetCallout>
            )}

            <div className="set-buttons">
              <Button
                type="button"
                variant="ghost"
                size="md"
                disabled={busy}
                onClick={() => setEditing(false)}
              >
                {t('profile.cancel')}
              </Button>
              {/* The button says what the click actually does: an edit
                  raises a request for review, it does not save. */}
              <AsyncButton
                type="submit"
                variant="primary"
                size="md"
                labels={
                  hasAccountOnFile
                    ? {
                        idle: t('profile.sendForApproval'),
                        busy: t('profile.sending'),
                        error: t('profile.notSent'),
                      }
                    : {
                        idle: t('profile.saveDetails'),
                        busy: t('profile.saving'),
                        error: t('profile.notSaved'),
                      }
                }
                state={phaseOf(busy, error)}
                disabled={busy}
              />
            </div>
          </form>
        )}
      </div>

      <ConfirmDialog
        open={pendingBody !== null}
        onOpenChange={(next) => {
          if (!next) setPendingBody(null);
        }}
        title={
          hasAccountOnFile ? t('profile.sendThisBankChange') : t('profile.saveTheseBankDetails')
        }
        entity={`${nextName ?? t('profile.bankNotNamed')} · ${maskedAccount(nextNumber) ?? t('profile.noAccountNumber')}`}
        entityIsIdentifier
        consequence={
          hasAccountOnFile ? t('profile.anAdminChecksIt') : t('profile.yourWithdrawalsWillBe')
        }
        confirmLabel={hasAccountOnFile ? t('profile.sendForApproval') : t('profile.saveDetails')}
        onConfirm={() => (pendingBody === null ? undefined : send(pendingBody))}
      >
        {changedLabels.length > 0 && (
          <p className="set-muted">
            {richMessage(t('profile.changing'), { changedLabels: changedLabels.join(', ') })}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}

function LogoSection({ profile }: { readonly profile: SellerProfileView }): ReactElement {
  const t = useT();
  const canManage = can(useSellerIdentity(), 'profile.manage');
  const presign = usePresignLogo();
  const register = useRegisterLogo();
  const remove = useRemoveLogo();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const upload = useAsyncState();

  function fmtErr(e: unknown): string {
    return verdict(e, t, t('profile.actionFailed'));
  }

  async function onPick(file: File): Promise<void> {
    setError(null);
    // A refusal here is thrown after it is shown, so the upload control
    // reports the failure on itself rather than a success.
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(t('profile.logoMustBeJpg'));
      throw new Error('Logo must be JPG, PNG, or WEBP');
    }
    if (file.size > 1_048_576) {
      setError(t('profile.logoMustBeUnder'));
      throw new Error('Logo must be under 1 MB');
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
      toast.success(t('profile.logoUpdated'));
    } catch (e) {
      setError(fmtErr(e));
      // Rethrown so the upload control shows the failure on itself.
      throw e;
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await remove.mutateAsync();
      toast.success(t('profile.logoRemoved'));
      setConfirmRemove(false);
    } catch (e) {
      setError(fmtErr(e));
    } finally {
      setBusy(false);
    }
  }

  const uploadLabel =
    upload.phase === 'busy'
      ? t('profile.uploading')
      : upload.phase === 'success'
        ? t('profile.logoUpdatedShort')
        : upload.phase === 'error'
          ? t('profile.notUploaded')
          : busy
            ? t('profile.uploading')
            : t('profile.chooseFile');

  return (
    <section className="set-section">
      <SectionHeading title={t('profile.companyLogo')} note={t('profile.shownToYourCustomers')} />
      <div className="set-card">
        {canManage ? (
          // Uploading or removing a logo is `profile.manage`; without it
          // the card says so and shows no controls, rather than buttons
          // that refuse.
          <div className="set-logo">
            {profile.logoUrl ? (
              <div className="set-logo__frame">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={profile.logoUrl} alt={t('profile.logo')} />
              </div>
            ) : (
              <div className="set-logo__frame" data-empty="1">
                {t('profile.noLogo')}
              </div>
            )}

            <div className="set-logo__body">
              <p className="set-muted">{t('profile.jpgPngOrWebp')}</p>
              <div className="set-buttons" data-align="start">
                <label
                  className={`set-file ${buttonClassName('primary', 'md')}`}
                  data-disabled={busy ? '1' : undefined}
                  aria-busy={upload.phase === 'busy' || undefined}
                >
                  <span className="sk-btn__fx" aria-hidden />
                  <span className="sk-btn__icon" aria-hidden>
                    <ImageUp size={15} />
                  </span>
                  <span className="sk-btn__label">{uploadLabel}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void upload.run(() => onPick(f));
                      e.target.value = '';
                    }}
                  />
                </label>
                {profile.logoUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 size={13} />}
                    disabled={busy}
                    onClick={() => setConfirmRemove(true)}
                  >
                    {t('profile.remove')}
                  </Button>
                )}
              </div>
              <span className="set-sr" aria-live="polite">
                {upload.phase === 'busy'
                  ? t('profile.uploading')
                  : upload.phase === 'success'
                    ? t('profile.logoUpdatedShort')
                    : ''}
              </span>
              {error && (
                <SetCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
                  <p>{error}</p>
                </SetCallout>
              )}
            </div>
          </div>
        ) : (
          <p className="set-muted">{t('profile.yourRoleCannotChange')}</p>
        )}
      </div>

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('profile.removeTheCompanyLogo')}
        entity={profile.companyName}
        consequence={t('profile.yourCustomersStopSeeing')}
        confirmLabel={t('profile.confirmRemove')}
        destructive
        onConfirm={onRemove}
      />
    </section>
  );
}
