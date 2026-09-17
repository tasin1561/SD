import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@skydrop/api-client';
import { NewTicketForm } from '../app/(authed)/tickets/new/_components/new-ticket-form';

const ORDER = '019fad84-7acd-754e-8ee4-43cf858fed83';

/**
 * FE-2 — the ticket form predicts nothing. An order that is not this
 * store's is refused by the SERVER, and the refusal reaches the person
 * in the server's own words, code first.
 *
 * And the choice that decides WHO reads it has to reach the caller: the
 * two audiences are different endpoints and different consequences (the
 * seller is not even told about a Skydrop issue), so a form that quietly
 * defaulted one of them would send a complaint about us to the wrong
 * company.
 */
describe('raise a ticket — the server verdict, verbatim', () => {
  it('shows [ORDER_NOT_FOUND] exactly as the server said it', async () => {
    const submit = vi.fn(async () => {
      throw new ApiError(404, 'ORDER_NOT_FOUND', {
        code: 'ORDER_NOT_FOUND',
        message: 'No such order in your store.',
      });
    });
    const onDone = vi.fn();
    render(
      <NewTicketForm initialOrderId={ORDER} pending={false} submit={submit} onDone={onDone} />,
    );
    await userEvent.type(screen.getByLabelText('What is wrong'), 'Wrong colour sent');
    await userEvent.click(screen.getByRole('button', { name: 'Raise it with your seller' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[ORDER_NOT_FOUND] No such order in your store.',
    );
    expect(submit).toHaveBeenCalledWith({
      audience: 'seller',
      orderId: ORDER,
      subject: 'Wrong colour sent',
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('carries the chosen audience, so a Skydrop issue never goes to the seller', async () => {
    const submit = vi.fn(async () => ({ kind: 'ticket' as const, id: 'tk-1' }));
    const onDone = vi.fn();
    render(
      <NewTicketForm initialOrderId={ORDER} pending={false} submit={submit} onDone={onDone} />,
    );

    // Anchored: the SELLER option's own blurb says "Skydrop referees",
    // so a loose /Skydrop/ matches both radios. Only one of them is
    // NAMED Skydrop.
    await userEvent.click(screen.getByRole('radio', { name: /^Skydrop/ }));
    await userEvent.type(
      screen.getByLabelText('What is wrong'),
      'Parcel crushed in your warehouse',
    );
    // The button names the destination, so the choice is readable at the
    // moment of committing and not only at the top of the form.
    await userEvent.click(screen.getByRole('button', { name: 'Raise it with Skydrop' }));

    expect(submit).toHaveBeenCalledWith({
      audience: 'skydrop',
      orderId: ORDER,
      subject: 'Parcel crushed in your warehouse',
    });
    expect(onDone).toHaveBeenCalledWith({ kind: 'ticket', id: 'tk-1' });
  });

  it('opens on the audience the order page already chose', () => {
    render(
      <NewTicketForm
        initialOrderId={ORDER}
        initialAudience="skydrop"
        pending={false}
        submit={vi.fn(async () => ({ kind: 'ticket' as const, id: 'tk-2' }))}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Raise it with Skydrop' })).toBeInTheDocument();
  });
});
