/**
 * The handover bench's scan field, pinned (2026-11-13). The person at the
 * van scans box after box with both hands full, so:
 *
 *   1. the field has focus the moment the bench opens — it did not, and the
 *      first parcel of every session was scanned into nothing;
 *   2. Enter sends the label and focus comes straight back;
 *   3. the tally says how many, and what the last one was, in words the
 *      console language owns (the two statuses were hard-coded English);
 *   4. a refused parcel STOPS the field until somebody acknowledges it.
 */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@skydrop/ui/app/toast';
import { HandoverBench } from '@/app/(authed)/warehouse/handover/_components/handover-bench';
import { buildFetchMock, makeStaff, renderWithProviders } from './helpers';

const ok = <T,>(body: T, n = 1): Array<{ status: number; body: T }> =>
  Array.from({ length: n }, () => ({ status: 200, body }));

const RESULT = {
  shipmentId: 's1',
  shipmentNumber: 'SH-2026-11-000060',
  orderId: 'o1',
  alreadyScanned: false,
  dispatched: true,
  manifestDispatched: false,
};

function posts(
  fetchImpl: ReturnType<typeof buildFetchMock>,
): Array<{ url: string; body: unknown }> {
  return fetchImpl.mock.calls
    .filter(
      ([, init]) => ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'POST',
    )
    .map(([input, init]) => ({
      url: String(input),
      body: JSON.parse(String((init as RequestInit).body)) as unknown,
    }));
}

function mount(scans: Array<{ status: number; body: unknown }>) {
  const fetchImpl = buildFetchMock([
    { match: /\/courier\/scan-block/, responses: ok(null, 20) },
    { match: /\/courier\/handover-queue/, responses: ok({ waiting: [] }, 20) },
    { match: /\/courier\/handover-scan$/, responses: scans },
  ]);
  renderWithProviders(
    <ToastProvider>
      <HandoverBench />
    </ToastProvider>,
    { fetchImpl, identity: makeStaff(['WAREHOUSE'], ['warehouse.handover']) },
  );
  return fetchImpl;
}

const field = (): HTMLInputElement => document.getElementById('handover-scan') as HTMLInputElement;

describe('handover bench: the scan field', () => {
  it('holds focus on arrival, sends the label on Enter, and takes focus back', async () => {
    const user = userEvent.setup();
    const fetchImpl = mount(ok(RESULT, 2));
    await waitFor(() => expect(document.activeElement).toBe(field()));

    // No click first: a scan gun types into whatever already has focus.
    await user.keyboard(' 38061110627406 {Enter}');
    await waitFor(() => expect(posts(fetchImpl)).toHaveLength(1));
    expect(posts(fetchImpl)[0]?.url).toMatch(/\/courier\/handover-scan$/);
    expect(posts(fetchImpl)[0]?.body).toEqual({ awbNumber: '38061110627406' });
    await waitFor(() => expect(field().value).toBe(''));
    await waitFor(() => expect(document.activeElement).toBe(field()));

    // The tally: one scanned, and which one, with the status in words.
    const tally = document.querySelector('.ho-tally') as HTMLElement;
    await waitFor(() => expect(tally.querySelector('.ho-tally__num')?.textContent).toBe('1'));
    expect(tally.textContent).toContain('SH-2026-11-000060');
    expect(tally.textContent).toContain('Dispatched');

    await user.keyboard('38061110627407{Enter}');
    await waitFor(() => expect(tally.querySelector('.ho-tally__num')?.textContent).toBe('2'));
  });

  it('an empty Enter sends nothing', async () => {
    const user = userEvent.setup();
    const fetchImpl = mount([]);
    await waitFor(() => expect(document.activeElement).toBe(field()));
    await user.keyboard('   {Enter}');
    expect(posts(fetchImpl)).toHaveLength(0);
  });

  it('a refused parcel stops the field until acknowledged, then gives focus back', async () => {
    const user = userEvent.setup();
    mount([
      { status: 409, body: { code: 'HANDOVER_NOT_PACKED', message: 'That parcel is not packed' } },
    ]);
    await waitFor(() => expect(document.activeElement).toBe(field()));
    await user.keyboard('38061110627406{Enter}');

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('[HANDOVER_NOT_PACKED] That parcel is not packed');
    expect(field().disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: /understood/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(field().disabled).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(field()));
  });
});
