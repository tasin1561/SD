import type { Page } from 'playwright';

/**
 * Which date window a reading of Delhivery's Finances page covers.
 *
 * Their "Total Debit" and the Download Ledger file are both for the range
 * the page currently has selected, so two readings can only be compared
 * when they were taken over the SAME window. `UNKNOWN` is a reading where
 * we tried to set the range and cannot say whether it took; it is never
 * compared against anything.
 */
export type WalletWindow = 'LAST_90_DAYS' | 'CUSTOM_RANGE' | 'PAGE_DEFAULT' | 'UNKNOWN';

/** True when two Finances readings covered the same, known window. */
export function sameWalletWindow(a: WalletWindow, b: WalletWindow): boolean {
  return a === b && (a === 'LAST_90_DAYS' || a === 'PAGE_DEFAULT');
}

export type PresetOutcome = 'APPLIED' | 'NO_PICKER' | 'NO_PRESET';

/**
 * Choose "Last 90 Days" in the Finances page's date picker.
 *
 * ONE implementation for both readers of that page — the ledger download
 * and the balance line — because the check between them is only true
 * when they took the same range. They drifted apart once already: the
 * export moved to ninety days (COST-1, 11 Sep 2026) while the balance
 * read stayed on the page default, and the nightly comparison then raised
 * HIGH "the export does not match their own page" (₹1,07,303.22 stated
 * against ₹12,28,010.68 exported) over two different windows.
 *
 * Their picker is a list of named ranges beside a month grid, then Done;
 * it has no `input[type="date"]`. On `NO_PRESET` the panel is left OPEN so
 * a caller with another way to set the range can still use it. May throw
 * on a click that fails; callers decide what that means.
 */
export async function applyLast90DaysPreset(page: Page): Promise<PresetOutcome> {
  // Settle FIRST (14 Sep 2026). The ledger download opened the page and
  // looked for the picker straight away with 5s to find it; on the night
  // of the 13th their app was still behind its loading overlay, the
  // picker "was not there", and the export came back at the page's
  // default seven days — while the balance read, which settled first,
  // took ninety the same night. The two readings then could not be
  // compared at all. Waiting here, in the one helper, means neither
  // reader can skip it.
  await settleFinancesPage(page);
  const trigger = page.getByText(/date range/i).first();
  const found = await trigger
    .waitFor({ state: 'visible', timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!found) return 'NO_PICKER';

  await trigger.click();
  // The panel animates in; its buttons are not hittable immediately.
  await page.waitForTimeout(700);

  const preset = page.getByText(/^last 90 days$/i).first();
  const hasPreset = await preset
    .waitFor({ state: 'visible', timeout: 4_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasPreset) return 'NO_PRESET';

  await preset.click();
  // Done COMMITS the choice. Without it the panel closes on the next
  // outside click and the range reverts — the reading then looks like it
  // was asked for and silently was not.
  await page
    .getByRole('button', { name: /^done$/i })
    .first()
    .click()
    .catch(() => undefined);
  // Their table and totals re-query on commit; reading mid-refresh gets
  // the previous range.
  await page.waitForTimeout(1_500);
  return 'APPLIED';
}

/**
 * Let the Finances page finish drawing: network quiet, their loading
 * overlay gone, then a beat for the widgets to become hittable. Each wait
 * is bounded and never throws — a page that stays busy is read as it is,
 * and the reading says which window it got.
 */
export async function settleFinancesPage(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 25_000 }).catch(() => undefined);
  await page
    .locator('.ap-loading__overlay')
    .waitFor({ state: 'detached', timeout: 20_000 })
    .catch(() => undefined);
  await page.waitForTimeout(1_500);
}
