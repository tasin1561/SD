import { applyLast90DaysPreset } from '../../src/modules/courier-portal/pages/wallet-date-range';

/**
 * The night of 13 Sep 2026: the balance read (which settled the page
 * first) took "Last 90 Days", the ledger download (which did not) looked
 * for the picker while their loading overlay was still up, found nothing
 * in 5s, and exported the page default — seven days. The comparison
 * between the two then could not run. The helper now settles the page
 * itself, so no reader can skip it.
 */
function recordingPage(opts: { pickerAppearsAfterSettle: boolean }) {
  const calls: string[] = [];
  let settled = false;
  const visibleAfterSettle = (name: string) => ({
    first: () => ({
      waitFor: async () => {
        calls.push(`wait:${name}`);
        if (!(settled && opts.pickerAppearsAfterSettle)) throw new Error('not visible');
      },
      click: async () => {
        calls.push(`click:${name}`);
      },
    }),
  });
  const page = {
    waitForLoadState: async () => {
      calls.push('networkidle');
    },
    locator: (sel: string) => ({
      waitFor: async () => {
        calls.push(`detached:${sel}`);
        settled = true;
      },
    }),
    waitForTimeout: async () => undefined,
    getByText: (re: RegExp) =>
      visibleAfterSettle(
        re.test('Date Range') ? 'picker' : re.test('Last 90 Days') ? 'preset' : '?',
      ),
    getByRole: () => visibleAfterSettle('done'),
  };
  return { page, calls };
}

describe('applyLast90DaysPreset settles the Finances page before looking for the picker', () => {
  it('waits for the network and the loading overlay first, then applies', async () => {
    const { page, calls } = recordingPage({ pickerAppearsAfterSettle: true });
    await expect(applyLast90DaysPreset(page as never)).resolves.toBe('APPLIED');
    expect(calls.slice(0, 3)).toEqual([
      'networkidle',
      'detached:.ap-loading__overlay',
      'wait:picker',
    ]);
    expect(calls).toContain('click:preset');
    expect(calls).toContain('click:done');
  });

  it('says NO_PICKER only after the page has settled', async () => {
    const { page, calls } = recordingPage({ pickerAppearsAfterSettle: false });
    await expect(applyLast90DaysPreset(page as never)).resolves.toBe('NO_PICKER');
    expect(calls.indexOf('detached:.ap-loading__overlay')).toBeLessThan(
      calls.indexOf('wait:picker'),
    );
  });
});
