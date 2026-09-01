import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A BullMQ worker that falls over is the quietest failure we have.
 *
 * Nothing 500s, no screen breaks, no request fails — the work simply
 * stops happening, and the first sign is somebody noticing days later
 * that costs stopped importing or that nobody was called back. For a
 * long time all twenty-two handlers did was `logger.error`, into a log
 * nobody reads unless they already suspect something.
 *
 * So every `worker.on('error')` must ALSO put the fact on
 * /system-issues, where a person is actually looking. This is
 * structural rather than behavioural on purpose: a new worker that
 * forgets behaves perfectly in every test anyone would think to write,
 * and the omission only shows up on the day it matters.
 */
const MODULES = join(__dirname, '..', '..', 'src', 'modules');

function workerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...workerFiles(full));
    else if (entry.endsWith('.worker.ts')) out.push(full);
  }
  return out;
}

describe('every BullMQ worker reports its errors where somebody looks', () => {
  const files = workerFiles(MODULES).filter((f) => readFileSync(f, 'utf8').includes(".on('error'"));

  it('finds the worker files at all (guards against a silent zero-file sweep)', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(files.map((f) => [f.slice(f.indexOf('src/')), f] as const))(
    '%s reports to SystemIssueService',
    (_label, file) => {
      const src = readFileSync(file, 'utf8');
      expect(src).toContain('reportWorkerError');
    },
  );
});
