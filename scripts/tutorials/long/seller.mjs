/**
 * THE LONG SELLER VIDEO — four products, Dhaka to an Indian doorstep,
 * and the money back again.
 *
 * ── WHAT IT IS ───────────────────────────────────────────────────────
 * The spine, not the tour. Eighty-seven short videos are the reference
 * library; this is the ONE path through them, so anything worth a
 * mention but not a minute gets a sentence and a pointer ("there is a
 * short video on this") rather than a scene. The cut list is explicit
 * and lives in the `the-rest` step, which exists so a viewer knows what
 * they have NOT been shown.
 *
 * ── THE FOUR PRODUCTS, AND WHY THESE FOUR ────────────────────────────
 * Each one is in the story to teach a different mechanic, and the
 * narration never reaches for a product that cannot carry its point:
 *
 *   Jamdani cotton kurti   variants — two colours × two sizes
 *   Leather wallet         the simple case: one SKU, nothing to choose
 *   Rose and neem soap     a batch with an expiry date → FEFO picking
 *   Brass table lamp       heavy and bulky → freight you can see
 *
 * ── THE ONE THING THAT IS NOT LITERAL, SAID OUT LOUD ─────────────────
 * The four products the video FOLLOWS are already in the catalogue,
 * carrying the stock, the crossing, the orders and the return that the
 * rest of the video reads. They have to be: a warehouse does not run at
 * the speed of a tutorial, and a consignment announced on camera cannot
 * land, be counted, be billed and come back inside twelve minutes.
 *
 * So the catalogue act does not pretend to create them. It adds THIS
 * SEASON'S kurti by hand — a real product, really created, with its own
 * options, variants and photo — and then uploads a three-row sheet that
 * adds a new variant to each of the other three. That second half is
 * the better lesson anyway: the page's own subtitle says re-uploading
 * updates what is there, matched on the seller's own reference, and the
 * scene proves it by creating three variants under three products that
 * already exist. The `products-list` line says plainly that the four
 * are already there. Nothing claims the on-camera kurti is the one
 * shipped.
 *
 * ── HOW IT IS REGISTERED ─────────────────────────────────────────────
 * `long/index.mjs` imports this module, converts `flow.steps` from an
 * array of `{ id, run }` into the object `record.mjs` looks steps up in,
 * and spreads everything else through untouched — so `app` and
 * `needsSpacesShim` below are read exactly as written.
 *
 * NO `prologue` IS EXPORTED, on purpose. `signIn` is private to
 * flows.mjs, and the registration there supplies the ordinary sign-in
 * for a long module that declares none; a module exports its own only
 * when it needs something else (`associate.mjs` does, because its first
 * scenes are the invitation page and the sign-in itself). This video
 * opens signed in on the dashboard, which is the default.
 *
 * `needsSpacesShim` MATTERS and is easy to drop: the kurti's photo and
 * the CSV upload are real `fetch` calls to a `mock://` presigned URL,
 * and without the shim they fail in a way that films as a stalled
 * upload panel under narration saying the file landed.
 *
 * ── WHY THE HELPERS ARE COPIED RATHER THAN IMPORTED ──────────────────
 * `flows.mjs` exports only `FLOWS`. Every selector helper in it —
 * `invSection`, `kpi`, `pickVariant`, `chooseCard` and the rest — is
 * module-private, so a long video either duplicates the handful it
 * needs or the shared file grows an export surface for four authors to
 * edit at once, which is the collision this directory exists to avoid.
 * Each copy below carries the reason the original was written that way,
 * because a copy without the reasoning is the one that gets
 * "simplified" back into a selector that matches the wrong element.
 */
import path from 'node:path';
import { GENERATED_DIR, TUTORIALS_DIR } from '../lib/paths.mjs';

/* ─────────────────────────────── DATA ──────────────────────────────── */

/**
 * The four products the video FOLLOWS. SKUs, not names, everywhere a
 * selector is involved: a name is prose and changes, a SKU is the thing
 * every order, pick and stock count refers to.
 *
 * Keep in step with the seed's own list (see `flow.seed`).
 */
const FOLLOWED = {
  kurti: { sku: 'RSH-JKURTI-ROSE-M', product: 'Jamdani Cotton Kurti' },
  wallet: { sku: 'RSH-WALLET-TAN', product: 'Hand-stitched Leather Wallet' },
  soap: { sku: 'RSH-SOAP6-ROSENEEM', product: 'Rose and Neem Soap — Box of 6' },
  lamp: { sku: 'RSH-LAMP-BRASS', product: 'Brass Table Lamp' },
};

/**
 * The product typed in on camera — this autumn's kurti.
 *
 * A SEPARATE product row from `FOLLOWED.kurti`, deliberately: the four
 * being followed carry weeks of history that cannot be created in front
 * of the camera, and a second row named for the season is honest where
 * a duplicate SKU would simply be refused. The `products-list` and
 * `kurti-new` lines both say which is which.
 *
 * The seed DELETES this product before every take — a second run
 * against a catalogue that already holds `RSH-JKURTI-AUT` would film
 * the duplicate-reference refusal under a line about creating it.
 */
const AUTUMN_KURTI = {
  name: 'Jamdani Cotton Kurti — Autumn',
  externalRef: 'RSH-JKURTI-AUT',
  weightGrams: '290',
  declaredValueInr: '2300',
  colours: ['Saffron', 'Teal'],
  sizes: ['Medium', 'Large'],
  /** Edited on camera, while a SKU is still editable. */
  editedSku: 'RSH-JKA-SAF-M',
};

/**
 * One picture for the new kurti.
 *
 * A COMMITTED fixture, reused from the photos video rather than a new
 * file: it is a silk garment shot against plain ground, which is what
 * the narration describes, and adding a fixture for a frame that holds
 * for eight seconds buys nothing.
 */
const KURTI_PHOTO = path.join(TUTORIALS_DIR, 'fixtures', 'muslin-rose-front.jpg');

/**
 * The three-row sheet, written by the SEED rather than committed.
 *
 * Committed fixtures are for files whose contents are narrated word for
 * word and must move with the words. This one is narrated by its SHAPE
 * — three rows, three products that already exist, one new variant each
 * — and it has to live per-stack beside the world it matches, because
 * two agents filming at once must not share one sheet. `flow.seed`
 * states its exact headers and rows.
 */
const PRODUCTS_CSV = path.join(GENERATED_DIR, 'long-seller-products.csv');

/** The variants the sheet creates. Checked on screen after the import. */
const CSV_NEW_SKU = 'RSH-LAMP-SMALL';

/** The consignment announced on camera, by a reference only this video uses. */
const ANNOUNCED = {
  reference: 'RSH-LONG-CN',
  kurti: { qty: '40', unitCost: '1180' },
  wallet: { qty: '30' },
  soap: { qty: '60', unitCost: '210' },
  lamp: { qty: '12', unitCost: '2100' },
};

/**
 * The consignment the video READS — landed, counted at both ends, with
 * a line short at each and a freight bill against its Indian arrival.
 *
 * Found by its own reference, never by position: the consignment NUMBER
 * changes with every rebuild of the demo world and the register is
 * newest-first, so the row the take announces would otherwise be the
 * row the next scene opens.
 */
const LANDED = 'RSH-CN-LANDED';

/** The customer the order is placed for, on camera. */
const CUSTOMER = {
  name: 'Ananya Iyer',
  phone: '9845017722',
  line1: '412, Brigade Gateway, Malleshwaram West',
  landmark: 'Opposite Orion Mall, next to the HDFC ATM',
  pin: '560055',
  reference: 'RSH-LONG-0001',
  note: 'She asked for delivery after 5pm on weekdays. Second number is her husband.',
  collectable: '4400',
};

/**
 * The three orders the second half reads, each by its OWN reference.
 *
 * `delivered` carries the whole journey — the call, the pick, the pack,
 * the handover and the scans — which is why one order does four acts of
 * this video rather than four orders doing one each: a viewer following
 * a single parcel can see the order of events, and four parcels would
 * only show that four pages look alike.
 *
 * Keep in step with `LIFECYCLE_PARCELS` in lib/lifecycle.mjs.
 */
const READ_ORDERS = {
  delivered: 'RSH-LIFE-DELIVERED',
  failed: 'RSH-LIFE-FAILED',
  restocked: 'RSH-LIFE-RESTOCKED',
};

/**
 * What the take asks to withdraw.
 *
 * Deliberately small. The request is REFUSED above what is withdrawable
 * (balance less the minimum to keep, WAL-3), and a refusal films as a
 * red line inside the dialog under narration saying the request has
 * gone in. `flow.seed` asks for comfortable headroom; this stays well
 * under it so the margin absorbs a world that drifted.
 */
const WITHDRAWAL = { amount: '10000', note: 'October payout — the BRAC account, please.' };

/* ────────────────────────────── HELPERS ─────────────────────────────── */

/**
 * One nav group of the sidebar, by the heading on its toggle.
 *
 * `.sk-nav__group` has no accessible role of its own, so the group is
 * found by the BUTTON it contains — which is the thing a viewer sees
 * and the only stable handle.
 */
function navGroup(page, heading) {
  return page
    .locator('.sk-nav__group')
    .filter({ has: page.getByRole('button', { name: heading, exact: true }) })
    .first();
}

/** Close an overlay. Escape, because a dialog's own Cancel is not universal. */
async function dismiss(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/** One choice card of a `ChoiceCards` group, by the enum value its input id ends in. */
function choiceCard(page, value) {
  return page.locator(`label.sk-choice:has(input[id$="-${value}"])`).first();
}

/**
 * Pick a choice card: halo, ripple, then CHECK THE INPUT.
 *
 * Not `clickIt`. The visible card is a `<label>` wrapping a visually
 * hidden radio, and a click on the label is forwarded by the browser —
 * which works, until the halo's own overlay intercepts it. Checking the
 * input directly is what the label's click would have done, and the
 * ripple is placed by hand so the gesture still reads on camera.
 */
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

/**
 * Tick a checkbox: halo the VISIBLE row, ripple, then check the input.
 *
 * `Checkbox` lays an `opacity: 0` input over a drawn box about twenty
 * pixels square. Clicking it works, but a halo drawn round the input is
 * a tiny ring beside a sentence, which on camera reads as nothing
 * having been pointed at. So the outline goes on the label row — the
 * thing a person sees and aims at — and the state change goes to the
 * input, which is what the label's own click would have done.
 */
async function tickBox({ page, stage }, label, { after = 900 } = {}) {
  const box = page.getByRole('checkbox', { name: label });
  const row = page.locator('.sk-check').filter({ has: box }).first();
  const seen = await stage.point(row, { settle: 600 });
  if (seen !== null) {
    await page.evaluate(
      ([x, y]) => window.__tut.ripple(x, y),
      [seen.x + 14, seen.y + seen.height / 2],
    );
    await page.waitForTimeout(160);
  }
  await box.check();
  await page.waitForTimeout(after);
  await stage.clearHalo();
}

/** The consignment dialog's variant combobox: type, wait for a hit, take it. */
async function pickVariant({ page, stage }, query) {
  await stage.typeIn(page.locator('#cn-variant'), query, { clear: true, after: 900 });
  const option = page.getByRole('option').first();
  await option.waitFor({ state: 'visible', timeout: 15_000 });
  await stage.clickIt(option, { after: 700 });
}

/** Fill a date input without typing it — a date picker cannot be typed at human rate. */
async function setDate({ page, stage }, locator, iso) {
  await stage.point(locator, { settle: 400 });
  await locator.fill(iso);
  await page.waitForTimeout(500);
  await stage.clearHalo();
}

/** An ISO date `days` from now, for an arrival or an expiry. */
function isoIn(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * One titled area of a consignment or order page, CENTRED.
 *
 * `hasText`, not an exact `getByText`: a leg's heading renders its title
 * and its goods-receipt number inside one span, so the element's whole
 * text is "Counted at our Bangladesh warehouseGR-2026-09-0027" and an
 * exact match finds nothing at all.
 *
 * `.last()` picks the leg's OWN section rather than the "Each stop"
 * section containing it — sections nest here, and the innermost one
 * carrying the words is last in document order.
 *
 * Centred rather than merely scrolled into view: `scrollIntoViewIfNeeded`
 * stops the moment the top edge is on screen, which on a tall section
 * leaves most of what the narration is about below the fold.
 */
async function area(page, title) {
  const target = page.locator('section').filter({ hasText: title }).last();
  await target.waitFor({ state: 'visible', timeout: 25_000 });
  await target.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(700);
  return target;
}

/**
 * One titled area of an ORDER page, by its heading EXACTLY.
 *
 * Not `area()`. Playwright's `hasText` is a case-insensitive SUBSTRING
 * match, so "Parcel" also matches the "Payment & parcel" section a few
 * hundred pixels above — and `.last()` resolving to the right one
 * depends on which panel the page happens to render second. The order
 * page's headings carry nothing appended to them (the consignment
 * page's carry a goods-receipt number, which is why that one cannot use
 * this), so the heading is an exact handle and the ambiguity disappears.
 */
async function ordSection(page, heading) {
  const section = page
    .locator('.ord-section')
    .filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
    .first();
  await section.waitFor({ state: 'visible', timeout: 25_000 });
  await section.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(700);
  return section;
}

/**
 * One tile on the inventory or freight page, by its label.
 *
 * Both grids are listed rather than a second helper written — a tile is
 * a tile, and only one of the two pages is ever on screen, so the union
 * cannot match the wrong one's card.
 */
async function kpi(page, label) {
  const card = page.locator('.inv-kpis > *, .frt-kpis > *').filter({ hasText: label }).first();
  await card.waitFor({ state: 'visible', timeout: 25_000 });
  await card.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(600);
  return card;
}

/** One SKU's row on the stock register. */
function stockRow(page, sku) {
  return page
    .getByRole('row')
    .filter({ has: page.getByText(sku, { exact: true }) })
    .first();
}

/** A consignment's row in the register, by its own reference. */
function consignmentRow(page, ref) {
  return page
    .getByRole('row')
    .filter({ has: page.getByText(ref, { exact: true }) })
    .first();
}

/**
 * The freight bill's row on `/freight`, by its TERMS.
 *
 * Not by its receipt number, which changes with every rebuild of the
 * consignment world, and not by position, because a withdrawn bill is
 * still listed — a void is not a delete, which is the point of it.
 */
function freightRow(page) {
  return page
    .getByRole('row')
    .filter({ has: page.getByText('Pay as it sells', { exact: true }) })
    .first();
}

/**
 * One rung of the order tracker, by its label.
 *
 * The seller's `OrderJourney` passes the `Timeline` no `collapseEarlier`,
 * so every rung is rendered and none hides behind a fold — if that ever
 * changes, this helper is where the expand goes, and the symptom will be
 * a timeout on a delivered order's earliest rung.
 */
async function rung(page, label) {
  const step = page.locator('.sk-tl__step').filter({ hasText: label }).first();
  await step.waitFor({ state: 'visible', timeout: 25_000 });
  await step.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(600);
  return step;
}

/**
 * One row of the wallet ledger, by the words the entry's direction prints.
 *
 * Matched on a cell STARTING with the label, never an exact match:
 * `LedgerEntryLabel` renders the direction as a bare text node with the
 * entry's own note in a `<div>` straight after, so the cell's text is
 * "Order chargesOrder charges — base shipping…" and nothing in the row
 * is exactly the label.
 *
 * `.first()` is the NEWEST of its kind — the ledger is newest-first —
 * which is deterministic: two delivery charges are two identical rows
 * and either tells the same story.
 */
async function ledgerRow(page, label) {
  const startsWith = new RegExp(`^${label.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  const row = page
    .getByRole('row')
    .filter({ has: page.getByRole('cell').filter({ hasText: startsWith }) })
    .first();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  await row.scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  return row;
}

/** One rule on `/wallet/limits`, by its label. Skipped silently if absent. */
async function term(page, stage, label, ms = 2200) {
  const row = page.locator('.wal-term').filter({ hasText: label }).first();
  if ((await row.count()) === 0) return;
  await stage.dwellOn(row, ms);
}

/** Walk to a top-level page through its OWN sidebar link. */
async function openNav({ page, stage }, name, urlRe) {
  await stage.clickIt(page.getByRole('link', { name, exact: true }).first(), { after: 1600 });
  await page.waitForURL(urlRe, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
}

/**
 * Open one of this seller's orders by ITS OWN reference, through the
 * list — never by `goto`.
 *
 * The camera records the page and never the address bar, so a URL jump
 * reads as the screen changing for no reason.
 *
 * THE ROW IS MATCHED ON AN EXACT REF, which is not fussiness: the list
 * searches `contains`, and the seeding retires a spent order by moving
 * its reference to `<ref>-SPENT-<n>` rather than deleting it, so a
 * loose match finds every previous take's leavings as well as the one
 * that is ready. The reference has its own element in the row, so an
 * exact text match picks the canonical one and nothing else.
 *
 * The retry is for the one failure a second attempt genuinely fixes:
 * typing into the search pushes the filter into the URL and the list
 * re-renders when the query behind it returns, which happens AFTER
 * `networkidle` has already fired once — so the row can be replaced
 * underneath a click that has started scrolling to it.
 */
async function openOrderByRef({ page, stage }, ref) {
  await openNav({ page, stage }, 'Orders', /\/orders$/);
  await stage.typeIn(page.getByLabel('Search orders'), ref, { clear: true, after: 500 });
  await page.keyboard.press('Enter');
  await page.waitForLoadState('networkidle').catch(() => {});
  const row = page
    .getByRole('row')
    .filter({ has: page.getByText(ref, { exact: true }) })
    .first();
  await row.waitFor({ state: 'visible', timeout: 25_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1200);
  try {
    await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
  } catch (err) {
    if (!String(err).includes('not attached')) throw err;
    await page.waitForTimeout(1200);
    await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
  }
  await page.waitForURL(/\/orders\/[0-9a-f-]+$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  // Its own reference under the number is what proves the RIGHT order
  // opened — the order number changes with every rebuild.
  await page.getByText(`Your ref: ${ref}`).first().waitFor({ state: 'visible', timeout: 25_000 });
  await page.waitForTimeout(900);
}

/* ───────────────────────────── NARRATION ────────────────────────────── */

export const narration = {
  slug: 'seller-everything',
  title: 'Getting your products to India',
  subtitle: 'Skydrop for sellers',
  steps: [
    /* ── what this is ─────────────────────────────────────────────── */
    {
      id: 'intro',
      say: 'Skydrop holds your stock in an Indian warehouse, phones every customer to confirm their order, then picks, packs and ships it. You sell into India without having anything in India.',
      sayBn:
        'Skydrop আপনার স্টক ভারতের একটি গুদামে রাখে, প্রতিটি ক্রেতাকে ফোন করে অর্ডার নিশ্চিত করে, তারপর পণ্য তুলে, প্যাক করে পাঠিয়ে দেয়। ভারতে আপনার কিছু না থাকলেও আপনি ভারতে বিক্রি করতে পারেন।',
      sayHi:
        'Skydrop आपका स्टॉक भारत के एक गोदाम में रखता है, हर ग्राहक को फ़ोन करके ऑर्डर पक्का करता है, फिर माल उठाकर, पैक करके भेज देता है। भारत में आपका कुछ न होने पर भी आप भारत में बेच सकते हैं।',
    },
    {
      id: 'the-job',
      say: 'Four products are going to make that trip: a cotton kurti, a leather wallet, boxed soap and a brass table lamp. We will follow all four, there and back.',
      sayBn:
        'চারটি পণ্য এই পথটা পার হবে: একটা সুতির কুর্তি, একটা চামড়ার মানিব্যাগ, বাক্সে ভরা সাবান আর একটা পিতলের টেবিল ল্যাম্প। আমরা চারটিকেই অনুসরণ করব — যাওয়া আর ফেরা, দুটোই।',
      sayHi:
        'चार प्रोडक्ट यह सफ़र तय करेंगे: एक सूती कुर्ती, एक चमड़े का बटुआ, डिब्बे में बंद साबुन, और एक पीतल का टेबल लैंप। हम चारों के पीछे चलेंगे — जाना और लौटना, दोनों।',
    },
    {
      id: 'the-shell',
      say: 'The sidebar is grouped by what you are doing. Selling, stock, money, reselling, your account. Everything in this video is one of those five, so this is the only map you need.',
      sayBn:
        'বাঁ দিকের সাইডবার ভাগ করা আছে আপনি কী করছেন সেই অনুযায়ী। Selling, Stock, Money, Reselling, Account। এই ভিডিওর সবকিছুই এই পাঁচটার একটার ভিতরে পড়ে, তাই এটাই আপনার একমাত্র দরকারি মানচিত্র।',
      sayHi:
        'बाईं तरफ़ का sidebar इस हिसाब से बँटा है कि आप क्या कर रहे हैं। Selling, Stock, Money, Reselling, Account। इस वीडियो की हर चीज़ इन पाँच में से किसी एक के अंदर आती है, इसलिए नक़्शा आपको बस यही चाहिए।',
    },

    /* ── act one: the catalogue ───────────────────────────────────── */
    {
      id: 'products-list',
      say: 'Your products first — the rail calls it Products. Those four are already here, with weeks of stock behind them — so instead of retyping them, I will add this autumn’s kurti by hand and update the rest from a sheet.',
      sayBn:
        'শুরু হবে ক্যাটালগ — Products — দিয়ে। ওই চারটা এখানে আগেই আছে, পিছনে কয়েক সপ্তাহের স্টকও আছে। তাই নতুন করে না লিখে এই শরতের কুর্তিটা হাতে যোগ করব, আর বাকিগুলো একটা শিট থেকে আপডেট করব।',
      sayHi:
        'पहले आपके प्रोडक्ट — पट्टी में इसे Products कहा गया है। वे चारों यहाँ पहले से हैं, और पीछे कई हफ़्तों का स्टॉक भी है — इसलिए उन्हें फिर से लिखने के बजाय मैं इस पतझड़ की कुर्ती हाथ से जोड़ूँगा, और बाकी को एक शीट से अपडेट करूँगा।',
    },
    {
      id: 'kurti-new',
      say: 'A product is the thing itself. Name, your own product code, then the weight and the value once — every version of it inherits both, and you only type them again where one genuinely differs.',
      sayBn:
        'একটা product হলো জিনিসটা নিজেই। Product name, আপনার নিজের Your product ID, তারপর একবারই Weight আর Declared value — এর প্রতিটা ভার্সন দুটোই পেয়ে যায়, আর যেখানে সত্যিই আলাদা শুধু সেখানেই আবার লিখতে হয়।',
      sayHi:
        'एक product चीज़ ख़ुद है। Product name, आपका अपना Your product ID, फिर एक ही बार Weight और Declared value — इसकी हर version को दोनों मिल जाते हैं, और जहाँ कोई सचमुच अलग हो वहीं दोबारा लिखना पड़ता है।',
    },
    {
      id: 'kurti-colour',
      say: 'An option is what the product varies by. Colour, with two values. Never a quantity here: an option is a choice, not a count.',
      sayBn:
        'option হলো যেটা অনুযায়ী পণ্যটা আলাদা হয়। এখানে Colour, দুটো value দিয়ে। এখানে কখনো সংখ্যা লিখবেন না: option একটা পছন্দ, গণনা নয়।',
      sayHi:
        'option वह है जिसके हिसाब से प्रोडक्ट अलग-अलग होता है। यहाँ Colour, दो value के साथ। यहाँ कभी गिनती न लिखें: option एक पसंद है, गिनती नहीं।',
    },
    {
      id: 'kurti-size',
      say: 'Add Size and it asks per colour, because the sizes you actually stock are rarely the same for every colour. A colour left blank produces no variant at all.',
      sayBn:
        'Size যোগ করলে এটা প্রতিটা রঙের জন্য আলাদা করে জিজ্ঞেস করে, কারণ আপনি আসলে যে সাইজগুলো রাখেন সেগুলো সব রঙের জন্য এক হয় না। কোনো রঙ ফাঁকা রেখে দিলে তার কোনো variant-ই তৈরি হয় না।',
      sayHi:
        'Size जोड़ें तो यह हर रंग के लिए अलग-अलग पूछता है, क्योंकि आप असल में जो size रखते हैं वे हर रंग के लिए एक जैसे कम ही होते हैं। कोई रंग ख़ाली छोड़ दें तो उसका कोई variant बनता ही नहीं।',
    },
    {
      id: 'kurti-variants',
      say: 'Two options multiplied out: four variants, one row each. This is the level that matters — stock is counted against variants, never against the product, and so is everything downstream.',
      sayBn:
        'দুটো option গুণ হয়ে গেল: চারটা variant, প্রতিটার জন্য এক সারি। এই স্তরটাই আসল — স্টক গোনা হয় variant ধরে, কখনো product ধরে নয়, আর তার পরের সবকিছুও তাই।',
      sayHi:
        'दो option गुणा होकर: चार variant, हर एक के लिए एक row। यही स्तर असल है — स्टॉक variant के हिसाब से गिना जाता है, product के हिसाब से कभी नहीं, और उसके आगे का सब कुछ भी वैसे ही।',
    },
    {
      id: 'kurti-save',
      say: 'Edit a SKU now while you still can. Once saved it is permanent, because every order, every pick and every stock count refers to the product by that code.',
      sayBn:
        'SKU বদলানোর সময় এখনই, যতক্ষণ সুযোগ আছে। একবার সেভ হলে এটা আর বদলায় না, কারণ প্রতিটা অর্ডার, গুদামের প্রতিটা pick আর প্রতিটা স্টক গণনা ওই কোড দিয়েই পণ্যটাকে চেনে।',
      sayHi:
        'SKU बदलने का वक़्त अभी है, जब तक मौक़ा है। एक बार save हो गया तो यह पक्का हो जाता है, क्योंकि हर ऑर्डर, गोदाम का हर pick और हर स्टॉक गिनती उसी कोड से प्रोडक्ट को पहचानती है।',
    },
    {
      id: 'kurti-photo',
      say: 'Then a picture, on the variant rather than the product, so the right colour appears beside the right row. Your call centre and our pack bench both see it.',
      sayBn:
        'তারপর একটা ছবি — product-এ নয়, variant-এ, যাতে ঠিক রঙটা ঠিক সারির পাশে দেখা যায়। আপনার কল সেন্টার আর আমাদের প্যাক বেঞ্চ, দুই জায়গাতেই ছবিটা দেখা যায়।',
      sayHi:
        'फिर एक तस्वीर — product पर नहीं, variant पर, ताकि सही रंग सही row के पास दिखे। आपका call centre और हमारा pack bench, दोनों जगह यह तस्वीर दिखती है।',
    },
    {
      id: 'csv-upload',
      say: 'The other three come from a spreadsheet. Three rows, one new variant each — a second colour of wallet, a different soap, a smaller lamp.',
      sayBn:
        'বাকি তিনটা আসবে একটা স্প্রেডশিট থেকে। তিনটা সারি, প্রতিটাতে একটা নতুন variant — মানিব্যাগের দ্বিতীয় একটা রঙ, আলাদা একটা সাবান, আর ছোট একটা ল্যাম্প।',
      sayHi:
        'बाकी तीन एक spreadsheet से आएँगे। तीन row, हर एक में एक नया variant — बटुए का दूसरा रंग, एक अलग साबुन, और एक छोटा लैंप।',
    },
    {
      id: 'csv-preview',
      say: 'Nothing imports until you have seen what was matched. Our field on the left, your column heading on the right, and anything we cannot place is named rather than guessed at.',
      sayBn:
        'কী কীসের সঙ্গে মিলেছে তা আপনি না দেখা পর্যন্ত কিছুই import হয় না। বাঁ দিকে আমাদের ফিল্ড, ডান দিকে আপনার কলামের নাম, আর যেটা আমরা বসাতে পারি না সেটার নাম বলে দেওয়া হয় — অনুমান করা হয় না।',
      sayHi:
        'क्या किससे मिला है यह आप देख न लें, तब तक कुछ भी import नहीं होता। बाईं तरफ़ हमारा field, दाईं तरफ़ आपके कॉलम का नाम, और जिसे हम बैठा नहीं पाते उसका नाम बता दिया जाता है — अंदाज़ा नहीं लगाया जाता।',
    },
    {
      id: 'csv-import',
      say: 'Products are matched on your own product code and variants on their SKU, so a re-upload updates what is there instead of duplicating it. Three new variants, nothing refused.',
      sayBn:
        'product মেলানো হয় আপনার নিজের product code দিয়ে আর variant মেলানো হয় তার SKU দিয়ে, তাই আবার আপলোড করলে যা আছে তা আপডেট হয়, দুবার তৈরি হয় না। তিনটা নতুন variant, কোনোটাই বাতিল হয়নি।',
      sayHi:
        'product आपके अपने product code से मिलाए जाते हैं और variant उनके SKU से, इसलिए दोबारा अपलोड करने पर जो है वह अपडेट होता है, दो बार नहीं बनता। तीन नए variant, कोई ख़ारिज नहीं हुआ।',
    },

    /* ── act two: announcing the consignment ──────────────────────── */
    {
      id: 'inbound-open',
      say: 'Now the goods. Before anything ships you announce the consignment, so our warehouse knows what is coming and you can follow it the whole way.',
      sayBn:
        'এবার পণ্য। কিছু পাঠানোর আগে আপনি consignment-টা ঘোষণা করবেন, যাতে আমাদের গুদাম জানে কী আসছে আর আপনি পুরো পথটা অনুসরণ করতে পারেন।',
      sayHi:
        'अब माल। कुछ भेजने से पहले आप consignment की घोषणा करते हैं, ताकि हमारे गोदाम को पता रहे कि क्या आ रहा है और आप पूरे रास्ते उसके पीछे चल सकें।',
    },
    {
      id: 'announce-open',
      say: 'Three things to settle: how it travels, what is in it, and when you expect it. Nothing here is locked in — you can change it until the day it ships.',
      sayBn:
        'তিনটা জিনিস ঠিক করতে হবে: কোন পথে যাবে, ভিতরে কী আছে, আর কবে পৌঁছাবে বলে আশা করছেন। এখানের কিছুই পাকা নয় — যেদিন পাঠাবেন, সেদিন পর্যন্ত বদলাতে পারবেন।',
      sayHi:
        'तीन चीज़ें तय करनी हैं: किस रास्ते जाएगा, अंदर क्या है, और कब पहुँचने की उम्मीद है। यहाँ कुछ भी पक्का नहीं है — जिस दिन भेजेंगे, उस दिन तक बदल सकते हैं।',
    },
    {
      id: 'routes',
      say: 'Two routes. Straight to India means you ship to our Indian warehouse yourself: one arrival, one count, no freight bill from us.',
      sayBn:
        'দুটো পথ। Straight to India মানে আপনি নিজেই আমাদের ভারতের গুদামে পাঠাচ্ছেন: একবার পৌঁছানো, একবার গণনা, আমাদের কাছ থেকে কোনো ফ্রেইট বিল নেই।',
      sayHi:
        'दो रास्ते। Straight to India का मतलब आप ख़ुद हमारे भारत के गोदाम में भेज रहे हैं: एक बार पहुँचना, एक बार गिनती, और हमारी तरफ़ से कोई freight बिल नहीं।',
    },
    {
      id: 'route-pick',
      say: 'Via our Bangladesh warehouse means you ship to Dhaka and we move it on. That is the one we charge inbound freight for, and the one most sellers use.',
      sayBn:
        'Via our Bangladesh warehouse মানে আপনি ঢাকায় পাঠাচ্ছেন আর আমরা সেটা এগিয়ে দিচ্ছি। এই পথটার জন্যই আমরা inbound ফ্রেইট নিই, আর বেশির ভাগ বিক্রেতা এই পথটাই নেন।',
      sayHi:
        'Via our Bangladesh warehouse का मतलब आप ढाका भेज रहे हैं और हम उसे आगे बढ़ाते हैं। इसी रास्ते के लिए हम inbound freight लेते हैं, और ज़्यादातर विक्रेता यही रास्ता लेते हैं।',
    },
    {
      id: 'line-kurti',
      say: 'Then the contents, a line at a time. Unit cost is optional and worth typing: it is what makes your landed cost and your margin real rather than an estimate.',
      sayBn:
        'তারপর ভিতরে কী আছে, এক লাইনে একটা করে। Unit cost দেওয়া বাধ্যতামূলক নয়, কিন্তু দেওয়া ভালো: এটাই আপনার landed cost আর মুনাফাকে অনুমান থেকে সত্যিকারের সংখ্যায় বদলে দেয়।',
      sayHi:
        'फिर अंदर क्या है, एक लाइन में एक। Unit cost देना ज़रूरी नहीं है, पर देना अच्छा है: यही आपके landed cost और मुनाफ़े को अंदाज़े से निकालकर असली आँकड़ा बनाता है।',
    },
    {
      id: 'line-soap',
      say: 'The soap has an expiry date, so it goes in as a batch. The warehouse then picks the oldest stock first, which is the only way boxed goods do not quietly expire on a shelf.',
      sayBn:
        'সাবানের একটা expiry date আছে, তাই এটা একটা batch হিসেবে ঢোকে। তখন গুদাম আগে সবচেয়ে পুরোনো স্টক তোলে — বাক্সে ভরা পণ্য তাকের উপর চুপচাপ মেয়াদ হারিয়ে না ফেলার এটাই একমাত্র উপায়।',
      sayHi:
        'साबुन की एक expiry date है, इसलिए वह एक batch के तौर पर अंदर जाता है। तब गोदाम पहले सबसे पुराना स्टॉक उठाता है — डिब्बे में बंद माल शेल्फ़ पर चुपचाप एक्सपायर न हो, इसका यही एक तरीका है।',
    },
    {
      id: 'line-lamp',
      say: 'The lamp is the heavy one. That weight you typed once on the product now decides its share of the freight bill and what the courier charges to carry it.',
      sayBn:
        'ল্যাম্পটাই ভারী জিনিস। product-এ একবার যে ওজনটা লিখেছিলেন, সেটাই এখন ঠিক করে দেয় ফ্রেইট বিলে এর ভাগ কত আর কুরিয়ার এটা বহন করতে কত নেবে।',
      sayHi:
        'लैंप ही भारी चीज़ है। product पर आपने एक बार जो वज़न लिखा था, वही अब तय करता है कि freight बिल में इसका हिस्सा कितना है और कूरियर इसे ढोने के कितने लेगा।',
    },
    {
      id: 'announced',
      say: 'A rough arrival date beats none, your own reference lines it up with your books, and announcing it puts it on the register with a Skydrop consignment number.',
      sayBn:
        'আন্দাজ করে একটা পৌঁছানোর তারিখ দেওয়াও কিছু না দেওয়ার চেয়ে ভালো, আপনার নিজের reference এটাকে আপনার হিসাবের খাতার সঙ্গে মিলিয়ে দেয়, আর ঘোষণা করলে এটা একটা Skydrop consignment নম্বর নিয়ে তালিকায় উঠে যায়।',
      sayHi:
        'अंदाज़ से एक पहुँचने की तारीख़ देना भी कुछ न देने से बेहतर है, आपका अपना reference इसे आपके खाते से मिला देता है, और घोषणा करने पर यह एक Skydrop consignment नंबर लेकर रजिस्टर पर चढ़ जाता है।',
    },

    /* ── act three: freight ───────────────────────────────────────── */
    {
      id: 'freight-open',
      say: 'Freight is a bill of its own, separate from anything a customer pays. This is the real one, against the consignment that landed three weeks ago.',
      sayBn:
        'ফ্রেইট আলাদা একটা বিল, ক্রেতা যা দেয় তার সঙ্গে এর কোনো সম্পর্ক নেই। এটা আসল একটা বিল, তিন সপ্তাহ আগে পৌঁছানো consignment-এর বিপরীতে।',
      sayHi:
        'Freight अपना एक अलग बिल है, ग्राहक जो देता है उससे इसका कोई वास्ता नहीं। यह एक असली बिल है, तीन हफ़्ते पहले पहुँचे consignment के बदले।',
    },
    {
      id: 'freight-figures',
      say: 'What it came to, what has actually been charged to you, and how many units that covers. The gap between the first two is what you still owe.',
      sayBn:
        'মোট কত হলো, আপনার কাছ থেকে আসলে কত কাটা হয়েছে, আর তাতে কতগুলো ইউনিট ধরা পড়ে। প্রথম দুটোর মাঝের ফাঁকটাই আপনার এখনো দেওয়ার বাকি।',
      sayHi:
        'कुल कितना बना, आपसे असल में कितना काटा गया है, और उसमें कितनी यूनिट आती हैं। पहले दोनों के बीच का फ़र्क़ ही अभी आपका देना बाकी है।',
    },
    {
      id: 'freight-when',
      say: 'On pay-as-it-sells terms each unit carries its share, and that share leaves your wallet when the unit is delivered. Stock still on the shelf owes nothing yet.',
      sayBn:
        'Pay as it sells শর্তে প্রতিটা ইউনিট নিজের ভাগটা বহন করে, আর ইউনিটটা ডেলিভারি হলে সেই ভাগ আপনার ওয়ালেট থেকে কেটে যায়। তাকের উপর পড়ে থাকা স্টকের এখনো কিছুই বাকি নেই।',
      sayHi:
        'Pay as it sells शर्त पर हर यूनिट अपना हिस्सा उठाती है, और यूनिट डिलीवर होने पर वह हिस्सा आपके wallet से कट जाता है। शेल्फ़ पर पड़े स्टॉक का अभी कुछ भी देना बाकी नहीं है।',
    },

    /* ── act four: it lands ───────────────────────────────────────── */
    {
      id: 'landed-open',
      say: 'Open the consignment itself and every stop is here, in order. Announced, counted in Dhaka, flown, counted again in India.',
      sayBn:
        'consignment-টা নিজে খুললে প্রতিটা ধাপ এখানে, পরপর। ঘোষণা হয়েছে, ঢাকায় গোনা হয়েছে, উড়ে গেছে, ভারতে আবার গোনা হয়েছে।',
      sayHi:
        'consignment को ख़ुद खोलें तो हर पड़ाव यहाँ है, सिलसिले से। घोषणा हुई, ढाका में गिना गया, उड़ा, भारत में फिर गिना गया।',
    },
    {
      id: 'landed-dhaka',
      say: 'Dhaka counted it against what you declared, and one line came up short. That is normal, it is recorded as a number, and it blocks nothing at all.',
      sayBn:
        'আপনি যা ঘোষণা করেছিলেন তার সঙ্গে মিলিয়ে ঢাকা গুনেছে, আর একটা লাইনে কম পড়েছে। এটা স্বাভাবিক, এটা একটা সংখ্যা হিসেবে লেখা থাকে, আর এতে কিছুই আটকায় না।',
      sayHi:
        'आपने जो घोषित किया था उससे मिलाकर ढाका ने गिना, और एक लाइन में कम निकला। यह आम बात है, इसे एक आँकड़े के तौर पर लिख लिया जाता है, और इससे कुछ भी नहीं रुकता।',
    },
    {
      id: 'landed-india',
      say: 'India counts it again on arrival, and India is the count that decides. These are the units that became sellable, and anything short of Dhaka’s figure is ours to chase.',
      sayBn:
        'ভারতে পৌঁছে আবার গোনা হয়, আর ভারতের গণনাই চূড়ান্ত। এই ইউনিটগুলোই বিক্রিযোগ্য হলো, আর ঢাকার সংখ্যার চেয়ে যা কম, সেটার খোঁজ করা আমাদের কাজ।',
      sayHi:
        'भारत पहुँचने पर फिर गिना जाता है, और फ़ैसला भारत की गिनती का होता है। ये वही यूनिट हैं जो बिकने लायक़ हुईं, और ढाका के आँकड़े से जो कम है, उसके पीछे पड़ना हमारा काम है।',
    },
    {
      id: 'landed-missing',
      say: 'When a unit leaves Bangladesh and does not arrive, the page says so in those words rather than leaving it on a still-to-come line forever.',
      sayBn:
        'কোনো ইউনিট বাংলাদেশ থেকে বেরিয়ে গিয়ে না পৌঁছালে পৃষ্ঠাটা সেটা ঠিক ওই কথাতেই বলে দেয় — চিরকাল আসছে-আসছে লাইনে ফেলে রাখে না।',
      sayHi:
        'कोई यूनिट बांग्लादेश से निकलकर न पहुँचे, तो पेज ठीक उन्हीं शब्दों में यह बता देता है — उसे हमेशा के लिए आने-वाली लाइन पर पड़ा नहीं छोड़ता।',
    },
    {
      id: 'stock-open',
      say: 'Your stock, in one place. What is in India, what is already held for orders you have placed, and what is still in the air.',
      sayBn:
        'আপনার স্টক, এক জায়গায়। ভারতে কী আছে, আপনার দেওয়া অর্ডারের জন্য কী আগেই আটকে রাখা হয়েছে, আর কী এখনো পথে।',
      sayHi:
        'आपका स्टॉक, एक जगह। भारत में क्या है, आपके डाले ऑर्डरों के लिए पहले से क्या रोका हुआ है, और क्या अभी रास्ते में है।',
    },
    {
      id: 'stock-row',
      say: 'Owning stock and being able to sell it are different numbers, and this is the difference: held units are spoken for, and only what is left is sellable.',
      sayBn:
        'স্টক থাকা আর সেটা বিক্রি করতে পারা দুটো আলাদা সংখ্যা, আর এটাই সেই পার্থক্য: Held for orders-এ থাকা ইউনিটগুলো আগেই বরাদ্দ হয়ে গেছে, বাকিটুকুই কেবল বিক্রিযোগ্য।',
      sayHi:
        'स्टॉक होना और उसे बेच पाना दो अलग आँकड़े हैं, और यही वह फ़र्क़ है: Held for orders में पड़ी यूनिट पहले से बँट चुकी हैं, और जो बचा है वही बिकने लायक़ है।',
    },

    /* ── act five: an order ───────────────────────────────────────── */
    {
      id: 'order-new',
      say: 'An order now. Most arrive from a spreadsheet or straight from your own website through an API key — both have a short video — but typing one shows you every field.',
      sayBn:
        'এবার একটা অর্ডার। বেশির ভাগ অর্ডার আসে স্প্রেডশিট থেকে, বা API key দিয়ে সরাসরি আপনার নিজের ওয়েবসাইট থেকে — দুটো নিয়েই আলাদা ছোট ভিডিও আছে — কিন্তু হাতে একটা লিখলে প্রতিটা ঘর দেখা যায়।',
      sayHi:
        'अब एक ऑर्डर। ज़्यादातर ऑर्डर spreadsheet से आते हैं, या API key के ज़रिए सीधे आपकी अपनी वेबसाइट से — दोनों पर एक-एक छोटा वीडियो है — पर हाथ से एक लिखने पर हर ख़ाना दिख जाता है।',
    },
    {
      id: 'order-recipient',
      say: 'Who it goes to. Their name, an Indian mobile, and the street address they gave you. We check the number is a real one as you type it.',
      sayBn:
        'কার কাছে যাবে। তার নাম, ভারতের একটা মোবাইল নম্বর, আর সে যে ঠিকানা দিয়েছে। আপনি টাইপ করার সময়ই আমরা দেখে নিই নম্বরটা আসল কি না।',
      sayHi:
        'किसके पास जाएगा। उसका नाम, भारत का एक मोबाइल नंबर, और उसने जो पता दिया है वह। आप टाइप करते ही हम देख लेते हैं कि नंबर असली है या नहीं।',
    },
    {
      id: 'order-address',
      say: 'The second line is the landmark, and it decides whether a driver finds a rural door. Then the PIN code — that is all the courier needs, and it works the city out itself.',
      sayBn:
        'দ্বিতীয় লাইনটা ল্যান্ডমার্ক, আর গ্রামের একটা দরজা ড্রাইভার খুঁজে পাবে কি না সেটা এটাই ঠিক করে। তারপর PIN code — কুরিয়ারের এটুকুই দরকার, শহরটা সে নিজেই বের করে নেয়।',
      sayHi:
        'दूसरी लाइन लैंडमार्क है, और गाँव का कोई दरवाज़ा ड्राइवर ढूँढ पाएगा या नहीं यह वही तय करती है। फिर PIN code — कूरियर को इतना ही चाहिए, शहर वह ख़ुद निकाल लेता है।',
    },
    {
      id: 'order-note',
      say: 'Your own reference, and a note for the call agent. Anything you know that helps the phone call: a second number, the hours she is home, a gate that is hard to find.',
      sayBn:
        'আপনার নিজের reference, আর কল এজেন্টের জন্য একটা নোট। ফোন কলে কাজে লাগবে এমন যা যা আপনি জানেন: আরেকটা নম্বর, কোন সময়ে সে বাড়িতে থাকে, খুঁজে পেতে কষ্ট হয় এমন একটা গেট।',
      sayHi:
        'आपका अपना reference, और call agent के लिए एक note। फ़ोन कॉल में काम आने वाली जो भी बात आप जानते हैं: एक दूसरा नंबर, वह किस वक़्त घर पर रहती है, या कोई गेट जो ढूँढना मुश्किल है।',
    },
    {
      id: 'order-products',
      say: 'Then the products. Price and sellable stock sit on every row, so you see both before committing, and the weight underneath keeps up as you add lines.',
      sayBn:
        'তারপর পণ্য। প্রতিটা সারিতেই দাম আর বিক্রিযোগ্য স্টক থাকে, তাই চূড়ান্ত করার আগেই দুটোই দেখতে পান, আর লাইন যোগ করার সঙ্গে সঙ্গে নিচের ওজনটাও হিসাব করে বদলে যায়।',
      sayHi:
        'फिर प्रोडक्ट। हर row पर कीमत और बिकने लायक़ स्टॉक, दोनों रहते हैं, इसलिए पक्का करने से पहले ही आप दोनों देख लेते हैं, और लाइन जोड़ने के साथ-साथ नीचे का वज़न भी हिसाब में बदलता रहता है।',
    },
    {
      id: 'order-cod',
      say: 'Cash on delivery is the norm in India, so it is the default. Type exactly what the customer hands over at the door.',
      sayBn:
        'Cash on delivery ভারতে স্বাভাবিক নিয়ম, তাই এটাই আগে থেকে বাছা থাকে। ক্রেতা দরজায় ঠিক যত টাকা হাতে দেবে, হুবহু সেটাই লিখুন।',
      sayHi:
        'Cash on delivery भारत में आम चलन है, इसलिए यही पहले से चुना रहता है। ग्राहक दरवाज़े पर जितना पैसा हाथ में देगा, हूबहू वही लिखें।',
    },
    {
      id: 'order-submit',
      say: 'Submitting it does not reserve your stock and does not book a courier. It puts the order in the call queue, and the phone call is what decides.',
      sayBn:
        'Submit for confirmation চাপলে আপনার স্টক আটকে যায় না, কুরিয়ারও বুক হয় না। অর্ডারটা কল কিউতে গিয়ে বসে, আর সিদ্ধান্ত নেয় ফোন কলটাই।',
      sayHi:
        'Submit for confirmation दबाने से आपका स्टॉक नहीं रुकता और कूरियर भी book नहीं होता। ऑर्डर कॉल की कतार में जाकर लग जाता है, और फ़ैसला फ़ोन कॉल ही करती है।',
    },
    {
      id: 'order-placed',
      say: 'And there it is, with its own Skydrop number and a tracker you can follow from the call centre to the door. Status: awaiting the call.',
      sayBn:
        'এই তো, নিজের একটা Skydrop নম্বর নিয়ে, আর সঙ্গে একটা tracker — কল সেন্টার থেকে দরজা পর্যন্ত অনুসরণ করা যায়। অবস্থা: কলের অপেক্ষায়।',
      sayHi:
        'यह हो गया, अपने एक Skydrop नंबर के साथ, और साथ में एक tracker — call centre से दरवाज़े तक पीछे चला जा सकता है। हालत: कॉल के इंतज़ार में।',
    },

    /* ── act six: the phone call ──────────────────────────────────── */
    {
      id: 'call-waiting',
      say: 'That is the single most important thing Skydrop does, so it is worth being slow about. In a cash-on-delivery market an unconfirmed order is a parcel that travels twice and gets paid for once.',
      sayBn:
        'Skydrop যা যা করে তার মধ্যে এটাই সবচেয়ে জরুরি, তাই এটা নিয়ে একটু ধীরে যাওয়া দরকার। COD-র বাজারে নিশ্চিত না হওয়া একটা অর্ডার মানে এমন একটা পার্সেল, যেটা দুবার যাতায়াত করে আর টাকা আসে একবারের।',
      sayHi:
        'Skydrop जो-जो करता है उसमें यही सबसे ज़रूरी है, इसलिए इस पर ज़रा धीरे चलना बनता है। COD के बाज़ार में बिना पक्का हुआ ऑर्डर मतलब ऐसा पार्सल, जो दो बार सफ़र करता है और पैसा एक बार का मिलता है।',
    },
    {
      id: 'call-confirmed',
      say: 'Here is an order that has been through it. One of our agents rang her, she said yes, and the stock was reserved and the courier booked at that moment and not before.',
      sayBn:
        'এই অর্ডারটা সেই ধাপ পার হয়ে এসেছে। আমাদের একজন এজেন্ট তাকে ফোন করেছিল, সে রাজি হয়েছে, আর ঠিক সেই মুহূর্তেই স্টক আটকে রাখা হয়েছে আর কুরিয়ার বুক হয়েছে — তার আগে নয়।',
      sayHi:
        'यह ऑर्डर उस पड़ाव से गुज़र चुका है। हमारे एक agent ने उसे फ़ोन किया, उसने हाँ कही, और ठीक उसी वक़्त स्टॉक रोका गया और कूरियर book हुआ — उससे पहले नहीं।',
    },
    {
      id: 'call-why',
      say: 'The agent’s own words are written against that call. If she had not answered we would try again, up to the limit you set — and after that the order comes back to you to decide.',
      sayBn:
        'এজেন্ট নিজে যা বলেছে, সেটা ওই কলের ঘরেই লেখা আছে। সে ফোন না ধরলে আমরা আবার চেষ্টা করতাম, আপনি যে সীমা ঠিক করে দিয়েছেন সেই পর্যন্ত — আর তারপর সিদ্ধান্ত নেওয়ার জন্য অর্ডারটা আপনার কাছে ফিরে আসে।',
      sayHi:
        'agent ने ख़ुद जो कहा, वह उसी कॉल के ख़ाने में लिखा है। उसने फ़ोन न उठाया होता तो हम फिर कोशिश करते, आपकी तय की हद तक — और उसके बाद फ़ैसले के लिए ऑर्डर आपके पास लौट आता है।',
    },

    /* ── act seven: the warehouse ─────────────────────────────────── */
    {
      id: 'wh-picked',
      say: 'From here you watch rather than work. Our picker walked the aisles with a printed sheet, scanned each product and took it off the shelf.',
      sayBn:
        'এখান থেকে আপনার আর কাজ নেই, শুধু দেখা। আমাদের picker ছাপানো একটা শিট নিয়ে গুদামের সারিতে হেঁটেছে, প্রতিটা পণ্য স্ক্যান করেছে আর তাক থেকে নামিয়েছে।',
      sayHi:
        'यहाँ से आपका काम नहीं, सिर्फ़ देखना है। हमारा picker छपी हुई एक शीट लेकर गोदाम की कतारों में चला, हर प्रोडक्ट स्कैन किया और शेल्फ़ से उतारा।',
    },
    {
      id: 'wh-packed',
      say: 'At the bench every item is scanned into the box and the box is scanned shut, which is the moment your on-hand stock actually goes down. Not at the order, not at the door.',
      sayBn:
        'প্যাক বেঞ্চে প্রতিটা জিনিস স্ক্যান করে বাক্সে ঢোকানো হয় আর বাক্স বন্ধ করার সময় আবার স্ক্যান করা হয় — ঠিক তখনই আপনার হাতের স্টক আসলে কমে। অর্ডারের সময় নয়, দরজায় পৌঁছানোর সময়ও নয়।',
      sayHi:
        'pack bench पर हर चीज़ स्कैन करके डिब्बे में डाली जाती है और डिब्बा बंद करते वक़्त फिर स्कैन होता है — ठीक उसी घड़ी आपका मौजूद स्टॉक असल में घटता है। ऑर्डर के वक़्त नहीं, दरवाज़े पर पहुँचने के वक़्त भी नहीं।',
    },
    {
      id: 'wh-handover',
      say: 'Then the courier’s driver takes it and the box is scanned out. That line is the handover: everything above it we did, everything below is the courier’s.',
      sayBn:
        'তারপর কুরিয়ারের ড্রাইভার এটা নিয়ে যায় আর বাক্সটা বেরিয়ে যাওয়ার সময় স্ক্যান হয়। ওই লাইনটাই হস্তান্তর: তার উপরের সবকিছু আমরা করেছি, নিচের সবকিছু কুরিয়ারের।',
      sayHi:
        'फिर कूरियर का ड्राइवर इसे ले जाता है और डिब्बा बाहर निकलते वक़्त स्कैन होता है। वही लाइन सुपुर्दगी है: उसके ऊपर का सब हमने किया, नीचे का सब कूरियर का है।',
    },

    /* ── act eight: tracking ──────────────────────────────────────── */
    {
      id: 'parcel-waybill',
      say: 'The parcel carries a waybill and the name of the courier holding it. That number is what the customer can follow on a public page, with no account and no login.',
      sayBn:
        'পার্সেলের সঙ্গে একটা waybill থাকে, আর সঙ্গে থাকে কোন কুরিয়ার এটা বহন করছে তার নাম। ওই নম্বর দিয়েই ক্রেতা একটা খোলা পৃষ্ঠায় পার্সেল অনুসরণ করতে পারে — কোনো অ্যাকাউন্ট লাগে না, লগইনও লাগে না।',
      sayHi:
        'पार्सल पर एक waybill रहता है, और साथ में यह कि उसे कौन-सा कूरियर ढो रहा है। उसी नंबर से ग्राहक एक खुले पेज पर पार्सल के पीछे चल सकता है — कोई अकाउंट नहीं चाहिए, login भी नहीं।',
    },
    {
      id: 'tracking-page',
      say: 'And every parcel at once, filtered by where it has got to. Out for delivery, delivery failed, coming back. This is read-only — the courier’s scans decide, not us.',
      sayBn:
        'আর Tracking-এ একসঙ্গে সব পার্সেল, কে কোন ধাপে পৌঁছেছে সেই অনুযায়ী ভাগ করা। Out for delivery, Delivery failed, Coming back। এই পৃষ্ঠা শুধু পড়ার জন্য — সিদ্ধান্ত নেয় কুরিয়ারের স্ক্যান, আমরা নয়।',
      sayHi:
        'और Tracking में एक साथ सारे पार्सल, इस हिसाब से बँटे कि कौन कहाँ तक पहुँचा। Out for delivery, Delivery failed, Coming back। यह पेज सिर्फ़ पढ़ने के लिए है — फ़ैसला कूरियर के स्कैन करते हैं, हम नहीं।',
    },

    /* ── act nine: it goes wrong ──────────────────────────────────── */
    {
      id: 'failed-open',
      say: 'Some will not arrive first time. Here the driver could not deliver, the courier said why, and the order is waiting on you rather than drifting.',
      sayBn:
        'কিছু পার্সেল প্রথমবারেই পৌঁছায় না। এখানে ড্রাইভার ডেলিভারি করতে পারেনি, কুরিয়ার কারণটা জানিয়েছে, আর অর্ডারটা ভেসে না গিয়ে আপনার সিদ্ধান্তের অপেক্ষায় আছে।',
      sayHi:
        'कुछ पार्सल पहली बार में नहीं पहुँचते। यहाँ ड्राइवर डिलीवर नहीं कर पाया, कूरियर ने कारण बता दिया, और ऑर्डर बहने के बजाय आपके फ़ैसले के इंतज़ार में है।',
    },
    {
      id: 'failed-choices',
      say: 'Three choices. Ask for another attempt, have us phone her again, or send it back — and the return fee is printed before you decide, not after. Each has a short video.',
      sayBn:
        'তিনটা পথ। আরেকবার ডেলিভারির চেষ্টা চাওয়া, আমাদের দিয়ে তাকে আবার ফোন করানো, বা জিনিসটা ফেরত পাঠানো — আর ফেরতের চার্জ সিদ্ধান্ত নেওয়ার আগেই দেখানো হয়, পরে নয়। প্রতিটা নিয়েই আলাদা ছোট ভিডিও আছে।',
      sayHi:
        'तीन रास्ते। एक बार और डिलीवरी की कोशिश माँगना, हमसे उसे फिर फ़ोन कराना, या चीज़ वापस भेजना — और वापसी का शुल्क फ़ैसला लेने से पहले ही दिखाया जाता है, बाद में नहीं। हर एक पर एक छोटा वीडियो है।',
    },
    {
      id: 'returned-open',
      say: 'This one did come back. Returning is not one event but four: the courier turns it round, it travels, our warehouse receives it, and somebody opens the box.',
      sayBn:
        'এটা সত্যিই ফেরত এসেছে। ফেরত আসা একটা ঘটনা নয়, চারটা: কুরিয়ার পার্সেলটা ঘুরিয়ে দেয়, সেটা পথ পার হয়, আমাদের গুদাম সেটা গ্রহণ করে, আর কেউ বাক্সটা খোলে।',
      sayHi:
        'यह सचमुच वापस आ गया। वापसी एक घटना नहीं, चार हैं: कूरियर पार्सल को घुमा देता है, वह सफ़र करता है, हमारा गोदाम उसे लेता है, और कोई डिब्बा खोलता है।',
    },
    {
      id: 'returned-stock',
      say: 'Two units were good and went straight back into your sellable stock. The tracker says so, and the stock figures moved the moment it happened.',
      sayBn:
        'দুটো ইউনিট ঠিক ছিল, তাই সোজা আপনার বিক্রিযোগ্য স্টকে ফিরে গেছে। tracker সেটাই বলছে, আর ঘটনার সঙ্গে সঙ্গেই স্টকের সংখ্যা বদলে গেছে।',
      sayHi:
        'दो यूनिट ठीक थीं, इसलिए सीधे आपके बिकने लायक़ स्टॉक में लौट गईं। tracker यही कह रहा है, और होते ही स्टॉक के आँकड़े बदल गए।',
    },
    {
      id: 'returned-ticket',
      say: 'The third arrived damaged, so we opened a ticket, said what we found, and settled it. The refund is already in your wallet — you did not have to ask.',
      sayBn:
        'তৃতীয়টা ভাঙা অবস্থায় এসেছে, তাই আমরা একটা ticket খুলেছি, কী পেয়েছি সেটা লিখেছি, আর নিষ্পত্তি করেছি। টাকা ফেরত আপনার ওয়ালেটে আগেই চলে এসেছে — আপনাকে চাইতেও হয়নি।',
      sayHi:
        'तीसरी टूटी हुई आई, इसलिए हमने एक ticket खोला, जो मिला वह लिखा, और उसे निपटा दिया। पैसा वापस आपके wallet में पहले ही आ चुका है — आपको माँगना भी नहीं पड़ा।',
    },

    /* ── act ten: the money ───────────────────────────────────────── */
    {
      id: 'wallet-open',
      say: 'Which brings us to the money. One wallet, in rupees, shown in taka as well at the rate on file. Every movement is a line you can read.',
      sayBn:
        'এবার টাকার কথা। একটাই Wallet, রুপিতে, আর ফাইলে রাখা রেট ধরে টাকাতেও দেখানো হয়। প্রতিটা লেনদেন একটা করে লাইন, আপনি পড়ে দেখতে পারেন।',
      sayHi:
        'अब बात पैसे की। एक ही wallet, रुपये में, और फ़ाइल में रखे रेट से टाका में भी दिखाया जाता है। हर लेन-देन एक लाइन है, जिसे आप पढ़ सकते हैं।',
    },
    {
      id: 'wallet-charges',
      say: 'What Skydrop charged for carrying that parcel, as its own entry with the order it belongs to. Nothing is rolled into a monthly figure you cannot take apart.',
      sayBn:
        'ওই পার্সেল বহনের জন্য Skydrop কত নিয়েছে, নিজের আলাদা একটা এন্ট্রি হিসেবে, কোন অর্ডারের সঙ্গে সেটাও লেখা। কিছুই এমন কোনো মাসিক সংখ্যার ভিতরে ঢুকিয়ে দেওয়া হয় না, যেটা আপনি আর আলাদা করতে পারবেন না।',
      sayHi:
        'उस पार्सल को ढोने के लिए Skydrop ने कितना लिया, अपनी एक अलग entry के तौर पर, और साथ में यह कि वह किस ऑर्डर का है। कुछ भी ऐसे किसी महीने के आँकड़े में नहीं मिलाया जाता जिसे आप फिर अलग न कर सकें।',
    },
    {
      id: 'wallet-cod',
      say: 'The cash the customer paid, credited when the courier settles with us rather than at the door — and the tax deducted from it, on its own line, never netted away.',
      sayBn:
        'ক্রেতা যে টাকা দিয়েছে, সেটা জমা হয় কুরিয়ার আমাদের সঙ্গে হিসাব মিটিয়ে দিলে — দরজায় টাকা দেওয়ার সময় নয় — আর তা থেকে কাটা কর আলাদা নিজের লাইনে থাকে, কখনো বাদ দিয়ে চুপচাপ মিলিয়ে দেওয়া হয় না।',
      sayHi:
        'ग्राहक ने जो पैसा दिया, वह जमा तब होता है जब कूरियर हमसे हिसाब मिला देता है — दरवाज़े पर पैसा देने के वक़्त नहीं — और उसमें से कटा टैक्स अपनी अलग लाइन में रहता है, कभी चुपचाप घटाकर मिला नहीं दिया जाता।',
    },
    {
      id: 'limits',
      say: 'Every rule behind those numbers is written down: when COD lands, what the fees are, the smallest withdrawal, the balance you must keep. Ask us to change one and it changes here.',
      sayBn:
        'ওই সংখ্যাগুলোর পিছনের প্রতিটা নিয়ম লেখা আছে: COD কখন জমা হয়, চার্জ কত, সবচেয়ে কম কত টাকা তোলা যায়, আর কত ব্যালেন্স রেখে দিতে হয়। কোনোটা বদলাতে বললে সেটা এখানেই বদলায়।',
      sayHi:
        'उन आँकड़ों के पीछे का हर नियम लिखा हुआ है: COD कब जमा होता है, शुल्क कितने हैं, सबसे कम कितना निकाला जा सकता है, और कितना बैलेंस रखना ज़रूरी है। हमसे कोई नियम बदलवाएँ तो वह यहीं बदलता है।',
    },
    {
      id: 'withdraw',
      say: 'Taking it out is a request, not a transfer. It tells you what is available — your balance less the amount you have chosen to keep — before you type a figure.',
      sayBn:
        'টাকা তোলা একটা অনুরোধ, সরাসরি পাঠানো নয়। আপনি কোনো সংখ্যা লেখার আগেই এটা বলে দেয় কত টাকা পাওয়া যাবে — আপনার ওয়ালেট ব্যালেন্স থেকে আপনি যতটা রেখে দিতে চেয়েছেন সেটা বাদ দিয়ে।',
      sayHi:
        'पैसा निकालना एक माँग है, सीधे भेजना नहीं। आप कोई रकम लिखने से पहले ही यह बता देता है कि कितना मिल सकता है — आपके वॉलेट बैलेंस में से आपने जितना रखना चुना है वह घटाकर।',
    },
    {
      id: 'withdrawn',
      say: 'A person checks it and pays it to the bank account on your profile. The request is on the record from this moment, with its own state you can watch.',
      sayBn:
        'একজন মানুষ এটা দেখে আপনার Profile-এ দেওয়া ব্যাংক অ্যাকাউন্টে টাকা পাঠায়। এই মুহূর্ত থেকেই অনুরোধটা নথিতে উঠে গেল, নিজের একটা অবস্থা নিয়ে, যেটা আপনি দেখতে পারবেন।',
      sayHi:
        'एक आदमी इसे देखता है और आपके Profile पर दिए बैंक अकाउंट में पैसा भेजता है। इस घड़ी से माँग रिकॉर्ड पर चढ़ गई, अपनी एक हालत के साथ, जिसे आप देख सकते हैं।',
    },

    /* ── act eleven: help, and what we skipped ────────────────────── */
    {
      id: 'help',
      say: 'When something is wrong, raise it on the order it is about. It reaches us with the parcel, the waybill and the customer already attached, and the reply lands on the ticket.',
      sayBn:
        'কোনো কিছু ভুল হলে, যে অর্ডার নিয়ে সমস্যা সেই অর্ডারেই Raise an issue করুন। পার্সেল, waybill আর ক্রেতার তথ্য আগেই জুড়ে এটা আমাদের কাছে পৌঁছায়, আর উত্তরটা ওই ticket-এই আসে।',
      sayHi:
        'कुछ ग़लत हो, तो जिस ऑर्डर की बात है उसी पर Raise an issue करें। पार्सल, waybill और ग्राहक की जानकारी पहले से जुड़ी हुई यह हमारे पास पहुँचता है, और जवाब उसी ticket पर आता है।',
    },
    {
      id: 'the-rest',
      say: 'Not covered here, one short video each: bins and batches, cycle counts, serial-tracked goods, changing your bank details, API keys and webhooks, notifications, your team, expenses and your profit and loss.',
      sayBn:
        'এখানে যা আসেনি, প্রতিটার জন্য একটা করে ছোট ভিডিও আছে: bin আর batch, cycle count, সিরিয়াল ধরে রাখা পণ্য, ব্যাংকের তথ্য বদলানো, API key আর webhook, notification, আপনার টিম, খরচ, আর আপনার লাভ-ক্ষতির হিসাব।',
      sayHi:
        'जो यहाँ नहीं आया, उसके लिए एक-एक छोटा वीडियो है: bin और batch, cycle count, सीरियल से रखा जाने वाला माल, बैंक की जानकारी बदलना, API key और webhook, notification, आपकी टीम, ख़र्च, और आपका नफ़ा-नुक़सान।',
    },
    {
      id: 'outro',
      say: 'That is the whole loop. Catalogue, consignment, freight, stock, order, call, warehouse, courier, return, money. Four products out of Dhaka and the cash back in your wallet.',
      sayBn:
        'এই হলো পুরো চক্র। ক্যাটালগ, consignment, ফ্রেইট, স্টক, অর্ডার, কল, গুদাম, কুরিয়ার, ফেরত, টাকা। ঢাকা থেকে চারটা পণ্য বেরিয়ে গেল, আর টাকা ফিরে এল আপনার ওয়ালেটে।',
      sayHi:
        'यह है पूरा चक्कर। कैटलॉग, consignment, freight, स्टॉक, ऑर्डर, कॉल, गोदाम, कूरियर, वापसी, पैसा। ढाका से चार प्रोडक्ट निकले, और पैसा लौटकर आपके wallet में आ गया।',
    },
  ],
};

/* ─────────────────────────────── FLOW ──────────────────────────────── */

export const flow = {
  app: 'seller',

  /**
   * The kurti's photo and both CSV uploads are real `fetch` calls to a
   * `mock://` presigned URL. Without the shim they fail, and the failure
   * films as a stalled panel under narration saying the file landed.
   */
  needsSpacesShim: true,

  /**
   * WHAT `seed-demo-data.mjs` MUST HAVE MADE.
   *
   * Written as assertions rather than as a to-do list, because every
   * one of them is a thing that renders a perfectly good page when it
   * is absent — an empty freight panel, a tracker with no call rung, a
   * stock tile reading zero — and films as a video of the wrong
   * sentence. Where a step can gate on the claim itself it does; this
   * list is what the gates are checking FOR.
   */
  seed: [
    // ── the four products the video follows ──
    'Product "Jamdani Cotton Kurti", external ref RSH-JKURTI, ACTIVE, default weight 290 g, declared value ₹2,200, with four variants: RSH-JKURTI-ROSE-M, RSH-JKURTI-ROSE-L, RSH-JKURTI-INDIGO-M, RSH-JKURTI-INDIGO-L (options colour × size). At least one of them carries a product image, so the order picker and the pack bench have a thumbnail.',
    'Product "Hand-stitched Leather Wallet", external ref RSH-WALLET, ACTIVE, weight 120 g, declared value ₹1,450, with exactly ONE variant RSH-WALLET-TAN and no options — it is the video\'s example of the simple case.',
    'Product "Rose and Neem Soap — Box of 6", external ref RSH-SOAP6, ACTIVE, weight 540 g, declared value ₹620, one variant RSH-SOAP6-ROSENEEM. Its India stock sits in a BATCH carrying an expiry date, so the FEFO line in `line-soap` is true of real data.',
    'Product "Brass Table Lamp", external ref RSH-LAMP, ACTIVE, weight 1850 g, declared value ₹3,900, one variant RSH-LAMP-BRASS. It must be the heaviest thing in the catalogue — `line-lamp` says so.',
    "NO em-dash or comma in any of those four product names beyond the one shown: the soap's name is narrated and appears in the CSV, and a comma there would need quoting in the sheet.",

    // ── what the take creates, and must therefore not already exist ──
    'NO product with external ref RSH-JKURTI-AUT and no variant whose SKU begins RSH-JKA-. The take creates "Jamdani Cotton Kurti — Autumn" on camera; a second run against a catalogue that already holds it films the duplicate-reference refusal under narration about creating it.',
    'NO variants RSH-WALLET-BLACK, RSH-SOAP6-SANDAL or RSH-LAMP-SMALL. The CSV creates all three, and the `csv-import` scene narrates "three new variants" — a re-upload that merely UPDATES them reports 0 created, which films as nothing having happened.',
    'NO consignment with seller reference RSH-LONG-CN (the take announces one), and NO order with reference RSH-LONG-0001 (the take places one).',
    'NO withdrawal request in PENDING for the demo seller. The take raises one, and a seller already at their daily or monthly request limit is refused inside the dialog.',
    'NO open seller delivery-action request on RSH-LIFE-FAILED. `failed-choices` opens the "Ask admin to act" dialog; the button is hidden once a request is outstanding.',

    // ── the sheet ──
    `A CSV at ${PRODUCTS_CSV} with EXACTLY these headers, in this order, so every column auto-detects and no saved mapping is needed: "Product Name,Product ID,SKU,Weight (g),Length (cm),Width (cm),Height (cm),Declared value,Barcode,Options".`,
    'Exactly THREE data rows in that CSV, each naming a product that already exists by its Product ID so the import adds a variant rather than a product: (1) Hand-stitched Leather Wallet / RSH-WALLET / RSH-WALLET-BLACK / 120 / 12 / 10 / 3 / 1450 / barcode / colour=Black; (2) Rose and Neem Soap — Box of 6 / RSH-SOAP6 / RSH-SOAP6-SANDAL / 540 / 18 / 12 / 6 / 620 / barcode / scent=Sandalwood; (3) Brass Table Lamp / RSH-LAMP / RSH-LAMP-SMALL / 1250 / 22 / 16 / 28 / 2900 / barcode / size=Small.',
    'NO saved catalogue mapping marked DEFAULT for this seller. A default mapping is applied to an import that names none, and one left over from the upload-a-catalogue take would re-aim every column in the preview this video narrates.',

    // ── the crossing ──
    `A consignment with seller reference ${LANDED}, route VIA_BD, fully landed: a COUNTED Bangladesh leg with a dispatch date, and a COUNTED arrival in India. It must carry all four followed products.`,
    'At least one line SHORT at the Bangladesh count (the page renders it with data-tone="bad") — `landed-dhaka` is about a count that disagrees, and a consignment matching all the way through films the opposite.',
    'At least one line short at the INDIA arrival as well, and the detail page\'s own sentence "left Bangladesh and did not arrive" must be true — `landed-missing` gates on those words rather than on the tile that would contain them.',
    'A second consignment still in the air, so `/inventory`\'s "In transit" tile is not a dash (the existing RSH-CN-FLYING does this).',
    'India stock greater than zero for all four followed products, and at least one unit HELD for an order, so the "Held for orders" figure in the India-stock tile is not a zero. `stock-row` is entirely about that difference.',

    // ── freight ──
    `A LIVE inbound-freight bill against ${LANDED}'s INDIAN goods receipt, terms pay-as-it-sells (PAY_LATER), status PARTIALLY_SETTLED, agreed in BDT with a named forwarder. "Partially settled" is the state the whole freight act describes and is the one thing the seeding can silently fail to produce — a bill at nought or at a hundred per cent renders the same tiles, tabs and rows.`,

    // ── the orders the second half reads ──
    `An order with reference ${READ_ORDERS.delivered}, DELIVERED, whose journey is complete: a CALL_LOGGED order event carrying the agent's own words (it is printed on the "Confirmed by phone" rung and narrated), pick and pack stamps, a handover, courier scans, a waybill and a courier on its live parcel. Its lines should include the kurti and the soap so the products match the story.`,
    `An order with reference ${READ_ORDERS.failed}, DELIVERY_FAILED, with NDR history and a courier reason, so the "Delivery did not succeed" panel and its "Ask admin to act" button both render.`,
    `An order with reference ${READ_ORDERS.restocked}, reaching RTO_RESTOCKED, with at least two units restocked and one found DAMAGED — so the tracker's final rung reads "Back in your stock" and there is a damage claim behind it.`,
    'A SCRAP_DAMAGE ticket for that return, CLOSED AND REFUNDED, listed on /tickets as "RTO DAMAGED" with "Closed · refunded", carrying a refund banner and a conversation. `returned-ticket` gates on the banner, which renders only when a refund actually landed.',
    'Enough parcels in flight that /tracking\'s tiles render and its "Delivery failed" and "Coming back" tabs each have a row — the tiles draw only on the unfiltered view and only with rows.',

    // ── the money ──
    'Wallet ledger rows present for this seller, each narrated by name: "Order charges", "COD collected", "COD tax deduction" and "Damage settlement" (the refund above writes the last one).',
    'An INR→BDT FX rate on file, so the wallet\'s converted tile and its "₹1 = ৳…" hint both render — `wallet-open` says the balance is shown in taka as well.',
    'Withdrawable balance (balance less the minimum to keep) of at least ₹20,000, comfortably above the ₹10,000 the take requests and above the smallest allowed withdrawal.',
    '/wallet/limits fully populated from the server — it is driven by GET /seller/wallet/settings, and `limits` dwells on four named rules.',
    'A bank account on the seller profile, so `withdrawn` can truthfully say where the money goes.',
  ],

  steps: [
    /* ── what this is ─────────────────────────────────────────────── */
    {
      id: 'intro',
      async run({ page, stage }) {
        // Let the dashboard breathe, then show there is more below it.
        await page.waitForTimeout(1600);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2000);
        await stage.glide(300);
        await page.waitForTimeout(800);
        await stage.glide(-300);
      },
    },
    {
      id: 'the-job',
      async run({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2400);
        await stage.glide(360);
        await page.waitForTimeout(1200);
        await stage.glide(-360);
      },
    },
    {
      id: 'the-shell',
      async run({ page, stage }) {
        // The five groups in the order the narration names them. This is
        // the ONLY time the shell is explained — the other long videos
        // assume it (the house rule), so nothing here is repeated later.
        await stage.dwellOn(page.locator('[data-slot="nav-rail"]').first(), 1600);
        for (const group of ['Selling', 'Stock', 'Money', 'Reselling', 'Account']) {
          await stage.dwellOn(navGroup(page, group), 1200);
        }
      },
    },

    /* ── act one: the catalogue ───────────────────────────────────── */
    {
      id: 'products-list',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Products', /\/products(\?|$)/);
        // The four being followed, by name, so a viewer can see they are
        // genuinely already there before the narration says so.
        for (const key of ['kurti', 'wallet', 'soap']) {
          const row = page.getByRole('row').filter({ hasText: FOLLOWED[key].product }).first();
          await row.waitFor({ state: 'visible', timeout: 25_000 });
          await stage.dwellOn(row, 1300);
        }
      },
    },
    {
      id: 'kurti-new',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: /^New product$/ }).first(), {
          after: 1500,
        });
        await page.waitForURL(/\/products\/new/, { timeout: 30_000 });
        await page.waitForTimeout(600);
        await stage.typeIn(page.getByLabel('Product name'), AUTUMN_KURTI.name, { delay: 42 });
        await stage.typeIn(page.getByLabel('Your product ID'), AUTUMN_KURTI.externalRef, {
          delay: 70,
        });
        await stage.typeIn(page.getByLabel('Weight (g)'), AUTUMN_KURTI.weightGrams, { delay: 120 });
        await stage.typeIn(page.getByLabel('Declared value (₹)'), AUTUMN_KURTI.declaredValueInr, {
          delay: 110,
          after: 800,
        });
      },
    },
    {
      id: 'kurti-colour',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add an option' }), { after: 800 });
        await stage.typeIn(page.locator('#option-0-name'), 'Colour', { delay: 90 });
        await stage.typeIn(
          page.getByRole('textbox', { name: 'Colour value 1', exact: true }),
          AUTUMN_KURTI.colours[0],
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
          AUTUMN_KURTI.colours[1],
          { delay: 70, after: 700 },
        );
      },
    },
    {
      id: 'kurti-size',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Add an option' }), { after: 800 });
        await stage.typeIn(page.locator('#option-1-name'), 'Size', { delay: 110, after: 700 });
        // The SECOND option is always per-parent, so it draws one value
        // list per colour — which is the thing this scene exists to show.
        await stage.dwellOn(page.getByRole('region', { name: 'Size' }), 1200);
        for (const colour of AUTUMN_KURTI.colours) {
          const first = page.getByRole('textbox', {
            name: `Size for ${colour} value 1`,
            exact: true,
          });
          await stage.typeIn(first, AUTUMN_KURTI.sizes[0], { delay: 70 });
          await stage.clickIt(
            page
              .locator('.prd-parent')
              .filter({ has: first })
              .getByRole('button', { name: 'Add value' }),
            { settle: 220, after: 400 },
          );
          await stage.typeIn(
            page.getByRole('textbox', { name: `Size for ${colour} value 2`, exact: true }),
            AUTUMN_KURTI.sizes[1],
            { delay: 70, after: 500 },
          );
        }
      },
    },
    {
      id: 'kurti-variants',
      async run({ page, stage }) {
        await stage.glide(560);
        await page.waitForTimeout(700);
        await stage.dwellOn(page.locator('table').last(), 2600);
      },
    },
    {
      id: 'kurti-save',
      async run({ page, stage }) {
        // Row labels are the option values joined with " / " — the form's
        // own `parts.join(' / ')`. Falling back to the first input in the
        // variant table keeps the scene alive if that label ever moves,
        // because editing SOME SKU is the point and which one is not.
        const label = `SKU for ${AUTUMN_KURTI.colours[0]} / ${AUTUMN_KURTI.sizes[0]}`;
        const byLabel = page.getByLabel(label);
        const target =
          (await byLabel.count()) > 0
            ? byLabel
            : page.locator('table').last().locator('input').first();
        await stage.typeIn(target, AUTUMN_KURTI.editedSku, {
          delay: 70,
          clear: true,
          after: 900,
        });
        await stage.clickIt(page.getByRole('button', { name: /^Create product$/ }), {
          settle: 700,
          after: 2600,
        });
        await page.waitForURL(/\/products\/[0-9a-f-]{20,}/, { timeout: 60_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(900);
      },
    },
    {
      id: 'kurti-photo',
      async run({ page, stage }) {
        // The variant's own page, reached by its SKU — pictures hang off
        // the variant and not the product, which is the scene's claim.
        const link = page.getByRole('link', { name: AUTUMN_KURTI.editedSku }).first();
        const target = (await link.count()) > 0 ? link : page.locator('a.inv-strong-link').first();
        await stage.clickIt(target, { after: 1600 });
        await page.waitForURL(/\/variants\//, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(800);
        // The <input> is visually hidden inside the zone, so the file goes
        // to the INPUT while the halo sits on what a viewer can see.
        await stage.point(page.locator('.sk-drop').first(), { settle: 700 });
        await page.locator('.sk-drop input[type="file"]').first().setInputFiles(KURTI_PHOTO);
        // THE GALLERY IS THE PROOF, not the queue badge: "done" is set
        // before the refetch lands, so waiting on it would film an empty
        // gallery under narration saying the picture is attached.
        await page
          .locator('.prd-gallery__item')
          .first()
          .waitFor({ state: 'visible', timeout: 40_000 });
        await page.waitForTimeout(1000);
        await stage.clearHalo();
        await stage.dwellOn(page.locator('.prd-gallery').first(), 1800);
      },
    },
    {
      id: 'csv-upload',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Products', /\/products(\?|$)/);
        await stage.clickIt(page.locator('a[href="/products/import"]').first(), { after: 1600 });
        await page.waitForURL(/\/products\/import$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The page's own subtitle says what the next two scenes claim —
        // that a re-upload updates, matched on the seller's own reference.
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2200);
        await stage.point(page.locator('.sk-drop').first(), { settle: 600 });
        await page.locator('.sk-drop input[type="file"]').first().setInputFiles(PRODUCTS_CSV);
        await page.waitForTimeout(900);
        await stage.clearHalo();
      },
    },
    {
      id: 'csv-preview',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Upload and check' }).first(), {
          after: 1400,
        });
        // The matched-columns block, which is the whole point of the step.
        const mapping = page.locator('.ord-mapping').first();
        await mapping.waitFor({ state: 'visible', timeout: 40_000 });
        await page.waitForTimeout(700);
        await stage.dwellOn(mapping, 3600);
      },
    },
    {
      id: 'csv-import',
      async run({ page, stage }) {
        const button = page.getByRole('button', { name: /^Import \d+ row/ }).first();
        await button.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(button, { settle: 700, after: 1800 });
        // The run reaching a TERMINAL state. The worker is in-process so
        // this is seconds, but waiting on the words is what stops the
        // scene filming a spinner under a line about three new variants.
        await page
          .getByRole('row')
          .filter({ hasText: /Completed|Failed|Partial/i })
          .first()
          .waitFor({ state: 'visible', timeout: 60_000 });
        await page.waitForTimeout(1000);
        await stage.dwellOn(page.getByRole('table').first(), 2200);
      },
    },

    /* ── act two: announcing the consignment ──────────────────────── */
    {
      id: 'inbound-open',
      async run(ctx) {
        const { page, stage } = ctx;
        // "Add stock" is what the sidebar calls /inbound, and it is the
        // only way in that a seller has.
        await openNav(ctx, 'Add stock', /\/inbound$/);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2400);
      },
    },
    {
      id: 'announce-open',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Announce a consignment' }).first(), {
          after: 1600,
        });
        await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 20_000 });
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('#cn-route-h'), 1800);
      },
    },
    {
      id: 'routes',
      async run({ page, stage }) {
        // The info toggle holds the full paragraph for each route; the
        // choices themselves carry only enough to decide.
        await stage.clickIt(
          page.getByRole('button', { name: /What do the routes mean/i }).first(),
          {
            after: 1400,
          },
        );
        await page.waitForTimeout(1400);
        await stage.dwellOn(choiceCard(page, 'DIRECT_IN'), 2600);
      },
    },
    {
      id: 'route-pick',
      async run(ctx) {
        await ctx.stage.dwellOn(choiceCard(ctx.page, 'VIA_BD'), 2400);
        await chooseCard(ctx, 'VIA_BD', { after: 1600 });
      },
    },
    {
      id: 'line-kurti',
      async run(ctx) {
        const { page, stage } = ctx;
        const add = page.getByRole('button', { name: 'Add this product to the consignment' });
        // The kurti first — a variant, chosen by its SKU so the picker
        // returns one hit and not a colour family.
        await pickVariant(ctx, FOLLOWED.kurti.sku);
        await stage.typeIn(page.locator('#cn-qty'), ANNOUNCED.kurti.qty, {
          clear: true,
          after: 400,
        });
        await stage.typeIn(page.locator('#cn-cost'), ANNOUNCED.kurti.unitCost, {
          clear: true,
          after: 700,
        });
        await stage.clickIt(add, { after: 1200 });
        // Then the wallet: one SKU, nothing to choose. The contrast is
        // the point, so the two go in the same scene.
        await pickVariant(ctx, FOLLOWED.wallet.sku);
        await stage.typeIn(page.locator('#cn-qty'), ANNOUNCED.wallet.qty, {
          clear: true,
          after: 400,
        });
        await stage.clickIt(add, { after: 1200 });
      },
    },
    {
      id: 'line-soap',
      async run(ctx) {
        const { page, stage } = ctx;
        await pickVariant(ctx, FOLLOWED.soap.sku);
        await stage.typeIn(page.locator('#cn-qty'), ANNOUNCED.soap.qty, {
          clear: true,
          after: 400,
        });
        await stage.typeIn(page.locator('#cn-cost'), ANNOUNCED.soap.unitCost, {
          clear: true,
          after: 500,
        });
        // The dates are what make this a BATCH, and the two fields do not
        // exist until the box is ticked.
        await tickBox(ctx, 'Has manufacture / expiry dates', { after: 900 });
        await setDate(ctx, page.locator('#cn-mfg'), isoIn(-20));
        await setDate(ctx, page.locator('#cn-exp'), isoIn(540));
        await stage.clickIt(
          page.getByRole('button', { name: 'Add this product to the consignment' }),
          { after: 1400 },
        );
      },
    },
    {
      id: 'line-lamp',
      async run(ctx) {
        const { page, stage } = ctx;
        await pickVariant(ctx, FOLLOWED.lamp.sku);
        await stage.typeIn(page.locator('#cn-qty'), ANNOUNCED.lamp.qty, {
          clear: true,
          after: 400,
        });
        await stage.typeIn(page.locator('#cn-cost'), ANNOUNCED.lamp.unitCost, {
          clear: true,
          after: 500,
        });
        await stage.clickIt(
          page.getByRole('button', { name: 'Add this product to the consignment' }),
          { after: 1400 },
        );
        // All four staged, in one table. The lamp's weight is not shown
        // here — it is on the product — so the scene holds the list and
        // the narration makes the connection.
        await stage.dwellOn(page.getByRole('table').last(), 2000);
      },
    },
    {
      id: 'announced',
      async run(ctx) {
        const { page, stage } = ctx;
        // Three weeks out: far enough to read as a real crossing rather
        // than as whatever today happens to be.
        await setDate(ctx, page.locator('#cn-eta'), isoIn(21));
        await stage.typeIn(page.locator('#cn-ref'), ANNOUNCED.reference, {
          clear: true,
          after: 600,
        });
        await stage.clickIt(page.getByRole('button', { name: /^Announce \d+ product/ }).first(), {
          after: 2400,
        });
        await page.getByRole('dialog').waitFor({ state: 'hidden', timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // THE ROW IS THE PROOF, not the dialog closing: a refusal stays
        // inside the dialog, and the register is what the narration reads.
        const row = consignmentRow(page, ANNOUNCED.reference);
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(row, 2200);
      },
    },

    /* ── act three: freight ───────────────────────────────────────── */
    {
      id: 'freight-open',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Inbound freight', /\/freight$/);
        /*
          THE GATE FOR THE WHOLE ACT. "Partially settled" is the state
          all three freight scenes describe, and it is the one thing the
          seeding can silently fail to produce: a bill at nought or at a
          hundred per cent renders the same tiles, tabs and rows.
        */
        await page
          .getByText('Partially settled', { exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        const row = freightRow(page);
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(row.locator('.frt-terms').first(), 2400);
      },
    },
    {
      id: 'freight-figures',
      async run({ page, stage }) {
        // One tile carries BOTH the total and, in its foot, what has
        // actually been charged — the gap between them is the sentence.
        const billed = await kpi(page, 'Billed to you');
        await stage.dwellOn(billed, 1600);
        await stage.dwellOn(billed.locator('.sk-kpi__foot').first(), 1600);
        await stage.dwellOn(await kpi(page, 'Units charged'), 1600);
        await stage.dwellOn(await kpi(page, 'Still owed'), 2000);
      },
    },
    {
      id: 'freight-when',
      async run({ page, stage }) {
        // The page's OWN paragraph, which says what the narration says.
        // It renders only while a pay-later bill is on screen, so it is a
        // second independent gate on the world being right.
        const note = page.locator('.frt-note').first();
        await note.waitFor({ state: 'visible', timeout: 20_000 });
        await note.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(note, 3400);
      },
    },

    /* ── act four: it lands ───────────────────────────────────────── */
    {
      id: 'landed-open',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Add stock', /\/inbound$/);
        const row = consignmentRow(page, LANDED);
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/inbound\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // Its own reference is what proves the RIGHT one opened — the
        // consignment number changes with every rebuild.
        await page
          .getByText(LANDED, { exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(await area(page, 'What has happened'), 2800);
      },
    },
    {
      id: 'landed-dhaka',
      async run({ page, stage }) {
        // THE DIFFERENCE, on the Bangladesh table. The whole scene is
        // about a line being short, so a gate on the SECTION would pass
        // happily on a consignment that matched all the way through.
        const bd = await area(page, 'Counted at our Bangladesh warehouse');
        const short = bd.locator('[data-tone="bad"]').first();
        await short.waitFor({ state: 'visible', timeout: 20_000 });
        await short.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(bd.locator('table').first(), 3000);
      },
    },
    {
      id: 'landed-india',
      async run({ page, stage }) {
        const arrival = await area(page, 'Arrival in India');
        await stage.dwellOn(arrival.locator('table').first(), 3000);
      },
    },
    {
      id: 'landed-missing',
      async run({ page, stage }) {
        /*
          THE LOST UNIT, NAMED. The same tile once read "Still to come: 1
          — in Dhaka or in the air" on a consignment whose every leg had
          been counted and whose transit bin held nothing. Gating on the
          SENTENCE rather than the tile means a regression fails this
          check instead of filming the promise again.
        */
        const named = page.getByText(/left Bangladesh and did not arrive/).first();
        await named.waitFor({ state: 'visible', timeout: 20_000 });
        await named.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(700);
        await stage.dwellOn(named, 3200);
      },
    },
    {
      id: 'stock-open',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Inventory', /\/inventory$/);
        await stage.dwellOn(await kpi(page, 'India stock'), 1800);
        await stage.dwellOn(await kpi(page, 'In transit'), 2200);
      },
    },
    {
      id: 'stock-row',
      async run({ page, stage }) {
        // THE SPLIT IS THE CLAIM. A zero held would put the narration on
        // a number that proves nothing, so the tile's own "Held for
        // orders" line is waited for rather than assumed.
        const card = await kpi(page, 'India stock');
        await card
          .getByText('Held for orders')
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(card, 1800);
        const table = page.locator('table').first();
        await table.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
        await page.waitForTimeout(600);
        await stage.dwellOn(stockRow(page, FOLLOWED.kurti.sku), 2400);
      },
    },

    /* ── act five: an order ───────────────────────────────────────── */
    {
      id: 'order-new',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Orders', /\/orders(\?|$)/);
        await stage.clickIt(page.getByRole('link', { name: /^New order$/ }).first(), {
          after: 1500,
        });
        await page.waitForURL(/\/orders\/new/, { timeout: 30_000 });
        await page.waitForTimeout(800);
      },
    },
    {
      id: 'order-recipient',
      async run({ page, stage }) {
        await stage.typeIn(page.getByLabel('Full name'), CUSTOMER.name, { delay: 50 });
        await stage.typeIn(page.getByLabel(/^Phone number,/), CUSTOMER.phone, { delay: 70 });
        await stage.typeIn(page.getByLabel('Address line 1'), CUSTOMER.line1, { delay: 30 });
      },
    },
    {
      id: 'order-address',
      async run({ page, stage }) {
        await stage.typeIn(page.getByLabel('Address line 2 (the landmark)'), CUSTOMER.landmark, {
          delay: 32,
          after: 700,
        });
        await stage.typeIn(page.getByLabel('PIN code'), CUSTOMER.pin, { delay: 130, after: 1200 });
        // The serviceability chip resolves a beat after the sixth digit.
        await page.waitForTimeout(1200);
      },
    },
    {
      id: 'order-note',
      async run({ page, stage }) {
        await stage.typeIn(page.getByLabel('Your reference'), CUSTOMER.reference, { delay: 60 });
        await stage.typeIn(page.getByLabel('Notes for the call agent'), CUSTOMER.note, {
          delay: 28,
          after: 900,
        });
      },
    },
    {
      id: 'order-products',
      async run({ page, stage }) {
        // Searched rather than scrolled to: the picker's list is a
        // scrolling panel over every active variant, and typing the SKU
        // is both unambiguous and what a seller would do.
        await stage.typeIn(page.getByLabel('Search the catalogue'), FOLLOWED.kurti.sku, {
          delay: 55,
          clear: true,
          after: 900,
        });
        const kurti = page.getByRole('button', { name: `Add ${FOLLOWED.kurti.sku}` });
        await kurti.waitFor({ state: 'visible', timeout: 20_000 });
        // Held before the press: the row carries the price and the
        // sellable figure, which is what the narration is pointing at.
        await stage.point(kurti, { settle: 1100 });
        await stage.clickIt(kurti, { settle: 240, after: 1000 });
        await stage.typeIn(page.getByLabel('Search the catalogue'), FOLLOWED.soap.sku, {
          delay: 55,
          clear: true,
          after: 900,
        });
        const soap = page.getByRole('button', { name: `Add ${FOLLOWED.soap.sku}` });
        await soap.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.clickIt(soap, { after: 1000 });
        const qty = page.getByRole('button', {
          name: `Increase Quantity of ${FOLLOWED.soap.sku}`,
        });
        await stage.point(qty, { settle: 400 });
        await qty.click();
        await page.waitForTimeout(1200);
        await stage.clearHalo();
      },
    },
    {
      id: 'order-cod',
      async run({ page, stage }) {
        await stage.typeIn(page.getByLabel('Collectable amount (INR)'), CUSTOMER.collectable, {
          delay: 150,
          clear: true,
          after: 1200,
        });
      },
    },
    {
      id: 'order-submit',
      async run({ page, stage }) {
        await page.waitForTimeout(600);
        // The sticky bar's button OPENS a confirmation, and the dialog
        // carries a button of the same name — so both halves are needed
        // and the second must be scoped or it re-finds the first.
        await stage.clickIt(
          page.getByRole('button', { name: /^Submit for confirmation$/ }).last(),
          {
            settle: 800,
            after: 900,
          },
        );
        const dialog = page.getByRole('dialog');
        await dialog.waitFor({ state: 'visible', timeout: 15_000 });
        await page.waitForTimeout(1400);
        await stage.clickIt(dialog.getByRole('button', { name: /^Submit for confirmation$/ }), {
          settle: 500,
          after: 2200,
        });
        await page.waitForURL(/\/orders\/[0-9a-f-]{20,}/, { timeout: 45_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
      },
    },
    {
      id: 'order-placed',
      async run({ page, stage }) {
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 1600);
        await stage.dwellOn(page.locator('.ord-kpis').first(), 2400);
      },
    },

    /* ── act six: the phone call ──────────────────────────────────── */
    {
      id: 'call-waiting',
      async run({ page, stage }) {
        // Held on the tracker of the order just placed, whose first rung
        // is the call that has not happened yet. This is the one scene in
        // the video that is argument rather than instruction, so the
        // picture stays still and the voice carries it.
        await stage.dwellOn(await ordSection(page, 'Order tracker'), 2400);
        await stage.dwellOn(await rung(page, 'Confirmed by phone'), 3000);
      },
    },
    {
      id: 'call-confirmed',
      async run(ctx) {
        await openOrderByRef(ctx, READ_ORDERS.delivered);
        await ctx.stage.dwellOn(await ordSection(ctx.page, 'Order tracker'), 2200);
      },
    },
    {
      id: 'call-why',
      async run({ page, stage }) {
        // THE AGENT'S OWN WORDS, which the rung carries as its detail —
        // the one step no courier panel has. Held on the rung itself,
        // because the sentence is about what it says.
        await stage.dwellOn(await rung(page, 'Confirmed by phone'), 3600);
      },
    },

    /* ── act seven: the warehouse ─────────────────────────────────── */
    {
      id: 'wh-picked',
      async run({ page, stage }) {
        await stage.dwellOn(await rung(page, 'Picked from shelf'), 3200);
      },
    },
    {
      id: 'wh-packed',
      async run({ page, stage }) {
        await stage.dwellOn(await rung(page, 'Packed'), 3400);
      },
    },
    {
      id: 'wh-handover',
      async run({ page, stage }) {
        // The rung the sentence turns on: everything above it is ours,
        // everything below is the courier's.
        await stage.dwellOn(await rung(page, 'Handed to courier'), 3400);
      },
    },

    /* ── act eight: tracking ──────────────────────────────────────── */
    {
      id: 'parcel-waybill',
      async run({ page, stage }) {
        const parcel = await ordSection(page, 'Parcel');
        await stage.dwellOn(parcel, 3400);
      },
    },
    {
      id: 'tracking-page',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Tracking', /\/tracking$/);
        // The tiles render only on the UNFILTERED view and only with
        // rows — a seller with no dispatched parcel opens on nothing.
        const kpis = page.locator('.ord-kpis').first();
        await kpis.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(kpis, 2000);
        await stage.clickIt(page.getByRole('tab', { name: 'Coming back' }).first(), {
          after: 1400,
        });
        // Waiting on the TABLE rather than the tab's own state is what
        // proves the filter did something.
        await page.getByRole('table').first().waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(800);
        await stage.dwellOn(page.getByRole('table').first(), 2200);
      },
    },

    /* ── act nine: it goes wrong ──────────────────────────────────── */
    {
      id: 'failed-open',
      async run(ctx) {
        const { page, stage } = ctx;
        await openOrderByRef(ctx, READ_ORDERS.failed);
        // The panel renders only while the parcel is in trouble, so its
        // absence means the seeding did not leave this order failed —
        // reported as a timeout rather than filmed as a page that
        // quietly does not say this.
        const panel = page
          .locator('.ord-section')
          .filter({ hasText: 'Delivery did not succeed' })
          .first();
        await panel.waitFor({ state: 'visible', timeout: 25_000 });
        await panel.scrollIntoViewIfNeeded();
        await page.waitForTimeout(800);
        await stage.dwellOn(panel.locator('.ord-notice, [class*="notice"]').first(), 2800);
      },
    },
    {
      id: 'failed-choices',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Ask admin to act' }).first(), {
          after: 1400,
        });
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        const choice = dialog.getByLabel('What would you like');
        // Each choice SELECTED so its own hint is on screen — the hint is
        // the component's own words, and reading one out over another
        // option's text would be a video of the wrong sentence.
        for (const value of ['REATTEMPT', 'RECALL']) {
          await choice.selectOption(value);
          await page.waitForTimeout(800);
          await stage.dwellOn(choice, 1400);
        }
        await choice.selectOption('RTO');
        await page.waitForTimeout(800);
        /*
          ANCHORED ON THE FEE ITSELF. The claim is that the figure is
          printed before you decide, and it is read from the server — so
          if that read is down or gated wrong the hint falls back to "a
          return fee applies" and this step FAILS here rather than
          filming a sentence the narration contradicts.
        */
        const fee = dialog.locator('p[data-kind="hint"]').filter({ hasText: /return fee is/ });
        await fee.first().waitFor({ state: 'visible', timeout: 15_000 });
        await stage.dwellOn(fee.first(), 2600);
        // NOTHING IS SENT. A send-back reaches the courier on the click
        // (CUR-10's seller amendment) and would turn the failed parcel
        // into a returning one, taking the next three scenes' world with
        // it — and each of the three has a short video of its own, which
        // the narration says.
        await stage.clickIt(dialog.getByRole('button', { name: 'Cancel' }).first(), { after: 900 });
        await dialog.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => dismiss(page));
      },
    },
    {
      id: 'returned-open',
      async run(ctx) {
        await openOrderByRef(ctx, READ_ORDERS.restocked);
        await ctx.stage.dwellOn(await ordSection(ctx.page, 'Order tracker'), 2600);
      },
    },
    {
      id: 'returned-stock',
      async run({ page, stage }) {
        // The final rung. Its label is "Back in your stock" when anything
        // restocked and "Not sellable" when nothing did, so matching on
        // the words is also a gate on the world being the one described.
        await stage.dwellOn(await rung(page, 'Back in your stock'), 3200);
      },
    },
    {
      id: 'returned-ticket',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Tickets', /\/tickets$/);
        /*
          THE REFUNDED ONE, not the newest. Other takes mark returned
          units damaged and open scrap tickets of their own, which land
          at the top of this list and stay OPEN — so the status is what
          tells this one from the rest, and the refund banner below would
          otherwise never appear.
        */
        const row = page
          .getByRole('row')
          .filter({ hasText: 'RTO DAMAGED' })
          .filter({ hasText: 'Closed · refunded' })
          .first();
        await row.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.clickIt(row.getByRole('link').first(), { after: 1800 });
        await page.waitForURL(/\/tickets\/[0-9a-f-]+$/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The banner renders only when a refund actually landed, so its
        // absence means the claim was never settled.
        const banner = page.locator('.tkt-refund').first();
        await banner.waitFor({ state: 'visible', timeout: 25_000 });
        await banner.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await stage.dwellOn(banner, 2800);
      },
    },

    /* ── act ten: the money ──────────────────────────────────────── */
    {
      id: 'wallet-open',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Wallet', /\/wallet$/);
        const tiles = page.locator('.wal-kpis, [class*="kpi"]').first();
        await tiles.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(tiles, 2000);
        // The CONVERTED tile's own hint, which carries the rate. Anchored
        // on the text rather than on "the second tile": an account with
        // no FX rate renders one tile, and the narration would then be
        // pointing at the rupee balance while saying "the rate".
        const hint = page.getByText(/₹1 = ৳/).first();
        await hint.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(hint, 2200);
      },
    },
    {
      id: 'wallet-charges',
      async run({ page, stage }) {
        await stage.dwellOn(page.locator('thead').first(), 1600);
        await stage.dwellOn(await ledgerRow(page, 'Order charges'), 2600);
      },
    },
    {
      id: 'wallet-cod',
      async run({ page, stage }) {
        await stage.dwellOn(await ledgerRow(page, 'COD collected'), 2600);
        await stage.dwellOn(await ledgerRow(page, 'COD tax deduction'), 2400);
      },
    },
    {
      id: 'limits',
      async run({ page, stage }) {
        await stage.clickIt(page.locator('a[href="/wallet/limits"]').first(), { after: 1600 });
        await page.waitForURL(/\/wallet\/limits/, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(900);
        // Found by their LABELS rather than by position: the list is
        // server-driven, so a rule added or reordered upstream must not
        // silently make this scene point at a different row.
        await term(page, stage, 'COD credited', 1800);
        await term(page, stage, 'COD collection fee', 1600);
        await term(page, stage, 'Smallest withdrawal', 1600);
        await term(page, stage, 'Minimum balance', 1800);
      },
    },
    {
      id: 'withdraw',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, 'Wallet', /\/wallet$/);
        await stage.clickIt(page.getByRole('button', { name: 'Request a withdrawal' }).first(), {
          after: 1400,
        });
        // The availability panel, not the dialog: it is what the
        // narration points at, and it renders only once the eligibility
        // call has answered — so waiting on the dialog alone would open
        // the scene on a form with a hole in it.
        const avail = page.locator('.wal-avail').first();
        await avail.waitFor({ state: 'visible', timeout: 25_000 });
        await stage.dwellOn(avail, 2400);
        await stage.typeIn(page.locator('#wd-amount'), WITHDRAWAL.amount, {
          clear: true,
          after: 500,
        });
        await stage.typeIn(page.locator('#wd-note'), WITHDRAWAL.note, { delay: 32, after: 700 });
      },
    },
    {
      id: 'withdrawn',
      async run({ page, stage }) {
        await stage.clickIt(
          page.locator('.sk-dialog').getByRole('button', { name: 'Request withdrawal' }).first(),
          { after: 1200 },
        );
        const confirm = page
          .locator('.sk-dialog')
          .filter({ hasText: 'Request this withdrawal?' })
          .first();
        await confirm.waitFor({ state: 'visible', timeout: 20_000 });
        await stage.dwellOn(confirm.locator('.sk-confirm__consequence').first(), 1800);
        await stage.clickIt(confirm.getByRole('button', { name: 'Request withdrawal' }).first(), {
          after: 1800,
        });
        // The TABLE is the proof, not the dialog closing: a refusal stays
        // inside the dialog, and the row is what the narration reads.
        const table = page.getByRole('table').first();
        await table.waitFor({ state: 'visible', timeout: 25_000 });
        await page.waitForTimeout(1000);
        await stage.dwellOn(table, 2400);
      },
    },

    /* ── act eleven: help, and what we skipped ────────────────────── */
    {
      id: 'help',
      async run(ctx) {
        const { page, stage } = ctx;
        // Raised FROM THE ORDER, which is the path that works: the
        // ticket modal's own order field is a paste box for an internal
        // id, and the order page shows a NUMBER. From here the order is
        // already known and the field is not asked for at all.
        await openOrderByRef(ctx, READ_ORDERS.delivered);
        const raise = page.getByRole('button', { name: 'Raise an issue' }).first();
        await raise.scrollIntoViewIfNeeded();
        await page.waitForTimeout(600);
        await stage.clickIt(raise, { after: 1600 });
        const dialog = page.getByRole('dialog').first();
        await dialog.waitFor({ state: 'visible', timeout: 20_000 });
        // The categories come from the courier, over the network, so the
        // select is empty for a beat after the dialog opens.
        await dialog
          .getByLabel('What is the problem')
          .locator('option')
          .nth(1)
          .waitFor({ state: 'attached', timeout: 25_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(dialog, 2800);
        // NOT SENT — raising one has its own short video, and a ticket
        // left behind is a ticket the next take has to clear.
        //
        // CLOSED BY ITS OWN CANCEL, with Escape as the fallback: an
        // overlay still up when the next scene clicks the sidebar
        // swallows the click, and the step after this one navigates.
        await stage.clickIt(dialog.getByRole('button', { name: 'Cancel' }).first(), { after: 900 });
        await dialog.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => dismiss(page));
      },
    },
    {
      id: 'the-rest',
      async run(ctx) {
        const { page, stage } = ctx;
        // The cut list, pointed at rather than listed: each nav group
        // holds most of what the narration names, which is the honest
        // way to say "there is more here, one video each".
        await openNav(ctx, 'Orders', /\/orders(\?|$)/);
        await stage.dwellOn(navGroup(page, 'Stock'), 1800);
        await stage.dwellOn(navGroup(page, 'Money'), 1800);
        await stage.dwellOn(navGroup(page, 'Account'), 2000);
      },
    },
    {
      id: 'outro',
      async run(ctx) {
        const { page, stage } = ctx;
        // Back where it started.
        await stage.clickIt(page.getByRole('link', { name: 'Dashboard', exact: true }).first(), {
          after: 1800,
        });
        await page.waitForURL(/\/dashboard$/, { timeout: 30_000 }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.getByRole('heading', { level: 1 }).first(), 2000);
        await stage.glide(320);
        await page.waitForTimeout(1200);
      },
    },
  ],
};
