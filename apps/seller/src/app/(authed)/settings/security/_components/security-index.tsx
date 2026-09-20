'use client';

import { useState, type ReactElement } from 'react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { useSellerIdentity } from '@skydrop/auth/client';
import {
  BandBody,
  Button,
  ConfirmDialog,
  Crumbs,
  ErrorNote,
  MetaChip,
  PageHeader,
  SectionBand,
  Skeleton,
  useToast,
} from '@skydrop/ui/components';
import { serverVerdict } from '@/lib/server-verdict';
import { useLogoutEverywhere, useRequestEmailVerification } from '@/lib/session-hooks';

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
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Crumbs items={CRUMBS} Link={Link} />}
        title="Sign-in & sessions"
        subtitle="Who this browser is signed in as, and how to end every session for this account at once."
        /*
          The comps put a session count and a last-seen location here.
          The API exposes no read over `seller_refresh_tokens`, so
          neither exists — these are the two standing facts that do.
        */
        meta={
          identity === null ? undefined : (
            <>
              <MetaChip tone={identity.emailVerifiedAt === null ? 'warn' : 'good'} dot>
                {identity.emailVerifiedAt === null ? 'Email not verified' : 'Email verified'}
              </MetaChip>
              <MetaChip>{identity.roleName}</MetaChip>
            </>
          )
        }
      />

      {error !== null && <ErrorNote message={error} retry={() => setConfirmOpen(true)} />}

      <div>
        <SectionBand
          index="01"
          title="This session"
          note="What the server says about the person signed in here."
        />
        <BandBody>
          {identity === null ? (
            // Non-null by SSR construction inside (authed); the skeleton
            // is for the frame before the provider hydrates, and it is
            // shaped like the list so the panel does not jump.
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i}>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="mt-1.5 h-4 w-40" />
                </div>
              ))}
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-[minmax(84px,36%)_1fr] gap-x-3 gap-y-2 text-sm sm:grid-cols-[180px_1fr] sm:gap-x-6">
                <dt className="text-text-muted">Signed in as</dt>
                <dd className="text-text-body">{identity.fullName}</dd>
                <dt className="text-text-muted">Email</dt>
                <dd className="text-text-body font-mono text-xs break-all">
                  {identity.emailDisplay}
                  {identity.emailVerifiedAt === null && (
                    <span className="text-[var(--status-pending-fg)]"> — not verified</span>
                  )}
                </dd>
                <dt className="text-text-muted">Role</dt>
                <dd className="text-text-body">{identity.roleName}</dd>
                <dt className="text-text-muted">Company</dt>
                <dd className="text-text-body">{identity.companyName}</dd>
              </dl>
              {identity.emailVerifiedAt === null && (
                <div className="border-border bg-surface-raised mt-3 rounded-[var(--radius-2)] border p-3">
                  <p className="text-text-muted text-sm">
                    We have not confirmed this address yet. The link may have been filtered, or sent
                    before you finished setting up — either way you can have another.
                  </p>
                  <Button
                    className="mt-2"
                    variant="secondary"
                    size="sm"
                    disabled={verify.isPending}
                    onClick={() => void onVerify()}
                  >
                    {verify.isPending ? 'Sending…' : 'Send me a new link'}
                  </Button>
                </div>
              )}
            </>
          )}
        </BandBody>
      </div>

      <div>
        <SectionBand
          index="02"
          title="Sign out everywhere"
          note="Every device, including this one."
        />
        <BandBody>
          {revokedCount === null ? (
            <div className="flex items-start gap-3">
              <div className="text-critical mt-0.5 shrink-0">
                <ShieldAlert size={18} aria-hidden />
              </div>
              <div className="min-w-0 space-y-2">
                <p className="text-text-body text-sm leading-relaxed">
                  Use this when a device is out of your hands, or when the same login has been used
                  on machines you can no longer account for. Every browser and app signed in as{' '}
                  <span className="text-text-bright font-mono text-xs break-all">
                    {identity?.emailDisplay ?? 'this account'}
                  </span>{' '}
                  is signed out.
                </p>
                <p className="text-text-muted text-xs leading-relaxed">
                  That includes this one — you will sign in again straight after. It does not change
                  your password, and it does not touch API keys: a key is a separate credential and
                  is revoked on the{' '}
                  <Link
                    href="/settings/api-keys"
                    className="text-accent underline underline-offset-2"
                  >
                    API keys
                  </Link>{' '}
                  page.
                </p>
                <div className="pt-1">
                  <Button
                    variant="destructive"
                    size="md"
                    onClick={() => setConfirmOpen(true)}
                    disabled={logoutAll.isPending}
                  >
                    {logoutAll.isPending ? 'Ending sessions…' : 'Sign out everywhere'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="text-accent mb-1 font-mono text-[11px] tracking-[0.08em] uppercase">
                Sessions ended
              </div>
              <p className="text-text-bright text-sm font-medium">
                {/* The server's own count, not a claim of our own. Zero is
                    reported as zero rather than dressed up as success —
                    if nothing was revoked, that is the fact worth seeing. */}
                {revokedCount === 0
                  ? 'The server reported no active sessions to revoke.'
                  : `${revokedCount} ${revokedCount === 1 ? 'session was' : 'sessions were'} revoked.`}
              </p>
              <p className="text-text-muted mt-1 text-xs leading-relaxed">
                This browser&apos;s session was ended too. Sign in again to carry on.
              </p>
              <div className="pt-3">
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
            </>
          )}
        </BandBody>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Sign out everywhere?"
        description="Every device signed in as this account is signed out, including this one. Anyone using the account will need to sign in again."
        confirmLabel={logoutAll.isPending ? 'Ending sessions…' : 'Sign out everywhere'}
        confirmVariant="destructive"
        disabled={logoutAll.isPending}
        onConfirm={() => void onConfirm()}
      />
    </div>
  );
}
