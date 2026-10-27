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
import { useT } from '@/i18n/client';

export function AccountSecurityView(): ReactElement {
  const t = useT();
  const me = useAccountIdentity();
  const toast = useToast();
  const verify = useRequestEmailVerification();

  async function onVerify(): Promise<void> {
    try {
      await verify.mutateAsync();
      // Nothing changes here until the link is clicked, so "sent" is
      // the whole honest outcome — refetching would show the same
      // "not verified" and read as a failure.
      toast.success(t('accountAccountSecurityView.sentCheckYourInboxThe'));
    } catch (e) {
      toast.error(serverVerdict(e, t('accountAccountSecurityView.couldNotSendAVerification')));
    }
  }

  return (
    <AcPage width="narrow">
      <AcHeader
        title={t('accountAccountSecurityView.yourAccount')}
        subtitle={t('accountAccountSecurityView.whoYouAreSignedIn')}
      />

      <AcCard
        title={t('accountAccountSecurityView.signedInAs')}
        note={t('accountAccountSecurityView.readFromTheApiEach')}
      >
        {me.isLoading ? (
          <SkeletonRows
            rows={3}
            cols={2}
            label={t('accountAccountSecurityView.loadingYourAccount')}
          />
        ) : me.isError ? (
          <ErrorState
            message={serverVerdict(
              me.error,
              t('accountAccountSecurityView.couldNotLoadYourAccount'),
            )}
            retry={() => void me.refetch()}
          />
        ) : me.data === undefined ? (
          // A 200 with nothing in it is not a state the API can
          // produce; saying so beats rendering an empty grid that
          // reads as "you have no email address".
          <ErrorState
            message={t('accountAccountSecurityView.theServerAnsweredWithoutAn')}
            retry={() => void me.refetch()}
          />
        ) : (
          <AcDl
            columns={2}
            items={[
              { label: t('accountAccountSecurityView.email'), value: me.data.emailDisplay },
              { label: t('accountAccountSecurityView.role'), value: me.data.roleName },
              {
                label: t('accountAccountSecurityView.emailVerified'),
                value:
                  me.data.emailVerifiedAt === null ? (
                    // Showing the problem without offering the fix is
                    // what this page did before: the request endpoint
                    // existed and nothing called it.
                    <span className="ac-inline">
                      <StatusChip
                        kind="pending"
                        label={t('accountAccountSecurityView.notVerified')}
                        size="sm"
                      />
                      <AsyncButton
                        variant="ghost"
                        size="sm"
                        icon={<MailCheck size={14} />}
                        state={verify.isPending ? 'busy' : 'idle'}
                        labels={{
                          idle: t('accountAccountSecurityView.sendANewLink'),
                          busy: t('accountAccountSecurityView.sending'),
                        }}
                        onClick={() => void onVerify()}
                      />
                    </span>
                  ) : (
                    <span className="sk-figure">{formatWhen(me.data.emailVerifiedAt)}</span>
                  ),
              },
              {
                label: t('accountAccountSecurityView.permissionsHeld'),
                value: <span className="sk-figure">{`${me.data.permissions.length}`}</span>,
              },
              {
                // The single most useful line on the page: an
                // hour you do not recognise is the reason somebody
                // came looking for the button below.
                label: t('accountAccountSecurityView.lastSignIn'),
                value: (
                  <span className="sk-figure">
                    {me.data.lastLoginAt === null ? '—' : formatWhen(me.data.lastLoginAt)}
                  </span>
                ),
              },
              {
                label: t('accountAccountSecurityView.accountCreated'),
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
        title={t('accountAccountSecurityView.thisBrowser')}
        note={t('accountAccountSecurityView.howTheConsoleMovesIn')}
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
