/**
 * "Invitation sent · <when>" on the lead drawer.
 *
 * `SellerInvitationListItem` declared `invitedAt`, and the API has never
 * sent that — it sends `createdAt`. A declared-but-absent field is
 * `undefined` at runtime, so the drawer rendered
 * `new Date(undefined).toLocaleString()`, which is the literal string
 * "Invalid Date", on every invitation anybody opened. Nothing threw:
 * the chip beside it was right, the expiry beside THAT was right, and
 * typecheck was reading a type that agreed with itself. Found by
 * filming it (O1, 2026-10-01).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@skydrop/ui/app/toast';

const LEAD = {
  id: 'lead-1',
  fullName: 'Farhana Akter',
  companyName: 'Jessore Jute Co',
  email: 'farhana@jessorejute.test',
  phone: '+8801711000412',
  altPhone: null,
  shippingDirection: 'BD_TO_IN',
  productTypes: 'Jute bags',
  monthlyOrders: '500-1000',
  message: 'We sell on Facebook.',
  status: 'NEW',
  notes: null,
  contactedAt: null,
  convertedSellerId: null,
  submissionCount: 1,
  createdAt: '2026-09-29T12:00:00.000Z',
  updatedAt: '2026-09-29T12:00:00.000Z',
};

/** Exactly what `GET /admin/seller-invitations` sends — no `invitedAt`. */
const INVITATION = {
  id: 'inv-1',
  email: LEAD.email,
  status: 'pending',
  createdAt: '2026-10-01T06:30:00.000Z',
  usedAt: null,
  expiresAt: '2026-10-08T06:30:00.000Z',
};

const idle = { isPending: false, mutateAsync: vi.fn() };

vi.mock('@/lib/api-hooks', () => ({
  useUpdateInviteLead: () => idle,
  useCreateInvitation: () => idle,
  useResendInvitation: () => idle,
  useSellerInvitationFor: () => ({ data: INVITATION }),
}));
vi.mock('@/lib/use-permission', () => ({ usePermission: () => true }));

import { LeadDrawer } from '../app/(authed)/leads/_components/lead-drawer';

function open(): void {
  render(
    <ToastProvider>
      <LeadDrawer lead={LEAD as never} onClose={() => undefined} />
    </ToastProvider>,
  );
}

describe('an invitation already sent', () => {
  it('says when it was issued, not "Invalid Date"', () => {
    open();
    const line = screen.getByText(/expires/i);
    expect(line.textContent ?? '').not.toContain('Invalid Date');
  });

  it('reads the date off the field the API actually sends', () => {
    open();
    const line = screen.getByText(/expires/i);
    // Whatever the runner's locale renders, it has to be THIS instant.
    expect(line.textContent ?? '').toContain(
      new Date(INVITATION.createdAt).toLocaleString(undefined, {}).split(',')[0],
    );
  });
});
