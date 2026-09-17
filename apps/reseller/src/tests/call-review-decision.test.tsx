import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallReviewDecision } from '@/components/call-review-decision';
import type { StoreCallReview } from '@/lib/review-hooks';
import { renderStoreScreen } from './helpers';

/**
 * Answering "we could not reach your customer".
 *
 * Three things are pinned, and each is a way this screen could quietly
 * cost somebody a sale:
 *
 *   THE CONSEQUENCE — releasing does two things, and the second one
 *   (the order is REJECTED) is the one people miss. It must be on the
 *   screen before the button can be pressed.
 *
 *   THE REASON — required on the destructive branch only. The review row
 *   is the lasting record of why a sale was given up on, and the seller
 *   reads it later. (The API accepts an empty note either way, so this
 *   is a product rule and not a client-side mirror of a guardrail.)
 *
 *   THE HONEST ENDING — "keep trying" can be recorded while the order
 *   has already moved on, in which case nobody is going to ring anyone,
 *   and saying "we will keep trying" there would be a lie.
 */

const REVIEW: StoreCallReview = {
  id: '019fad84-0000-7000-8000-0000000000aa',
  orderId: '019fad84-0000-7000-8000-0000000000bb',
  status: 'OPEN',
  attemptCount: 3,
  heldQty: 2,
  note: null,
  resolvedAt: null,
  createdAt: '2026-09-14T09:00:00.000Z',
} as StoreCallReview;

function bodyOf(call: readonly unknown[]): Record<string, unknown> {
  const init = call[1] as { body?: string };
  return JSON.parse(init.body ?? '{}') as Record<string, unknown>;
}

function openDialog(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Answer' }));
}

describe('call-cap answer — the consequence, then the commit', () => {
  it('spells out that releasing rejects the order, and holds the button until a reason is given', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            applied: true,
            result: { review: REVIEW, orderStatus: 'REJECTED_NDR', orderMoved: true },
            request: null,
          }),
          {
            status: 200,
          },
        ),
    );
    renderStoreScreen(<CallReviewDecision review={REVIEW} orderNumber="SD-2026-26-000123" />, {
      fetchImpl,
    });
    openDialog();

    const dialog = await screen.findByRole('dialog');
    // It opens on the reversible choice, never on the destructive one.
    expect(within(dialog).getByRole('button', { name: 'Keep trying' })).toBeInTheDocument();
    expect(dialog.textContent).toContain('held for this order');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Give up on this order/ }));

    // BOTH halves said before anything can be sent.
    expect(dialog.textContent).toContain('and the order is rejected');
    expect(dialog.textContent).toContain('cannot be undone');

    const commit = within(dialog).getByRole('button', {
      name: 'Release the stock and reject the order',
    });
    expect(commit).toBeDisabled();
    expect(fetchImpl).not.toHaveBeenCalled();

    // `selector` because FormField's help disclosure carries the label
    // in its own aria-label ("Show help for …"), so the label text alone
    // matches the field AND its help button.
    fireEvent.change(
      within(dialog).getByLabelText(/Why you are giving up on it/, { selector: 'textarea' }),
      { target: { value: 'Customer says they never ordered it.' } },
    );
    expect(commit).toBeEnabled();
    fireEvent.click(commit);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    // `readonly unknown[]` rather than a 2-tuple: the mock is declared
    // with no parameters, so TS types its recorded calls as `[]` and a
    // direct tuple cast is rejected as too big a jump.
    const call = fetchImpl.mock.calls[0] as readonly unknown[];
    expect(String(call[0])).toContain(`/api/store/call-reviews/${REVIEW.id}`);
    expect((call[1] as { method?: string }).method).toBe('PATCH');
    expect(bodyOf(fetchImpl.mock.calls[0] as readonly unknown[])).toEqual({
      decision: 'RELEASE',
      note: 'Customer says they never ordered it.',
    });
  });

  it('says so plainly when the answer is recorded but the order had moved on', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            applied: true,
            result: { review: REVIEW, orderStatus: null, orderMoved: false },
            request: null,
          }),
          {
            status: 200,
          },
        ),
    );
    renderStoreScreen(<CallReviewDecision review={REVIEW} />, { fetchImpl });
    openDialog();

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep trying' }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(bodyOf(fetchImpl.mock.calls[0] as readonly unknown[])).toEqual({
      decision: 'REQUEST_MORE_ATTEMPTS',
    });
    expect(await screen.findByText(/calling did not restart/)).toBeInTheDocument();
  });

  it('when Seller staff approve answers first, it asks for a reason and says the answer went to them', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            applied: false,
            result: null,
            request: { id: 'req-1', orderId: REVIEW.orderId, status: 'PENDING' },
          }),
          { status: 201 },
        ),
    );
    renderStoreScreen(<CallReviewDecision review={REVIEW} mode="ASK_SELLER" />, { fetchImpl });
    openDialog();

    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Send to your seller to approve' });
    expect(send).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox'), {
      target: { value: 'Customer asked us to try tomorrow' },
    });
    fireEvent.click(send);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(await screen.findByText(/Sent to Seller staff to approve/)).toBeInTheDocument();
  });

  it('shows the server’s refusal verbatim (FE-2) when the seller keeps this question', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: 'STORE_ACTION_NOT_ALLOWED',
            message:
              'The seller answers call-attempt questions for this store. Ask them whether to keep trying.',
          }),
          { status: 403 },
        ),
    );
    renderStoreScreen(<CallReviewDecision review={REVIEW} />, { fetchImpl });
    openDialog();

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep trying' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[STORE_ACTION_NOT_ALLOWED] The seller answers call-attempt questions for this store. Ask them whether to keep trying.',
    );
  });
});
