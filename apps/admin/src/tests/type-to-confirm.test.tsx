/**
 * The typed order number on the three god-mode dialogs is a client-side
 * speed bump: confirm stays disabled until the input EXACTLY equals the
 * order number (trimmed, case-sensitive), and the typed value is never part
 * of what is sent to the API.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReleaseReservationsDialog } from '@/app/(authed)/orders/_components/release-reservations-dialog';
import { RestoreReservationsDialog } from '@/app/(authed)/orders/_components/restore-reservations-dialog';
import { typedMatchesOrderNo } from '@/app/(authed)/orders/_components/danger-confirm';
import { buildFetchMock, renderWithProviders } from './helpers';

const NO = 'SD-2026-26-000065';

describe('typedMatchesOrderNo', () => {
  it('is exact, trimmed and case-sensitive', () => {
    expect(typedMatchesOrderNo(NO, NO)).toBe(true);
    expect(typedMatchesOrderNo(`  ${NO}\n`, NO)).toBe(true);
    expect(typedMatchesOrderNo(NO.toLowerCase(), NO)).toBe(false);
    expect(typedMatchesOrderNo(NO.slice(0, -1), NO)).toBe(false);
    expect(typedMatchesOrderNo('', NO)).toBe(false);
    expect(typedMatchesOrderNo('', '')).toBe(false);
  });
});

describe('Release reservations dialog — typed confirmation', () => {
  it('confirm is disabled until the order number is typed, and the payload never carries it', async () => {
    const user = userEvent.setup();
    const fetchImpl = buildFetchMock([
      {
        match: /release-reservations$/,
        responses: [{ status: 200, body: { releasedCount: 0, released: [] } }],
      },
    ]);
    let done = false;
    renderWithProviders(
      <ReleaseReservationsDialog
        open
        onOpenChange={() => undefined}
        orderId="o1"
        orderNumber={NO}
        onSuccess={() => {
          done = true;
        }}
      />,
      { fetchImpl },
    );
    const confirm = await screen.findByRole('button', { name: /^Release reservations/ });
    expect(confirm).toBeDisabled();

    const input = screen.getByLabelText(`Type ${NO} to confirm`);
    await user.type(input, NO.toLowerCase());
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, NO);
    expect(confirm).toBeEnabled();

    await user.type(screen.getByLabelText(/reason/i), 'cleanup after force');
    await user.click(confirm);
    await waitFor(() => expect(done).toBe(true));

    const call = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith('release-reservations'));
    const body = String((call?.[1] as { body?: unknown } | undefined)?.body ?? '');
    expect(body).toContain('cleanup after force'); // the reason still travels
    expect(body).not.toContain(NO); // the typed confirmation never does
  });

  it('opens with focus on the SAFE button (Cancel), not on confirm', async () => {
    renderWithProviders(
      <ReleaseReservationsDialog
        open
        onOpenChange={() => undefined}
        orderId="o1"
        orderNumber={NO}
        onSuccess={() => undefined}
      />,
    );
    const safe = await screen.findByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(safe).toHaveFocus());
  });
});

describe('Restore stock claim dialog — typed confirmation', () => {
  it('is gated the same way', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <RestoreReservationsDialog
        open
        onOpenChange={() => undefined}
        orderId="o1"
        orderNumber={NO}
        onSuccess={() => undefined}
      />,
    );
    const confirm = await screen.findByRole('button', { name: /^Restore stock claim/ });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText(`Type ${NO} to confirm`), NO);
    expect(confirm).toBeEnabled();
  });
});
