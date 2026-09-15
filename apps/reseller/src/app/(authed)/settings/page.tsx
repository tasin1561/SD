'use client';

import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  ErrorState,
  FormActions,
  FormField,
  Input,
  LoadingState,
  PageHeader,
  useToast,
} from '@skydrop/ui/components';
import { can } from '@/lib/page-access';
import { serverVerdict } from '@/lib/server-verdict';
import {
  useRemoveStoreLogo,
  useStoreProfile,
  useUpdateStoreProfile,
  useUploadStoreLogo,
} from '@/lib/store-hooks';

/**
 * How the store presents itself (RS-1 / RS-10): the name customers will
 * see, the logo, the contact details. Everyone with `store.profile.view`
 * reads it; editing needs `store.profile.manage` (cosmetic, FE-2).
 */
export default function StoreSettingsPage(): ReactElement {
  const me = useStoreIdentity();
  const profile = useStoreProfile();
  const manage = can(me, 'store.profile.manage');

  if (profile.isPending || profile.isError) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader
          title="Store settings"
          subtitle="How your store presents itself to customers."
        />
        {profile.isPending ? (
          <LoadingState label="Loading store settings" rows={4} />
        ) : (
          <ErrorState message={serverVerdict(profile.error)} retry={() => void profile.refetch()} />
        )}
      </div>
    );
  }
  const p = profile.data;

  return (
    <div className="max-w-3xl space-y-6">
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
        <Card>
          <CardHeader title="Profile" />
          <CardBody>
            <DescriptionList
              columns={1}
              items={[
                { label: 'Customers see', value: p.displayName ?? p.name },
                { label: 'Contact email', value: p.contactEmail ?? '—' },
                { label: 'Contact phone', value: p.contactPhone ?? '—' },
              ]}
            />
          </CardBody>
        </Card>
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
    <Card>
      <CardHeader title="Profile" />
      <CardBody>
        <form onSubmit={submit} className="space-y-4">
          <FormField
            label="Name customers see"
            htmlFor="displayName"
            hint={`Leave empty to use “${storeName}”.`}
          >
            <Input
              id="displayName"
              maxLength={80}
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </FormField>
          <FormField label="Contact email" htmlFor="contactEmail">
            <Input
              id="contactEmail"
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            />
          </FormField>
          <FormField
            label="Contact phone"
            htmlFor="contactPhone"
            hint="With the country code, e.g. +919812345678."
          >
            <Input
              id="contactPhone"
              type="tel"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
            />
          </FormField>
          {error !== null ? (
            <p role="alert" className="text-critical text-sm">
              {error}
            </p>
          ) : null}
          <FormActions>
            <Button type="submit" variant="primary" size="md" disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </FormActions>
        </form>
      </CardBody>
    </Card>
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
    <Card>
      <CardHeader title="Logo" subtitle="JPEG, PNG or WebP, up to 1 MB." />
      <CardBody>
        <div className="flex flex-wrap items-center gap-4">
          {logoUrl !== null ? (
            // A 15-minute presigned Spaces URL: next/image would proxy and cache it past expiry.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Your store logo"
              className="border-border h-16 w-16 rounded border object-contain"
            />
          ) : (
            <p className="text-text-muted text-sm">No logo yet.</p>
          )}
          {manage ? (
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="logo-file">
                Choose a logo
              </label>
              <Input
                id="logo-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={pick}
                disabled={upload.isPending}
              />
              {logoUrl !== null ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => setConfirming(true)}
                >
                  Remove logo
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove your logo?"
        description="Customers see your store’s name without a logo on tracking and anywhere else it shows, until you upload another."
        confirmLabel="Remove logo"
        confirmVariant="destructive"
        disabled={remove.isPending}
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
    </Card>
  );
}
