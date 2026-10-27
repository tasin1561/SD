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
  const t = useT();
  const me = useStoreIdentity();
  const toast = useToast();
  const verify = useRequestEmailVerification();
  const everywhere = useSignOutEverywhere();
  const [confirming, setConfirming] = useState(false);
  if (me === null) return <></>;

  return (
    <div className="as-page" data-width="narrow">
      <PageHeader title={t('account.title')} subtitle={t('account.subtitle')} />

      {/* The pause belongs on this page too: somebody who finds the order
          form refusing them looks here next, and "your store did this"
          is the answer, not "something is broken". */}
      {ordersPaused(me) ? (
        <Notice tone="warn" title={t('account.paused.title')} role="status">
          <span>{t('account.paused.body')}</span>
        </Notice>
      ) : null}

      <Section title={t('account.you')}>
        <Facts
          items={[
            { label: t('account.name'), value: <span className="as-strong">{me.fullName}</span> },
            { label: t('common.email'), value: me.emailDisplay },
            { label: t('account.store'), value: (me.store.displayName ?? me.store.name) || '—' },
            // Every role held, not `roleKey` — that is the first grant, a
            // label, so somebody holding two would be told something
            // untrue about their own access.
            { label: t('account.roles'), value: me.roleNames.join(t('account.and')) || '—' },
            {
              label: t('account.whatYouSee'),
              value: seesOwnOnly(me) ? t('account.seesOwn') : t('account.seesAll'),
            },
            {
              label: t('account.emailConfirmed'),
              value:
                me.emailVerifiedAt !== null ? (
                  t('common.yes')
                ) : (
                  <AsyncButton
                    variant="secondary"
                    size="sm"
                    icon={<MailCheck size={14} />}
                    labels={{
                      idle: verify.isSuccess ? t('account.linkSent') : t('account.sendLink'),
                      busy: t('account.sending'),
                      error: t('account.notSent'),
                    }}
                    state={verify.isPending ? 'busy' : verify.isError ? 'error' : 'idle'}
                    disabled={verify.isPending || verify.isSuccess}
                    onClick={() =>
                      verify.mutate(undefined, {
                        onSuccess: () => toast.success(t('account.checkInbox')),
                        onError: (err) => toast.error(verdict(err, t)),
                      })
                    }
                  />
                ),
            },
          ]}
        />
      </Section>

      <Section title={t('account.browser.title')} note={t('account.browser.note')}>
        <MotionSwitch />
      </Section>

      <Section title={t('account.sessions.title')} note={t('account.sessions.note')}>
        <div className="as-row">
          <Button
            variant="destructive"
            size="md"
            icon={<LogOut size={15} />}
            onClick={() => setConfirming(true)}
          >
            {t('account.signOutAll')}
          </Button>
        </div>
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('account.signOutAll.title')}
          entity={me.emailDisplay}
          consequence={t('account.signOutAll.consequence')}
          confirmLabel={t('account.signOutAll')}
          destructive
          closeOnSuccess={false}
          onConfirm={async () => {
            try {
              await everywhere.mutateAsync();
            } catch (err) {
              toast.error(verdict(err, t));
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
