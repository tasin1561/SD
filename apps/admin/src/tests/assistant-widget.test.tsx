import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AssistantWidget,
  resetAssistantSoundForTests,
  type AssistantTransport,
} from '@skydrop/ui/app/assistant';
import { clearLastError, recordLastError } from '@skydrop/ui/app/last-error';
import { ApiError } from '@skydrop/api-client';
import { serverVerdict } from '@/lib/server-verdict';

const frame = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;

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
  streamCalls: Array<{ path: string; body: Record<string, unknown> }>;
}

function rig(streams: Array<() => Response | Promise<Response>>): Rig {
  const streamCalls: Rig['streamCalls'] = [];
  let i = 0;
  const transport: AssistantTransport = {
    request: async <T,>(path: string): Promise<T> => {
      if (path.endsWith('/conversations') && !path.includes('/c')) return { id: 'c1' } as T;
      if (path.endsWith('/conversations')) return { id: 'c1' } as T;
      return [] as unknown as T;
    },
    requestStream: async (path, init) => {
      streamCalls.push({ path, body: init?.body as Record<string, unknown> });
      const next = streams[Math.min(i++, streams.length - 1)];
      if (!next) throw new Error('no stream');
      return next();
    },
  };
  return { transport, streamCalls };
}

/** The answer as drawn in the transcript (the live region repeats it for screen readers). */
const drawn = (text: string) => screen.findByText(text, { selector: '.sk-ai-md p' });

const answer = (text: string) => () =>
  sse([frame({ type: 'text', delta: text }), frame({ type: 'done', conversationId: 'c1' })]);

async function openAndAsk(r: Rig, question: string, pathname = '/orders/0192') {
  const user = userEvent.setup();
  render(<AssistantWidget console="seller" pathname={pathname} transport={r.transport} />);
  await user.click(screen.getByRole('button', { name: /ask skydrop/i }));
  const box = await screen.findByLabelText('Ask a question');
  await user.type(box, question);
  await user.click(screen.getByRole('button', { name: 'Send' }));
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  resetAssistantSoundForTests();
  clearLastError();
});
afterEach(() => vi.restoreAllMocks());

describe('assistant panel', () => {
  it('opens as a labelled dialog, moves focus in, and Esc closes it and returns focus', async () => {
    const r = rig([answer('hi')]);
    const user = userEvent.setup();
    render(<AssistantWidget console="seller" pathname="/orders" transport={r.transport} />);
    const launcher = screen.getByRole('button', { name: /ask skydrop/i });
    await user.click(launcher);
    const dialog = await screen.findByRole('dialog', { name: /Skydrop AI assistant/ });
    await waitFor(() => expect(screen.getByLabelText('Ask a question')).toHaveFocus());
    expect(dialog).not.toHaveAttribute('inert');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(launcher).toHaveFocus());
    expect(dialog).toHaveAttribute('inert');
  });

  it('shows quick actions on an empty chat and tapping one sends it', async () => {
    const r = rig([answer('Because it is waiting for a call.')]);
    const user = userEvent.setup();
    render(<AssistantWidget console="seller" pathname="/orders/0192" transport={r.transport} />);
    await user.click(screen.getByRole('button', { name: /ask skydrop/i }));
    await user.click(await screen.findByRole('button', { name: 'Why is this order stuck?' }));
    await drawn('Because it is waiting for a call.');
    expect(r.streamCalls[0]?.body['text']).toBe('Why is this order stuck?');
  });

  it('streams the answer, links an order number to this console, and announces once when complete', async () => {
    const r = rig([
      () =>
        sse([
          frame({ type: 'text', delta: 'Order SD-2026-26-000123 ' }),
          frame({ type: 'text', delta: 'is **packed**.' }),
          frame({ type: 'done', conversationId: 'c1' }),
        ]),
    ]);
    await openAndAsk(r, 'where is it');
    const link = await screen.findByRole('link', { name: 'SD-2026-26-000123' });
    expect(link).toHaveAttribute('href', '/orders?search=SD-2026-26-000123');
    const live = document.querySelector('[aria-live="polite"]');
    await waitFor(() => expect(live?.textContent).toBe('Order SD-2026-26-000123 is packed.'));
  });

  it('does NOT announce while tokens arrive; only once, when the answer completes', async () => {
    const enc = new TextEncoder();
    let ctl!: ReadableStreamDefaultController<Uint8Array>;
    const r = rig([
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              ctl = c;
            },
          }),
        ),
    ]);
    await openAndAsk(r, 'stream please');
    await waitFor(() => expect(ctl).toBeDefined());
    ctl.enqueue(enc.encode(frame({ type: 'text', delta: 'Half an ' })));
    await drawn('Half an');
    ctl.enqueue(enc.encode(frame({ type: 'text', delta: 'answer' })));
    await drawn('Half an answer');
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('');
    ctl.enqueue(enc.encode(frame({ type: 'done', conversationId: 'c1' })));
    ctl.close();
    await waitFor(() => expect(live?.textContent).toBe('Half an answer'));
  });

  it('renders a server notice as a styled block, not an empty bubble', async () => {
    const r = rig([
      () =>
        sse([
          frame({
            type: 'notice',
            code: 'RESTING_BUDGET',
            text: 'The assistant is resting for now.',
            helpLinks: [{ label: 'Tickets', path: '/tickets' }],
          }),
          frame({ type: 'done', conversationId: 'c1' }),
        ]),
    ]);
    await openAndAsk(r, 'hello');
    const text = await screen.findByText('The assistant is resting for now.');
    const block = text.closest('.sk-ai-notice');
    expect(block).not.toBeNull();
    expect(block).toHaveAttribute('data-code', 'RESTING_BUDGET');
    expect(within(block as HTMLElement).getByRole('link', { name: 'Tickets' })).toHaveAttribute(
      'href',
      '/tickets',
    );
    // and no empty answer bubble/typing indicator is left behind
    expect(document.querySelector('.sk-ai-typing')).toBeNull();
    expect(
      document.querySelectorAll('.sk-ai-msg[data-role="assistant"] .sk-ai-bubble'),
    ).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Copy answer' })).toBeNull();
  });

  it('a failed send becomes a calm notice with a retry that re-sends', async () => {
    const r = rig([
      () => {
        throw new Error('network');
      },
      answer('recovered'),
    ]);
    const user = await openAndAsk(r, 'first try');
    expect(await screen.findByText(/did not send/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await drawn('recovered');
    expect(r.streamCalls).toHaveLength(2);
    expect(r.streamCalls[1]?.body['text']).toBe('first try');
  });

  it('sends the page path and the last error the user saw as context', async () => {
    // The error goes through the REAL on-screen path: serverVerdict.
    serverVerdict(
      new ApiError(409, 'PACK_SCAN_WRONG', {
        code: 'PACK_SCAN_WRONG',
        message: 'Wrong item scanned',
      }),
    );
    const r = rig([answer('ok')]);
    await openAndAsk(r, 'what happened', '/warehouse/pack?x=1');
    await drawn('ok');
    expect(r.streamCalls[0]?.body['context']).toEqual({
      path: '/warehouse/pack',
      lastError: { code: 'PACK_SCAN_WRONG', message: 'Wrong item scanned' },
    });
  });

  it('sends no lastError when nothing went wrong', async () => {
    const r = rig([answer('ok')]);
    await openAndAsk(r, 'hi', '/orders');
    await drawn('ok');
    expect(r.streamCalls[0]?.body['context']).toEqual({ path: '/orders' });
  });

  it('an expired last error is not sent', async () => {
    recordLastError('OLD', 'ancient', Date.now() - 11 * 60 * 1000);
    const r = rig([answer('ok')]);
    await openAndAsk(r, 'hi', '/orders');
    await drawn('ok');
    expect(r.streamCalls[0]?.body['context']).toEqual({ path: '/orders' });
  });

  it('survives localStorage throwing everywhere', async () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const r = rig([answer('still works')]);
    const user = await openAndAsk(r, 'hi');
    await drawn('still works');
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Mute sounds' }));
    });
    expect(screen.getByRole('button', { name: 'Turn sounds on' })).toBeInTheDocument();
  });

  it('the launcher cue shows only the first time', () => {
    const r = rig([answer('x')]);
    const first = render(<AssistantWidget console="seller" pathname="/" transport={r.transport} />);
    expect(first.container.ownerDocument.querySelector('[data-nudge="1"]')).not.toBeNull();
    first.unmount();
    render(<AssistantWidget console="seller" pathname="/" transport={r.transport} />);
    expect(document.querySelector('[data-nudge="1"]')).toBeNull();
  });
});
