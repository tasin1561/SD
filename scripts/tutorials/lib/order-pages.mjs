/**
 * Helpers for the REDESIGNED order screens, shared by `flows.mjs` and the long
 * videos (`long/*.mjs`), so three videos do not carry three copies of the same
 * selector and drift apart the next time a card is renamed.
 *
 * Every selector here is cited to the product file it comes from, because
 * none of it can be proved without the stack running.
 */

/**
 * One card of the REDESIGNED order page (`/orders/[id]`), by the id its
 * `DetailCard` gives its `<section>`: `recipient`, `items`, `notes`,
 * `parcel`, `payment`, `invoice`, `activity`
 * (`orders/_components/detail/detail-card.tsx`). Centred rather than merely
 * in view, for the reason `ordSection` gives — and, on the redesigned page,
 * so it also clears the pinned header bar above it and the "Ask Skydrop AI"
 * launcher bottom-right. A card that is not there (no parcel booked yet, no
 * notes) fails the take at once instead of dwelling on the wrong thing.
 */
export async function codCard(page, id) {
  const card = page.locator(`section#${id}.cod-card`).first();
  await card.waitFor({ state: 'visible', timeout: 25_000 });
  await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(700);
  return card;
}

/**
 * Prove `/orders/new` rendered the v2 form (the seller's `new-v2` form has a
 * sticky "Order form sections" rail and a client-order-ID field the original
 * form lacks). `orders.page_v2_audience` is a DATABASE setting, a fresh stack
 * opens on OFF and the take would then film the old form without a single
 * selector failing. See `seed-demo-data.mjs`, which sets it to ALL.
 */
export async function assertOrderFormV2(page) {
  const rail = page.getByRole('list', { name: 'Order form sections' });
  const seen = await rail
    .waitFor({ state: 'visible', timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!seen) {
    throw new Error(
      '/orders/new is not the v2 order form. Set system setting ' +
        '"orders.page_v2_audience" to ALL (seed-demo-data.mjs does) and re-run.',
    );
  }
}

/**
 * Wait for the address check's 0-100 score and return its panel. The check
 * fires by itself after the landmark settles; if it has not by then the
 * "Check address" button is pressed once. No score means the address service
 * is not configured on this stack (it reads "Address check unavailable"), and
 * the narration describes a score, so that is a hard stop, not a shrug.
 */
export async function waitForAddressScore(page) {
  const panel = page.getByRole('region', { name: 'Address check' });
  await panel.waitFor({ state: 'visible', timeout: 15_000 });
  const score = panel.locator('.sk-ac__score');
  let got = await score
    .waitFor({ state: 'visible', timeout: 7_000 })
    .then(() => true)
    .catch(() => false);
  if (!got) {
    const go = panel.getByRole('button', { name: /^Check (address|again)$/ });
    if (await go.isEnabled().catch(() => false)) await go.click();
    got = await score
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!got) {
    throw new Error(
      'The address check returned no score ("Address check unavailable"). The stack needs ' +
        'SOLUSTATION_ADDRESS_KEY and SOLUSTATION_ADDRESS_URL (or address_check.base_url) set for the api.',
    );
  }
  await page.waitForTimeout(500);
  return panel;
}

/**
 * The redesigned order page's progress stepper, centred. A
 * `<section aria-label="Order progress">` (`detail/order-stepper.tsx`), shown
 * in its wide form from a container width of 600px, which a 1920px recording
 * always has.
 */
export async function stepperRegion(page) {
  const region = page.getByRole('region', { name: 'Order progress' });
  await region.waitFor({ state: 'visible', timeout: 25_000 });
  await region.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(600);
  return region;
}

/**
 * One step of that stepper, by its label ("Confirmed by phone", "Packed",
 * "Handed to courier", "Back in your stock"...). Each is an
 * `<li class="cod-step">` (`order-stepper.tsx`), and a substring match is
 * enough because the labels are distinct. The stepper replaces the old
 * `.sk-tl__step` timeline rungs.
 */
export async function stepOf(page, label) {
  const step = page.locator('li.cod-step').filter({ hasText: label }).first();
  await step.waitFor({ state: 'visible', timeout: 25_000 });
  await step.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(600);
  return step;
}

/**
 * One line of the Activity card's "Milestones" tab: the same journey as steps,
 * but with every step's OWN detail — including the words the call agent wrote
 * against "Confirmed by phone", which the stepper only shows for the CURRENT
 * step. Opens the tab (it opens on "Full history"), then returns the row.
 */
export async function milestoneRow(page, stage, label) {
  const card = await codCard(page, 'activity');
  const tab = card.getByRole('tab', { name: /^Milestones/ });
  if ((await tab.getAttribute('aria-selected')) !== 'true') {
    await stage.clickIt(tab, { after: 700 });
  }
  const row = card.locator('li.cod-hist__row').filter({ hasText: label }).first();
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  return row;
}
