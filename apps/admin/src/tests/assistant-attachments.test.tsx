import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AssistantWidget,
  resetAssistantSoundForTests,
  type AssistantTransport,
} from '@skydrop/ui/app/assistant';
import { clearLastError } from '@skydrop/ui/app/last-error';
import { ApiError } from '@skydrop/api-client';

const frame = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;
const stream = (): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(enc.encode(frame({ type: 'text', delta: 'ok' })));
        c.enqueue(enc.encode(frame({ type: 'done', conversationId: 'c1' })));
        c.close();
      },
    }),
    { status: 200 },
  );

interface Rig {
  transport: AssistantTransport;
  uploads: Array<{ path: string; body: unknown }>;
  streamBodies: Array<Record<string, unknown>>;
  /** Resolve (or reject) the n-th upload. */
  settle: (n: number, how: 'ok' | Error) => void;
}

function rig(): Rig {
  const uploads: Rig['uploads'] = [];
  const streamBodies: Rig['streamBodies'] = [];
  const pendingUploads: Array<{
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
    name: string;
  }> = [];
  const transport: AssistantTransport = {
    request: async <T,>(path: string, init?: { body?: unknown }): Promise<T> => {
      if (path.endsWith('/attachments')) {
        uploads.push({ path, body: init?.body });
        const file = (init?.body as FormData).get('file') as File;
        return new Promise<T>((resolve, reject) => {
          pendingUploads.push({
            resolve: resolve as (v: unknown) => void,
            reject,
            name: file.name,
          });
        });
      }
      if (path.endsWith('/conversations')) return { id: 'c1' } as T;
      return [] as unknown as T;
    },
    requestStream: async (_path, init) => {
      streamBodies.push(init?.body as Record<string, unknown>);
      return stream();
    },
  };
  return {
    transport,
    uploads,
    streamBodies,
    settle(n, how) {
      const p = pendingUploads[n];
      if (!p) throw new Error('no such upload');
      if (how === 'ok') {
        p.resolve({
          id: `att-${n}`,
          kind: p.name.endsWith('.pdf') ? 'PDF' : 'IMAGE',
          mediaType: p.name.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
          name: p.name,
          bytes: 1234,
          pages: p.name.endsWith('.pdf') ? 4 : null,
        });
      } else p.reject(how);
    },
  };
}

async function openPanel(r: Rig) {
  const user = userEvent.setup();
  const view = render(
    <AssistantWidget console="seller" pathname="/orders" transport={r.transport} />,
  );
  await user.click(screen.getByRole('button', { name: /ask skydrop/i }));
  await screen.findByLabelText('Ask a question');
  const input = view.container.ownerDocument.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input missing');
  return { user, input };
}

const png = (name = 'shot.png') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const pdf = (name = 'bill.pdf') =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' });

beforeEach(() => {
  window.localStorage.clear();
  resetAssistantSoundForTests();
  clearLastError();
  // jsdom has no object URLs
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('attachments in the composer', () => {
  it('has a labelled 44px-class paperclip button and a hidden file input', async () => {
    const { input } = await openPanel(rig());
    expect(screen.getByRole('button', { name: 'Attach a picture or PDF' })).toBeInTheDocument();
    expect(input.accept).toContain('application/pdf');
    expect(input.multiple).toBe(true);
  });

  it('a chip is busy while it uploads, done after, and Send is disabled meanwhile', async () => {
    const r = rig();
    const { user, input } = await openPanel(r);
    await user.type(await screen.findByLabelText('Ask a question'), 'what is this?');
    const send = () =>
      screen.getByRole('button', { name: /^(Send|Waiting for the upload to finish)$/ });
    expect(send()).toBeEnabled();

    await user.upload(input, png());
    const tray = await screen.findByRole('list', { name: 'Attached files' });
    expect(within(tray).getByText('Uploading shot.png')).toBeInTheDocument();
    expect(tray.querySelector('[data-state="busy"]')).not.toBeNull();
    expect(send()).toBeDisabled();
    expect(send()).toHaveAccessibleName('Waiting for the upload to finish');
    // a busy chip cannot be removed mid-flight
    expect(within(tray).queryByRole('button', { name: /remove/i })).toBeNull();

    r.settle(0, 'ok');
    await waitFor(() => expect(tray.querySelector('[data-state="done"]')).not.toBeNull());
    expect(send()).toBeEnabled();
    expect(within(tray).getByRole('button', { name: 'Remove shot.png' })).toBeInTheDocument();
  });

  it('shows the server’s [CODE] message verbatim on a refused file, and the chip can be removed', async () => {
    const r = rig();
    const { user, input } = await openPanel(r);
    await user.upload(input, pdf());
    r.settle(
      0,
      new ApiError(400, 'ATTACHMENT_PDF_TOO_MANY_PAGES', {
        code: 'ATTACHMENT_PDF_TOO_MANY_PAGES',
        message: 'That PDF has 21 pages. The limit is 20 pages.',
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      '[ATTACHMENT_PDF_TOO_MANY_PAGES] That PDF has 21 pages. The limit is 20 pages.',
    );
    await user.click(screen.getByRole('button', { name: 'Remove bill.pdf' }));
    expect(screen.queryByRole('list', { name: 'Attached files' })).toBeNull();
  });

  it('sends the uploaded ids with the question and shows chips, never bytes, in the transcript', async () => {
    const r = rig();
    const { user, input } = await openPanel(r);
    await user.upload(input, [png('a.png'), pdf('b.pdf')]);
    r.settle(0, 'ok');
    r.settle(1, 'ok');
    await waitFor(() => expect(document.querySelectorAll('[data-state="done"]').length).toBe(2));
    await user.type(screen.getByLabelText('Ask a question'), 'read these');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(r.streamBodies).toHaveLength(1));
    expect(r.streamBodies[0]).toMatchObject({
      text: 'read these',
      attachmentIds: ['att-0', 'att-1'],
    });
    const sent = await screen.findAllByRole('list', { name: 'Attached files' });
    const chips = sent[sent.length - 1]!;
    expect(within(chips).getByRole('button', { name: 'Download a.png' })).toBeInTheDocument();
    expect(within(chips).getByText('1 KB · 4 pages')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('base64');
  });

  it('sends nothing extra when there are no files', async () => {
    const r = rig();
    const { user } = await openPanel(r);
    await user.type(screen.getByLabelText('Ask a question'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(r.streamBodies).toHaveLength(1));
    expect(r.streamBodies[0]).not.toHaveProperty('attachmentIds');
  });

  it('a pasted screenshot is attached', async () => {
    const r = rig();
    const { user } = await openPanel(r);
    const box = screen.getByLabelText('Ask a question');
    await user.click(box);
    await user.paste({ files: [png('image.png')], getData: () => '' } as unknown as DataTransfer);
    await waitFor(() => expect(r.uploads).toHaveLength(1));
    expect((r.uploads[0]!.body as FormData).get('file')).toBeInstanceOf(File);
  });

  it('at most three files; the paperclip is disabled when the tray is full', async () => {
    const r = rig();
    const { user, input } = await openPanel(r);
    await user.upload(input, [png('1.png'), png('2.png'), png('3.png'), png('4.png')]);
    await waitFor(() => expect(r.uploads).toHaveLength(3));
    expect(screen.getByText('You can attach up to 3 files to one question.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach a picture or PDF' })).toBeDisabled();
  });
});
