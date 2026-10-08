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
import { ordersPaused, seesOwnOnly } from '@/lib/orders-paused';
import { useRequestEmailVerification, useSignOutEverywhere } from '@/lib/store-hooks';
import { Facts, Notice, Section } from '../_components/parts';
import '../_components/as.css';

/**
 * The signed-in person's own account — open to everyone here, because it
 * is about themselves (NOTIF-11: a self-service surface must never sit
 * behind a grantable permission, or a key added today reaches no role
 * that already exists and bounces most people off their own page).
 *
 * It is also where the one per-PERSON preference lives: motion. There is
 * no store-settings screen in this portal to put it on, and it is a
 * choice about this browser rather than about the store.
 */
export default function AccountPage(): ReactElement {
  const me = useStoreIdentity();
  const toast = useToast();
  const verify = useRequestEmailVerification();
  const everywhere = useSignOutEverywhere();
  const [confirming, setConfirming] = useState(false);
  if (me === null) return <></>;

  return (
    <div className="as-page" data-width="narrow">
      <PageHeader title="My account" subtitle="Your own login for this store." />

      {/* The pause belongs on this page too: somebody who finds the order
          form refusing them looks here next, and "your store did this"
          is the answer, not "something is broken". */}
      {ordersPaused(me) ? (
        <Notice tone="warn" title="Your store has paused new orders from you" role="status">
          <span>
            You can still read, track and follow up everything you have already placed. Ask whoever
            runs your store to switch it back on.
          </span>
        </Notice>
      ) : null}

      <Section title="You">
        <Facts
          items={[
            { label: 'Name', value: <span className="as-strong">{me.fullName}</span> },
            { label: 'Email', value: me.emailDisplay },
            { label: 'Store', value: (me.store.displayName ?? me.store.name) || '—' },
            // Every role held, not `roleKey` — that is the first grant, a
            // label, so somebody holding two would be told something
            // untrue about their own access.
            { label: 'Roles', value: me.roleNames.join(' and ') || '—' },
            {
              label: 'What you see',
              value: seesOwnOnly(me)
                ? 'The orders and customers you placed'
                : 'Everything your store has placed',
            },
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
      </Section>

      <Section
        title="This browser"
        note="How the portal moves in this browser — saved here only, so another device keeps its own choice."
      >
        <MotionSwitch />
      </Section>

      <Section title="Sessions" note="Signed in somewhere you should not be?">
        <div className="as-row">
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
              // Keep the dialog open: the sign-out did not happen.
              throw err;
            }
            window.location.assign('/login');
          }}
        />
      </Section>
    </div>
  );
}
