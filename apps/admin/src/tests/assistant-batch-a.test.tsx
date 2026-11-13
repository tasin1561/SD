import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AssistantWidget,
  TicketPhotos,
  loadGreeting,
  resetAssistantSoundForTests,
  splitVerdict,
  type AssistantTransport,
} from '@skydrop/ui/app/assistant';
import { ErrorState } from '@skydrop/ui/app/empty-state';
import { ToastProvider, useToast } from '@skydrop/ui/app/toast';
import { clearLastError, readLastError } from '@skydrop/ui/app/last-error';

function sse(parts: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const p of parts) c.enqueue(enc.encode(p));
        c.close();
      },
    }),
    { status: 200 },
  );
}

interface Rig {
  transport: AssistantTransport;
  requests: string[];
  streamBodies: Array<Record<string, unknown>>;
}

function rig(
  status: unknown,
  data: Record<string, unknown> = {},
  failing: readonly string[] = [],
): Rig {
  const requests: string[] = [];
  const streamBodies: Array<Record<string, unknown>> = [];
  const transport: AssistantTransport = {
    request: async <T,>(path: string): Promise<T> => {
      requests.push(path);
      if (path.endsWith('/status')) return status as T;
      if (failing.includes(path)) throw new Error('refused');
      if (path in data) return data[path] as T;
      if (path.endsWith('/conversations')) return { id: 'c1' } as T;
      return [] as unknown as T;
    },
    requestStream: async (_path, init) => {
      streamBodies.push(init?.body as Record<string, unknown>);
      return sse([
        `data: ${JSON.stringify({ type: 'text', delta: 'ok' })}\n\n`,
        `data: ${JSON.stringify({ type: 'done', conversationId: 'c1' })}\n\n`,
      ]);
    },
  };
  return { transport, requests, streamBodies };
}

beforeEach(() => {
  window.localStorage.clear();
  resetAssistantSoundForTests();
  clearLastError();
});
afterEach(() => vi.restoreAllMocks());

const ON = { enabled: true, permissions: ['orders.view'] };

describe('Ask AI why', () => {
  it('shows no button where no assistant is mounted (every console looks as before)', () => {
    render(<ErrorState message="[ORDER_LOCKED] This order is locked." />);
    expect(screen.queryByRole('button', { name: 'Ask AI why' })).toBeNull();
  });

  it('shows no button while the assistant is switched off for the console', async () => {
    const r = rig({ enabled: false, permissions: [] });
    render(
      <>
        <AssistantWidget console="seller" pathname="/orders" transport={r.transport} />
        <ErrorState message="[ORDER_LOCKED] This order is locked." />
      </>,
    );
    await waitFor(() => expect(r.requests).toContain('/api/seller/assistant/status'));
    await act(async () => undefined);
    expect(screen.queryByRole('button', { name: 'Ask AI why' })).toBeNull();
  });

  it('on an error: opens the assistant with the question pre-filled and the error as context', async () => {
    const r = rig(ON);
    const user = userEvent.setup();
    render(
      <>
        <AssistantWidget console="seller" pathname="/orders/0192" transport={r.transport} />
        <ErrorState message="[ORDER_LOCKED] This order is locked." />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Ask AI why' }));
    const box = await screen.findByLabelText('Ask a question');
    expect(box).toHaveValue('Why did I get this error and what should I do?');
    expect(readLastError()).toMatchObject({
      code: 'ORDER_LOCKED',
      message: 'This order is locked.',
    });
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(r.streamBodies).toHaveLength(1));
    expect(r.streamBodies[0]).toMatchObject({
      text: 'Why did I get this error and what should I do?',
      context: { lastError: { code: 'ORDER_LOCKED', message: 'This order is locked.' } },
    });
  });

  it('appears on an error toast and not on a success toast', async () => {
    const r = rig(ON);
    function Fire(): null {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast.success('Saved');
            toast.error('[WALLET_LOW] Not enough balance.');
          }}
        >
          fire
        </button>
      ) as unknown as null;
    }
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <AssistantWidget console="seller" pathname="/" transport={r.transport} />
        <Fire />
      </ToastProvider>,
    );
    await act(async () => undefined);
    await user.click(screen.getByRole('button', { name: 'fire' }));
    expect(await screen.findAllByRole('button', { name: 'Ask AI why' })).toHaveLength(1);
  });

  it('splits "[CODE] message" and leaves plain text alone', () => {
    expect(splitVerdict('[A_B] hello')).toEqual({ code: 'A_B', message: 'hello' });
    expect(splitVerdict('hello')).toEqual({ code: null, message: 'hello' });
  });
});

describe('the greeting card', () => {
  it('asks only for what the caller may see, and a viewer without wallet.view sees no balance line', async () => {
    const paths = {
      '/api/seller/orders/summary': {
        byStatus: [
          { status: 'AWAITING_SELLER_DECISION', count: 3 },
          { status: 'DELIVERY_FAILED', count: 2 },
        ],
      },
      '/api/seller/nsa': [{}, {}],
    };
    const calls: string[] = [];
    const res = await loadGreeting('seller', ['orders.view'], {
      request: async <T,>(p: string): Promise<T> => {
        calls.push(p);
        return paths[p as keyof typeof paths] as T;
      },
    });
    expect(calls).not.toContain('/api/seller/wallet');
    // Two lines share the summary: one request.
    expect(calls.filter((c) => c === '/api/seller/orders/summary')).toHaveLength(1);
    expect(res).toMatchObject({ state: 'lines' });
    if (res.state === 'lines') {
      expect(res.lines.map((l) => [l.key.split('.').pop(), l.count])).toEqual([
        ['awaiting', 3],
        ['stuck', 2],
        ['failed', 2],
      ]);
    }
  });

  it('is hidden when every request fails, instead of claiming all clear', async () => {
    const res = await loadGreeting('seller', ['orders.view'], {
      request: async () => {
        throw new Error('down');
      },
    });
    expect(res).toEqual({ state: 'unavailable' });
  });

  it('shows in an empty chat with links, makes no model call, and "Explain these" sends it', async () => {
    const r = rig(ON, {
      '/api/seller/orders/summary': {
        byStatus: [{ status: 'AWAITING_SELLER_DECISION', count: 4 }],
      },
      '/api/seller/nsa': [],
    });
    const user = userEvent.setup();
    render(<AssistantWidget console="seller" pathname="/dashboard" transport={r.transport} />);
    await act(async () => undefined);
    await user.click(screen.getByRole('button', { name: /ask skydrop/i }));
    const link = await screen.findByRole('link', { name: /Orders waiting for your decision: 4/ });
    expect(link).toHaveAttribute('href', '/needs-attention');
    expect(r.streamBodies).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Explain these' }));
    await waitFor(() => expect(r.streamBodies).toHaveLength(1));
    expect(String(r.streamBodies[0]?.['text'])).toContain('Orders waiting for your decision: 4');
  });
});

describe('ticket photos', () => {
  it('shows thumbnails for images and nothing when there are none or the call is refused', async () => {
    const { container, rerender } = render(
      <TicketPhotos
        ticketId="t1"
        fetcher={async () => ({
          items: [
            {
              id: 'a',
              kind: 'IMAGE',
              mediaType: 'image/jpeg',
              name: 'box.jpg',
              bytes: 1,
              url: 'https://x.test/a',
            },
            {
              id: 'b',
              kind: 'PDF',
              mediaType: 'application/pdf',
              name: 'slip.pdf',
              bytes: 1,
              url: 'https://x.test/b',
            },
          ],
        })}
      />,
    );
    const link = await screen.findByRole('link', { name: 'Open box.jpg' });
    expect(link).toHaveAttribute('href', 'https://x.test/a');
    expect(container.querySelectorAll('img')).toHaveLength(1);
    rerender(<TicketPhotos ticketId="t2" fetcher={async () => ({ items: [] })} />);
    await waitFor(() => expect(container.querySelector('.sk-tphotos')).toBeNull());
    rerender(
      <TicketPhotos
        ticketId="t3"
        fetcher={async () => {
          throw new Error('403');
        }}
      />,
    );
    await waitFor(() => expect(container.querySelector('.sk-tphotos')).toBeNull());
  });
});
