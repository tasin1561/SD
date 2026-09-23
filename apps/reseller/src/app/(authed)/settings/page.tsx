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
import { serverVerdict } from '@/lib/server-verdict';
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
  const me = useStoreIdentity();
  const profile = useStoreProfile();
  const manage = can(me, 'store.profile.manage');

  if (profile.isPending || profile.isError) {
    return (
      <div className="rd-page" data-width="narrow">
        <PageHeader
          title="Store settings"
          subtitle="How your store presents itself to customers."
        />
        {profile.isPending ? (
          <SkeletonRows label="Loading store settings" rows={4} cols={2} />
        ) : (
          <ErrorState message={serverVerdict(profile.error)} retry={() => void profile.refetch()} />
        )}
      </div>
    );
  }
  const p = profile.data;

  return (
    <div className="rd-page" data-width="narrow">
      <PageHeader title="Store settings" subtitle="How your store presents itself to customers." />
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
        <RdCard title="Profile">
          <RdDl
            items={[
              { label: 'Customers see', value: p.displayName ?? p.name },
              { label: 'Contact email', value: p.contactEmail ?? '—' },
              { label: 'Contact phone', value: p.contactPhone ?? '—' },
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
      toast.success('Store settings saved.');
    } catch (err) {
      setError(serverVerdict(err));
    }
  }

  return (
    <RdCard title="Profile">
      <form onSubmit={submit} className="rd-form">
        <TextField
          id="displayName"
          label="Name customers see"
          icon={<Store size={15} />}
          hint={`Leave empty to use “${storeName}”.`}
          maxLength={80}
          showCount
          value={form.displayName}
          onChange={(e) => setForm({ ...form, displayName: e.target.value })}
        />
        <TextField
          id="contactEmail"
          type="email"
          label="Contact email"
          icon={<Mail size={15} />}
          value={form.contactEmail}
          onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
        />
        <TextField
          id="contactPhone"
          type="tel"
          label="Contact phone"
          icon={<Phone size={15} />}
          hint="With the country code, e.g. +919812345678."
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
            labels={{ idle: 'Save', busy: 'Saving…', error: 'Not saved' }}
            state={phaseOf(update.isPending, error)}
            disabled={update.isPending}
          />
        </div>
      </form>
    </RdCard>
  );
}

function LogoCard({ logoUrl, manage }: { logoUrl: string | null; manage: boolean }): ReactElement {
  const toast = useToast();
  const upload = useUploadStoreLogo();
  const remove = useRemoveStoreLogo();
  const [confirming, setConfirming] = useState(false);

  function pick(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    upload.mutate(file, {
      onSuccess: () => toast.success('Logo updated.'),
      onError: (err) => toast.error(serverVerdict(err)),
    });
  }

  return (
    <RdCard title="Logo" note="JPEG, PNG or WebP, up to 1 MB.">
      <div className="rd-logo">
        {logoUrl !== null ? (
          <span className="rd-logo__frame">
            {/* A 15-minute presigned Spaces URL: next/image would proxy and cache it past expiry. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt="Your store logo" />
          </span>
        ) : (
          <p className="rd-muted">No logo yet.</p>
        )}
        {manage ? (
          <div className="rd-logo__controls">
            <label
              className="rd-file"
              htmlFor="logo-file"
              data-disabled={upload.isPending ? '1' : undefined}
            >
              <span className="rd-sr">Choose a logo</span>
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
                  {upload.isPending ? 'Uploading…' : 'Choose a logo'}
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
                Remove logo
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove your logo?"
        entity="Your store logo"
        consequence="Customers see your store’s name without a logo on tracking and anywhere else it shows, until you upload another."
        confirmLabel="Remove logo"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync();
            toast.success('Logo removed.');
          } catch (err) {
            toast.error(serverVerdict(err));
          }
          setConfirming(false);
        }}
      />
    </RdCard>
  );
}
