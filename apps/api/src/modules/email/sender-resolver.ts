import type { ResolvedSender } from './email.types';

/**
 * Maps a template code to the appropriate sender identity per the auth spec:
 *
 *   - security@skydrop.online — auth/security templates (password reset,
 *     email verification, login alerts, security alerts).
 *   - hello@skydrop.online    — everything else (invitations, welcome,
 *     order/shipment notifications, etc.).
 *
 * reply-to is always support@skydrop.online so user replies route to the
 * support inbox regardless of which mailbox sent the original.
 *
 * Display names give recipient inboxes a sensible sender name without
 * needing a per-template config field.
 */
const SECURITY_TEMPLATE_PATTERN = /\.(password_reset|email_verification|login_alert|security_alert)\./;

const SECURITY_FROM = 'Skydrop Security <security@skydrop.online>';
const HELLO_FROM = 'Skydrop <hello@skydrop.online>';
const REPLY_TO = 'Skydrop Support <support@skydrop.online>';

export function resolveSender(templateCode: string): ResolvedSender {
  return {
    from: SECURITY_TEMPLATE_PATTERN.test(templateCode) ? SECURITY_FROM : HELLO_FROM,
    replyTo: REPLY_TO,
  };
}
