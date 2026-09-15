import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@skydrop/api-client';
import { NewDisputeForm } from '../app/(authed)/tickets/new/_components/new-dispute-form';

/**
 * FE-2 — the dispute form predicts nothing. An order that is not this
 * store's is refused by the SERVER, and the refusal reaches the person in
 * the server's own words, code first.
 */
describe('raise a dispute — the server verdict, verbatim', () => {
  it('shows [ORDER_NOT_FOUND] exactly as the server said it', async () => {
    const submit = vi.fn(async () => {
      throw new ApiError(404, 'ORDER_NOT_FOUND', {
        code: 'ORDER_NOT_FOUND',
        message: 'No such order in your store.',
      });
    });
    const onDone = vi.fn();
    render(
      <NewDisputeForm
        initialOrderId="019fad84-7acd-754e-8ee4-43cf858fed83"
        pending={false}
        submit={submit}
        onDone={onDone}
      />,
    );
    await userEvent.type(screen.getByLabelText('What is wrong'), 'Wrong colour sent');
    await userEvent.click(screen.getByRole('button', { name: 'Raise the dispute' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      '[ORDER_NOT_FOUND] No such order in your store.',
    );
    expect(submit).toHaveBeenCalledWith({
      orderId: '019fad84-7acd-754e-8ee4-43cf858fed83',
      subject: 'Wrong colour sent',
    });
    expect(onDone).not.toHaveBeenCalled();
  });
});
