/**
 * FE-2 boundary — seller suspend / reapprove.
 *
 * Two properties this file pins as a permanent guard against
 * regressions that would erode the boundary:
 *
 *   (a) The UI collects the action correctly: button → modal →
 *       confirm → request is fired with the right body.
 *
 *   (b) When the server rejects with an ApiError carrying a `code`,
 *       the UI surfaces `[code] message` VERBATIM rather than having
 *       pre-empted with a client-side error. This is the test that
 *       proves the UI is reading material, not law.
 *
 * Same role for the frontend boundary as the M12 commit 1 test
 * "fetchImpl EXACTLY ONCE" plays for the SSR non-rotation invariant.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusActionPanel } from '@/app/(authed)/sellers/_components/status-action-panel';
import { buildFetchMock, renderWithProviders, makeStaff } from './helpers';
import type { StaffRole } from '@skydrop/db';

describe('FE-2 boundary — seller status action', () => {
  it('SUSPENDED button: open modal → server-rejects with [INSUFFICIENT_ROLE] → UI displays the verdict verbatim (NOT pre-empted)', async () => {
    const user = userEvent.setup();

    // SERVER says no — this is exactly the kind of response the API
    // would return if/when the requireStaffRoles gate lands on the
    // status endpoint. The FE-2 contract: the UI shows what the
    // SERVER returned. It must NOT pre-empt with its own copy.
    const serverRejection = {
      code: 'INSUFFICIENT_ROLE',
      message: 'Role CALL_AGENT not permitted; required one of: SUPER_ADMIN, SELLER_APPROVAL_ADMIN',
    };
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/admin\/sellers\/seller-1\/status$/,
        responses: [{ status: 403, body: serverRejection }],
      },
    ]);

    renderWithProviders(
      <StatusActionPanel
        sellerId="seller-1"
        currentStatus="APPROVED"
        // canChangeStatus=true on the UI side — but the SERVER is the
        // real gate. The test verifies that even when the UI's
        // cosmetic gate has let the operator through, the server's
        // rejection comes through legibly.
        canChangeStatus={true}
      />,
      { fetchImpl },
    );

    // (a) UI collects: SUSPEND button → modal → reason → confirm
    await user.click(screen.getByRole('button', { name: /suspend account/i }));
    expect(await screen.findByText(/Suspend this seller\?/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/Reason \(optional/i), 'Customer-complaint-driven test');
    await user.click(screen.getByRole('button', { name: /^Suspend$/ }));

    // (b) The server's [code] + message render verbatim.
    const verdict = await screen.findByText(/INSUFFICIENT_ROLE/);
    expect(verdict.textContent).toContain('[INSUFFICIENT_ROLE]');
    expect(verdict.textContent).toContain(serverRejection.message);

    // The body the SUT actually sent: targetStatus + the reason.
    const calls = fetchImpl.mock.calls;
    const statusCall = calls.find((c) => /\/status$/.test(String(c[0])))!;
    expect(statusCall).toBeDefined();
    const init = statusCall[1] as RequestInit;
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body['targetStatus']).toBe('SUSPENDED');
    expect(body['reason']).toBe('Customer-complaint-driven test');

    // Modal stays OPEN (so the operator can read the error + retry).
    expect(screen.getByText(/Suspend this seller\?/i)).toBeInTheDocument();
  });

  it('cosmetic RBAC: canChangeStatus=false → SUSPEND button is disabled (UX hide-not-gate) — but the SERVER is still the real boundary', async () => {
    renderWithProviders(
      <StatusActionPanel sellerId="seller-1" currentStatus="APPROVED" canChangeStatus={false} />,
      {
        identity: makeStaff('CALL_AGENT' as StaffRole),
      },
    );

    const suspendBtn = screen.getByRole('button', { name: /suspend account/i });
    expect(suspendBtn).toBeDisabled();
    // The role-restriction note is shown to the operator.
    expect(screen.getByText(/Your role can/i)).toBeInTheDocument();
  });

  it('happy path: server 200 → modal closes', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/admin\/sellers\/seller-1\/status$/,
        responses: [
          {
            status: 200,
            body: { sellerId: 'seller-1', newStatus: 'SUSPENDED' },
          },
        ],
      },
    ]);

    renderWithProviders(
      <StatusActionPanel sellerId="seller-1" currentStatus="APPROVED" canChangeStatus={true} />,
      { fetchImpl },
    );

    await user.click(screen.getByRole('button', { name: /suspend account/i }));
    await user.click(screen.getByRole('button', { name: /^Suspend$/ }));

    // Modal closes — the dialog title disappears from the tree.
    await waitFor(() => {
      expect(screen.queryByText(/Suspend this seller\?/i)).not.toBeInTheDocument();
    });
  });
});
