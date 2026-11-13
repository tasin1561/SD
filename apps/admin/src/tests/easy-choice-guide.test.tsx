/**
 * "What does each choice do?" — the instruction menu beside a dropdown
 * whose options have consequences (owner, 2026-11-13).
 *
 * It must list EVERY option with what it does before one is picked, pick
 * the option in the dropdown when pressed, and stay readable — but not
 * pickable — while the dropdown itself is held.
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import type { PulledAssignment } from '@skydrop/api-client';
import { LocaleProvider } from '@skydrop/ui/app/i18n-client';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { ChoiceGuide } from '@/components/easy/choice-guide';
import { CallCenterStation } from '@/app/(authed)/call-center/_components/call-center-station';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

afterEach(cleanup);

const CHOICES = [
  { value: 'A', label: 'Confirmed', helper: 'The customer wants it. Stock is reserved.' },
  { value: 'B', label: 'Busy', helper: 'The line was busy. We call again later.' },
] as const;

describe('ChoiceGuide', () => {
  it('is closed until asked for, then lists every choice with what it does', () => {
    render(
      <LocaleProvider initialLocale="en">
        <ChoiceGuide choices={CHOICES} selected="" onChoose={() => undefined} />
      </LocaleProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'What does each choice do?' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('The line was busy. We call again later.')).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    for (const c of CHOICES) {
      expect(screen.getByText(c.label)).toBeTruthy();
      expect(screen.getByText(c.helper)).toBeTruthy();
    }
  });

  it('pressing a choice picks it and closes the guide; the chosen one is marked', () => {
    const onChoose = vi.fn();
    const { rerender } = render(
      <LocaleProvider initialLocale="en">
        <ChoiceGuide choices={CHOICES} selected="" onChoose={onChoose} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'What does each choice do?' }));
    fireEvent.click(screen.getByRole('button', { name: /Busy/ }));
    expect(onChoose).toHaveBeenCalledWith('B');
    expect(screen.queryByText('The customer wants it. Stock is reserved.')).toBeNull();

    rerender(
      <LocaleProvider initialLocale="en">
        <ChoiceGuide choices={CHOICES} selected="B" onChoose={onChoose} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'What does each choice do?' }));
    expect(screen.getByRole('button', { name: /Busy/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Chosen')).toBeTruthy();
  });

  it('held: still readable, nothing pickable', () => {
    const onChoose = vi.fn();
    render(
      <LocaleProvider initialLocale="en">
        <ChoiceGuide choices={CHOICES} selected="" onChoose={onChoose} disabled />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'What does each choice do?' }));
    expect(screen.getByText('The line was busy. We call again later.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Busy/ })).toBeNull();
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('speaks the console language', () => {
    render(
      <LocaleProvider initialLocale="bn">
        <ChoiceGuide choices={CHOICES} />
      </LocaleProvider>,
    );
    expect(screen.getByRole('button', { name: 'কোনটা বাছলে কী হয়?' })).toBeTruthy();
  });
});

function assignment(): PulledAssignment {
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
        addressLine1: '12 MG Road',
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

describe('call bench: the outcome guide', () => {
  it('lists all nine outcomes with what each does, and picking one sets the dropdown', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ToastProvider>
        <CallCenterStation />
      </ToastProvider>,
      {
        fetchImpl: buildFetchMock([
          { match: /\/agent\/settings$/, responses: many({ isAvailable: false }) },
          { match: /\/agent\/calls\/current/, responses: many({ assignments: [assignment()] }) },
        ]),
        identity: makeStaff(['CALL_AGENT'], ['callcenter.work']),
      },
    );
    const select = (await screen.findByLabelText(/^outcome/i)) as HTMLSelectElement;
    const names = [...select.options].filter((o) => o.value !== '').map((o) => o.text);
    expect(names).toHaveLength(9);

    await user.click(screen.getByRole('button', { name: 'What does each choice do?' }));
    const list = document.querySelector('.ez-guide__list') as HTMLElement;
    const items = [...list.querySelectorAll('.ez-guide__item')];
    // The same nine, in the same order as the dropdown — and every one explained.
    expect(items.map((li) => li.querySelector('.ez-guide__name')?.textContent)).toEqual(names);
    for (const li of items) {
      expect((li.querySelector('.ez-guide__what')?.textContent ?? '').length).toBeGreaterThan(10);
    }

    await user.click(items[4]?.querySelector('button') as HTMLElement);
    expect(select.value).toBe([...select.options].filter((o) => o.value !== '')[4]?.value);
    expect(document.querySelector('.ez-guide__list')).toBeNull();
  });
});
