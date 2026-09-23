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
import { serverVerdict } from '@/lib/server-verdict';
import { useLogoutEverywhere, useRequestEmailVerification } from '@/lib/session-hooks';
import { SetCallout, SetFact, SetPageHeader } from '../../_components/settings-parts';

const CRUMBS = [
  { label: 'Seller console' },
  { label: 'Account' },
  { label: 'Settings', href: '/settings' },
  { label: 'Sign-in & sessions' },
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
      toast.success('Sent. Check your inbox — the link confirms this address.');
    } catch (e) {
      setError(serverVerdict(e, 'Could not send a verification link.'));
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
      setError(serverVerdict(e, 'Could not end your sessions.'));
    }
  }

  return (
    <div className="set-page">
      <SetPageHeader
        crumbs={CRUMBS}
        title="Sign-in & sessions"
        subtitle="Who this browser is signed in as, and how to end every session for this account at once."
        /*
          The comps put a session count and a last-seen location here.
          The API exposes no read over `seller_refresh_tokens`, so
          neither exists — these are the two standing facts that do.
        */
        meta={
          identity === null ? undefined : (
            <span className="set-meta">
              <SetFact tone={identity.emailVerifiedAt === null ? 'warn' : 'good'} dot>
                {identity.emailVerifiedAt === null ? 'Email not verified' : 'Email verified'}
              </SetFact>
              <SetFact>{identity.roleName}</SetFact>
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
              Try again
            </Button>
          }
        >
          <p>{error}</p>
        </SetCallout>
      )}

      <section className="set-section">
        <SectionHeading
          title="This session"
          note="What the server says about the person signed in here."
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
                <dt>Signed in as</dt>
                <dd>{identity.fullName}</dd>
                <dt>Email</dt>
                <dd>
                  <span className="sk-ident">{identity.emailDisplay}</span>
                  {identity.emailVerifiedAt === null && (
                    <span className="set-faint"> — not verified</span>
                  )}
                </dd>
                <dt>Role</dt>
                <dd>{identity.roleName}</dd>
                <dt>Company</dt>
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
                        idle: 'Send me a new link',
                        busy: 'Sending…',
                        done: 'Sent',
                        error: 'Not sent',
                      }}
                      disabled={verify.isPending}
                      onAction={onVerify}
                    />
                  }
                >
                  <p>
                    We have not confirmed this address yet. The link may have been filtered, or sent
                    before you finished setting up — either way you can have another.
                  </p>
                </SetCallout>
              )}
            </>
          )}
        </div>
      </section>

      <section className="set-section">
        <SectionHeading title="Sign out everywhere" note="Every device, including this one." />
        {revokedCount === null ? (
          <div className="set-card" data-tone="danger">
            <SetCallout tone="critical" icon={<ShieldAlert size={15} />}>
              <p>
                Use this when a device is out of your hands, or when the same login has been used on
                machines you can no longer account for. Every browser and app signed in as{' '}
                <span className="sk-ident set-strong">
                  {identity?.emailDisplay ?? 'this account'}
                </span>{' '}
                is signed out.
              </p>
            </SetCallout>
            <p className="set-muted">
              That includes this one — you will sign in again straight after. It does not change
              your password, and it does not touch API keys: a key is a separate credential and is
              revoked on the{' '}
              <Link href="/settings/api-keys" className="set-link">
                API keys
              </Link>{' '}
              page.
            </p>
            <div className="set-buttons" data-align="start">
              <Button
                variant="destructive"
                size="md"
                icon={<ShieldAlert size={15} />}
                onClick={() => setConfirmOpen(true)}
                disabled={logoutAll.isPending}
              >
                {logoutAll.isPending ? 'Ending sessions…' : 'Sign out everywhere'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="set-card" aria-live="polite">
            <SetCallout tone="good" icon={<CircleCheck size={15} />} title="Sessions ended">
              <p>
                {/* The server's own count, not a claim of our own. Zero is
                    reported as zero rather than dressed up as success —
                    if nothing was revoked, that is the fact worth seeing. */}
                {revokedCount === 0
                  ? 'The server reported no active sessions to revoke.'
                  : `${revokedCount} ${revokedCount === 1 ? 'session was' : 'sessions were'} revoked.`}
              </p>
              <p className="set-callout__aside">
                This browser&apos;s session was ended too. Sign in again to carry on.
              </p>
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
                Sign in again
              </Button>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out everywhere?"
        entity={identity?.emailDisplay ?? 'This account'}
        entityIsIdentifier={identity !== null}
        consequence="Every device signed in as this account is signed out, including this one. Anyone using the account will need to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        onConfirm={onConfirm}
      />
    </div>
  );
}
