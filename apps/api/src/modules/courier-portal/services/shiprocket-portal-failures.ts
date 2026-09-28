import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import type { SystemIssueService } from '../../system-issues/services/system-issue.service';
import {
  ShiprocketPortalChallengeError,
  ShiprocketPortalCredentialsMissingError,
  ShiprocketPortalEgressError,
  ShiprocketPortalSignInRejectedError,
} from './shiprocket-portal-session.service';

export type ShiprocketOpenFailure = 'CHALLENGE' | 'NO_LOGIN' | 'REJECTED' | 'EGRESS' | 'FAILED';

/**
 * What every Shiprocket panel job does when it cannot sign in — shared so
 * the wallet sync and the invoice check raise the SAME issues. The
 * challenge key in particular must be one key: an OTP or captcha met by
 * either stops both until a person clears it, and two keys would let one
 * job keep knocking while the other waits.
 */
export async function raiseShiprocketOpenFailure(
  issues: SystemIssueService,
  opts: {
    readonly source: string;
    readonly account: { readonly id: string; readonly label: string };
    readonly err: unknown;
    /** The job's own failure key, for anything that is not a challenge or a missing login. */
    readonly failureKey: string;
  },
): Promise<{ readonly outcome: ShiprocketOpenFailure; readonly message: string }> {
  const { account, err, source } = opts;
  if (err instanceof ShiprocketPortalChallengeError) {
    await issues.raise({
      kind: SystemIssueKind.COURIER_PORTAL_CHALLENGE,
      severity: SystemIssueSeverity.HIGH,
      title: `Shiprocket panel asked ${account.label} for a ${err.challenge} — automation stopped`,
      detail:
        `Signing in to app.shiprocket.in stopped at a ${err.challenge} challenge (${err.url}). ` +
        'Nothing will try again until this issue is resolved. Sign in once by hand from a ' +
        'browser using the Bangalore tunnel, then resolve this issue.' +
        (err.artifactPath === null ? '' : ` Screenshot on the server: ${err.artifactPath}`),
      source,
      dedupeKey: `shiprocket-portal-challenge:${account.id}`,
      metadata: { courierAccountId: account.id, challenge: err.challenge, url: err.url },
    });
    return { outcome: 'CHALLENGE', message: err.message };
  }
  if (err instanceof ShiprocketPortalSignInRejectedError) {
    /*
      Its OWN issue, not the generic "could not sign in" one.

      A person reading that one goes and checks the tunnel and the
      password, and here both are fine — Shiprocket accepted the
      credentials and then refused the session. Filing it under the same
      key would send somebody to re-check the two things that are not
      wrong, which is what happened for five days. HIGH, because nothing
      we do makes it work: it is a call to their account manager.
    */
    await issues.raise({
      kind: SystemIssueKind.COURIER_PORTAL_CHALLENGE,
      severity: SystemIssueSeverity.HIGH,
      title: `Shiprocket accepted ${account.label}'s login and would not open the panel`,
      detail:
        `${err.message}\n\nThis is theirs, not ours — the tunnel, the password and the API are ` +
        'all fine (the nightly cost sync still reads their API every night). Ask Shiprocket ' +
        'why a successful sign-in is being bounced for this account. Costs stop updating ' +
        'meanwhile and read as uncovered in the P&L, not as free.',
      source,
      dedupeKey: `shiprocket-portal-rejected:${account.id}`,
      metadata: { courierAccountId: account.id, url: err.url },
    });
    return { outcome: 'REJECTED', message: err.message };
  }
  if (err instanceof ShiprocketPortalEgressError) {
    /*
      Its own key again, for the same reason as REJECTED: the generic
      "could not sign in" issue sends somebody to check a password and a
      tunnel, and here neither was even reached. Nothing signed in, so
      nothing was spent — this is the cheap failure, and it should read
      that way.
    */
    await issues.raise({
      kind: SystemIssueKind.COURIER_COST_SYNC,
      severity: SystemIssueSeverity.HIGH,
      title: `Shiprocket panel reads are stopped for ${account.label} — the egress is wrong`,
      detail:
        `${err.message}\n\nOn the app server: \`systemctl status shiprocket-vpn\` and ` +
        '`shiprocket-vpn status`. Costs stop updating meanwhile and read as uncovered in the ' +
        'P&L, not as free. docs/infrastructure.md has the restart and the rollback.',
      source,
      dedupeKey: `shiprocket-portal-egress:${account.id}`,
      metadata: {
        courierAccountId: account.id,
        reason: err.reason,
        publicIp: err.reading?.publicIp ?? null,
        country: err.reading?.country ?? null,
      },
    });
    return { outcome: 'EGRESS', message: err.message };
  }
  if (err instanceof ShiprocketPortalCredentialsMissingError) {
    await issues.raise({
      kind: SystemIssueKind.COURIER_CREDENTIAL,
      severity: SystemIssueSeverity.MEDIUM,
      title: `${account.label} has no Shiprocket website login stored`,
      detail: err.message,
      source,
      dedupeKey: `shiprocket-portal-login:${account.id}`,
      metadata: { courierAccountId: account.id },
    });
    return { outcome: 'NO_LOGIN', message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  await issues.raise({
    kind: SystemIssueKind.COURIER_COST_SYNC,
    severity: SystemIssueSeverity.MEDIUM,
    title: `Could not sign in to ${account.label}'s Shiprocket panel`,
    detail: `${message.slice(0, 400)}\n\nThe tunnel (shiprocket-egress-tunnel.service) and the login are the usual causes.`,
    source,
    dedupeKey: opts.failureKey,
    metadata: { courierAccountId: account.id, error: message.slice(0, 500) },
  });
  return { outcome: 'FAILED', message };
}

/**
 * The counterpart of `raiseShiprocketOpenFailure`: the panel opened, so
 * every issue that says it could not is no longer true.
 *
 * ── WHY THIS IS SHARED, AND WHY IT EXISTS AT ALL ─────────────────────
 * These keys were raised from one place and cleared from ANOTHER — only
 * `ShiprocketPortalProbeService` resolved them, so a wallet sync that
 * signed in perfectly left `shiprocket-portal-rejected` open, saying
 * HIGH and in so many words "ask Shiprocket why a successful sign-in is
 * being bounced". Measured on 2026-09-29: the fix worked, 176 stored
 * transactions proved it, and that issue was still on /system-issues
 * pointing a person at their account manager. **An issue raised by a
 * shared helper must be cleared by a shared helper** — anything else
 * clears on whichever job happens to run, which is a coin toss.
 *
 * The CHALLENGE key is deliberately NOT here: an OTP or captcha stops
 * both jobs before a browser is even opened (they short-circuit on it),
 * so it is never reached from a success and is cleared by the probe,
 * which is the run a person triggers after answering one.
 */
export async function clearShiprocketOpenFailures(
  issues: SystemIssueService,
  accountId: string,
  note: string,
): Promise<void> {
  for (const key of [
    `shiprocket-portal-login:${accountId}`,
    `shiprocket-portal-rejected:${accountId}`,
    `shiprocket-portal-egress:${accountId}`,
  ]) {
    await issues.resolveByKey(key, note);
  }
}
