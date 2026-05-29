/**
 * FE-2 boundary — god-mode force-mutation. The most important FE-2
 * test in the suite.
 *
 * The escalating chrome (red panel → red checkboxes → 30-char reason
 * counter → risk-ack checkbox → typed "FORCE-MUTATE" confirm) is
 * GRAVITY for the operator. None of it is enforcement — the SERVER
 * is the gate. This file pins both:
 *
 *   (a) The gravity chrome works: submit is disabled until reason ≥
 *       30 chars + ack is checked + at least one mutation is staged;
 *       the typed-confirm gate refuses anything but the literal
 *       'FORCE-MUTATE'.
 *
 *   (b) When the server REJECTS with a guardrail code (e.g.,
 *       FORCE_MUTATION_REASON_TOO_SHORT — possible if the trimmed
 *       reason crosses the threshold differently than the UI's
 *       counter), the UI displays the verdict VERBATIM. The UI's
 *       counter is UX guidance; the SERVER is the law.
 *
 * This is the codified guard against a future refactor that
 * accidentally moves enforcement client-side — exactly the
 * FE-2-erosion mode that the test exists to prevent.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForceMutationDialog } from '@/app/(authed)/orders/_components/force-mutation-dialog';
import { buildFetchMock, renderWithProviders } from './helpers';
import type { OrderView } from '@skydrop/api-client';

function mockOrder(): OrderView {
  return {
    id: 'order-1',
    orderNumber: 'SD-2026-22-000001',
    sellerOrderRef: 'SOR-1',
    sellerId: 'seller-1',
    status: 'PENDING_CONFIRMATION' as OrderView['status'],
    source: 'MANUAL' as OrderView['source'],
    recipientName: 'Asha Verma',
    recipientPhoneE164: '+919876543210',
    recipientAltPhoneE164: null,
    recipientEmail: 'asha@example.com',
    recipientAddressLine1: '12 MG Road',
    recipientAddressLine2: null,
    recipientLandmark: null,
    recipientCity: 'Bengaluru',
    recipientStateProvince: 'Karnataka',
    recipientPostalCode: '560001',
    recipientCountryCode: 'IN',
    paymentMode: 'COD' as OrderView['paymentMode'],
    codAmountInr: '999.00',
    declaredValueInr: '900.00',
    totalWeightGrams: 500,
    packageType: 'BOX' as OrderView['packageType'],
    isUrgent: false,
    isHighRisk: false,
    hasAdminOverride: false,
    sellerNotes: null,
    internalNotes: null,
    callNotes: null,
    cancellationReason: null,
    cancelledAt: null,
    placedAt: '2026-05-26T00:00:00.000Z',
    expectedDeliveryAt: null,
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
    items: [],
  };
}

describe('FE-2 boundary — god-mode force-mutation', () => {
  it('escalating gravity: submit stays disabled until ALL of reason≥30, ack=true, ≥1 mutation staged', async () => {
    const user = userEvent.setup();
    const onOpenChange = (): void => undefined;
    const onSuccess = (): void => undefined;
    renderWithProviders(
      <ForceMutationDialog
        open={true}
        onOpenChange={onOpenChange}
        order={mockOrder()}
        onSuccess={onSuccess}
      />,
    );

    const cta = screen.getByRole('button', { name: /Continue → confirmation/i });
    expect(cta).toBeDisabled(); // nothing staged yet

    // Stage a mutation (toggle the "Force order status" checkbox).
    await user.click(screen.getByLabelText(/Force order status/i));
    expect(cta).toBeDisabled(); // still no reason / ack

    // Type a short reason (< 30).
    const reason = screen.getByLabelText(/Justification/i);
    await user.type(reason, 'short');
    expect(cta).toBeDisabled();

    // Pad to ≥ 30.
    await user.type(reason, 'iiiiiiiiiiiiiiiiiiiiiiiiiii');
    expect(cta).toBeDisabled(); // still no ack

    // Tick the risk-ack checkbox.
    await user.click(screen.getByRole('checkbox', { name: /I acknowledge the data-integrity risk/i }));
    expect(cta).not.toBeDisabled(); // all three gates open
  });

  it("typed-confirm gate: 'Force-mutate this order' button stays disabled until the operator types exactly 'FORCE-MUTATE'", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ForceMutationDialog
        open={true}
        onOpenChange={() => undefined}
        order={mockOrder()}
        onSuccess={() => undefined}
      />,
    );

    // Get to the typed-confirm step.
    await user.click(screen.getByLabelText(/Force order status/i));
    await user.type(
      screen.getByLabelText(/Justification/i),
      'this is a long-enough reason for the override',
    );
    await user.click(
      screen.getByRole('checkbox', { name: /I acknowledge the data-integrity risk/i }),
    );
    await user.click(screen.getByRole('button', { name: /Continue → confirmation/i }));

    // The typed-confirm input must equal the literal string.
    const submit = await screen.findByRole('button', {
      name: /Force-mutate this order/i,
    });
    expect(submit).toBeDisabled();

    const typedInput = screen.getByPlaceholderText('FORCE-MUTATE');
    await user.type(typedInput, 'FORCE-MUTATE-WRONG');
    expect(submit).toBeDisabled();

    await user.clear(typedInput);
    await user.type(typedInput, 'force-mutate'); // wrong case
    expect(submit).toBeDisabled();

    await user.clear(typedInput);
    await user.type(typedInput, 'FORCE-MUTATE');
    expect(submit).not.toBeDisabled();
  });

  it('server-rejection VERBATIM: server returns [FORCE_MUTATION_REASON_TOO_SHORT] → UI displays the verdict EXACTLY (no client-side pre-emption)', async () => {
    const user = userEvent.setup();

    // This is the load-bearing FE-2 boundary test for god-mode. The
    // UI's char counter showed ≥30 (so the operator wasn't blocked
    // client-side); the SERVER still rejected — e.g., because the
    // trim() collapsed the count differently or a future MIN_LEN
    // bump landed server-side and the client hasn't been redeployed.
    // The UI MUST surface the server's [code] + message verbatim,
    // not a generic "failed". This is what makes the operator able
    // to read what actually happened.
    const serverRejection = {
      code: 'FORCE_MUTATION_REASON_TOO_SHORT',
      message: 'reason must be at least 30 characters',
    };
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/admin\/orders\/order-1\/force-mutation$/,
        responses: [{ status: 400, body: serverRejection }],
      },
    ]);

    renderWithProviders(
      <ForceMutationDialog
        open={true}
        onOpenChange={() => undefined}
        order={mockOrder()}
        onSuccess={() => undefined}
      />,
      { fetchImpl },
    );

    // Get past the UI's gates (with a string that passes the local
    // counter — the SERVER will reject anyway).
    await user.click(screen.getByLabelText(/Force order status/i));
    await user.type(
      screen.getByLabelText(/Justification/i),
      'reasonable-looking reason that satisfies the client counter',
    );
    await user.click(
      screen.getByRole('checkbox', { name: /I acknowledge the data-integrity risk/i }),
    );
    await user.click(screen.getByRole('button', { name: /Continue → confirmation/i }));
    await user.type(screen.getByPlaceholderText('FORCE-MUTATE'), 'FORCE-MUTATE');
    await user.click(screen.getByRole('button', { name: /Force-mutate this order/i }));

    // The server's [code] + message render verbatim in the dialog.
    const verdict = await screen.findByText(/FORCE_MUTATION_REASON_TOO_SHORT/);
    expect(verdict.textContent).toContain('[FORCE_MUTATION_REASON_TOO_SHORT]');
    expect(verdict.textContent).toContain(serverRejection.message);

    // The dialog returns to the edit step so the operator can revise.
    // The Continue → confirmation button is back.
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Continue → confirmation/i }),
      ).toBeInTheDocument();
    });
  });

  it('happy path: server 200 with reserveOutcomes → onSuccess called with the full ForceMutationResult (verbatim from the server)', async () => {
    const user = userEvent.setup();

    const serverResult = {
      orderId: 'order-1',
      fromStatus: 'PENDING_CONFIRMATION',
      status: 'CONFIRMED',
      hasAdminOverride: true,
      fieldChangesApplied: [],
      reserveOutcomes: [
        { orderItemId: 'item-1', ok: true, reservationId: 'res-1' },
        { orderItemId: 'item-2', ok: false, error: 'INSUFFICIENT_STOCK' },
      ],
    };
    const fetchImpl = buildFetchMock([
      {
        match: /\/api\/admin\/orders\/order-1\/force-mutation$/,
        responses: [{ status: 200, body: serverResult }],
      },
    ]);

    let captured: unknown = null;
    renderWithProviders(
      <ForceMutationDialog
        open={true}
        onOpenChange={() => undefined}
        order={mockOrder()}
        onSuccess={(r) => {
          captured = r;
        }}
      />,
      { fetchImpl },
    );

    await user.click(screen.getByLabelText(/Force order status/i));
    await user.type(
      screen.getByLabelText(/Justification/i),
      'reason that is long enough to clear the threshold gate',
    );
    await user.click(
      screen.getByRole('checkbox', { name: /I acknowledge the data-integrity risk/i }),
    );
    await user.click(screen.getByRole('button', { name: /Continue → confirmation/i }));
    await user.type(screen.getByPlaceholderText('FORCE-MUTATE'), 'FORCE-MUTATE');
    await user.click(screen.getByRole('button', { name: /Force-mutate this order/i }));

    await waitFor(() => {
      expect(captured).not.toBeNull();
    });
    // The UI receives the server's response object verbatim — INCL.
    // the reserveOutcomes array. The OverrideResultPanel renders
    // them; we don't recompute them client-side.
    expect(captured).toEqual(serverResult);
  });
});
