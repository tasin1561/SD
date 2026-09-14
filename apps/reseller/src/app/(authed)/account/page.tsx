'use client';

import { useState, type ReactElement } from 'react';
import { useStoreIdentity } from '@skydrop/auth/client';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  PageHeader,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useRequestEmailVerification, useSignOutEverywhere } from '@/lib/store-hooks';

/**
 * The signed-in person's own account — open to every store user (it is
 * about themselves; the API side is self-service).
 */
export default function AccountPage(): ReactElement {
  const me = useStoreIdentity();
  const toast = useToast();
  const verify = useRequestEmailVerification();
  const everywhere = useSignOutEverywhere();
  const [confirming, setConfirming] = useState(false);
  if (me === null) return <></>;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="My account" subtitle="Your own login for this store." />
      <Card>
        <CardHeader title="You" />
        <CardBody>
          <DescriptionList
            columns={1}
            items={[
              { label: 'Name', value: me.fullName },
              { label: 'Email', value: me.emailDisplay },
              { label: 'Role', value: me.roleName },
              {
                label: 'Email confirmed',
                value:
                  me.emailVerifiedAt !== null ? (
                    'Yes'
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={verify.isPending || verify.isSuccess}
                      onClick={() =>
                        verify.mutate(undefined, {
                          onSuccess: () => toast.success('Check your inbox for the link.'),
                          onError: (err) => toast.error(serverVerdict(err)),
                        })
                      }
                    >
                      {verify.isSuccess ? 'Link sent' : 'Send a confirmation link'}
                    </Button>
                  ),
              },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sessions" subtitle="Signed in somewhere you should not be?" />
        <CardBody>
          <Button variant="destructive" size="md" onClick={() => setConfirming(true)}>
            Sign out everywhere
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title="Sign out of every device?"
            description="Every session of yours ends, including this one."
            confirmLabel="Sign out everywhere"
            confirmVariant="destructive"
            disabled={everywhere.isPending}
            onConfirm={async () => {
              try {
                await everywhere.mutateAsync();
              } catch (err) {
                toast.error(serverVerdict(err));
                return;
              }
              window.location.assign('/login');
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
