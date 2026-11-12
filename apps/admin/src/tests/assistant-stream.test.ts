import { describe, expect, it } from 'vitest';
import { createSseParser, readAssistantStream, toAssistantEvent } from '@skydrop/ui/app/assistant';

const frame = (o: unknown): string => `data: ${JSON.stringify(o)}\n\n`;

describe('assistant SSE parser', () => {
  it('parses whole frames', () => {
    const p = createSseParser();
    const out = p.push(
      frame({ type: 'text', delta: 'Hi' }) + frame({ type: 'done', conversationId: 'c1' }),
    );
    expect(out).toEqual([
      { type: 'text', delta: 'Hi' },
      { type: 'done', conversationId: 'c1' },
    ]);
  });

  it('holds a frame split across two chunks until it is complete', () => {
    const p = createSseParser();
    const whole = frame({ type: 'text', delta: 'split me' });
    const cut = Math.floor(whole.length / 2);
    expect(p.push(whole.slice(0, cut))).toEqual([]);
    expect(p.push(whole.slice(cut))).toEqual([{ type: 'text', delta: 'split me' }]);
  });

  it('splits the blank-line terminator itself across chunks', () => {
    const p = createSseParser();
    expect(p.push('data: {"type":"tool","name":"x"}\n')).toEqual([]);
    expect(p.push('\n')).toEqual([{ type: 'tool', name: 'x' }]);
  });

  it('returns several frames from one chunk, tolerates CRLF and comments', () => {
    const p = createSseParser();
    const chunk =
      `: keep-alive\r\n\r\n${frame({ type: 'text', delta: 'a' })}${frame({ type: 'text', delta: 'b' })}`.replace(
        /\n/g,
        '\r\n',
      );
    expect(p.push(chunk).map((e) => (e.type === 'text' ? e.delta : '?'))).toEqual(['a', 'b']);
  });

  it('drops malformed or unknown frames instead of guessing', () => {
    const p = createSseParser();
    const out = p.push(
      'data: {nope\n\n' + frame({ type: 'weird' }) + frame({ type: 'text', delta: 'ok' }),
    );
    expect(out).toEqual([{ type: 'text', delta: 'ok' }]);
    expect(toAssistantEvent({ type: 'notice', code: 'NOPE', text: 'x' })).toBeNull();
  });

  it('keeps notice help links and ignores malformed ones', () => {
    const ev = toAssistantEvent({
      type: 'notice',
      code: 'RESTING_BUDGET',
      text: 'resting',
      helpLinks: [{ label: 'Tickets', path: '/tickets' }, { label: 1 }],
    });
    expect(ev).toEqual({
      type: 'notice',
      code: 'RESTING_BUDGET',
      text: 'resting',
      helpLinks: [{ label: 'Tickets', path: '/tickets' }],
    });
  });

  it('reads a fetch body, including a multi-byte character cut between chunks', async () => {
    const bytes = new TextEncoder().encode(frame({ type: 'text', delta: 'আমার অর্ডার' }));
    // Cut inside a 3-byte Bangla character.
    const at = bytes.indexOf(0xa6) + 1;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, at));
        c.enqueue(bytes.slice(at));
        c.close();
      },
    });
    const got: string[] = [];
    for await (const ev of readAssistantStream(body)) if (ev.type === 'text') got.push(ev.delta);
    expect(got).toEqual(['আমার অর্ডার']);
  });

  it('parses a final frame that lacks its trailing blank line', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"type":"done","conversationId":"z"}\n'));
        c.close();
      },
    });
    const got = [];
    for await (const ev of readAssistantStream(body)) got.push(ev);
    expect(got).toEqual([{ type: 'done', conversationId: 'z' }]);
  });
});
