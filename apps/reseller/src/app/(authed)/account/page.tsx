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
import { useT } from '@/i18n/client';
import { verdict } from '@/i18n/verdict';
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
  const t = useT();
  const me = useStoreIdentity();
  const toast = useToast();
  const verify = useRequestEmailVerification();
  const everywhere = useSignOutEverywhere();
  const [confirming, setConfirming] = useState(false);
  if (me === null) return <></>;

  return (
    <div className="rd-page" data-width="narrow">
      <PageHeader title={t('acct.title')} subtitle={t('acct.subtitle')} />
      <RdCard title={t('acct.you')}>
        <RdDl
          items={[
            { label: t('acct.name'), value: <span className="rd-strong">{me.fullName}</span> },
            { label: t('acct.email'), value: me.emailDisplay },
            // Every role held, not `roleName` — that is the first grant,
            // a label, so somebody who is Finance AND Owner would read
            // as one of the two and be told something untrue about their
            // own access.
            { label: t('acct.roles'), value: me.roleNames.join(t('acct.rolesJoin')) || '—' },
            {
              label: t('acct.verified'),
              value:
                me.emailVerifiedAt !== null ? (
                  t('acct.yes')
                ) : (
                  <AsyncButton
                    variant="secondary"
                    size="sm"
                    icon={<MailCheck size={14} />}
                    labels={{
                      idle: verify.isSuccess ? t('acct.linkSent') : t('acct.sendLink'),
                      busy: t('acct.sending'),
                      error: t('acct.notSent'),
                    }}
                    state={verify.isPending ? 'busy' : verify.isError ? 'error' : 'idle'}
                    disabled={verify.isPending || verify.isSuccess}
                    onClick={() =>
                      verify.mutate(undefined, {
                        onSuccess: () => toast.success(t('acct.checkInbox')),
                        onError: (err) => toast.error(verdict(err, t)),
                      })
                    }
                  />
                ),
            },
          ]}
        />
      </RdCard>

      <RdCard title={t('acct.browser.title')} note={t('acct.browser.note')}>
        <MotionSwitch />
      </RdCard>

      <RdCard title={t('acct.sessions.title')} note={t('acct.sessions.note')} tone="danger">
        <div className="rd-buttons" data-align="start">
          <Button
            variant="destructive"
            size="md"
            icon={<LogOut size={15} />}
            onClick={() => setConfirming(true)}
          >
            {t('acct.signOutAll')}
          </Button>
        </div>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('acct.confirm.title')}
          entity={me.emailDisplay}
          consequence={t('acct.confirm.consequence')}
          confirmLabel={t('acct.signOutAll')}
          destructive
          closeOnSuccess={false}
          onConfirm={async () => {
            try {
              await everywhere.mutateAsync();
            } catch (err) {
              toast.error(verdict(err, t));
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
