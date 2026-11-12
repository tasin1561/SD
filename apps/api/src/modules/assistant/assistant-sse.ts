import type { Response } from 'express';
import type { AssistantStreamEvent } from './assistant.types';

/**
 * Opens a Server-Sent Events response and hands the caller an `emit`.
 * Anything that can still be a plain HTTP error (a 404 on someone else's
 * conversation, a 400 on the body) must be thrown BEFORE this is called:
 * once the headers are out, the status is spent.
 */
export async function streamAnswer(
  res: Response,
  run: (emit: (event: AssistantStreamEvent) => void) => Promise<void>,
): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Tell a reverse proxy not to buffer the stream.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const emit = (event: AssistantStreamEvent): void => {
    if (!res.writableEnded && !res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  try {
    // A client that closes the tab does not cancel the turn: the model call
    // is already paid for and the answer is stored for their next visit.
    await run(emit);
  } finally {
    if (!res.writableEnded) res.end();
  }
}
