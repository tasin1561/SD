import type { ReactElement } from 'react';
import { StaffManagementIndex } from './_components/staff-management-index';

/**
 * Phase 1B — admin staff management.
 *
 * Two cards:
 *   1. Active staff users (list + role change + deactivate)
 *   2. Pending invitations (list + invite + resend + revoke)
 *
 * SUPER_ADMIN-only on the server; the UI surfaces are not
 * pre-empted client-side (FE-2 — the server is the boundary), so
 * a non-SUPER_ADMIN seeing this page gets a 403 verbatim on action.
 */
export default function StaffPage(): ReactElement {
  return <StaffManagementIndex />;
}
