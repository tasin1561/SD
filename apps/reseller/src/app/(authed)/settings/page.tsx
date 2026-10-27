'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { CircleAlert, ImagePlus, Mail, Phone, Store, Trash2 } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { TextField } from '@skydrop/ui/app/text-field';
import { useToast } from '@skydrop/ui/app/toast';
import { can } from '@/lib/page-access';
import { useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
import {
  useRemoveStoreLogo,
  useStoreProfile,
  useUpdateStoreProfile,
  useUploadStoreLogo,
} from '@/lib/store-hooks';
import { RdCallout, RdCard, RdDl, phaseOf } from './_components/rd-parts';

/**
 * How the store presents itself (RS-1 / RS-10): the name customers will
 * see, the logo, the contact details. Everyone with `store.profile.view`
 * reads it; editing needs `store.profile.manage` (cosmetic, FE-2).
 *
 * This page is STORE-WIDE and permission-gated, so the per-person motion
 * preference lives on /account instead.
 */
export default function StoreSettingsPage(): ReactElement {
  const t = useT();
  const me = useStoreIdentity();
  const profile = useStoreProfile();
  const manage = can(me, 'store.profile.manage');

  if (profile.isPending || profile.isError) {
    return (
      <div className="rd-page" data-width="narrow">
        <PageHeader title={t('setg.title')} subtitle={t('setg.subtitle')} />
        {profile.isPending ? (
          <SkeletonRows label={t('setg.loading')} rows={4} cols={2} />
        ) : (
          <ErrorState message={verdict(profile.error, t)} retry={() => void profile.refetch()} />
        )}
      </div>
    );
  }
  const p = profile.data;

  return (
    <div className="rd-page" data-width="narrow">
      <PageHeader title={t('setg.title')} subtitle={t('setg.subtitle')} />
      {manage ? (
        <ProfileForm
          initial={{
            displayName: p.displayName ?? '',
            contactEmail: p.contactEmail ?? '',
            contactPhone: p.contactPhone ?? '',
          }}
          storeName={p.name}
        />
      ) : (
        <RdCard title={t('setg.profile')}>
          <RdDl
            items={[
              { label: t('setg.customersSee'), value: p.displayName ?? p.name },
              { label: t('setg.contactEmail'), value: p.contactEmail ?? '—' },
              { label: t('setg.contactPhone'), value: p.contactPhone ?? '—' },
            ]}
          />
        </RdCard>
      )}
      <LogoCard logoUrl={p.logoUrl} manage={manage} />
    </div>
  );
}

function ProfileForm({
  initial,
  storeName,
}: {
  initial: { displayName: string; contactEmail: string; contactPhone: string };
  storeName: string;
}): ReactElement {
  const t = useT();
  const toast = useToast();
  const update = useUpdateStoreProfile();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  // Re-seed the form when the saved values change (after a save or a
  // refetch). Keyed on the three strings, not the object, which is a new
  // identity on every render of the parent.
  const { displayName, contactEmail, contactPhone } = initial;
  useEffect(
    () => setForm({ displayName, contactEmail, contactPhone }),
    [displayName, contactEmail, contactPhone],
  );

  async function submit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    setError(null);
    try {
      await update.mutateAsync(form);
      toast.success(t('setg.saved'));
    } catch (err) {
      setError(verdict(err, t));
    }
  }

  return (
    <RdCard title={t('setg.profile')}>
      <form onSubmit={submit} className="rd-form">
        <TextField
          id="displayName"
          label={t('setg.displayName')}
          icon={<Store size={15} />}
          hint={t('setg.displayNameHint', { store: storeName })}
          maxLength={80}
          showCount
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
        <TextField
          id="contactEmail"
          type="email"
          label={t('setg.contactEmail')}
          icon={<Mail size={15} />}
          value={form.contactEmail}
          onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
        />
        <TextField
          id="contactPhone"
          type="tel"
          label={t('setg.contactPhone')}
          icon={<Phone size={15} />}
          hint={t('setg.phoneHint')}
          value={form.contactPhone}
          onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
        />
        {error !== null ? (
          <RdCallout tone="critical" icon={<CircleAlert size={15} />} role="alert">
            <p>{error}</p>
          </RdCallout>
        ) : null}
        <div className="rd-buttons">
          <AsyncButton
            type="submit"
            variant="primary"
            size="md"
            labels={{
              idle: t('setg.save'),
              busy: t('setg.saving'),
              error: t('setg.notSaved'),
            }}
            state={phaseOf(update.isPending, error)}
            disabled={update.isPending}
          />
        </div>
      </form>
    </RdCard>
  );
}

function LogoCard({ logoUrl, manage }: { logoUrl: string | null; manage: boolean }): ReactElement {
  const t = useT();
  const toast = useToast();
  const upload = useUploadStoreLogo();
  const remove = useRemoveStoreLogo();
  const [confirming, setConfirming] = useState(false);

  function pick(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    upload.mutate(file, {
      onSuccess: () => toast.success(t('setg.logo.updated')),
      onError: (err) => toast.error(verdict(err, t)),
    });
  }

  return (
    <RdCard title={t('setg.logo.title')} note={t('setg.logo.note')}>
      <div className="rd-logo">
        {logoUrl !== null ? (
          <span className="rd-logo__frame">
            {/* A 15-minute presigned Spaces URL: next/image would proxy and cache it past expiry. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt={t('setg.logo.alt')} />
          </span>
        ) : (
          <p className="rd-muted">{t('setg.logo.none')}</p>
        )}
        {manage ? (
          <div className="rd-logo__controls">
            <label
              className="rd-file"
              htmlFor="logo-file"
              data-disabled={upload.isPending ? '1' : undefined}
            >
              <span className="rd-sr">{t('setg.logo.choose')}</span>
              <input
                id="logo-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={pick}
                disabled={upload.isPending}
              />
              <span
                className="sk-btn sk-btn--secondary sk-btn--sm"
                aria-hidden
                data-loading={upload.isPending || undefined}
              >
                <span className="sk-btn__fx" />
                <span className="sk-btn__icon">
                  <ImagePlus size={14} />
                </span>
                <span className="sk-btn__label">
                  {upload.isPending ? t('setg.logo.uploading') : t('setg.logo.choose')}
                </span>
              </span>
            </label>
            {logoUrl !== null ? (
              <Button
                variant="secondary"
                size="sm"
                icon={<Trash2 size={14} />}
                disabled={remove.isPending}
                onClick={() => setConfirming(true)}
              >
                {t('setg.logo.remove')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('setg.logo.removeTitle')}
        entity={t('setg.logo.removeEntity')}
        consequence={t('setg.logo.removeConsequence')}
        confirmLabel={t('setg.logo.remove')}
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync();
            toast.success(t('setg.logo.removed'));
          } catch (err) {
            toast.error(verdict(err, t));
          }
          setConfirming(false);
        }}
      />
    </RdCard>
  );
}
