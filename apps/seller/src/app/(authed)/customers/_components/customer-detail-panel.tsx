'use client';

import { useState, type ReactElement, type ReactNode } from 'react';
import { PencilLine, Trash2 } from 'lucide-react';
import { Num } from '@skydrop/ui/components';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog, Dialog, DialogFooter } from '@skydrop/ui/app/dialog';
import { TextArea, TextField } from '@skydrop/ui/app/text-field';
import { Select } from '@skydrop/ui/app/select';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { useToast } from '@skydrop/ui/app/toast';
import { useSellerIdentity } from '@skydrop/auth/client';
import { useCustomer, useDeleteCustomer, useUpdateCustomer } from '@/lib/account-hooks';
import { can } from '@/lib/page-access';
import { verdict } from '@/i18n/verdict';
import './customers.css';
import { useT } from '@/i18n/client';

/**
 * One customer record, and the two things you can do to it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The customers list is read-only. A name typed wrong on the first
 * order — or a stale email that bounces every confirmation — followed
 * that customer forever, because ORD-7 dedups on `(sellerId, phone)`
 * and re-encountering them on a new order deliberately does NOT
 * overwrite the seller-curated name. So the wrong value was permanent
 * and there was no screen to fix it. GET/PATCH/DELETE have existed on
 * `/seller/customers/:id` since M6 with no caller at all.
 *
 * ── THE PHONE IS NOT EDITABLE, AND THAT IS DELIBERATE ────────────────
 * `phoneE164` is the identity (ORD-7). The server has no parameter for
 * it by construction, so offering a field would be offering something
 * that cannot be saved. A wrong phone is a different customer: place
 * the next order against the right number and remove this record.
 *
 * ── REMOVE IS A SOFT DELETE ──────────────────────────────────────────
 * The row is hidden, the order history behind it is untouched, and a
 * new order to the same number revives the record rather than creating
 * a second one. Worth saying out loud, because "delete" in a COD
 * business reads like it destroys the RTO history you priced them on.
 */
export function CustomerDetailPanel({
  customerId,
  onDeleted,
}: {
  readonly customerId: string;
  /** Let the parent drop this panel — the record it is showing is gone. */
  readonly onDeleted?: () => void;
}): ReactElement | null {
  const t = useT();
  // COSMETIC (FE-2), and TWO permissions rather than one: the server
  // guards the read on `customers.view` and both writes on
  // `customers.manage`. They were the same key until the write was split
  // out, which meant a company could not say "let them look" — the only
  // way to withhold the edit was to withhold the whole customer list.
  const identity = useSellerIdentity();
  const mayView = can(identity, 'customers.view');
  const mayManage = can(identity, 'customers.manage');

  const toast = useToast();
  const detail = useCustomer(customerId);
  const update = useUpdateCustomer();
  const remove = useDeleteCustomer();

  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [altPhone, setAltPhone] = useState('');
  const [riskNotes, setRiskNotes] = useState('');
  const [language, setLanguage] = useState('en');

  if (!mayView) return null;

  const c = detail.data;

  function openEditor(): void {
    // Seed from the loaded record at open time rather than in an effect:
    // an effect would clobber whatever the operator has typed the moment
    // a background refetch lands.
    if (c === undefined) return;
    setName(c.name ?? '');
    setEmail(c.email ?? '');
    setAltPhone(c.altPhoneE164 ?? '');
    setRiskNotes(c.riskNotes ?? '');
    setLanguage(c.preferredLanguage ?? 'en');
    setError(null);
    setEditing(true);
  }

  /**
   * The save. Rejects after recording the server's verdict, so the
   * button beside it shows the failure it really had — the verdict
   * itself is shown verbatim above the fields (FE-2).
   */
  async function onSave(): Promise<void> {
    if (c === undefined) return;
    setError(null);
    try {
      // Only CHANGED fields go on the wire. The API runs
      // forbidNonWhitelisted, so an extra key is a 400 on the whole
      // call — and sending an untouched field would overwrite a value
      // another teammate corrected while this modal was open.
      //
      // Cleared-out fields send `null`, which the DTO's @IsOptional
      // accepts and the service writes through. Sending '' instead
      // would fail @IsEmail and store a meaningless empty string in
      // the others.
      const body = changedFields(c, {
        name: name.trim(),
        email: email.trim(),
        altPhoneE164: altPhone.trim(),
        riskNotes: riskNotes.trim(),
        preferredLanguage: language,
      });
      if (Object.keys(body).length === 0) {
        setEditing(false);
        return;
      }
      await update.mutateAsync({ id: customerId, body });
      setEditing(false);
      toast.success(t('customers.customerUpdated'));
    } catch (err) {
      setError(verdict(err, t));
      throw err;
    }
  }

  /** The remove. Rejects on a refusal so the confirm stays open with the verdict. */
  async function onRemove(): Promise<void> {
    setError(null);
    try {
      await remove.mutateAsync({ id: customerId });
      setRemoving(false);
      toast.success(t('customers.customerRemoved'));
      onDeleted?.();
    } catch (err) {
      setError(verdict(err, t));
      throw err;
    }
  }

  // The server's own E.164 shape, mirrored so the operator is told here
  // rather than after a round trip. The server still decides (FE-2).
  const altPhoneMalformed = altPhone.trim() !== '' && !/^\+[1-9]\d{6,14}$/.test(altPhone.trim());

  return (
    <div className="cst-card">
      <div className="cst-card__head">
        <div>
          <h3 className="cst-card__title">{c?.name ?? c?.phoneE164 ?? t('customers.customer')}</h3>
          {c !== undefined && <p className="cst-card__sub sk-ident">{c.phoneE164}</p>}
        </div>
        {mayManage ? (
          <div className="cst-card__actions">
            <Button
              variant="secondary"
              size="sm"
              icon={<PencilLine size={14} />}
              disabled={c === undefined}
              onClick={() => openEditor()}
            >
              {t('customers.correctDetails')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              icon={<Trash2 size={14} />}
              disabled={c === undefined}
              onClick={() => {
                setError(null);
                setRemoving(true);
              }}
            >
              {t('customers.remove')}
            </Button>
          </div>
        ) : null}
      </div>

      {detail.isLoading ? (
        <SkeletonRows rows={3} cols={2} label={t('customers.loadingThisCustomer')} />
      ) : detail.isError ? (
        <ErrorState message={verdict(detail.error, t)} retry={() => void detail.refetch()} />
      ) : c === undefined ? null : (
        <dl className="cst-facts">
          <Fact label={t('customers.phone')}>
            <span className="sk-ident">{c.phoneE164}</span>
            <span className="cst-fixed">fixed</span>
          </Fact>
          <Fact label={t('customers.name')}>{c.name ?? '—'}</Fact>
          <Fact label={t('customers.email')}>{c.email ?? '—'}</Fact>
          <Fact label={t('customers.alternatePhone')}>
            {c.altPhoneE164 === null ? '—' : <span className="sk-ident">{c.altPhoneE164}</span>}
          </Fact>
          <Fact label={t('customers.callLanguage')}>
            {c.preferredLanguage === 'hi' ? t('customers.hindi') : t('customers.english')}
          </Fact>
          <Fact label={t('customers.risk')}>
            {c.riskLevel === null ? '—' : c.riskLevel.toLowerCase()}
          </Fact>
          <Fact label={t('customers.orders')}>
            <Num value={c.totalOrdersCount} />
          </Fact>
          <Fact label={t('customers.delivered')}>
            <Num value={c.successfulOrdersCount} />
          </Fact>
          <Fact label={t('customers.returned')}>
            {c.rtoCount === 0 ? (
              <span className="cst-faint sk-figure">0</span>
            ) : (
              <span className="cst-bad sk-figure">{c.rtoCount}</span>
            )}
          </Fact>
          <Fact label={t('customers.firstOrder')}>
            <span className="sk-figure">
              {c.firstOrderAt === null ? '—' : new Date(c.firstOrderAt).toLocaleDateString('en-IN')}
            </span>
          </Fact>
          <Fact label={t('customers.lastOrder')}>
            <span className="sk-figure">
              {c.lastOrderAt === null ? '—' : new Date(c.lastOrderAt).toLocaleDateString('en-IN')}
            </span>
          </Fact>
          <Fact label={t('customers.notes')}>{c.riskNotes ?? '—'}</Fact>
        </dl>
      )}

      {/* ── Correct ───────────────────────────────────────────────── */}
      <Dialog
        open={editing}
        onOpenChange={(next) => {
          if (!next) {
            setEditing(false);
            setError(null);
          }
        }}
        title={t('customers.correctCustomerDetails')}
        description={c?.phoneE164}
        icon={<PencilLine size={18} />}
        footer={
          <DialogFooter>
            <Button variant="secondary" size="md" onClick={() => setEditing(false)}>
              {t('customers.cancel')}
            </Button>
            <AsyncButton
              variant="primary"
              size="md"
              disabled={altPhoneMalformed || update.isPending}
              labels={{
                idle: t('customers.saveCorrections'),
                busy: t('customers.saving'),
                done: t('customers.saved'),
                error: t('customers.notSaved'),
              }}
              onAction={onSave}
            />
          </DialogFooter>
        }
      >
        <div className="cst-form">
          <p className="cst-lede">{t('customers.theseAreTheDetails')}</p>

          {error !== null && (
            <p className="cst-error" role="alert">
              {error}
            </p>
          )}

          <TextField
            label={t('customers.name')}
            hint={t('customers.whatTheCallCentre')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={160}
          />
          <TextField
            label={t('customers.email')}
            hint={t('customers.whereOrderUpdatesGo')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
          />
          <TextField
            label={t('customers.alternatePhone')}
            hint={t('customers.fullInternationalFormE')}
            error={altPhoneMalformed ? t('customers.mustStartWithAnd') : undefined}
            value={altPhone}
            onChange={(e) => setAltPhone(e.target.value)}
            placeholder="+919812345678"
            maxLength={16}
          />
          <Select
            label={t('customers.callLanguage')}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="en">{t('customers.english')}</option>
            <option value="hi">{t('customers.hindi')}</option>
          </Select>
          <TextArea
            label={t('customers.notes')}
            hint={t('customers.anythingTheAgentShould')}
            value={riskNotes}
            onChange={(e) => setRiskNotes(e.target.value)}
            maxLength={2000}
            showCount
            rows={3}
          />
        </div>
      </Dialog>

      {/* ── Remove ────────────────────────────────────────────────── */}
      <ConfirmDialog
        open={removing}
        onOpenChange={(next) => {
          if (!next) {
            setRemoving(false);
            setError(null);
          }
        }}
        title={t('customers.removeThisCustomer')}
        entity={c?.phoneE164 ?? t('customers.thisCustomer')}
        entityIsIdentifier={c !== undefined}
        consequence={t('customers.theRecordDisappearsFrom')}
        confirmLabel={t('customers.removeCustomer')}
        cancelLabel={t('customers.keepIt')}
        destructive
        onConfirm={onRemove}
        error={error ?? undefined}
      />
    </div>
  );
}

/** One label/value pair in the record's facts. */
function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div className="cst-facts__item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * The five editable fields, narrowed to what actually moved.
 *
 * `null` means "the operator emptied this" — the DTO's @IsOptional lets
 * null through and the service writes it, which is the only way to
 * clear a wrong email. An unchanged field is ABSENT, not null: sending
 * it would silently revert an edit made elsewhere between load and save.
 */
function changedFields(
  current: {
    name: string | null;
    email: string | null;
    altPhoneE164: string | null;
    riskNotes: string | null;
    preferredLanguage: string | null;
  },
  next: {
    name: string;
    email: string;
    altPhoneE164: string;
    riskNotes: string;
    preferredLanguage: string;
  },
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const pairs = [
    ['name', current.name, next.name],
    ['email', current.email, next.email],
    ['altPhoneE164', current.altPhoneE164, next.altPhoneE164],
    ['riskNotes', current.riskNotes, next.riskNotes],
    ['preferredLanguage', current.preferredLanguage ?? 'en', next.preferredLanguage],
  ] as const;
  for (const [key, was, now] of pairs) {
    const wasText = was ?? '';
    if (wasText === now) continue;
    out[key] = now === '' ? null : now;
  }
  return out;
}
