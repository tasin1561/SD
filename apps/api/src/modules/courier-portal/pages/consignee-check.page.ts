import type { Page } from 'playwright';

export interface ConsigneeOnPortal {
  /** Null when the field could not be read — NOT the same as empty. */
  readonly name: string | null;
  readonly phone: string | null;
  readonly address: string | null;
  /** True when we found the order at all. */
  readonly found: boolean;
}

/**
 * Read back what the courier's own screen says about a parcel.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * Their edit API returning success means they took the request, not
 * that their record changed, and the track API does not return consignee
 * details at all — so there is no way to confirm a correction landed
 * except to go and look at it.
 *
 * ── WHY NULL AND EMPTY ARE DIFFERENT HERE ────────────────────────────
 * A field we could not read is not a field that is blank. Reporting the
 * first as the second would tell a seller their customer's phone number
 * had been wiped, on the strength of a selector that stopped matching.
 * Every getter returns null on any doubt, and the caller treats null as
 * "could not verify" rather than as a value.
 */
export class ConsigneeCheckPage {
  constructor(private readonly page: Page) {}

  /**
   * Find the parcel by waybill and read the delivery details.
   *
   * The search box is the entry point rather than a URL, because their
   * order URL is keyed on an internal id we do not hold — we know the
   * AWB, which is what their own search takes.
   */
  async read(awbNumber: string): Promise<ConsigneeOnPortal> {
    await this.page.goto('https://one.delhivery.com/orders/forward', {
      waitUntil: 'domcontentloaded',
    });

    const search = this.page.getByPlaceholder(/search multiple awbs/i).first();
    const hasSearch = await search
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!hasSearch) return { name: null, phone: null, address: null, found: false };

    await search.fill(awbNumber);
    await search.press('Enter');

    // Their list re-renders in place; waiting for the AWB text is more
    // reliable than a network-idle guess on a page that polls.
    const row = this.page.getByText(awbNumber, { exact: false }).first();
    const found = await row
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!found) return { name: null, phone: null, address: null, found: false };

    await row.click().catch(() => undefined);
    // The detail view carries a "Delivery Address" block; its heading is
    // the anchor because the values around it have no stable test id.
    const anchor = this.page.getByText(/delivery address/i).first();
    const onDetail = await anchor
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!onDetail) return { name: null, phone: null, address: null, found: true };

    const block = await anchor
      .locator('xpath=ancestor::*[self::div][1]')
      .innerText()
      .catch(() => null);

    return {
      found: true,
      // Deliberately the WHOLE block rather than parsed fields. Their
      // markup gives no stable hook per value, and a comparison that
      // asks "does the new phone number appear here" is both simpler
      // and harder to get wrong than one that guesses which line is
      // which and then compares the wrong pair.
      name: block,
      phone: block,
      address: block,
    };
  }
}
