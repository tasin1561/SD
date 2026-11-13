/**
 * The assistant's Server-Sent Events, read from a `fetch` body.
 *
 * `EventSource` cannot POST, so the stream is read with a reader and the
 * frames parsed here. The parser is robust to what a network does to a
 * stream: a frame split across two chunks, several frames in one chunk,
 * CRLF line ends, comment/keep-alive lines, and a multi-byte character
 * cut in half between chunks (`TextDecoder` with `stream: true`).
 *
 * The event shapes mirror `AssistantStreamEvent` in
 * `apps/api/src/modules/assistant/assistant.types.ts`. Anything that does
 * not match is DROPPED, never guessed at.
 */
export type NoticeCode =
  | 'DISABLED'
  | 'NOT_CONFIGURED'
  | 'RESTING_BUDGET'
  | 'RESTING_DAILY'
  | 'REFUSED'
  | 'TRUNCATED'
  | 'ATTACHMENTS_TOO_LARGE'
  | 'ATTACHMENT_UNAVAILABLE'
  | 'FAILED';

export interface HelpLink {
  readonly label: string;
  readonly path: string;
}

export type AssistantEvent =
  | { readonly type: 'text'; readonly delta: string }
  | { readonly type: 'tool'; readonly name: string }
  | {
      readonly type: 'notice';
      readonly code: NoticeCode;
      readonly text: string;
      readonly helpLinks: readonly HelpLink[];
    }
  | {
      readonly type: 'ticket_proposal';
      readonly id: string;
      readonly subject: string;
      readonly description: string;
      readonly orderNumber: string | null;
    }
  | { readonly type: 'done'; readonly conversationId: string; readonly messageId?: string };

const NOTICE_CODES: ReadonlySet<string> = new Set([
  'DISABLED',
  'NOT_CONFIGURED',
  'RESTING_BUDGET',
  'RESTING_DAILY',
  'REFUSED',
  'TRUNCATED',
  'ATTACHMENTS_TOO_LARGE',
  'ATTACHMENT_UNAVAILABLE',
  'FAILED',
]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Narrow one decoded JSON value to an event, or null. */
export function toAssistantEvent(value: unknown): AssistantEvent | null {
  if (!isRecord(value)) return null;
  switch (value['type']) {
    case 'text':
      return typeof value['delta'] === 'string' ? { type: 'text', delta: value['delta'] } : null;
    case 'tool':
      return typeof value['name'] === 'string' ? { type: 'tool', name: value['name'] } : null;
    case 'ticket_proposal':
      return typeof value['id'] === 'string' &&
        typeof value['subject'] === 'string' &&
        typeof value['description'] === 'string'
        ? {
            type: 'ticket_proposal',
            id: value['id'],
            subject: value['subject'],
            description: value['description'],
            orderNumber: typeof value['orderNumber'] === 'string' ? value['orderNumber'] : null,
          }
        : null;
    case 'done':
      return typeof value['conversationId'] === 'string'
        ? {
            type: 'done',
            conversationId: value['conversationId'],
            ...(typeof value['messageId'] === 'string' ? { messageId: value['messageId'] } : {}),
          }
        : null;
    case 'notice': {
      const code = value['code'];
      const text = value['text'];
      if (typeof code !== 'string' || !NOTICE_CODES.has(code) || typeof text !== 'string') {
        return null;
      }
      const raw = Array.isArray(value['helpLinks']) ? (value['helpLinks'] as unknown[]) : [];
      const helpLinks: HelpLink[] = [];
      for (const l of raw) {
        if (isRecord(l) && typeof l['label'] === 'string' && typeof l['path'] === 'string') {
          helpLinks.push({ label: l['label'], path: l['path'] });
        }
      }
      return { type: 'notice', code: code as NoticeCode, text, helpLinks };
    }
    default:
      return null;
  }
}

export interface SseParser {
  /** Feed decoded text; returns the events completed by it. */
  push(chunk: string): AssistantEvent[];
  /** The stream ended: parse a final frame that had no trailing blank line. */
  flush(): AssistantEvent[];
}

function frameToEvent(frame: string): AssistantEvent | null {
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return null;
  try {
    return toAssistantEvent(JSON.parse(data.join('\n')));
  } catch {
    return null;
  }
}

export function createSseParser(): SseParser {
  let buffer = '';
  const drain = (final: boolean): AssistantEvent[] => {
    buffer = buffer.replace(/\r\n?/g, '\n');
    const out: AssistantEvent[] = [];
    let at = buffer.indexOf('\n\n');
    while (at !== -1) {
      const ev = frameToEvent(buffer.slice(0, at));
      if (ev !== null) out.push(ev);
      buffer = buffer.slice(at + 2);
      at = buffer.indexOf('\n\n');
    }
    if (final && buffer.trim() !== '') {
      const ev = frameToEvent(buffer);
      if (ev !== null) out.push(ev);
      buffer = '';
    }
    return out;
  };
  return {
    push(chunk) {
      buffer += chunk;
      return drain(false);
    },
    flush() {
      return drain(true);
    },
  };
}

/** Read a fetch body to its end, yielding events as their frames complete. */
export async function* readAssistantStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<AssistantEvent, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = createSseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) yield ev;
    }
    for (const ev of parser.push(decoder.decode())) yield ev;
    for (const ev of parser.flush()) yield ev;
  } finally {
    reader.releaseLock();
  }
}
