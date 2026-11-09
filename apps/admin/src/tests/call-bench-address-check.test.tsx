/**
 * The address verdict on the call bench, and its re-check (2026-11-09).
 *
 * Two things are worth a test here and neither is visible by looking at
 * the screen: that an EDITED address is asked about again, and that the
 * answer never gets to cost the agent the edit they just saved.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PulledAssignment } from '@skydrop/api-client';
import { CallCenterStation } from '@/app/(authed)/call-center/_components/call-center-station';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

function assignment(addressLine1 = '12 MG Road', name = 'Asha Verma'): PulledAssignment {
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
        name,
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

function verdict(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    available: true,
    status: 'needs_review',
    action: 'confirm_with_customer',
    score: 42,
    poConfidence: null,
    completedAddress: null,
    issues: [{ code: 'house_number_missing', message: 'No house or flat number' }],
    suggestions: [],
    extracted: {},
    fieldSource: {},
    rtoRisk: null,
    rtoRiskStatus: 'model_not_ready',
    rechecked: false,
    questions: [{ field: 'house', text: 'Which house or flat number is it?' }],
    providersUsed: [],
    ...over,
  };
}

const many = <T,>(body: T, n = 8): Array<{ status: number; body: T }> =>
  Array.from({ length: n }, () => ({ status: 200, body }));

function mount(
  opts: {
    recheck?: { status: number; body: unknown };
    after?: PulledAssignment;
  } = {},
) {
  const fetchImpl = buildFetchMock([
    { match: /\/agent\/settings$/, responses: many({ isAvailable: false }) },
    {
      match: /\/agent\/calls\/current/,
      responses: [
        { status: 200, body: { assignments: [assignment()] } },
        ...many({ assignments: [opts.after ?? assignment('14 MG Road')] }),
      ],
    },
    {
      match: /\/agent\/calls\/[^/]+\/recipient/,
      responses: [{ status: 200, body: { saved: true } }],
    },
    // BEFORE the stored read: its URL ends with the same words.
    {
      match: /\/address-check\/recheck$/,
      responses: [opts.recheck ?? { status: 200, body: verdict({ score: 88, rechecked: true }) }],
    },
    { match: /\/address-check$/, responses: many(verdict()) },
  ]);
  return renderWithProviders(
    <ToastProvider>
      <CallCenterStation />
    </ToastProvider>,
    { fetchImpl, identity: makeStaff(['CALL_AGENT'], ['callcenter.work']) },
  );
}

const recheckCalls = (m: ReturnType<typeof mount>): string[] =>
  m.fetchImpl.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes('/address-check/recheck'));

describe('call bench: the address verdict', () => {
  it('shows the score and the questions to ask, and holds no outcome back (FE-2)', async () => {
    mount();
    expect(await screen.findByText('42')).toBeTruthy();
    expect(screen.getByText(/which house or flat number/i)).toBeTruthy();
    expect(screen.getByText(/no house or flat number/i)).toBeTruthy();
    // A low score is something to ask about, never a refusal: the
    // outcome select is open and nothing holds the attempt back.
    expect((screen.getByLabelText(/^outcome/i) as HTMLSelectElement).disabled).toBe(false);
    expect(screen.queryByTestId('outcome-hold')).toBeNull();
  });

  it('re-checks the edited address and replaces the verdict on screen', async () => {
    const user = userEvent.setup();
    const m = mount();
    expect(await screen.findByText('42')).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: /edit details/i }));
    const address = screen.getByRole('textbox', { name: /^address/i });
    await user.clear(address);
    await user.type(address, '14 MG Road');
    await user.click(screen.getByRole('button', { name: /save details/i }));

    expect(await screen.findByText('88')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('42')).toBeNull());
    expect(recheckCalls(m)).toHaveLength(1);
    // Asked only AFTER the edit was saved — never before it.
    const order = m.fetchImpl.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => /recipient|recheck/.test(u));
    expect(order[0]).toMatch(/\/recipient$/);
    expect(order[1]).toMatch(/\/recheck$/);
  });

  it('does not spend a check on a name-only correction', async () => {
    const user = userEvent.setup();
    const m = mount({ after: assignment('12 MG Road', 'Asha Verma Singh') });
    expect(await screen.findByText('42')).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: /edit details/i }));
    await user.type(screen.getByRole('textbox', { name: /^name/i }), ' Singh');
    await user.click(screen.getByRole('button', { name: /save details/i }));

    await waitFor(() => expect(screen.queryByTestId('outcome-hold')).toBeNull());
    expect(recheckCalls(m)).toEqual([]);
  });

  it('keeps the saved edit when the re-check cannot be made, and says so verbatim', async () => {
    const user = userEvent.setup();
    const m = mount({
      recheck: {
        status: 503,
        body: { code: 'ADDRESS_CHECK_UNAVAILABLE', message: 'The address service did not answer.' },
      },
    });
    expect(await screen.findByText('42')).toBeTruthy();

    await user.click(await screen.findByRole('button', { name: /edit details/i }));
    const address = screen.getByRole('textbox', { name: /^address/i });
    await user.clear(address);
    await user.type(address, '14 MG Road');
    await user.click(screen.getByRole('button', { name: /save details/i }));

    // The edit stands: saved, the form closed, outcomes open.
    expect(await screen.findByText(/details saved/i, { selector: '.cc-edit__saved' })).toBeTruthy();
    expect(await screen.findByText(/14 MG Road/)).toBeTruthy();
    expect((screen.getByLabelText(/^outcome/i) as HTMLSelectElement).disabled).toBe(false);
    // And the panel says the score below is not about what was saved.
    expect(
      await screen.findByText(/\[ADDRESS_CHECK_UNAVAILABLE\] The address service did not answer\./),
    ).toBeTruthy();
    expect(recheckCalls(m)).toHaveLength(1);
  });
});
