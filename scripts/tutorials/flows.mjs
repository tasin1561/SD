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
import path from 'node:path';
import { TUTORIALS_DIR } from './lib/paths.mjs';

/**
 * The CSV the bulk-import video uploads. A COMMITTED fixture rather than
 * a file written at record time: what the preview says about it — six
 * rows, four orders, one that will not import — is narrated word for
 * word, so the file and the words have to move together or not at all.
 */
const BULK_CSV = path.join(TUTORIALS_DIR, 'fixtures', 'rangpur-bulk-orders.csv');

/** The two rows of that file which share one reference, hence one order. */
const BULK_MULTI_LINE_REF = 'RSH-2026-0501';

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

/** The logo the profile video uploads. Committed, like the CSV fixture. */
const LOGO_FILE = path.join(TUTORIALS_DIR, 'fixtures', 'rangpur-silk-logo.png');

/** What the profile video types. Nothing here is a real bank. */
const PROFILE = {
  whatsapp: '+8801711223344',
  bank: {
    name: 'BRAC Bank',
    branch: 'Rangpur Branch',
    holder: 'Rangpur Silk House',
    account: '1501204536789012',
    routing: '060851726',
    // Required, not optional — the form refuses a partial account.
    swift: 'BRAKBDDH',
  },
};

/** What the consignment video declares. Keep in step with seed-demo-data.mjs. */
const CONSIGNMENT = {
  lines: [
    { search: 'Jamdani', qty: '40' },
    { search: 'Nakshi', qty: '25', unitCost: '1150' },
  ],
  reference: 'RSH-CN-2026-07',
};

/** The shopfront the store video adds. Keep in step with seed-demo-data.mjs. */
const NEW_STORE = {
  name: 'Dhaka Boutique',
  note: 'Instagram shop — same stock, different name',
};

/** The role the roles video builds. Keep in step with seed-demo-data.mjs. */
const NEW_ROLE = {
  name: 'Warehouse manager',
  purpose: 'Runs the floor — stock, parcels and returns. No access to money.',
  search: 'stock',
  // Turned ON in this order. Named by their LABEL, because that is what
  // the switch is addressable by and what a viewer reads.
  grant: ['Orders', 'Inventory'],
};

/** What the top-up video records. A real bank account of ours, a reference that is not. */
const TOPUP = {
  bank: 'BRAC Bank',
  amount: '25000',
  reference: 'TXN-BRAC-778120394',
};

/** What the stock-alert video types. Keep in step with seed-demo-data.mjs. */
const STOCK_ALERTS = {
  accountDefault: '10',
  perSku: '25',
  product: 'Jamdani Cotton Saree',
  sku: 'RSH-JAMDANI-IVORY',
};

/** What the delivery-fee video types. Anything but the seeded default. */
const CUSTOMER_DELIVERY_FEE = '90';

/**
 * Open the Settings hub from the sidebar.
 *
 * Shared by the two settings videos. The hub is the only way in to
 * either page — neither has a sidebar link of its own — so this is the
 * step both of them have to take and the one place it is written.
 */
async function openSettingsHub({ page, stage }) {
  await stage.clickIt(page.getByRole('link', { name: 'Settings', exact: true }).first(), {
    after: 1400,
  });
  await page.waitForURL(/\/settings$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
}

/**
 * Outline one or more wallet rules by their LABEL.
 *
 * `/wallet/limits` renders whatever `GET /seller/wallet/settings`
 * returns, so the list is server-driven and its order is not ours. A
 * scene pointing at "the fourth row" would keep working and start
 * describing a different rule the day one is added — which is the
 * quietest way a tutorial goes wrong. A rule that has been removed
 * upstream is SKIPPED rather than failing the take: the narration would
 * be wrong either way, and a missing row is visible in the frame check
 * while a hard failure costs the whole recording.
 */
async function dwellOnTerms(page, stage, labels, ms = 1800) {
  for (const label of labels) {
    const row = page.locator('.wal-term').filter({ hasText: label }).first();
    if ((await row.count()) === 0) continue;
    await stage.dwellOn(row, ms);
  }
}

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

/**
 * One collapsible group of the nav rail, found through its own heading.
 *
 * The heading is a BUTTON (it folds the group), so haloing the button
 * alone outlines a word and not the thing the viewer is being shown. The
 * group's container is what carries the links, and the only stable way
 * to it is "the group that contains this heading".
 */
function navGroup(page, heading) {
  return page
    .locator('.sk-nav__group')
    .filter({ has: page.getByRole('button', { name: heading, exact: true }) })
    .first();
}

/**
 * One card of a `ChoiceCards` group, by the value its radio carries.
 *
 * The visible card is a <label> wrapping a visually-hidden radio, and
 * clicking the label's TEXT is refused — the card's own decoration sits
 * over it and Playwright waits for the interception to clear, which it
 * never does. So the halo goes on the card, which is what a viewer is
 * being shown, and the radio is checked directly.
 */
function choiceCard(page, value) {
  return page.locator(`label.sk-choice:has(input[id$="-${value}"])`).first();
}

async function chooseCard({ page, stage }, value, { after = 900 } = {}) {
  const card = choiceCard(page, value);
  await stage.point(card, { settle: 600 });
  const box = await card.boundingBox();
  if (box !== null) {
    await page.evaluate(
      ([x, y]) => window.__tut.ripple(x, y),
      [box.x + box.width / 2, box.y + box.height / 2],
    );
    await page.waitForTimeout(160);
  }
  await page.locator(`input[id$="-${value}"]`).first().check();
  await page.waitForTimeout(after);
  await stage.clearHalo();
}

/** Close a popover without clicking anything inside it. */
async function dismiss(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/**
 * Set a native `<input type="date">`.
 *
 * NOT `typeIn`: a date input is a row of SEGMENTS, so typing
 * "2026-10-20" a character at a time feeds the digits into whichever
 * segment has focus and produces a date like 02/02/61020 — which the
 * server then refuses, several seconds after the mistake was made. The
 * halo still goes on first, so the viewer sees which field is being
 * filled; only the keystrokes are given up.
 */
async function setDate({ page, stage }, locator, iso) {
  await stage.point(locator, { settle: 400 });
  await locator.fill(iso);
  await page.waitForTimeout(500);
  await stage.clearHalo();
}

/** Pick a catalogue variant in the consignment form's combobox. */
async function pickVariant({ page, stage }, query) {
  await stage.typeIn(page.locator('#cn-variant'), query, { clear: true, after: 900 });
  const option = page.getByRole('option').first();
  await option.waitFor({ state: 'visible', timeout: 15_000 });
  await stage.clickIt(option, { after: 700 });
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

  'upload-bulk-orders': {
    /**
     * The `mock://` PUT shim. Local object storage is a stub, so the
     * panel's own upload cannot complete in a browser without it — see
     * `lib/spaces-shim.mjs`. The flag is read by `record.mjs`, so the
     * other two videos keep a stock `fetch`.
     */
    needsSpacesShim: true,

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1200);
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1400,
        });
        await page.waitForURL(/\/orders(\?|$)/, { timeout: 30_000 });
        await page.waitForTimeout(1800);
      },

      async 'open-import'({ page, stage }) {
        const link = page.getByRole('link', { name: /^CSV import$/ }).first();
        await stage.point(link, { settle: 900 });
        await stage.clickIt(link, { settle: 260, after: 1500 });
        await page.waitForURL(/\/orders\/import/, { timeout: 30_000 });
        await page.waitForTimeout(1200);
      },

      async template({ page, stage }) {
        // A rolling-label button: Download template → Downloading… →
        // Downloaded, which is the only sign on screen that a file came
        // down, so the dwell after the press is the point of the scene.
        //
        // WHY THIS IS WORTH A NOTE. It could not be pressed until
        // 2026-09-29: `downloadTemplate` fetched the endpoint with a raw
        // `fetch` and `credentials: 'include'` and no Authorization
        // header, while `SellerJwtGuard` is bearer-only — FE-1 keeps the
        // access token in memory and never in a cookie, so `credentials`
        // had nothing to send. It answered 401 for every seller, every
        // time, on both importers (the panel is shared with the
        // catalogue one), and the panel painted a red "Template download
        // failed: 401" that stayed up until the next upload cleared it.
        // An early take of this video filmed exactly that, under a line
        // about starting from the template — which is how it was found.
        // `downloadErrorReport` was the same shape and the same 401; both
        // go through the ApiClient now. **A screen existing is not
        // evidence its endpoint does**, and a recording is a surprisingly
        // good way to find out which.
        await stage.clickIt(page.getByRole('button', { name: /^Download template$/ }).first(), {
          settle: 800,
          after: 2600,
        });
      },

      async 'choose-file'({ page, stage }) {
        const zone = page.locator('.sk-drop__zone');
        await stage.point(zone, { settle: 900 });
        // `stage.clickIt` CANNOT drive this one: the real <input type=file>
        // is `opacity: 0; pointer-events: none` inside the zone, and a
        // native picker cannot be opened from a script anyway. Setting the
        // files on the input fires its own change event, which is the same
        // path a person's picker takes.
        await page.locator('input.sk-drop__input').setInputFiles(BULK_CSV);
        await page.waitForTimeout(900);
        // The zone's label becomes the file name once one is chosen.
        await stage.dwellOn(zone, 2000);
      },

      async preview({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Upload and check$/ }), {
          settle: 700,
          after: 900,
        });
        await page.getByText('Check before importing').waitFor({ timeout: 45_000 });
        await page.waitForTimeout(1400);
        // "<file> · 6 rows · 4 orders" — the sentence the narration reads.
        await stage.dwellOn(page.locator('.ord-mapping'), 7000);
      },

      async 'problem-row'({ page, stage }) {
        // Held for most of the scene: this and the scene before it sit on
        // the same unscrolled page, so the moving highlight is the only
        // thing telling a viewer which half is being talked about.
        await stage.dwellOn(page.locator('.ord-notice').first(), 9000);
      },

      async import({ page, stage }) {
        const button = page.getByRole('button', { name: /^Import \d+ orders?$/ });
        await stage.point(button, { settle: 1100 });
        await stage.clickIt(button, { settle: 300, after: 1600 });
      },

      async processing({ page, stage }) {
        // The table polls every 5s, so PROCESSING → terminal is not
        // instant. Wait for the run to land rather than timing it: a
        // scene that ends mid-poll shows a spinner over a line about
        // four orders having been created.
        const row = page.locator('table tbody tr').first();
        await row.waitFor({ state: 'visible', timeout: 30_000 });
        await page
          .waitForFunction(
            () => {
              const cell = document.querySelector('table tbody tr');
              return cell !== null && /done|failed|completed/i.test(cell.textContent ?? '');
            },
            undefined,
            { timeout: 60_000 },
          )
          .catch(() => {});
        await page.waitForTimeout(900);
        await stage.dwellOn(row, 2600);
        // And press the errors file the narration is naming. A download
        // shows nothing on camera, so what this actually films is the
        // ABSENCE of a red notice — which is the whole of the second half
        // of the 401 described on the `template` scene. It goes here
        // rather than in a scene of its own because the link is already
        // on screen and the line already names the file.
        await stage.clickIt(page.getByRole('button', { name: /Errors CSV/i }).first(), {
          settle: 500,
          after: 1400,
        });
      },

      async 'orders-list'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Orders', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/orders(\?|$)/, { timeout: 30_000 });
        const row = page.locator('table tbody tr').filter({ hasText: BULK_MULTI_LINE_REF }).first();
        try {
          await row.waitFor({ state: 'visible', timeout: 8_000 });
        } catch {
          // The list is a 30s-stale TanStack query and the import page
          // does not invalidate it, so a fast take can arrive back here
          // on the cached empty list. Every scene between is held open
          // for its narration, so in practice the cache has long
          // expired; this is the belt for the day it has not.
          await page.reload({ waitUntil: 'domcontentloaded' });
          await row.waitFor({ state: 'visible', timeout: 30_000 });
        }
        await page.waitForTimeout(1200);
        await stage.dwellOn(row, 2400);
      },

      async 'multi-line'({ page, stage }) {
        await stage.clickIt(
          page
            .locator('table tbody tr')
            .filter({ hasText: BULK_MULTI_LINE_REF })
            .first()
            .locator('a.ord-order-link')
            .first(),
          { settle: 500, after: 2000 },
        );
        await page.waitForURL(/\/orders\/[0-9a-f-]{20,}/, { timeout: 45_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The Items section is below the fold and says "2 lines" over a
        // row per product — which is the whole claim of this video, on
        // screen rather than only in the narration.
        const items = page.getByRole('table', { name: 'Items on this order' });
        await items.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(800);
        await stage.dwellOn(items, 3000);
      },
    },
  },

  'find-your-way-around': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1500);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async dashboard({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { name: /Treasury/i }).first(), 2400);
        await stage.glide(260);
        await page.waitForTimeout(900);
        await stage.glide(-260);
      },

      async sidebar({ page, stage }) {
        await stage.dwellOn(page.locator('[data-slot="nav-rail"]').first(), 3000);
      },

      async selling({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Selling'), 3200);
      },

      async stock({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Stock'), 3200);
      },

      async money({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Money'), 1800);
        await stage.dwellOn(navGroup(page, 'Reselling'), 2200);
      },

      async account({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Account'), 3200);
      },

      async search({ page, stage }) {
        // `type="search"`, so its implicit role is SEARCHBOX and not
        // textbox — asking for a textbox waits thirty seconds and finds
        // nothing.
        const box = page.getByLabel('Find an order or ticket').first();
        // A partial order number, so the suggestions the viewer is being
        // told about are actually on screen. The A1 seed places orders
        // for exactly this reason.
        await stage.typeIn(box, 'SD-2026', { after: 1800 });
        await page.waitForTimeout(1200);
        await dismiss(page);
        await box.fill('');
      },

      async 'quick-actions'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /Quick actions/i }).first(), {
          after: 1600,
        });
        await page.waitForTimeout(1400);
        await dismiss(page);
      },

      async bell({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Notifications/i }).first(), {
          after: 1600,
        });
        await page.waitForTimeout(1600);
        await dismiss(page);
      },

      async strip({ page, stage }) {
        await stage.dwellOn(page.locator('[data-slot="status-strip"]').first(), 3000);
      },

      async outro({ page, stage }) {
        await stage.glide(-400);
        await page.waitForTimeout(600);
        await stage.dwellOn(navGroup(page, 'Account'), 1600);
        await stage.dwellOn(navGroup(page, 'Stock'), 1600);
      },
    },
  },

  'set-up-your-profile': {
    // The logo goes through presign → PUT, and local object storage is a
    // stub. See lib/spaces-shim.mjs — it also serves the `mock://` GET
    // back as a data URL, so the logo the viewer just uploaded actually
    // APPEARS rather than rendering as a broken frame.
    needsSpacesShim: true,

    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-profile'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Profile', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/profile/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1600);
      },

      async 'edit-company'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Edit', exact: true }).first(), {
          after: 1400,
        });
        await stage.typeIn(page.getByLabel('WhatsApp'), PROFILE.whatsapp, {
          clear: true,
          after: 600,
        });
      },

      async fixed({ page, stage }) {
        await stage.dwellOn(page.getByLabel('Company name'), 2000);
        await stage.dwellOn(page.getByLabel(/^Phone/), 2000);
      },

      async 'save-company'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /Save changes/i }).first(), {
          after: 2200,
        });
        await page.waitForTimeout(1200);
      },

      async 'logo-pick'({ page, stage }) {
        const heading = page.getByRole('heading', { name: 'Company logo' }).first();
        await heading.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.dwellOn(heading, 1600);
        // The control is a styled <label> wrapping a hidden input, so the
        // file goes to the INPUT while the halo sits on what a viewer can
        // actually see.
        await stage.point(page.locator('.set-file').first(), { settle: 700 });
        await page.locator('.set-file input[type="file"]').first().setInputFiles(LOGO_FILE);
        await page.waitForTimeout(1600);
        await stage.clearHalo();
      },

      async 'logo-done'({ page, stage }) {
        const frame = page.locator('.set-logo__frame').first();
        await frame.waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(1200);
        await stage.dwellOn(frame, 2600);
      },

      async 'bank-open'({ page, stage }) {
        const heading = page.getByRole('heading', { name: 'Bank details' }).first();
        await heading.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.clickIt(page.getByRole('button', { name: 'Edit', exact: true }).last(), {
          after: 1200,
        });
        // All six fields are filled inside THIS scene. There was a
        // narrated scene of its own for them, and its line said "a SWIFT
        // code if you have one" — which the form contradicts on screen,
        // in the same shot: "All six fields are needed together". The
        // line went rather than ship a tutorial the page argues with.
        // The picture still shows every field being typed.
        //
        // Typed FASTER than the default 55 ms. Six fields at a careful
        // human rate is about eighteen seconds, and the narration for
        // this scene is eight — the rest would be silence over a form
        // filling itself. The scene is still held for the whole clip;
        // this only stops it running far past it.
        const bank = { delay: 26, after: 200, clear: true };
        await stage.typeIn(page.getByLabel('Bank name'), PROFILE.bank.name, bank);
        await stage.typeIn(page.getByLabel('Branch name'), PROFILE.bank.branch, bank);
        await stage.typeIn(page.getByLabel('Account holder name'), PROFILE.bank.holder, bank);
        await stage.typeIn(page.getByLabel('Account number'), PROFILE.bank.account, bank);
        await stage.typeIn(page.getByLabel('Routing number'), PROFILE.bank.routing, bank);
        await stage.typeIn(page.getByLabel('SWIFT code'), PROFILE.bank.swift, bank);
      },

      async 'bank-approval'({ page, stage }) {
        // BOTH labels. The submit button says "Save details" for a first
        // account and "Send for approval" once one is on file, and
        // matching only the first is how a re-take hangs on a button
        // that is no longer there. The seed clears the account so the
        // take films the first-time path; this is the backstop, and the
        // narration for this scene describes both outcomes anyway.
        await stage.clickIt(
          page.getByRole('button', { name: /Save details|Send for approval/i }).first(),
          { after: 1400 },
        );
        // Saving asks first, and WHICH question it asks is the lesson:
        // a first set of details is stored, a change to an account
        // already on file goes to Skydrop for approval.
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(2000);
        await stage.clickIt(
          dialog.getByRole('button', { name: /Send for approval|Save details/i }).first(),
          { after: 2000 },
        );
        // The closing shot. This is the last scene, so it runs on past
        // its narration and ends on the whole page rather than on a
        // dialog that has just closed.
        await page.waitForTimeout(1200);
        await stage.glide(-900);
        await page.waitForTimeout(700);
        await stage.dwellOn(page.getByRole('heading', { name: 'Company info' }).first(), 1800);
      },
    },
  },

  'announce-a-consignment': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-inbound'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Add stock', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/inbound/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1800);
      },

      async 'open-form'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Announce a consignment' }).first(), {
          after: 1600,
        });
        await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(1200);
      },

      async route({ page, stage }) {
        await stage.dwellOn(page.locator('#cn-route-h'), 2800);
      },

      async 'route-info'({ page, stage }) {
        await stage.clickIt(
          page.getByRole('button', { name: /What do the routes mean/i }).first(),
          { after: 1600 },
        );
        await page.waitForTimeout(2400);
      },

      async 'route-pick'(ctx) {
        await chooseCard(ctx, 'VIA_BD', { after: 1800 });
      },

      async 'first-line'({ page, stage }) {
        const line = CONSIGNMENT.lines[0];
        await pickVariant({ page, stage }, line.search);
        await stage.typeIn(page.locator('#cn-qty'), line.qty, { clear: true, after: 500 });
        await stage.clickIt(
          page.getByRole('button', { name: 'Add this product to the consignment' }),
          { after: 1400 },
        );
      },

      async 'unit-cost'({ page, stage }) {
        const line = CONSIGNMENT.lines[1];
        await pickVariant({ page, stage }, line.search);
        await stage.typeIn(page.locator('#cn-qty'), line.qty, { clear: true, after: 400 });
        await stage.typeIn(page.locator('#cn-cost'), line.unitCost, { clear: true, after: 1400 });
      },

      async 'second-line'({ page, stage }) {
        await stage.clickIt(
          page.getByRole('button', { name: 'Add this product to the consignment' }),
          { after: 1800 },
        );
      },

      async details(ctx) {
        const { page, stage } = ctx;
        // Three weeks out: far enough to read as a real crossing rather
        // than as whatever today happens to be.
        const eta = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
        await setDate(ctx, page.locator('#cn-eta'), eta.toISOString().slice(0, 10));
        await stage.typeIn(page.locator('#cn-ref'), CONSIGNMENT.reference, {
          clear: true,
          after: 700,
        });
      },

      async announce({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Announce \d+ product/ }).first(), {
          after: 2400,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1600);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(
          page.getByRole('heading', { name: 'Consignment register' }).first(),
          1800,
        );
        await stage.glide(220);
        await page.waitForTimeout(1600);
      },
    },
  },

  'add-a-shopfront': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-settings'(ctx) {
        await openSettingsHub(ctx);
      },

      async 'open-stores'({ page, stage }) {
        // The tile by HREF, not by accessible name. A ListRow puts the
        // title AND the description inside one <a>, so a name match is
        // matching a paragraph — and the paragraph is the thing most
        // likely to be reworded.
        const tile = page.locator('a[href="/settings/stores"]').first();
        await stage.dwellOn(tile, 2200);
        await stage.clickIt(tile, { after: 1400 });
        await page.waitForURL(/\/settings\/stores/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async shared({ page, stage }) {
        // The sentence the whole video exists to say, in the app's own
        // words. Filming the page saying it is worth more than the
        // narration saying it alone.
        await stage.dwellOn(page.locator('.set-card__lead').first(), 2600);
      },

      async tiles({ page, stage }) {
        await stage.dwellOn(page.locator('.set-kpis').first(), 3000);
      },

      async add({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add a store' }).first(), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The dialog's own description makes the promise the narration
        // is about — a new store never becomes the default.
        await stage.dwellOn(dialog.locator('p').first(), 2200);
      },

      async name({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.typeIn(dialog.getByLabel('Name'), NEW_STORE.name, { after: 500 });
        await stage.typeIn(dialog.getByLabel('Note'), NEW_STORE.note, {
          delay: 34,
          after: 500,
        });
      },

      async saved({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add store' }).first(), {
          after: 1800,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
        const row = page.getByRole('row').filter({ hasText: NEW_STORE.name });
        await row.first().waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(row.first(), 2400);
      },

      async close({ page, stage }) {
        // Close and REOPEN in one scene: the narration says both in one
        // breath ("you can reopen it whenever you like"), and splitting
        // them would leave a scene whose only content is undoing the
        // previous one.
        const row = () => page.getByRole('row').filter({ hasText: NEW_STORE.name }).first();
        await stage.clickIt(row().getByRole('button', { name: 'Close' }), { after: 900 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2200);
        await stage.clickIt(page.getByRole('button', { name: 'Close store' }).first(), {
          after: 1600,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForTimeout(900);

        await stage.clickIt(row().getByRole('button', { name: 'Reopen' }), { after: 900 });
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(page.getByRole('button', { name: 'Reopen store' }).first(), {
          after: 1400,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForTimeout(900);
      },

      async 'make-default'({ page, stage }) {
        const row = page.getByRole('row').filter({ hasText: NEW_STORE.name }).first();
        await stage.clickIt(row.getByRole('button', { name: 'Make default' }), { after: 900 });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2600);
        await stage.clickIt(page.getByRole('button', { name: 'Make default' }).last(), {
          after: 1800,
        });
        await dialog.waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForTimeout(1200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.set-kpis').first(), 2600);
        await stage.dwellOn(page.getByRole('table').first(), 2200);
      },
    },
  },

  'set-your-delivery-fee': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-settings'(ctx) {
        await openSettingsHub(ctx);
      },

      async 'open-defaults'({ page, stage }) {
        const tile = page.locator('a[href="/settings/orders"]').first();
        await stage.dwellOn(tile, 2000);
        await stage.clickIt(tile, { after: 1400 });
        await page.waitForURL(/\/settings\/orders/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
      },

      async 'whose-figure'({ page, stage }) {
        // The badge, not the field. It is the one thing about this page
        // a glance cannot tell you, and the seed clears the seller's
        // override precisely so this take opens on "Skydrop default".
        await stage.dwellOn(page.locator('.sk-sh__note .set-fact').first(), 3000);
      },

      async 'not-ours'({ page, stage }) {
        await stage.dwellOn(page.locator('.set-form-grid p.set-muted').first(), 3000);
      },

      async type({ page, stage }) {
        await stage.typeIn(page.getByLabel(/Delivery fee charged/i), CUSTOMER_DELIVERY_FEE, {
          clear: true,
          after: 800,
        });
      },

      async save({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Save/ }).first(), { after: 2000 });
        // The badge FLIPS on success, which is the proof the save landed
        // and the thing the narration points at. Waited for by text
        // rather than by a fixed pause.
        await page
          .locator('.sk-sh__note .set-fact')
          .filter({ hasText: 'Your own figure' })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.sk-sh__note .set-fact').first(), 2400);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2400);
        await stage.dwellOn(page.getByLabel(/Delivery fee charged/i), 2000);
      },
    },
  },

  'be-told-before-you-run-out': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-settings'(ctx) {
        const { page, stage } = ctx;
        await openSettingsHub(ctx);
        const tile = page.locator('a[href="/settings/stock"]').first();
        await stage.clickIt(tile, { after: 1400 });
        await page.waitForURL(/\/settings\/stock/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async state({ page, stage }) {
        // The seed clears the seller's default precisely so this opens
        // on "Off — nothing alerts by default", which is the state the
        // narration describes and the one a new seller is actually in.
        await stage.dwellOn(page.locator('.sk-sh__note .set-fact').first(), 3000);
      },

      async 'blank-vs-zero'({ page, stage }) {
        await stage.dwellOn(page.locator('form.set-form-grid p.set-muted').first(), 3200);
      },

      async 'set-default'({ page, stage }) {
        await stage.typeIn(page.getByLabel('Default threshold'), STOCK_ALERTS.accountDefault, {
          clear: true,
          after: 800,
        });
      },

      async saved({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Save/ }).first(), { after: 1800 });
        // The badge flipping is the proof the save landed, and it is
        // what the narration points at. Waited for by its text.
        await page
          .locator('.sk-sh__note .set-fact')
          .filter({ hasText: /Warning below/ })
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.sk-sh__note .set-fact').first(), 2400);
      },

      async 'open-variant'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Products', exact: true }).first(), {
          after: 1400,
        });
        await page.waitForURL(/\/products/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(
          page.getByRole('link', { name: STOCK_ALERTS.product, exact: true }).first(),
          { after: 1600 },
        );
        await page.waitForLoadState('networkidle').catch(() => {});
        // The SKU code IS the link to the variant — there is no other
        // control on the row that opens it.
        await stage.clickIt(page.getByRole('link', { name: STOCK_ALERTS.sku }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/variants\//, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async 'per-sku'({ page, stage }) {
        const field = page.getByLabel('Low-stock alert at');
        await field.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(field, 2800);
      },

      async override({ page, stage }) {
        await stage.typeIn(page.getByLabel('Low-stock alert at'), STOCK_ALERTS.perSku, {
          clear: true,
          after: 700,
        });
        // The Save beside the field, not the page's other buttons —
        // scoped to the panel that owns it.
        await stage.clickIt(
          page
            .locator('.inv-lookup')
            .filter({ has: page.getByLabel('Low-stock alert at') })
            .getByRole('button', { name: /^Save/ })
            .first(),
          { after: 2000 },
        );
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByLabel('Low-stock alert at'), 2400);
        await stage.glide(-240);
        await page.waitForTimeout(1400);
      },
    },
  },

  'what-skydrop-charges': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-limits'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Wallet', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/wallet$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(900);
        await stage.clickIt(page.locator('a[href="/wallet/limits"]').first(), { after: 1600 });
        await page.waitForURL(/\/wallet\/limits/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async framing({ page, stage }) {
        // The page's own subtitle says who sets these and invites the
        // question the last scene answers.
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 1400);
        await stage.dwellOn(page.locator('.wal-terms').first(), 2600);
      },

      // Each of the next four dwells on the RULES it is about, found by
      // their labels rather than by position: the list is server-driven
      // (`GET /seller/wallet/settings`), so a rule added or reordered
      // upstream must not silently make a scene point at a different row.
      async withdrawals({ page, stage }) {
        await dwellOnTerms(page, stage, ['Minimum balance', 'Smallest withdrawal']);
        await dwellOnTerms(page, stage, ['Withdrawals per day', 'Withdrawals per month']);
      },

      async 'cod-timing'({ page, stage }) {
        await dwellOnTerms(page, stage, ['COD credited'], 2600);
        await dwellOnTerms(page, stage, ['Instant-pay fee'], 2000);
      },

      async deductions({ page, stage }) {
        await dwellOnTerms(page, stage, ['GST withheld on COD'], 2600);
        await dwellOnTerms(page, stage, ['COD collection fee'], 2200);
      },

      async charges({ page, stage }) {
        await dwellOnTerms(page, stage, ['Delivery fee charged'], 2400);
        await dwellOnTerms(page, stage, ['Inbound freight terms', 'Pay-later service charge']);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.wal-setting__desc').first(), 2400);
        await stage.glide(-320);
        await page.waitForTimeout(1400);
      },
    },
  },

  'pay-money-in': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-wallet'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Wallet', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/wallet$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
      },

      async 'choose-account'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /Top-up wallet/i }).first(), {
          after: 1600,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await page.locator('.wal-bank').first().waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.wal-banks').first(), 2600);
      },

      async 'pick-bd'({ page, stage }) {
        // The TAKA account on purpose. It is the one that makes the next
        // scene mean anything — an INR account shows no conversion, so
        // the "rupee equivalent underneath" the narration points at
        // would be the same number twice.
        await stage.clickIt(page.locator('.wal-bank').filter({ hasText: TOPUP.bank }).first(), {
          after: 1800,
        });
        await page.waitForTimeout(900);
      },

      async amount({ page, stage }) {
        await stage.typeIn(page.getByLabel(/Amount you paid/i), TOPUP.amount, { after: 1200 });
      },

      async evidence({ page, stage }) {
        await stage.typeIn(page.getByLabel(/Transaction ID/i), TOPUP.reference, { after: 800 });
        // The receipt drop zone is POINTED AT, not used. Either one
        // satisfies the requirement, and uploading would mean inventing
        // a bank document to put on camera — a fabricated record is not
        // something to put in a tutorial, and the narration says the two
        // are alternatives anyway.
        await stage.dwellOn(page.locator('.sk-dropzone, [class*="drop"]').first(), 1800);
      },

      async submit({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /Record|Submit/i }).last(), {
          after: 2400,
        });
      },

      async claim({ page, stage }) {
        await page
          .getByRole('heading', { name: /We have your top-up/i })
          .waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(page.locator('.wal-done__body').first(), 2600);
        await stage.dwellOn(page.locator('.wal-done__aside').first(), 2200);
      },

      async outro({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Done|^Close/i }).last(), {
          after: 1800,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.getByRole('table').first(), 2600);
      },
    },
  },

  'build-a-role': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-roles'({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Roles', exact: true }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/team\/roles/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 1600);
      },

      async 'the-list'({ page, stage }) {
        await stage.dwellOn(page.getByRole('table').first(), 2200);
        await stage.dwellOn(page.getByRole('row').filter({ hasText: 'Owner' }).first(), 2200);
      },

      async 'new-role'({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'New role' }).first(), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.typeIn(dialog.getByLabel('Name'), NEW_ROLE.name, { after: 700 });
      },

      async purpose({ page, stage }) {
        const dialog = page.getByRole('dialog');
        await stage.typeIn(dialog.getByLabel(/What this role is for/i), NEW_ROLE.purpose, {
          delay: 30,
          after: 700,
        });
      },

      async groups({ page, stage }) {
        await stage.dwellOn(page.locator('.role-perms__list').first(), 3000);
      },

      async search({ page, stage }) {
        // Typed into the search to show it matching the KEY, then
        // cleared — the next scene needs the full list back.
        await stage.typeIn(page.getByLabel('Search permissions'), NEW_ROLE.search, { after: 1800 });
        await page.getByLabel('Search permissions').fill('');
        await page.waitForTimeout(800);
      },

      async pick({ page, stage }) {
        // Scoped to the GROUP's own accordion item, so a switch from
        // another area can never be the one that gets ticked.
        //
        // And it THROWS when it ticks nothing. The first version skipped
        // quietly on a selector miss, which passed `--check` twice while
        // saving a role with zero permissions — a video whose whole
        // middle is choosing permissions, filming a form where none were
        // chosen. A step that cannot do its job must say so; that is the
        // entire reason check mode exists.
        let ticked = 0;
        for (const group of NEW_ROLE.grant) {
          const item = page
            .locator('.sk-acc__item')
            .filter({ has: page.locator('.sk-acc__title', { hasText: group }) })
            .first();
          await item.waitFor({ state: 'visible', timeout: 20_000 });
          await stage.clickIt(item.locator('.sk-acc__trigger').first(), { after: 800 });

          const switches = item.locator('[role="switch"]');
          const n = Math.min(2, await switches.count());
          if (n === 0) throw new Error(`No permission switches inside the "${group}" group`);
          for (let i = 0; i < n; i += 1) {
            await stage.clickIt(switches.nth(i), { settle: 300, after: 450 });
            ticked += 1;
          }
        }
        if (ticked === 0) throw new Error('The role would save with no permissions at all');
      },

      async sensitive({ page, stage }) {
        await stage.dwellOn(page.locator('.role-perms__summary').first(), 3000);
      },

      async save({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Create role|^Save/ }).last(), {
          after: 2200,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.getByRole('row').filter({ hasText: NEW_ROLE.name }).first(), 2000);
      },

      async remove({ page, stage }) {
        await stage.clickIt(
          page
            .getByRole('row')
            .filter({ hasText: NEW_ROLE.name })
            .first()
            .getByRole('button', { name: 'Edit' }),
          { after: 1400 },
        );
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // Turn OFF the first permission that is on, whichever it is.
        // Re-opening the editor draws every group CLOSED, so the switch
        // that is on sits inside a collapsed panel — Playwright found it,
        // scrolled to it, and clicked the accordion header that was
        // covering it, for thirty seconds. Open the group first.
        const item = page
          .locator('.sk-acc__item')
          .filter({ has: page.locator('.sk-acc__title', { hasText: NEW_ROLE.grant[0] }) })
          .first();
        await item.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(item.locator('.sk-acc__trigger').first(), { after: 800 });

        // `aria-checked`, which is what the Switch actually sets — it
        // carries no `data-state`, and asking for one waited 30 s and
        // timed out.
        const on = item.locator('[role="switch"][aria-checked="true"]').first();
        await on.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(on, { after: 900 });
        await stage.clickIt(page.getByRole('button', { name: /^Save/ }).last(), { after: 1400 });
        // The confirmation naming what goes — the scene's whole point.
        await page
          .getByRole('heading', { name: /Remove permissions from this role/i })
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(page.locator('.sk-confirm__consequence').first(), 2600);

        // Backed out HERE rather than at the top of the next scene.
        // The lesson was the question, and going through with it would
        // leave the role in a different shape than the one just built on
        // camera — but the dismissal belongs to THIS scene's tail: a
        // scene should open on the thing it is about, and the first take
        // spent its first two seconds watching this editor close while
        // the narration was already talking about the Owner row.
        await stage.clickIt(page.getByRole('button', { name: 'Cancel' }).last(), { after: 800 });
        await page.keyboard.press('Escape');
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 20_000 });
        await page.waitForTimeout(600);
      },

      async owner({ page, stage }) {
        await stage.dwellOn(page.getByRole('row').filter({ hasText: 'Owner' }).first(), 3200);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.getByRole('table').first(), 2600);
      },
    },
  },

  'sign-out-everywhere': {
    async prologue(ctx) {
      await signIn(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2200);
      },

      async 'open-security'(ctx) {
        const { page, stage } = ctx;
        await openSettingsHub(ctx);
        await stage.clickIt(page.locator('a[href="/settings/security"]').first(), { after: 1400 });
        await page.waitForURL(/\/settings\/security/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
      },

      async 'this-session'({ page, stage }) {
        await stage.dwellOn(page.locator('.set-dl').first(), 3000);
      },

      async 'no-list'({ page, stage }) {
        // An ABSENCE, so there is nothing to point at. The page header
        // is what the narration is really talking about — "who this
        // browser is signed in as", singular.
        await stage.dwellOn(page.getByRole('heading', { name: 'This session' }).first(), 2600);
      },

      async 'what-it-does'({ page, stage }) {
        const heading = page.getByRole('heading', { name: 'Sign out everywhere' }).first();
        await heading.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await stage.dwellOn(page.locator('.set-card[data-tone="danger"] p').first(), 3000);
      },

      async 'not-touched'({ page, stage }) {
        await stage.dwellOn(page.locator('.set-card[data-tone="danger"] .set-muted').first(), 3000);
      },

      async confirm({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Sign out everywhere' }).last(), {
          after: 1200,
        });
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2600);

        // Answered HERE, in this scene's tail, so the next one opens on
        // the RESULT rather than on this dialog dismissing — the same
        // correction the roles video needed. A scene should open on the
        // thing it is about.
        await stage.clickIt(page.getByRole('button', { name: 'Sign out everywhere' }).last(), {
          after: 1200,
        });
        await page
          .getByText(/Sessions ended/i)
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 });
        await page.waitForTimeout(600);
      },

      async done({ page, stage }) {
        // THE LAST SCENE, and it has to be: the click in the scene above
        // ended the session this recording is running in. Anything after
        // it would be filmed signed out.
        await stage.dwellOn(page.locator('.set-card[aria-live="polite"]').first(), 3400);
      },
    },
  },
};
