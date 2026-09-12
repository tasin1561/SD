import { BadRequestException } from '@nestjs/common';
import {
  AdminTreasuryController,
  pnlWindow,
} from '../../src/modules/treasury/controllers/admin-treasury.controller';
import type { PnlService } from '../../src/modules/treasury/services/pnl.service';

/*
  The P&L report and its drill-down read the SAME window, through the
  same parser. The drill-down used to take `new Date(from)` as it came —
  an Invalid Date, which every comparison is false against, answered with
  no rows: "nothing behind this line" instead of "bad request".
*/

function makeSut(): {
  ctrl: AdminTreasuryController;
  pnl: { report: jest.Mock; lineItems: jest.Mock };
} {
  const pnl = {
    report: jest.fn(async () => ({})),
    lineItems: jest.fn(async () => ({ key: 'delivery', items: [], truncated: false })),
  };
  const none = {} as never;
  const ctrl = new AdminTreasuryController(
    none,
    none,
    none,
    pnl as unknown as PnlService,
    none,
    none,
    none,
    none,
  );
  return { ctrl, pnl };
}

async function refusal(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof BadRequestException) {
      return (e.getResponse() as { code?: string }).code;
    }
    throw e;
  }
  return undefined;
}

const FROM = '2026-07-31T18:30:00.000Z';
const TO = '2026-08-31T18:30:00.000Z';

describe('the P&L drill-down validates its window as the report does', () => {
  it('refuses a from or to that is not a date', async () => {
    const { ctrl, pnl } = makeSut();
    expect(await refusal(() => ctrl.pnlLineItems('delivery', 'x', TO))).toBe('INVALID_DATE');
    expect(await refusal(() => ctrl.pnlLineItems('delivery', FROM, 'not-a-date'))).toBe(
      'INVALID_DATE',
    );
    expect(pnl.lineItems).not.toHaveBeenCalled();
  });

  it('refuses a window that starts after it ends', async () => {
    const { ctrl } = makeSut();
    expect(await refusal(() => ctrl.pnlLineItems('delivery', TO, FROM))).toBe('INVALID_RANGE');
  });

  it('refuses a limit that is not a whole number of rows', async () => {
    const { ctrl, pnl } = makeSut();
    for (const limit of ['abc', '0', '-3', '2.5']) {
      expect(await refusal(() => ctrl.pnlLineItems('delivery', FROM, TO, limit))).toBe(
        'INVALID_LIMIT',
      );
    }
    expect(pnl.lineItems).not.toHaveBeenCalled();
  });

  it('passes a valid window and limit through as dates and a number', async () => {
    const { ctrl, pnl } = makeSut();
    await ctrl.pnlLineItems('delivery', FROM, TO, '200');
    expect(pnl.lineItems).toHaveBeenCalledWith('delivery', new Date(FROM), new Date(TO), 200);
    await ctrl.pnlLineItems('rto', FROM, TO);
    expect(pnl.lineItems).toHaveBeenLastCalledWith('rto', new Date(FROM), new Date(TO), undefined);
  });

  it('the report refuses the same things through the same parser', async () => {
    const { ctrl, pnl } = makeSut();
    expect(await refusal(() => ctrl.profitAndLoss('x', TO))).toBe('INVALID_DATE');
    expect(await refusal(() => ctrl.profitAndLoss(TO, FROM))).toBe('INVALID_RANGE');
    expect(pnl.report).not.toHaveBeenCalled();
  });

  it('defaults to the thirty days before now when neither end is given', () => {
    const w = pnlWindow(undefined, undefined);
    expect(w.to.getTime() - w.from.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(Math.abs(w.to.getTime() - Date.now())).toBeLessThan(5_000);
  });
});
