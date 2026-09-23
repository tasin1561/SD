'use client';

import { useState, type ReactElement } from 'react';
import { LogOut, MailCheck } from 'lucide-react';
import { useStoreIdentity } from '@skydrop/auth/client';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { Button } from '@skydrop/ui/app/button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { MotionSwitch } from '@skydrop/ui/app/motion-switch';
import { PageHeader } from '@skydrop/ui/app/page-header';
import { useToast } from '@skydrop/ui/app/toast';
import { serverVerdict } from '@/lib/server-verdict';
import { useRequestEmailVerification, useSignOutEverywhere } from '@/lib/store-hooks';
import { RdCard, RdDl } from '../settings/_components/rd-parts';

/**
 * The signed-in person's own account — open to every store user (it is
 * about themselves; the API side is self-service).
 *
 * It is also where the one per-PERSON preference lives: motion. Store
 * settings is store-wide and gated on a permission, so a preference of
 * this browser would be unreachable there for most of the team.
 */
export default function AccountPage(): ReactElement {
  const me = useStoreIdentity();
  const toast = useToast();
  const verify = useRequestEmailVerification();
  const everywhere = useSignOutEverywhere();
  const [confirming, setConfirming] = useState(false);
  if (me === null) return <></>;

  return (
    <div className="rd-page" data-width="narrow">
      <PageHeader title="My account" subtitle="Your own login for this store." />
      <RdCard title="You">
        <RdDl
          items={[
            { label: 'Name', value: <span className="rd-strong">{me.fullName}</span> },
            { label: 'Email', value: me.emailDisplay },
            { label: 'Role', value: me.roleName },
            {
              label: 'Email confirmed',
              value:
                me.emailVerifiedAt !== null ? (
                  'Yes'
                ) : (
                  <AsyncButton
                    variant="secondary"
                    size="sm"
                    icon={<MailCheck size={14} />}
                    labels={{
                      idle: verify.isSuccess ? 'Link sent' : 'Send a confirmation link',
                      busy: 'Sending…',
                      error: 'Not sent',
                    }}
                    state={verify.isPending ? 'busy' : verify.isError ? 'error' : 'idle'}
                    disabled={verify.isPending || verify.isSuccess}
                    onClick={() =>
                      verify.mutate(undefined, {
                        onSuccess: () => toast.success('Check your inbox for the link.'),
                        onError: (err) => toast.error(serverVerdict(err)),
                      })
                    }
                  />
                ),
            },
          ]}
        />
      </RdCard>

      <RdCard
        title="This browser"
        note="How the portal moves in this browser — saved here only, so another device keeps its own choice."
      >
        <MotionSwitch />
      </RdCard>

      <RdCard title="Sessions" note="Signed in somewhere you should not be?" tone="danger">
        <div className="rd-buttons" data-align="start">
          <Button
            variant="destructive"
            size="md"
            icon={<LogOut size={15} />}
            onClick={() => setConfirming(true)}
          >
            Sign out everywhere
          </Button>
        </div>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Sign out of every device?"
          entity={me.emailDisplay}
          consequence="Every session of yours ends, including this one."
          confirmLabel="Sign out everywhere"
          destructive
          closeOnSuccess={false}
          onConfirm={async () => {
            try {
              await everywhere.mutateAsync();
            } catch (err) {
              toast.error(serverVerdict(err));
              // Keep the dialog open, as before: the sign-out did not happen.
              throw err;
            }
            window.location.assign('/login');
          }}
        />
      </RdCard>
    </div>
  );
}
