'use client';

import type { ReactElement } from 'react';
import { MailCheck } from 'lucide-react';
import { useToast } from '@skydrop/ui/app/toast';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { MotionSwitch } from '@skydrop/ui/app/motion-switch';
import { SkeletonRows } from '@skydrop/ui/app/skeleton';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { StatusChip } from '@skydrop/ui/app/status-chip';
import { AcCard, AcDl, AcHeader, AcPage } from '../../settings/_components/ac-parts';
import { useAccountIdentity, useRequestEmailVerification } from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';
import { SessionRevocationCard } from './session-revocation-card';

export function AccountSecurityView(): ReactElement {
  const me = useAccountIdentity();
  const toast = useToast();
  const verify = useRequestEmailVerification();

  async function onVerify(): Promise<void> {
    try {
      await verify.mutateAsync();
      // Nothing changes here until the link is clicked, so "sent" is
      // the whole honest outcome — refetching would show the same
      // "not verified" and read as a failure.
      toast.success('Sent. Check your inbox — the link confirms this address.');
    } catch (e) {
      toast.error(serverVerdict(e, 'Could not send a verification link.'));
    }
  }

  return (
    <AcPage width="narrow">
      <AcHeader
        title="Your account"
        subtitle="Who you are signed in as, and how to end the sessions you are not sitting in front of."
      />

      <AcCard
        title="Signed in as"
        note="Read from the API each time this page opens, so the last sign-in below is current."
      >
        {me.isLoading ? (
          <SkeletonRows rows={3} cols={2} label="Loading your account…" />
        ) : me.isError ? (
          <ErrorState
            message={serverVerdict(me.error, 'Could not load your account.')}
            retry={() => void me.refetch()}
          />
        ) : me.data === undefined ? (
          // A 200 with nothing in it is not a state the API can
          // produce; saying so beats rendering an empty grid that
          // reads as "you have no email address".
          <ErrorState
            message="The server answered without an account. Reload, or sign in again."
            retry={() => void me.refetch()}
          />
        ) : (
          <AcDl
            columns={2}
            items={[
              { label: 'Email', value: me.data.emailDisplay },
              { label: 'Role', value: me.data.roleName },
              {
                label: 'Email verified',
                value:
                  me.data.emailVerifiedAt === null ? (
                    // Showing the problem without offering the fix is
                    // what this page did before: the request endpoint
                    // existed and nothing called it.
                    <span className="ac-inline">
                      <StatusChip kind="pending" label="Not verified" size="sm" />
                      <AsyncButton
                        variant="ghost"
                        size="sm"
                        icon={<MailCheck size={14} />}
                        state={verify.isPending ? 'busy' : 'idle'}
                        labels={{ idle: 'Send a new link', busy: 'Sending…' }}
                        onClick={() => void onVerify()}
                      />
                    </span>
                  ) : (
                    <span className="sk-figure">{formatWhen(me.data.emailVerifiedAt)}</span>
                  ),
              },
              {
                label: 'Permissions held',
                value: <span className="sk-figure">{`${me.data.permissions.length}`}</span>,
              },
              {
                // The single most useful line on the page: an
                // hour you do not recognise is the reason somebody
                // came looking for the button below.
                label: 'Last sign-in',
                value: (
                  <span className="sk-figure">
                    {me.data.lastLoginAt === null ? '—' : formatWhen(me.data.lastLoginAt)}
                  </span>
                ),
              },
              {
                label: 'Account created',
                value: <span className="sk-figure">{formatWhen(me.data.createdAt)}</span>,
              },
            ]}
          />
        )}
      </AcCard>

      {/* The one per-PERSON preference: how the console moves in this
          browser. Stored here only (localStorage), so another device keeps
          its own choice. */}
      <AcCard
        title="This browser"
        note="How the console moves in this browser — saved here only, so another device keeps its own choice."
      >
        <MotionSwitch />
      </AcCard>

      <SessionRevocationCard />
    </AcPage>
  );
}

/** Local timezone, because the person reading it is deciding whether
 *  they were awake at the time. */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : at.toLocaleString();
}
