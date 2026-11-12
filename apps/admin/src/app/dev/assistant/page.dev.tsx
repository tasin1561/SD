'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { AssistantWidget, type AssistantTransport } from '@skydrop/ui/app/assistant';
import { recordLastError } from '@skydrop/ui/app/last-error';
import '@skydrop/ui/brand/scales.css';
import '@skydrop/ui/brand/theme.css';
import '@skydrop/ui/brand/app.css';

/**
 * /dev/assistant — the assistant panel against a MOCKED stream, so the whole
 * experience (typing dots, streaming, notices, history, quick actions,
 * sound) can be looked at without an Anthropic key.
 *
 * DEV ONLY: `page.dev.tsx` compiles only under APPS_DEV_ROUTES=1.
 *
 * What you type picks the scenario: a question containing "notice" gets a
 * server notice; "fail" makes the send itself fail; anything else streams a
 * markdown answer that includes an order number, a waybill and some hostile
 * text that must render as text.
 */
const ANSWER = [
  'Order SD-2026-26-000123 is **waiting for a call**. ',
  'Its waybill is 38061110627373.\n\n',
  '- The customer has not picked up twice\n',
  '- Next attempt is scheduled for `tomorrow`\n\n',
  '1. Check the call queue\n2. Ask the agent to retry\n\n',
  'Hostile text stays inert: <script>alert(1)</script> <img src=x onerror=alert(1)> ',
  '[click](javascript:alert(1)) and a real link https://skydrop.global/help.',
];

const enc = new TextEncoder();
const frame = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;

function streamOf(parts: string[], delay: number): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const p of parts) {
        await new Promise((r) => setTimeout(r, delay));
        // Split every frame in two to prove the parser copes mid-frame.
        const bytes = enc.encode(p);
        const mid = Math.floor(bytes.length / 2);
        controller.enqueue(bytes.slice(0, mid));
        await new Promise((r) => setTimeout(r, 5));
        controller.enqueue(bytes.slice(mid));
      }
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const ROWS = [
  { id: 'c1', title: 'ORD-1', updatedAt: '2026-11-12T08:30:00Z' },
  { id: 'c2', title: null, updatedAt: '2026-11-11T17:05:00Z' },
];

function makeTransport(): AssistantTransport {
  return {
    request: async <T,>(path: string): Promise<T> => {
      await new Promise((r) => setTimeout(r, 120));
      if (path.endsWith('/conversations/c1')) {
        return {
          conversation: { id: 'c1' },
          messages: [
            { role: 'user', text: 'Where is SD-2026-26-000123?', at: '2026-11-12T08:29:00Z' },
            { role: 'assistant', text: 'It is **out for delivery**.', at: '2026-11-12T08:30:00Z' },
          ],
        } as T;
      }
      if (path.endsWith('/conversations')) return ROWS as T;
      return { id: 'c-new' } as T;
    },
    requestStream: async (_path, init) => {
      const text = String((init?.body as { text?: string } | undefined)?.text ?? '');
      if (/fail/i.test(text)) throw new Error('boom');
      if (/notice/i.test(text)) {
        return streamOf(
          [
            frame({
              type: 'notice',
              code: 'RESTING_BUDGET',
              text: 'The assistant is resting for now. Please try again later.',
              helpLinks: [{ label: 'Tickets', path: '/tickets' }],
            }),
            frame({ type: 'done', conversationId: 'c-new' }),
          ],
          400,
        );
      }
      return streamOf(
        [
          frame({ type: 'tool', name: 'get_order' }),
          ...ANSWER.map((delta) => frame({ type: 'text', delta })),
          frame({ type: 'done', conversationId: 'c-new' }),
        ],
        220,
      );
    },
  };
}

const PATHS = ['/orders/0192', '/warehouse/pack', '/treasury'];

export default function AssistantHarness(): ReactElement {
  const transport = useMemo(makeTransport, []);
  const [path, setPath] = useState(PATHS[0] ?? '/');
  return (
    <main style={{ padding: 16, minHeight: '100vh' }}>
      {PATHS.map((p) => (
        <button key={p} type="button" onClick={() => setPath(p)} style={{ marginInlineEnd: 8 }}>
          {p}
        </button>
      ))}
      <button
        type="button"
        onClick={() => recordLastError('PACK_SCAN_WRONG', 'Wrong item scanned')}
      >
        PACK_SCAN_WRONG
      </button>
      <AssistantWidget console="admin" pathname={path} transport={transport} />
    </main>
  );
}
