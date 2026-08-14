'use client';

import { useState, type ReactElement } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorNote,
} from '@skydrop/ui/components';
import { useLogoutAllSessions } from '@/lib/account-hooks';
import { serverVerdict } from '@/lib/server-verdict';

/**
 * Sign out of every device.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * A staff session survives as a `__Host-staffRefresh` cookie on each
 * browser it was created in, for as long as that token lives. Until
 * this screen, the only way to kill the one on a lost laptop or a
 * shared machine was a full password reset — the confirm path revokes
 * refresh tokens as a side effect. Changing your password to end a
 * session you can no longer reach is a workaround, and it teaches
 * people that "I left myself signed in somewhere" is a big deal to
 * fix. `POST /auth/staff/logout-all` has been on the server all along.
 *
 * ── IT ENDS THIS SESSION TOO ─────────────────────────────────────────
 * The handler revokes EVERY unrevoked refresh row for the staff user
 * and clears this browser's cookie on the way out — there is no
 * "other devices only" variant, and pretending otherwise in the copy
 * would be a lie the operator discovers one click later. So the
 * confirmation says so, and success is a terminal panel rather than a
 * screen that carries on as if it still had a session.
 *
 * ── NO PERMISSION GATE (FE-2) ────────────────────────────────────────
 * The endpoint is `@StaffSelfService()` — every authenticated staff
 * member may end their own sessions. There is nothing for the UI to
 * mirror, so nothing is hidden. Whatever the server refuses is shown
 * back in the server's own words via `serverVerdict`.
 */
export function SessionRevocationCard(): ReactElement {
  const logoutAll = useLogoutAllSessions();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokedCount, setRevokedCount] = useState<number | null>(null);

  async function run(): Promise<void> {
    setError(null);
    try {
      const result = await logoutAll.mutateAsync();
      setConfirming(false);
      setRevokedCount(result.revokedCount);
    } catch (err) {
      setConfirming(false);
      setError(serverVerdict(err, 'Could not end your sessions.'));
    }
  }

  // Terminal state. We deliberately do NOT auto-redirect: the count is
  // the only evidence of what happened, and a screen that vanishes
  // after half a second leaves the person unsure whether the sessions
  // they were worried about were among them.
  if (revokedCount !== null) {
    return (
      <Card>
        <CardHeader
          title="Signed out everywhere"
          subtitle="This browser included — the refresh cookie has been cleared."
        />
        <CardBody>
          <p className="text-text-bright text-sm">
            {revokedCount === 1
              ? '1 session ended.'
              : `${String(revokedCount)} sessions ended, this one among them.`}
          </p>
          <p className="text-text-muted mt-1.5 text-xs">
            Any other browser still showing the console will be sent to the sign-in page the moment
            it asks the server for anything.
          </p>
          <div className="mt-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                // Hard navigation, matching the shell's sign-out: SSR
                // re-runs clean and the in-memory access token (FE-1)
                // dies with the page.
                window.location.assign('/login');
              }}
            >
              Sign in again
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        tone="critical"
        title="Sessions"
        subtitle="Every browser you have signed in from holds its own session."
        action={
          <Button
            variant="destructive"
            size="md"
            disabled={logoutAll.isPending}
            onClick={() => setConfirming(true)}
          >
            {logoutAll.isPending ? 'Signing out…' : 'Sign out everywhere'}
          </Button>
        }
      />
      <CardBody>
        <p className="text-text-body text-sm leading-relaxed">
          Ends every session for your account at once — a lost laptop, a shared machine, a browser
          you cannot get back to. <span className="text-text-bright">Including this one:</span> you
          will be returned to the sign-in page and will need your password again.
        </p>
        <p className="text-text-muted mt-2 text-xs leading-relaxed">
          Do this the moment a device goes missing. It does not change your password, so if you also
          think someone knows it, change that too.
        </p>
        {error !== null && <ErrorNote className="mt-3" message={error} retry={() => void run()} />}
      </CardBody>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Sign out of every device?"
        description="This ends every session for your account, including the one you are using right now. You will be signed out here and will need your password to get back in. Sessions on other devices stop working immediately."
        confirmLabel={logoutAll.isPending ? 'Signing out…' : 'Sign out everywhere'}
        confirmVariant="destructive"
        disabled={logoutAll.isPending}
        onConfirm={() => void run()}
      />
    </Card>
  );
}
