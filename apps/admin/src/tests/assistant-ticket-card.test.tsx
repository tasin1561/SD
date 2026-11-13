import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AssistantWidget,
  resetAssistantSoundForTests,
  toAssistantEvent,
  type AssistantTransport,
} from '@skydrop/ui/app/assistant';
import { clearLastError } from '@skydrop/ui/app/last-error';
import { ApiError } from '@skydrop/api-client';

const frame = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;
const PROPOSAL = {
  type: 'ticket_proposal',
  id: '0191a000-0000-7000-8000-0000000000aa',
  subject: 'Parcel stuck for four days',
  description: 'It has not moved since Monday.',
  orderNumber: 'SD-2026-000123',
};

function rig(confirm: (n: number) => Promise<unknown>) {
  const posts: string[] = [];
  const transport: AssistantTransport = {
    request: async <T,>(path: string): Promise<T> => {
      if (path.endsWith('/confirm') || path.endsWith('/dismiss')) {
        posts.push(path);
        return (await confirm(posts.length)) as T;
      }
      if (path.endsWith('/conversations')) return { id: 'c1' } as T;
      return [] as unknown as T;
    },
    requestStream: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            const enc = new TextEncoder();
            c.enqueue(enc.encode(frame({ type: 'text', delta: 'Please press the button.' })));
            c.enqueue(enc.encode(frame(PROPOSAL)));
            c.enqueue(enc.encode(frame({ type: 'done', conversationId: 'c1' })));
            c.close();
          },
        }),
        { status: 200 },
      ),
  };
  return { transport, posts };
}

async function ask(r: ReturnType<typeof rig>) {
  const user = userEvent.setup();
  render(<AssistantWidget console="seller" pathname="/orders" transport={r.transport} />);
  await user.click(screen.getByRole('button', { name: /ask skydrop/i }));
  await user.type(await screen.findByLabelText('Ask a question'), 'I need a person');
  await user.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByRole('button', { name: 'Raise this ticket' });
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  resetAssistantSoundForTests();
  clearLastError();
});
afterEach(() => vi.restoreAllMocks());

describe('the proposed ticket card', () => {
  it('the stream event parses, and a malformed one is dropped', () => {
    expect(toAssistantEvent(PROPOSAL)).toEqual(PROPOSAL);
    expect(toAssistantEvent({ type: 'ticket_proposal', id: 1 })).toBeNull();
  });

  it('shows the subject, the description and two real buttons — nothing is raised yet', async () => {
    const r = rig(async () => ({}));
    await ask(r);
    expect(screen.getByText('Parcel stuck for four days')).toBeInTheDocument();
    expect(screen.getByText('It has not moved since Monday.')).toBeInTheDocument();
    expect(screen.getByText('Order SD-2026-000123')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeEnabled();
    expect(r.posts).toEqual([]);
  });

  it('pressing the button twice sends ONE request, shows busy, then "Raised · TK-…" as a link', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const r = rig(() => new Promise((res) => (finish = res)));
    const user = await ask(r);
    const raise = screen.getByRole('button', { name: 'Raise this ticket' });
    await user.dblClick(raise);
    expect(r.posts).toEqual([
      '/api/seller/assistant/ticket-proposals/0191a000-0000-7000-8000-0000000000aa/confirm',
    ]);
    const busy = screen.getByRole('button', { name: 'Raising…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    finish({
      ...PROPOSAL,
      status: 'CONFIRMED',
      ticketId: 'tid-1',
      ticketNumber: 'TK-2026-000009',
      held: false,
    });
    const link = await screen.findByRole('link', { name: /TK-2026-000009/ });
    expect(link).toHaveAttribute('href', '/tickets/tid-1');
    expect(screen.getByText('Raised')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raise this ticket' })).toBeNull();
  });

  it('shows the server’s [CODE] message verbatim when it refuses, and the same button tries again', async () => {
    let n = 0;
    const r = rig(async () => {
      n += 1;
      if (n === 1) {
        throw new ApiError(403, 'ASSISTANT_TICKET_FORBIDDEN', {
          code: 'ASSISTANT_TICKET_FORBIDDEN',
          message: 'You do not have permission to raise tickets.',
        });
      }
      return { ...PROPOSAL, status: 'CONFIRMED', ticketId: 't', ticketNumber: 'TK-2026-000010' };
    });
    const user = await ask(r);
    await user.click(screen.getByRole('button', { name: 'Raise this ticket' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      '[ASSISTANT_TICKET_FORBIDDEN] You do not have permission to raise tickets.',
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Raised')).toBeInTheDocument());
    expect(r.posts).toHaveLength(2);
  });

  it('"Not now" dismisses it through the server and leaves a quiet note', async () => {
    const r = rig(async () => ({ ...PROPOSAL, status: 'DISMISSED' }));
    const user = await ask(r);
    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await screen.findByText('Not raised');
    expect(r.posts[0]).toMatch(/\/dismiss$/);
    expect(screen.queryByRole('button', { name: 'Raise this ticket' })).toBeNull();
  });

  it('a held store issue says it was sent for approval, with no ticket link', async () => {
    const r = rig(async () => ({ ...PROPOSAL, status: 'CONFIRMED', held: true }));
    const user = await ask(r);
    await user.click(screen.getByRole('button', { name: 'Raise this ticket' }));
    await screen.findByText('Sent to your client for approval');
    expect(screen.queryByRole('link', { name: /TK-/ })).toBeNull();
  });
});
