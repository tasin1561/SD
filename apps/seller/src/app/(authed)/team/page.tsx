import type { ReactElement } from 'react';
import { TeamManagementIndex } from './_components/team-management-index';

/**
 * Seller team management.
 *
 * Two cards:
 *   1. Active team members (list + role change + deactivate)
 *   2. Pending invitations (list + invite + resend + revoke)
 *
 * Write paths are OWNER/ADMIN-only on the server; the UI does not
 * pre-empt (FE-2) — a non-OWNER/ADMIN sees the buttons and gets a
 * server 403 verbatim on click.
 */
export default function TeamPage(): ReactElement {
  return <TeamManagementIndex />;
}
