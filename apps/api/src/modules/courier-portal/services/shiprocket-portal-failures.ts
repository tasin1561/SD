import { SystemIssueKind, SystemIssueSeverity } from '@skydrop/db';
import type { SystemIssueService } from '../../system-issues/services/system-issue.service';
import {
  ShiprocketPortalChallengeError,
  ShiprocketPortalCredentialsMissingError,
} from './shiprocket-portal-session.service';

export type ShiprocketOpenFailure = 'CHALLENGE' | 'NO_LOGIN' | 'FAILED';

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
