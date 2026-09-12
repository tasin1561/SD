import {
  ProbeBudget,
  ProbeBudgetExhausted,
  judgeClick,
  judgeNavigation,
} from '../../src/modules/courier-portal/services/portal-read-only-guard';

const button = (label: string, extra: Partial<Parameters<typeof judgeClick>[0]> = {}) =>
  judgeClick({ label, tag: 'button', type: 'button', inForm: false, ...extra });

describe('the read-only guard refuses anything that could change something on their side', () => {
  it.each([
    'Pay Now',
    'Payment',
    'Raise Dispute',
    'Dispute',
    'Submit',
    'Delete invoice',
    'Cancel',
    'Cancelled',
    'Update GSTIN',
    'Save',
    'Recharge wallet',
    'Add Money',
    'Top up',
    'Confirm',
    'Log out',
    'Sign out',
    'Raise a ticket',
    'Generate report',
    'anticon anticon-delete',
  ])('refuses "%s"', (label) => {
    expect(button(label).allowed).toBe(false);
  });

  it.each([
    'Download',
    'Download Invoice',
    'Export CSV',
    'View',
    'Invoices',
    'Last 90 Days',
    'Done',
    'Date Range',
    'anticon anticon-download',
  ])('allows "%s"', (label) => {
    expect(button(label).allowed).toBe(true);
  });

  it('refuses an unlabelled control — an icon with no name could be a bin', () => {
    expect(button('   ')).toEqual({ allowed: false, reason: expect.stringMatching(/unlabelled/) });
  });

  it('refuses a form submit, whatever it is called', () => {
    expect(
      judgeClick({ label: 'Download', tag: 'input', type: 'submit', inForm: true }).allowed,
    ).toBe(false);
    // A <button> in a form with no type IS a submit button (the HTML default).
    expect(button('Download', { type: '', inForm: true }).allowed).toBe(false);
    expect(button('Download', { type: 'button', inForm: true }).allowed).toBe(true);
  });

  it('judges navigation: https only, and never a url that is an action', () => {
    expect(judgeNavigation('https://one.delhivery.com/finances/unified/transactions').allowed).toBe(
      true,
    );
    expect(judgeNavigation('https://one.delhivery.com/logout').allowed).toBe(false);
    expect(judgeNavigation('https://one.delhivery.com/wallet/recharge').allowed).toBe(false);
    expect(judgeNavigation('https://one.delhivery.com/invoices?action=pay-now').allowed).toBe(
      false,
    );
    expect(judgeNavigation('http://one.delhivery.com/finances').allowed).toBe(false);
    expect(judgeNavigation('javascript:void(0)').allowed).toBe(false);
  });
});

describe('the probe budget caps pages, downloads and time', () => {
  it('stops at the page cap and the download cap', () => {
    const b = new ProbeBudget({ maxPages: 2, maxDownloads: 1 }, Number.MAX_SAFE_INTEGER);
    b.takePage();
    b.takePage();
    expect(() => b.takePage()).toThrow(new ProbeBudgetExhausted('PAGES'));
    b.takeDownload();
    expect(() => b.takeDownload()).toThrow(new ProbeBudgetExhausted('DOWNLOADS'));
    expect(b.used()).toEqual({ pages: 2, downloads: 1 });
  });

  it('stops at the deadline', () => {
    let t = 0;
    const b = new ProbeBudget({ maxPages: 99, maxDownloads: 99 }, 1_000, () => t);
    b.takePage();
    t = 1_000;
    expect(() => b.takePage()).toThrow(ProbeBudgetExhausted);
    expect(() => b.checkTime()).toThrow(ProbeBudgetExhausted);
  });
});
