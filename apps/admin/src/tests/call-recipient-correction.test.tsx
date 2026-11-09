/**
 * The agent corrects the customer's details mid-call, and may only pick an
 * outcome once those edits are saved (owner, 2026-11-09). FE-2: a server
 * refusal is rendered verbatim.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PulledAssignment } from '@skydrop/api-client';
import { CallCenterStation } from '@/app/(authed)/call-center/_components/call-center-station';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

function assignment(addressLine1 = '12 MG Road'): PulledAssignment {
  return {
    assignmentId: '01a0f2a6-4f66-7bb0-9657-872a6237734b',
    orderId: 'order-1',
    scheduledAttempts: 1,
    assignedAt: '2026-11-09T10:00:00.000Z',
    callPurpose: { kind: 'CONFIRMATION' },
    openTickets: [],
    priorAttempts: [],
    seller: null,
    customerBrand: null,
    itemDisplay: {},
    order: {
      orderId: 'order-1',
      orderNumber: 'SD-2026-26-000365',
      status: 'PENDING_CONFIRMATION',
      recipient: {
        name: 'Asha Verma',
        phoneE164: '+919876543210',
        altPhoneE164: null,
        addressLine1,
        addressLine2: 'Near the temple',
        landmark: null,
        city: 'Bengaluru',
        stateProvince: 'Karnataka',
        postalCode: '560001',
      },
      paymentMode: 'COD',
      codAmountInr: '999.00',
      items: [],
    },
  } as unknown as PulledAssignment;
}

const many = <T,>(body: T, n = 8): Array<{ status: number; body: T }> =>
  Array.from({ length: n }, () => ({ status: 200, body }));

function mount(patch: { status: number; body: unknown }, after = assignment('14 MG Road')) {
  const fetchImpl = buildFetchMock([
    { match: /\/agent\/settings$/, responses: many({ isAvailable: false }) },
    {
      match: /\/agent\/calls\/current/,
      responses: [
        { status: 200, body: { assignments: [assignment()] } },
        ...many({ assignments: [after] }),
      ],
    },
    { match: /\/agent\/calls\/[^/]+\/recipient/, responses: [patch] },
  ]);
  return renderWithProviders(
    <ToastProvider>
      <CallCenterStation />
    </ToastProvider>,
    { fetchImpl, identity: makeStaff(['CALL_AGENT'], ['callcenter.work']) },
  );
}

describe('call bench: correcting the customer details', () => {
  it('blocks the outcome controls while edits are unsaved, and opens them once saved', async () => {
    const user = userEvent.setup();
    mount({ status: 200, body: { saved: true } });

    await user.click(await screen.findByRole('button', { name: /edit details/i }));
    // Phone is shown, not editable.
    expect(screen.getByText('+919876543210', { selector: '.cc-edit__phone *' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /phone/i })).toBeNull();

    const outcome = screen.getByLabelText(/^outcome/i) as HTMLSelectElement;
    expect(outcome.disabled).toBe(false);

    const address = screen.getByLabelText(/^address/i);
    await user.clear(address);
    await user.type(address, '14 MG Road');

    expect(outcome.disabled).toBe(true);
    expect(screen.getByTestId('outcome-hold').textContent).toMatch(/save or discard/i);
    expect(
      (screen.getByRole('button', { name: /record outcome/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: /save details/i }));

    await waitFor(() => expect(screen.queryByTestId('outcome-hold')).toBeNull());
    expect((screen.getByLabelText(/^outcome/i) as HTMLSelectElement).disabled).toBe(false);
    // The panel now shows what the server holds (re-fetched, not optimistic).
    expect(await screen.findByText(/14 MG Road/)).toBeTruthy();
  });

  it('discarding the edits re-opens the outcome controls', async () => {
    const user = userEvent.setup();
    mount({ status: 200, body: { saved: true } });
    await user.click(await screen.findByRole('button', { name: /edit details/i }));
    const address = screen.getByLabelText(/^address/i);
    await user.type(address, 'x');
    expect((screen.getByLabelText(/^outcome/i) as HTMLSelectElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /discard changes/i }));
    expect((screen.getByLabelText(/^outcome/i) as HTMLSelectElement).disabled).toBe(false);
  });

  it('renders a server refusal verbatim and keeps the outcome blocked', async () => {
    const user = userEvent.setup();
    mount({
      status: 409,
      body: {
        code: 'COURIER_MUST_ACCEPT_ADDRESS_CHANGE',
        message: 'The courier already has this parcel’s address.',
      },
    });
    await user.click(await screen.findByRole('button', { name: /edit details/i }));
    const address = screen.getByLabelText(/^address/i);
    await user.type(address, '9');
    await user.click(screen.getByRole('button', { name: /save details/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(
      '[COURIER_MUST_ACCEPT_ADDRESS_CHANGE] The courier already has this parcel’s address.',
    );
    expect((screen.getByLabelText(/^outcome/i) as HTMLSelectElement).disabled).toBe(true);
  });

  it('will not let the landmark be cleared, and checks the PIN shape before submitting', async () => {
    const user = userEvent.setup();
    const m = mount({ status: 200, body: { saved: true } });
    await user.click(await screen.findByRole('button', { name: /edit details/i }));
    await user.clear(screen.getByLabelText(/landmark/i));
    expect(screen.getByText(/landmark cannot be left empty/i)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /save details/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.type(screen.getByLabelText(/landmark/i), 'Gate 2');
    const pin = screen.getByLabelText(/^pin/i);
    await user.clear(pin);
    await user.type(pin, '56');
    expect(screen.getByText(/6 digits/i)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: /save details/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(m.fetchImpl.mock.calls.some((c) => String(c[0]).includes('/recipient'))).toBe(false);
  });
});
