import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Reattempt } from '../app/(authed)/orders/[id]/_components/reattempt';
import { fetchFrom, renderAssociateScreen } from './helpers';

const ORDER = '019fad84-7acd-754e-8ee4-43cf858fed83';
const ACTIONS = `/store/orders/${ORDER}/actions`;

/**
 * ASSOC-1 — asking for another delivery attempt, and the ONE sentence
 * this component exists to get right.
 *
 * An associate who believes a van is coming will tell a customer so. So
 * a request HELD for the store to approve must never read as done, and
 * the difference has to be visible BEFORE the click as well as after it
 * — which is why the seller's policy is shown beside the button rather
 * than only discovered in the reply.
 *
 * What is NOT asserted here, deliberately: whether the request is
 * allowed. That is the server's, and the component renders its words
 * (FE-2).
 */
describe('try delivering again', () => {
  it('says the store approves it first when the policy is ASK_SELLER', async () => {
    renderAssociateScreen(<Reattempt orderId={ORDER} orderNumber="SD-2026-26-000001" stageOpen />, {
      fetchImpl: fetchFrom({ [ACTIONS]: { items: [], allowed: { reattempt: 'ASK_SELLER' } } }),
    });
    expect(await screen.findByRole('button', { name: /Try delivering again/ })).toBeVisible();
    expect(screen.getByText('Your store approves this before anything happens')).toBeVisible();
    // And NOT the other note, which would be the lie.
    expect(screen.queryByText('Happens as soon as you ask')).toBeNull();
  });

  it('says it happens at once when the policy is DIRECT', async () => {
    renderAssociateScreen(<Reattempt orderId={ORDER} orderNumber="SD-2026-26-000001" stageOpen />, {
      fetchImpl: fetchFrom({ [ACTIONS]: { items: [], allowed: { reattempt: 'DIRECT' } } }),
    });
    expect(await screen.findByText('Happens as soon as you ask')).toBeVisible();
    expect(screen.queryByText('Your store approves this before anything happens')).toBeNull();
  });

  it('renders NOTHING when the store has switched it off and nothing was ever asked', async () => {
    const { container } = renderAssociateScreen(
      <Reattempt orderId={ORDER} orderNumber="SD-2026-26-000001" stageOpen />,
      { fetchImpl: fetchFrom({ [ACTIONS]: { items: [], allowed: { reattempt: 'OFF' } } }) },
    );
    // An offered button that always refuses teaches people to ignore
    // refusals, so the section does not exist at all.
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('still shows the history when it is off, so a past ask is not hidden', async () => {
    renderAssociateScreen(<Reattempt orderId={ORDER} orderNumber="SD-2026-26-000001" stageOpen />, {
      fetchImpl: fetchFrom({
        [ACTIONS]: {
          allowed: { reattempt: 'OFF' },
          items: [
            {
              id: 'r1',
              action: 'REATTEMPT',
              reason: 'Customer was out, try after 6pm',
              status: 'EXECUTED',
              decisionNote: null,
              decidedAt: null,
              executedAt: '2026-10-07T12:00:00.000Z',
              executionError: null,
              createdAt: '2026-10-07T11:00:00.000Z',
            },
          ],
        },
      }),
    });
    expect(await screen.findByText('Customer was out, try after 6pm')).toBeVisible();
    expect(screen.getByText('Your store has not enabled this for you.')).toBeVisible();
  });

  it('explains why the button is absent outside the delivery window', async () => {
    renderAssociateScreen(
      <Reattempt orderId={ORDER} orderNumber="SD-2026-26-000001" stageOpen={false} />,
      { fetchImpl: fetchFrom({ [ACTIONS]: { items: [], allowed: { reattempt: 'DIRECT' } } }) },
    );
    expect(await screen.findByText(/only while the parcel is out for delivery/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Try delivering again/ })).toBeNull();
  });

  it('names the other two in the history but never offers them', async () => {
    renderAssociateScreen(<Reattempt orderId={ORDER} orderNumber="SD-2026-26-000001" stageOpen />, {
      fetchImpl: fetchFrom({
        [ACTIONS]: {
          // The store may hold all three; this portal offers one.
          allowed: { reattempt: 'DIRECT', recall: 'DIRECT', sendBack: 'DIRECT' },
          items: [
            {
              id: 'r2',
              action: 'RTO',
              reason: 'Customer refused it',
              status: 'EXECUTED',
              decisionNote: null,
              decidedAt: null,
              executedAt: null,
              executionError: null,
              createdAt: '2026-10-07T11:00:00.000Z',
            },
          ],
        },
      }),
    });
    // Named, so an associate reading the parcel's history is not shown a
    // blank where something real happened…
    expect(await screen.findByText('Send it back')).toBeVisible();
    // …but the only thing offered is the one the owner named.
    expect(screen.getByRole('button', { name: /Try delivering again/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Send it back/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Call the customer again/ })).toBeNull();
  });
});
