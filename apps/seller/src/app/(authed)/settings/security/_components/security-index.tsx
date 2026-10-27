'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { CircleAlert, CircleCheck, MailWarning, ShieldAlert } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import { SectionHeading } from '@skydrop/ui/app/page-header';
import { Button } from '@skydrop/ui/app/button';
import { AsyncButton } from '@skydrop/ui/app/async-button';
import { ConfirmDialog } from '@skydrop/ui/app/dialog';
import { Skeleton } from '@skydrop/ui/app/skeleton';
import { useToast } from '@skydrop/ui/app/toast';
import { verdict } from '@/i18n/verdict';
import { roleLine, roleNamesOf } from '@/lib/role-words';
import { useLogoutEverywhere, useRequestEmailVerification } from '@/lib/session-hooks';
import { SetCallout, SetFact, SetPageHeader } from '../../_components/settings-parts';
import { useT } from '@/i18n/client';
import { richMessage } from '@/i18n/rich';
import type { Translate } from '@skydrop/ui/app/i18n';
import type { MessageKey } from '@/i18n/catalog';

const crumbsOf = (t: Translate<MessageKey>) => [
  { label: t('settingsSecurity.clientConsole') },
  { label: t('settingsSecurity.account') },
  { label: t('settingsSecurity.settings'), href: '/settings' },
  { label: t('settingsSecurity.signInSessions') },
];

/**
 * Sign-in & sessions.
 *
 * The one thing a person can do here is end every session for their
 * account at once. It exists for the case the rest of the app cannot
 * help with: a laptop left at a desk, a phone sold, a shared login that
 * has been typed into more machines than anybody remembers. Signing out
 * of THIS browser (the shell's Sign out) does nothing about any of them.
 *
 * There is no session LIST — the API exposes no read over
 * `seller_refresh_tokens`, so a list here would be invented. Rather
 * than show a plausible-looking table nobody can act on, the page says
 * plainly what it does and what it costs, and reports the count the
 * server actually revoked.
 */
export function SecurityIndex(): ReactElement {
  const t = useT();
  const identity = useSellerIdentity();
  const toast = useToast();
  const logoutAll = useLogoutEverywhere();
  const verify = useRequestEmailVerification();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokedCount, setRevokedCount] = useState<number | null>(null);

  async function onVerify(): Promise<void> {
    setError(null);
    try {
      await verify.mutateAsync();
      // No new state to show: the account is still unverified until the
      // link is clicked, so saying "sent" is the whole honest outcome.
      toast.success(t('settingsSecurity.sentCheckYourInbox'));
    } catch (e) {
      setError(verdict(e, t, t('settingsSecurity.couldNotSendA')));
      // Rethrown so the button shows the failure on itself.
      throw e;
    }
  }

  async function onConfirm(): Promise<void> {
    setError(null);
    try {
      const res = await logoutAll.mutateAsync();
      setConfirmOpen(false);
      setRevokedCount(res.revokedCount);
    } catch (e) {
      // FE-2 — the server's own words and its code, verbatim. A refusal
      // here is worth reading: it is the difference between "the network
      // dropped" and "this account is suspended".
      setConfirmOpen(false);
      setError(verdict(e, t, t('settingsSecurity.couldNotEndYour')));
    }
  }

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={crumbsOf(t)}
        title={t('settingsSecurity.signInSessions')}
        subtitle={t('settingsSecurity.whoThisBrowserIs')}
        /*
          The comps put a session count and a last-seen location here.
          The API exposes no read over `seller_refresh_tokens`, so
          neither exists — these are the two standing facts that do.
        */
        meta={
          identity === null ? undefined : (
            <span className="set-meta">
              <SetFact tone={identity.emailVerifiedAt === null ? 'warn' : 'good'} dot>
                {identity.emailVerifiedAt === null
                  ? t('settingsSecurity.emailNotVerified')
                  : t('settingsSecurity.emailVerified')}
              </SetFact>
              {/* EVERY role, not the first one. `roleName` is a label
                  the server keeps truthful; somebody who is Finance AND
                  Ops read as Finance on the page that tells them what
                  they are. */}
              <SetFact>{roleLine(identity, t('roleWords.noRole'))}</SetFact>
            </span>
          )
        }
      />

      {error !== null && (
        <SetCallout
          tone="critical"
          icon={<CircleAlert size={15} />}
          role="alert"
          action={
            <Button variant="secondary" size="sm" onClick={() => setConfirmOpen(true)}>
              {t('settingsSecurity.tryAgain')}
            </Button>
          }
        >
          <p>{error}</p>
        </SetCallout>
      )}

      <section className="set-section">
        <SectionHeading
          title={t('settingsSecurity.thisSession')}
          note={t('settingsSecurity.whatTheServerSays')}
        />
        <div className="set-card">
          {identity === null ? (
            // Non-null by SSR construction inside (authed); the skeleton
            // is for the frame before the provider hydrates, and it is
            // shaped like the list so the panel does not jump.
            <div className="set-skel-grid">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="set-skel-pair">
                  <Skeleton width={96} height={12} />
                  <Skeleton width={160} height={16} />
                </div>
              ))}
            </div>
          ) : (
            <>
              <dl className="set-dl">
                <dt>{t('settingsSecurity.signedInAs')}</dt>
                <dd>{identity.fullName}</dd>
                <dt>{t('settingsSecurity.email')}</dt>
                <dd>
                  <span className="sk-ident sk-ident--wrap">{identity.emailDisplay}</span>
                  {identity.emailVerifiedAt === null && (
                    <span className="set-faint">{t('settingsSecurity.notVerified')}</span>
                  )}
                </dd>
                <dt>
                  {roleNamesOf(identity).length === 1
                    ? t('settingsSecurity.role')
                    : t('settingsSecurity.roles')}
                </dt>
                <dd>{roleLine(identity, t('roleWords.noRole'))}</dd>
                <dt>{t('settingsSecurity.company')}</dt>
                <dd>{identity.companyName}</dd>
              </dl>
              {identity.emailVerifiedAt === null && (
                <SetCallout
                  tone="warn"
                  icon={<MailWarning size={15} />}
                  action={
                    <AsyncButton
                      variant="secondary"
                      size="sm"
                      labels={{
                        idle: t('settingsSecurity.sendMeANew'),
                        busy: t('settingsSecurity.sending'),
                        done: t('settingsSecurity.sent'),
                        error: t('settingsSecurity.notSent'),
                      }}
                      disabled={verify.isPending}
                      onAction={onVerify}
                    />
                  }
                >
                  <p>{t('settingsSecurity.weHaveNotConfirmed')}</p>
                </SetCallout>
              )}
            </>
          )}
        </div>
      </section>

      <section className="set-section">
        <SectionHeading
          title={t('settingsSecurity.signOutEverywhere')}
          note={t('settingsSecurity.everyDeviceIncludingThis')}
        />
        {revokedCount === null ? (
          <div className="set-card" data-tone="danger">
            <SetCallout tone="critical" icon={<ShieldAlert size={15} />}>
              <p>
                {richMessage(t('settingsSecurity.useThisWhenA'), {
                  span: (
                    <span className="sk-ident set-strong">
                      {identity?.emailDisplay ?? t('settingsSecurity.thisAccount')}
                    </span>
                  ),
                  t: t('settingsSecurity.isSignedOut'),
                })}
              </p>
            </SetCallout>
            <p className="set-muted">
              {richMessage(t('settingsSecurity.thatIncludesThisOne'), {
                link: (
                  <Link href="/settings/api-keys" className="set-link">
                    {t('settingsSecurity.apiKeys')}
                  </Link>
                ),
              })}
            </p>
            <div className="set-buttons" data-align="start">
              <Button
                variant="destructive"
                size="md"
                icon={<ShieldAlert size={15} />}
                onClick={() => setConfirmOpen(true)}
                disabled={logoutAll.isPending}
              >
                {logoutAll.isPending
                  ? t('settingsSecurity.endingSessions')
                  : t('settingsSecurity.signOutEverywhere')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="set-card" aria-live="polite">
            <SetCallout
              tone="good"
              icon={<CircleCheck size={15} />}
              title={t('settingsSecurity.sessionsEnded')}
            >
              <p>
                {/* The server's own count, not a claim of our own. Zero is
                    reported as zero rather than dressed up as success —
                    if nothing was revoked, that is the fact worth seeing. */}
                {revokedCount === 0
                  ? t('settingsSecurity.theServerReportedNo')
                  : t(
                      revokedCount === 1
                        ? 'settingsSecurity.sessionRevokedOne'
                        : 'settingsSecurity.sessionsRevokedMany',
                      { revokedCount },
                    )}
              </p>
              <p className="set-callout__aside">{t('settingsSecurity.thisBrowserSSession')}</p>
            </SetCallout>
            <div className="set-buttons" data-align="start">
              <Button
                variant="primary"
                size="md"
                // A full page load, not a router push: the access token
                // lives in memory only (FE-1), so reloading is what
                // actually clears it from this tab.
                onClick={() => window.location.assign('/login')}
              >
                {t('settingsSecurity.signInAgain')}
              </Button>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('settingsSecurity.signOutEverywhere2')}
        entity={identity?.emailDisplay ?? t('settingsSecurity.thisAccount2')}
        entityIsIdentifier={identity !== null}
        consequence={t('settingsSecurity.everyDeviceSignedIn')}
        confirmLabel={t('settingsSecurity.signOutEverywhere')}
        destructive
        onConfirm={onConfirm}
      />
    </div>
  );
}
