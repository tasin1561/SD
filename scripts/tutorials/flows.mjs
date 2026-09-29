/**
 * What the camera actually does, per video, one function per narrated
 * step.
 *
 * A step's function only has to PERFORM the action — `record.mjs` holds
 * the scene open for at least as long as its narration clip, so a short
 * action is padded rather than rushed and a long one simply makes the
 * scene longer. That is why nothing here counts seconds: the audio owns
 * the timing, the flow owns the actions.
 *
 * Keys match `narration.mjs` step ids exactly. A mismatch is caught by
 * `record.mjs` before the browser opens, because a step with no action
 * would otherwise record a still frame and nobody would notice until the
 * video was watched.
 */

/** Who the demo order goes to. Plausible, and nobody real. */
const CUSTOMER = {
  name: 'Ananya Iyer',
  phone: '9845017722',
  line1: '412, Brigade Gateway, Malleshwaram West',
  line2: 'Opposite Orion Mall, next to the HDFC ATM',
  pin: '560055',
  reference: 'RSH-2026-0412',
  note: 'Customer asked for delivery after 5pm on weekdays.',
  collectable: '4400',
};

/** The product the second video creates. Keep in step with seed-demo-data.mjs. */
const NEW_PRODUCT = {
  name: 'Rajshahi Silk Kurti',
  externalRef: 'RSH-KURTI',
  weightGrams: '320',
  declaredValueInr: '1750',
  colours: ['Emerald', 'Indigo'],
  sizes: ['Medium', 'Large'],
  editedSku: 'RSH-KURTI-EMR-M',
};

/**
 * Sign in off camera.
 *
 * Shared by both videos, and it reports a REFUSAL rather than a timeout:
 * seller login is throttled at 5 attempts per 15 minutes per email+IP,
 * so a re-take taken too soon after a run of probes fails here — and
 * "waitForURL timed out" reads as a broken selector, which is half an
 * hour of looking in the wrong place. The page's own verdict is on
 * screen; this puts it in the error.
 */
async function signIn({ page, stage, baseUrl, seller }) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/email/i).first().fill(seller.email);
  await page
    .getByLabel(/password/i)
    .first()
    .fill(seller.password);
  await page
    .getByRole('button', { name: /sign in|log in/i })
    .first()
    .click();

  try {
    await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
  } catch (e) {
    const verdict =
      (await page
        .locator('body')
        .innerText()
        .catch(() => '')) ?? '';
    const line = verdict
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /\[[A-Z_]+\]|too many|invalid|incorrect/i.test(l));
    throw new Error(
      line === undefined
        ? `Sign-in did not reach the dashboard: ${e.message}`
        : `Sign-in refused: ${line}\n(seller login is throttled 5 per 15 minutes per email+IP)`,
    );
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await stage.clearHalo();
  await page.waitForTimeout(1200);
}

/** One value chip of the SIZE option, under a named colour. */
function sizeChip(page, colour, index) {
  return page.getByRole('textbox', { name: `Size for ${colour} value ${index}`, exact: true });
}

/**
 * The "Add value" button belonging to one colour's list. It carries no
 * name of its own — every list has one — so it is found through a chip
 * that DOES name its colour.
 */
function addSizeValue(page, colour) {
  return page
    .locator('.prd-parent')
    .filter({ has: sizeChip(page, colour, 1) })
    .getByRole('button', { name: 'Add value' });
}

export const FLOWS = {
  'place-an-order': {
    /** Everything before scene one: sign in and land where the intro expects. */
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        // Let the dashboard breathe, then show there is more below it.
        await page.waitForTimeout(1600);
        await stage.glide(320);
        await page.waitForTimeout(900);
        await stage.glide(-320);
      },

      async 'open-form'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1400,
        });
        await page.waitForURL(/\/orders(\?|$)/, { timeout: 30_000 });
        await page.waitForTimeout(1400);
        await stage.clickIt(page.getByRole('link', { name: /^New order$/ }).first(), {
          after: 1500,
        });
        await page.waitForURL(/\/orders\/new/, { timeout: 30_000 });
        await page.waitForTimeout(700);
      },

      async recipient({ page, stage }) {
        await stage.typeIn(page.getByLabel('Full name'), CUSTOMER.name);
        await stage.typeIn(page.getByLabel(/^Phone number,/), CUSTOMER.phone, { delay: 70 });
        await stage.typeIn(page.getByLabel('Address line 1'), CUSTOMER.line1, { delay: 34 });
      },

      async landmark({ page, stage }) {
        await stage.typeIn(page.getByLabel('Address line 2 (the landmark)'), CUSTOMER.line2, {
          delay: 36,
          after: 900,
        });
      },

      async pincode({ page, stage }) {
        await stage.typeIn(page.getByLabel('PIN code'), CUSTOMER.pin, { delay: 130, after: 1500 });
        // The serviceability chip resolves a beat after the sixth digit.
        await page.waitForTimeout(1200);
      },

      async reference({ page, stage }) {
        await stage.typeIn(page.getByLabel('Your reference'), CUSTOMER.reference, { delay: 60 });
        await stage.typeIn(page.getByLabel('Notes for the call agent'), CUSTOMER.note, {
          delay: 32,
          after: 800,
        });
      },

      async products({ page, stage }) {
        const catalogue = page.getByRole('button', { name: 'Add RSH-JAMDANI-IVORY' });
        await stage.point(catalogue, { settle: 900 });
        await stage.clickIt(catalogue, { settle: 260, after: 1100 });
      },

      async quantity({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add RSH-SCARF-EMERALD' }), {
          after: 1000,
        });
        const qty = page.getByRole('button', { name: 'Increase Quantity of RSH-SCARF-EMERALD' });
        await stage.point(qty, { settle: 500 });
        await qty.click();
        await page.waitForTimeout(1400);
        await stage.clearHalo();
      },

      async payment({ page, stage }) {
        const field = page.getByLabel('Collectable amount (INR)');
        await stage.typeIn(field, CUSTOMER.collectable, { delay: 150, clear: true, after: 1200 });
      },

      async submit({ page, stage }) {
        await page.waitForTimeout(700);
        // The sticky bar's button OPENS a confirmation dialog; the dialog
        // carries a button of the same name, so both halves are needed and
        // the second must be scoped to the dialog or it re-finds the first.
        const bar = page.getByRole('button', { name: /^Submit for confirmation$/ }).last();
        await stage.clickIt(bar, { settle: 900, after: 900 });

        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(1600);
        await stage.clickIt(dialog.getByRole('button', { name: /^Submit for confirmation$/ }), {
          settle: 500,
          after: 2200,
        });
        await page.waitForURL(/\/orders\/[0-9a-f-]{20,}/, { timeout: 45_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
      },

      async detail({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.glide(420);
        await page.waitForTimeout(1000);
      },
    },
  },

  'add-a-product-with-variations': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1500);
        await stage.glide(300);
        await page.waitForTimeout(900);
        await stage.glide(-300);
      },

      async 'open-form'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Products', exact: true }).first(), {
          after: 1500,
        });
        await page.waitForURL(/\/products(\?|$)/, { timeout: 30_000 });
        await page.waitForTimeout(1600);
        await stage.clickIt(page.getByRole('link', { name: /^New product$/ }).first(), {
          after: 1500,
        });
        await page.waitForURL(/\/products\/new/, { timeout: 30_000 });
      },

      async name({ page, stage }) {
        await stage.typeIn(page.getByLabel('Product name'), NEW_PRODUCT.name, { delay: 58 });
        await stage.typeIn(page.getByLabel('Your product ID'), NEW_PRODUCT.externalRef, {
          delay: 80,
        });
      },

      async shared({ page, stage }) {
        await stage.typeIn(page.getByLabel('Weight (g)'), NEW_PRODUCT.weightGrams, { delay: 130 });
        await stage.typeIn(page.getByLabel('Declared value (₹)'), NEW_PRODUCT.declaredValueInr, {
          delay: 110,
          after: 900,
        });
      },

      async 'option-colour'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add an option' }), { after: 800 });
        await stage.typeIn(page.locator('#option-0-name'), 'Colour', { delay: 90 });
        await stage.typeIn(
          page.getByRole('textbox', { name: 'Colour value 1', exact: true }),
          NEW_PRODUCT.colours[0],
          { delay: 70 },
        );
        // "Add value" appears once per option, so it is scoped to this
        // one's <section aria-label>, which carries the option's name.
        await stage.clickIt(
          page.getByRole('region', { name: 'Colour' }).getByRole('button', { name: 'Add value' }),
          { settle: 240, after: 500 },
        );
        await stage.typeIn(
          page.getByRole('textbox', { name: 'Colour value 2', exact: true }),
          NEW_PRODUCT.colours[1],
          {
            delay: 70,
            after: 800,
          },
        );
      },

      async 'option-size'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add an option' }), { after: 800 });
        await stage.typeIn(page.locator('#option-1-name'), 'Size', { delay: 110, after: 900 });
        // The SECOND option is always per-parent (`perParent: {}` in the
        // form), so it draws one value list per colour. That is the thing
        // worth showing here, and it is why the values get a step of
        // their own below.
        await stage.dwellOn(page.getByRole('region', { name: 'Size' }), 1600);
      },

      async 'size-values'({ page, stage }) {
        for (const colour of NEW_PRODUCT.colours) {
          await stage.typeIn(sizeChip(page, colour, 1), NEW_PRODUCT.sizes[0], { delay: 75 });
          await stage.clickIt(addSizeValue(page, colour), { settle: 220, after: 420 });
          await stage.typeIn(sizeChip(page, colour, 2), NEW_PRODUCT.sizes[1], {
            delay: 75,
            after: 700,
          });
        }
      },

      async variants({ page, stage }) {
        await stage.glide(560);
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('table').last(), 2400);
      },

      async sku({ page, stage }) {
        // Row labels are the option values joined with " / " — see the
        // form's own `parts.join(' / ')`.
        const label = `SKU for ${NEW_PRODUCT.colours[0]} / ${NEW_PRODUCT.sizes[0]}`;
        const byLabel = page.getByLabel(label);
        const target =
          (await byLabel.count()) > 0
            ? byLabel
            : page.locator('table').last().locator('input').first();
        await stage.typeIn(target, NEW_PRODUCT.editedSku, { delay: 70, clear: true, after: 1400 });
      },

      async save({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Create product$/ }), {
          settle: 900,
          after: 3000,
        });
        await page.waitForURL(/\/products\/[0-9a-f-]{20,}/, { timeout: 60_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
      },

      async done({ page, stage }) {
        await page.waitForTimeout(1500);
        await stage.glide(380);
        await page.waitForTimeout(1200);
      },
    },
  },
};
