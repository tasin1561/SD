/**
 * The portal navigation that kept killing the ticket sweep.
 *
 * Delhivery's app re-asserts its own route on load, and when it does
 * that while our `goto` is in flight Playwright aborts ours and throws
 * "Navigation to X is interrupted by another navigation to X" — the
 * same url on both sides. Nothing had gone wrong; the throw killed the
 * whole sweep, five times in a day, and surfaced to an operator as
 * "Courier replies are not being collected".
 *
 * What matters here is the NARROWNESS. A helper that swallowed
 * navigation errors would hide a portal that has moved, a login
 * challenge, or a dead network — each of which must still raise.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gotoPortal } from '../../src/modules/courier-portal/pages/navigate';

type FakePage = {
  goto: jest.Mock;
  url: jest.Mock;
  waitForLoadState: jest.Mock;
};

function page(opts: { gotoErr?: Error; landsOn?: string }): FakePage {
  return {
    goto: jest.fn(async () => {
      if (opts.gotoErr) throw opts.gotoErr;
    }),
    url: jest.fn(() => opts.landsOn ?? 'https://one.delhivery.com/v2/login'),
    waitForLoadState: jest.fn(async () => undefined),
  };
}

const interrupted = new Error(
  'page.goto: Navigation to "https://one.delhivery.com/v2/login" is interrupted by another navigation to "https://one.delhivery.com/v2/login"',
);

describe('gotoPortal', () => {
  it('is an ordinary goto when nothing interrupts', async () => {
    const p = page({});
    await expect(
      gotoPortal(p as never, 'https://one.delhivery.com/v2/login'),
    ).resolves.toBeUndefined();
    expect(p.goto).toHaveBeenCalledTimes(1);
    expect(p.waitForLoadState).not.toHaveBeenCalled();
  });

  it('accepts the page redirecting to where we asked', async () => {
    const p = page({ gotoErr: interrupted, landsOn: 'https://one.delhivery.com/v2/login' });
    await expect(
      gotoPortal(p as never, 'https://one.delhivery.com/v2/login'),
    ).resolves.toBeUndefined();
    // It waits for the interrupting navigation rather than racing on.
    expect(p.waitForLoadState).toHaveBeenCalled();
  });

  it('ignores a query or hash their router appends', async () => {
    const p = page({
      gotoErr: interrupted,
      landsOn: 'https://one.delhivery.com/v2/login?src=app#/',
    });
    await expect(
      gotoPortal(p as never, 'https://one.delhivery.com/v2/login'),
    ).resolves.toBeUndefined();
  });

  it('RETHROWS when the interruption took us somewhere else', async () => {
    // "It redirected me to the app" is a real outcome and looks nothing
    // like the race — the caller has to see it.
    const p = page({ gotoErr: interrupted, landsOn: 'https://one.delhivery.com/home' });
    await expect(gotoPortal(p as never, 'https://one.delhivery.com/v2/login')).rejects.toThrow(
      /interrupted/,
    );
  });

  it('RETHROWS anything that is not this race', async () => {
    for (const err of [
      new Error('page.goto: Timeout 30000ms exceeded'),
      new Error('net::ERR_NAME_NOT_RESOLVED'),
      new Error('Target page, context or browser has been closed'),
    ]) {
      const p = page({ gotoErr: err });
      await expect(gotoPortal(p as never, 'https://one.delhivery.com/v2/login')).rejects.toThrow(
        err.message,
      );
    }
  });
});

describe('every portal navigation goes through it', () => {
  it('no page object calls page.goto directly', () => {
    // Structural, because the race is a property of THEIR app rather
    // than of any one page of ours: a new page object that reaches for
    // `page.goto` inherits the bug, and nothing behavioural would catch
    // it until the sweep died again in production.
    const root = join(__dirname, '../../src/modules/courier-portal');

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && !p.endsWith('navigate.ts')) {
          const src = readFileSync(p, 'utf8');
          if (/\.goto\(/.test(src)) offenders.push(p.replace(/.*\/courier-portal\//, ''));
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
