/**
 * THE ADMIN LONG VIDEO — `admin.skydrop.global`, the staff console.
 *
 * ── WHO IS WATCHING ─────────────────────────────────────────────────
 * A new member of Skydrop's own staff in their first week: a call-centre
 * agent, a warehouse hand, somebody in finance, a supervisor. They are at
 * a desk, with the console open beside the video, and they will repeat
 * what they see. So this is a TRAINING REFERENCE and not a pitch. The
 * seller, reseller and associate videos are short because their viewers
 * are customers deciding whether to bother; this one is long because its
 * viewer has to do the job on Monday. Completeness beats brevity here,
 * and the brevity rule in `long/README.md` is deliberately relaxed for it.
 *
 * "No filler" is NOT relaxed. Including every area means more SCREENS,
 * not more words per screen. Each step says what the screen is FOR
 * first, and then walks the real sequence of clicks and fields in the
 * order a person performs them, so it can be repeated without having
 * been watched.
 *
 * ── THE SPINE ───────────────────────────────────────────────────────
 * Sections H to P of `CURRICULUM.md`, in the order of a first week:
 *
 *   H  the desk       dashboard, finding an order, system issues, roles
 *   I  call centre    taking calls, supervising, forcing, re-attempts
 *   J  warehouse      bins, receiving, labels + picking, packing,
 *                     handover, pickups, manifests
 *   K  returns        taking a return in, inspecting, finalising
 *   L  stock          adjustments, cycle counts, ledger, transfers
 *   M  couriers       accounts, Delhivery health, manual placement,
 *                     carrier decisions, failed-delivery requests
 *   N  money          client wallets, top-ups, withdrawals, remittances,
 *                     bank changes, courier settlements, wallet
 *                     transfers, treasury, freight, P&L, month close
 *   O  clients        leads, a client's page, settings, staff, broadcast
 *   P  the five       god mode, live courier writes, refunds and
 *                     disputes, collapsing bins, what cannot be undone
 *
 * The ~40 short videos film these one task at a time and are still the
 * reference for a single job; this one is the path through all of them.
 *
 * ── THIS VIDEO WRITES NOTHING, AND THAT IS THE DESIGN ───────────────
 * Admin is the only console that can destroy things. Filming it against
 * a stack and PRESSING the buttons would mean performing a god-mode
 * override, recording a payout, crediting a wallet, approving a bank
 * change and adjusting stock for real, once per take. So the rule for
 * every step in this module is:
 *
 *   · reading is free — pages, tabs, filters, dialogs OPENED;
 *   · a form may be FILLED IN, because typing changes local state only;
 *   · every dialog is CANCELLED, and the final button is shown with the
 *     pointer on it and never clicked.
 *
 * For the acts marked dangerous in `CURRICULUM.md` (god mode, live
 * courier writes, refunds, collapsing bins, adjusting stock, forcing a
 * call outcome, packing without a scan, the courier handover, receiving
 * a consignment, finalising a return, moving stock) the "step by step" is
 * the sequence up to the irreversible click, then a plain statement of
 * what the click would do and cost. The take is therefore repeatable
 * with the same seed, and the seed does not have to be rebuilt between
 * takes because nothing was spent.
 *
 * ── WHAT IS PERMISSION-GATED, AND SAID SO ───────────────────────────
 * The viewer may not be a super admin. The permissions step teaches the
 * model, and the steps that follow say where a screen is gated rather
 * than assuming everyone sees it: the dashboard's money tiles, the
 * wallet-transfer page ("a permission of its own"), finalising a return
 * and acting on a parcel at the courier (both marked dangerous in the
 * role editor), pack-without-scan (a supervisor, enforced by the server),
 * and collapsing bins (a super admin plus an emailed code).
 *
 * ── DELIBERATELY NOT IN IT ──────────────────────────────────────────
 * Anything that exists only as a mechanism and has no person at the
 * keyboard: webhooks, the hourly sweep's internals, the tracking poll's
 * schedule. The poll's "Run it now" is SHOWN (M3) and not pressed.
 * Screens the curriculum's H-P sections do not cover — reseller stores
 * and their wallets, expenses, liabilities, margin, FX, pricing,
 * reports, the Shiprocket and courier-escalation consoles, impersonation,
 * notification settings, inventory units and the holds register — are
 * not here; they belong to the commercial and reseller tracks. This is
 * named in the module's report rather than hidden.
 *
 * A few steps narrate over a NEIGHBOURING screen because the screen they
 * describe only exists after a write: the packing bench's refusal of one
 * item too many, the handover's duplicate-scan stop, the connection
 * result on the Delhivery page, and the live courier panel's four
 * writes (opening it spends live Delhivery calls). Each says what pressing
 * would do and is listed in the report.
 *
 * Exports `narration` and `flow` in the shape `long/README.md` sets out.
 */

/**
 * The slug — the mp4's name, and the key `long/index.mjs` registers
 * under.
 */
const SLUG = 'admin-everything';

/** The richest order D0 leaves: a whole journey, a failure, a return. */
const LIFE_REF = 'RSH-LIFE-RESTOCKED';

/** The paused order the god-mode short is filmed on. */
const GOD_SEARCH = '/orders?search=RSH-LIFE-REVIEW&status=AWAITING_SELLER_DECISION';

/** The call the seed leaves stuck, and the agent who is on shift. */
const STUCK_AGENT = 'asha.pillai';
const FREE_AGENT = 'imran.shaikh';

/* ────────────────────────────── flow helpers ─────────────────────── */

/**
 * LOCAL COPIES, on purpose: `flows.mjs` exports none of its helpers and
 * imports this module to register the flow, so reaching back would close
 * a cycle. Two copies of a six-line wait is the price of authors not
 * editing one file (`long/README.md`).
 */

const WAIT = 25_000;

/**
 * Wait for the page's own data, pressing Retry and reloading when the
 * first fetch loses the race for an access token.
 *
 * FE-1 keeps the access token in BROWSER MEMORY, so any full page load
 * throws it away and the client has to get another through the cookie.
 * Invisible normally; under recording it is not.
 */
async function withRetry(page, probe, { rounds = 4 } = {}) {
  const retry = page.getByRole('button', { name: 'Retry' }).first();
  for (let round = 0; round < rounds; round += 1) {
    const appeared = await probe
      .waitFor({ state: 'attached', timeout: round === 0 ? 15_000 : 8_000 })
      .then(() => true)
      .catch(() => false);
    if (appeared) return;
    if ((await retry.count()) > 0) await retry.click();
    if (round % 2 === 1) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
    await page.waitForTimeout(1500);
  }
  await probe.waitFor({ state: 'attached', timeout: 20_000 });
}

/**
 * NOT `networkidle` as a gate: the dashboard and the call station poll,
 * so that state never arrives and the wait burns its whole timeout
 * without failing anything. A short, forgiving wait is enough; the probe
 * passed to `withRetry` is the real gate.
 */
async function quiet(page) {
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
}

const h1 = (page) => page.getByRole('heading', { level: 1 }).first();

/**
 * Reach a page THE WAY THE APP DOES — by clicking its sidebar link.
 * Clicking keeps the SPA alive, so there is no token race to lose; a
 * `goto` is the fallback for a page the rail does not link to.
 */
async function go(ctx, href, probe) {
  const { page, stage, baseUrl } = ctx;
  const link = page.locator(`a[href="${href}"]`).first();
  if ((await link.count()) > 0 && (await link.isVisible().catch(() => false))) {
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await stage.clickIt(link, { after: 900 });
  } else {
    await page.goto(`${baseUrl}${href}`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForURL((u) => u.pathname === href, { timeout: 20_000 });
  await quiet(page);
  await withRetry(page, probe ?? h1(page));
}

/** Open a URL that carries a query string, which no rail link does. */
async function visit(ctx, path, probe) {
  const { page, baseUrl } = ctx;
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
  await quiet(page);
  await withRetry(page, probe ?? h1(page));
}

/** Bring a target to the middle of the frame, then hold on it. */
async function show({ page, stage }, locator, ms = 3000) {
  const target = locator.first();
  await target.waitFor({ state: 'visible', timeout: WAIT });
  await target.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.waitForTimeout(500);
  await stage.dwellOn(target, ms);
}

/** Click, and wait for a dialog to be in front. */
async function openDialog({ page, stage }, button, ms = 1400) {
  await stage.clickIt(button.first(), { after: ms });
  await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: WAIT });
}

/**
 * Close whatever dialog is open WITHOUT submitting it.
 *
 * Every dialog's header carries an X with `aria-label="Close"`, so an
 * unscoped name match is two buttons; the footer's Cancel is looked for
 * first and the X is the fallback. Run at the START of the next step,
 * because a dialog has to survive the sentence that is about it.
 */
async function shut({ page, stage }) {
  const dialog = page.getByRole('dialog').first();
  if ((await dialog.count()) === 0) return;
  const cancel = dialog.getByRole('button', { name: /^(Cancel|Keep the order|Not now)$/ }).first();
  const target =
    (await cancel.count()) > 0 ? cancel : dialog.getByRole('button', { name: 'Close' }).first();
  await stage.clickIt(target, { after: 900 });
  await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: WAIT });
}

/** One attention tile on the dashboard, by its AREA word. */
function tile(page, area) {
  return page.locator('.db-attn').filter({ hasText: area }).first();
}

/** One card on the order page, by its own `<h2>` and not by its text. */
function orderCard(page, title) {
  return page
    .locator('section.oo-section')
    .filter({ has: page.getByRole('heading', { level: 2, name: title }) })
    .first();
}

/** One row of a table, by a word in it. */
function rowWith(page, text) {
  return page.locator('tr, .sk-tr').filter({ hasText: text }).first();
}

/** The footer of the dialog in front. */
function foot(page) {
  return page.getByRole('dialog').first().locator('.sk-dialog__foot, .sk-dialog__actions').first();
}

/* ─────────────────── H · the desk: narration + flow ──────────────── */

const H_SAY = [
  {
    id: 'intro',
    say: 'This is the staff console: where Skydrop’s own people run the business. Call centre agents, warehouse staff, finance, supervisors. It is also the only console that can destroy things, so this video goes in the order of a first week: read first, then the routine jobs, then the handful of acts that cannot be taken back.',
  },
  {
    id: 'saves-nothing',
    say: 'One rule for this recording. Every form you will see is opened and filled in, and none is submitted. Where a button writes stock, money or a courier booking, the video stops with the pointer on it and says what pressing it would do. On the real console you press it only once the reasons on screen are true.',
  },
  {
    id: 'rail',
    say: 'The rail on the left is the whole console, grouped by job. And it is yours alone: it shows only what your roles allow. A link that is missing means your role does not hold that permission, not that the screen is gone. A super admin sees every link; almost nobody else does.',
  },
  {
    id: 'dash-bands',
    say: 'Start where every shift starts, the dashboard. It answers one question before any other: what is waiting on a person right now. The top band is the work queue: seven areas, each with a count, and the ones with work in them are lit, so the screen reads as a shape before you read a number.',
  },
  {
    id: 'dash-callcentre',
    say: 'Call centre comes first because nothing moves until a customer says yes. These are orders nobody has reached yet. Click the tile and it opens the screen that clears it. Every tile is a link, and none of them is a report.',
  },
  {
    id: 'dash-merchant',
    say: 'Merchant is not yours to clear. These orders rang out until the cap, and the client has been asked whether to keep trying or let them go. It waits on them, not on us.',
  },
  {
    id: 'dash-warehouse',
    say: 'Warehouse is confirmed orders with stock behind them, waiting for somebody to print a picking sheet. That count is a morning’s work, not a problem.',
  },
  {
    id: 'dash-quiet',
    say: 'Dispatch and Stock are quiet here, and that is the point of the band. Dispatch lights when a courier refused to carry a parcel; Stock lights when something was confirmed against an empty shelf. A zero on either is good news.',
  },
  {
    id: 'dash-support',
    say: 'Support is damage claims and client issues. It carries an Action badge because every one has somebody at the other end waiting to hear back from us.',
  },
  {
    id: 'dash-settlements',
    say: 'Settlements is money: clients who have asked to be paid out and have not been. It is marked Escrow because we are holding cash that belongs to somebody else. If your role holds no money permissions, this tile is not drawn, and the grid shows five tiles instead of seven.',
  },
  {
    id: 'dash-performance',
    say: 'The second band is a different question: how the last thirty days went. Every figure is a rate with its denominator printed under it. Confirmed on call, out of orders placed. Delivered, out of everything dispatched. Returned, the same. Read together they say where parcels are being lost.',
  },
  {
    id: 'dash-money',
    say: 'The third band is the money the last thirty days moved: what couriers collected, what we charged for carrying it, and what we paid out to clients.',
  },
  {
    id: 'dash-owed',
    say: 'The last tile is the one to read carefully. Outstanding owed is not revenue. It is client balances we hold and have not paid out, which is a debt. The link beside it opens the ledger behind it. So: the top band is today, the middle is the month, the bottom is whose money is where.',
  },
  {
    id: 'orders-list',
    say: 'Next, finding an order. Every order on the platform is on this one list, whoever sold it. Open Orders in the rail. The subtitle counts the rows, and it only appears once the list has answered, so a number there means the list is real.',
  },
  {
    id: 'orders-filters',
    say: 'Four filters sit over the list. Status is the whole lifecycle, thirty states. Then how the order arrived, which client it belongs to, and the day it was placed, read in India time and not yours. A filter lives in the page address, so a filtered list can be sent to a colleague as a link.',
  },
  {
    id: 'orders-search',
    say: 'One search box takes several handles: our order number, the client’s own reference, the recipient’s name or their phone. Type it and press Enter. It is a form, not a live filter, so nothing happens until Enter. Whichever handle the person on the phone has is the right one.',
  },
  {
    id: 'order-open',
    say: 'Click the order number to open it. The page is a reading exercise first; every button on it is taught in its own place later in this video. This one came back: delivery failed, the parcel returned, the goods are on our shelf again, which makes it the fullest page there is.',
  },
  {
    id: 'order-recipient',
    say: 'The recipient is a snapshot, frozen when the order was placed. Editing the customer record later never rewrites it, because this is where the parcel was actually sent.',
  },
  {
    id: 'order-reputation',
    say: 'Beside it, what we know about this customer: how many orders, how many arrived, how many came back. The last number is the one a call agent wants before ringing.',
  },
  {
    id: 'order-payment',
    say: 'Payment holds two figures that are not the same: what the customer hands over at the door, and what the goods were declared to be worth. The courier needs both.',
  },
  {
    id: 'order-items',
    say: 'Items are a snapshot too, down to the SKU and weight. Reserved is stock actually held for this order; on a parcel that has shipped it is back to nothing.',
  },
  {
    id: 'order-charges',
    say: 'Charges are what the client was billed, line by line, with a visibility column. This is the page that tells you whether the client can see the same line you are looking at.',
  },
  {
    id: 'order-parcel',
    say: 'Shipments carries the waybill and which of our courier accounts booked it. Underneath, a panel says plainly what the courier will no longer accept, and why.',
  },
  {
    id: 'order-tracker',
    say: 'The tracker is the journey as rungs. It ends where the parcel actually got to. This one has no delivery rung because it never had one, and it finishes back in stock.',
  },
  {
    id: 'order-history',
    say: 'Full history is everything, newest first: our own events and the courier’s scans in one column, so you never hold two timelines in your head.',
  },
  {
    id: 'order-attempt',
    say: 'A failed delivery is drawn on the scan it belongs to, not as a second line, with the courier’s own reason code and whether that code allows another attempt. If you only ever read this page, you can still answer almost any question about an order.',
  },
  {
    id: 'si-open',
    say: 'Now the page for failures that break nothing you can see. A login expires, a nightly job stops, and the only sign is a figure that quietly stops moving. Open System issues. These are the things the system could not fix by itself, gathered in one place instead of a log nobody reads.',
  },
  {
    id: 'si-counts',
    say: 'Three counts answer three questions: how many are open, how many nobody has claimed, and how many are urgent. The urgent one is the one to look at on a busy morning.',
  },
  {
    id: 'si-card',
    say: 'Cards are sorted worst first, and severity is a word on the chip, not only a colour. High means money or parcels are affected right now. Read the body: it says what is wrong and what it costs. Where an issue is about one order, an Open the order link goes straight to it.',
  },
  {
    id: 'si-meta',
    say: 'Underneath, three facts: which part of the system said it, when it was first seen, and how often. Seen once is usually one bad row. Seen every hour for days will not fix itself.',
  },
  {
    id: 'si-claim',
    say: 'I’m on it records that somebody is chasing the issue, so two people do not ring the same courier. It does not close the issue, because the problem is still there. Press it on the real console; here the pointer rests on it.',
  },
  {
    id: 'si-close',
    say: 'Close is a statement about the problem. Click Close on a card and the dialog insists on a few words, because that note is the record. Use it only for issues that needed a person. One whose text says it clears itself, such as a stale exchange rate, closes when the cause is fixed.',
  },
  {
    id: 'si-history',
    say: 'Show closed too brings back the finished ones, each with when it closed and the note left. Nothing here is ever deleted; a closed issue is the record that it happened.',
  },
  {
    id: 'si-notify',
    say: 'Last, Notify unannounced. It sends a notification for every open issue nobody was ever told about, so it asks first and says what it is about to do. Read it, then Cancel unless you mean it. An empty page here is the good outcome, not a missing feature.',
  },
  {
    id: 'roles-open',
    say: 'Somebody cannot see a screen, and you have been asked to fix it. That is decided on Roles. A role is a set of permissions, and you make as many roles as the work needs. The permissions themselves are fixed by the system: you choose which a role holds, never what one means.',
  },
  {
    id: 'roles-list',
    say: 'Each role shows what it covers and how many people hold it. Read that last column first: a role nobody holds is safe to change, and one held by thirty is not.',
  },
  {
    id: 'roles-super',
    say: 'One row has a padlock and no Delete. Super admin holds everything, including permissions that do not exist yet, which is what stops a new feature being invisible on the day it ships. It cannot be edited from here at all.',
  },
  {
    id: 'roles-editor',
    say: 'Click Edit on a real role, and the whole model is on one screen: every permission the system has, grouped, with the ones this role holds ticked. This editor is opened and then closed, so nothing is saved.',
  },
  {
    id: 'roles-counts',
    say: 'Read the line above the list before anything else: how many permissions this role holds out of the total, and separately how many of those can move money or stock.',
  },
  {
    id: 'roles-groups',
    say: 'They are grouped by part of the business, and every one carries a sentence: not what it is called, but what somebody holding it can actually do.',
  },
  {
    id: 'roles-danger',
    say: 'A triangle means it can move money or stock. It is not a different check, since the server treats every permission alike, but a mark, so a role quietly collecting six says so before it is saved.',
  },
  {
    id: 'roles-search',
    say: 'The search covers the name, the explanation and the key, which is how you answer the question you were actually asked. Somebody cannot finish a return? Type return. Finalise a return sounds like paperwork and permanently removes stock. Act on a parcel at the courier sounds like admin and sends a van.',
  },
  {
    id: 'roles-cancel',
    say: 'Cancel closes it without saving. A role is held by real people, and changing one is not something to do while looking around. To change one for real: tick or untick, read the counts again, then Save.',
  },
  {
    id: 'roles-boundary',
    say: 'Last, what keeps this honest. Hiding a button is a courtesy. The server checks the permission on every request, so a control you cannot see is refused anyway if somebody finds it.',
  },
];

const H_RUN = [
  {
    id: 'intro',
    run: async ({ page, stage }) => {
      // NOT `networkidle`: the dashboard polls, so that wait burns its
      // whole timeout against an eleven-second line. The subtitle is
      // the thing that says the page has drawn.
      await page
        .getByText('What is waiting on someone right now', { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await page.waitForTimeout(1200);
      await stage.dwellOn(h1(page), 2800);
    },
  },
  {
    id: 'saves-nothing',
    run: async ({ page, stage }) => {
      await stage.dwellOn(h1(page), 3400);
    },
  },
  {
    id: 'rail',
    run: async ({ page, stage }) => {
      await stage.dwellOn(page.locator('nav').first(), 4600);
    },
  },
  {
    id: 'dash-bands',
    run: async (ctx) => {
      const { page } = ctx;
      await page
        .getByText(/queues? needs? staff attention|Nothing is waiting on a person/)
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await page.waitForTimeout(700);
      await show(ctx, page.locator('.db-attn-grid'), 3600);
    },
  },
  { id: 'dash-callcentre', run: (ctx) => show(ctx, tile(ctx.page, 'Call centre'), 3200) },
  { id: 'dash-merchant', run: (ctx) => show(ctx, tile(ctx.page, 'Merchant'), 3200) },
  { id: 'dash-warehouse', run: (ctx) => show(ctx, tile(ctx.page, 'Warehouse'), 3000) },
  {
    id: 'dash-quiet',
    run: async (ctx) => {
      await show(ctx, tile(ctx.page, 'Dispatch'), 1800);
      await show(ctx, tile(ctx.page, 'Stock'), 2400);
    },
  },
  { id: 'dash-support', run: (ctx) => show(ctx, tile(ctx.page, 'Support'), 3200) },
  { id: 'dash-settlements', run: (ctx) => show(ctx, tile(ctx.page, 'Settlements'), 3600) },
  {
    id: 'dash-performance',
    run: async (ctx) => {
      const { page } = ctx;
      await page
        .locator('.db-chip')
        .filter({ hasText: /^\d+\/\d+$/ })
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await show(ctx, page.getByText(/^Performance & fulfilment/), 1800);
      await show(ctx, page.getByText('Confirmed on call', { exact: true }), 1800);
      await show(ctx, page.getByText('Returned (RTO)', { exact: true }), 2200);
    },
  },
  {
    id: 'dash-money',
    run: (ctx) => show(ctx, ctx.page.getByText('COD collected', { exact: true }), 3400),
  },
  {
    id: 'dash-owed',
    run: async (ctx) => {
      await show(ctx, ctx.page.getByText('Outstanding owed', { exact: true }), 2200);
      await show(ctx, ctx.page.getByRole('link', { name: 'View ledger' }), 2400);
    },
  },
  {
    id: 'orders-list',
    run: async (ctx) => {
      await go(ctx, '/orders');
      await ctx.page
        .getByText(/^\d+ orders?$/)
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await ctx.stage.dwellOn(h1(ctx.page), 2600);
    },
  },
  {
    id: 'orders-filters',
    run: async (ctx) => {
      const { page, stage } = ctx;
      await stage.dwellOn(page.getByLabel('Status', { exact: true }).first(), 1500);
      await stage.dwellOn(page.getByLabel('Client', { exact: true }).first(), 1300);
      await stage.dwellOn(page.getByLabel('Placed from', { exact: true }).first(), 2200);
    },
  },
  {
    id: 'orders-search',
    run: async ({ page, stage }) => {
      /*
        "Search orders", not "Search". The field's `aria-label` overrides
        its visible label, and the submit magnifier inside it is the
        thing labelled "Search" — so the short form types into a BUTTON
        and the step passes. And the wait is on the COUNT: the unfiltered
        list is full of rows that match, so "a row appeared" proves
        nothing, while `1 order` cannot be true until the filter applied.
      */
      await stage.typeIn(page.getByLabel('Search orders', { exact: true }).first(), LIFE_REF);
      await page.keyboard.press('Enter');
      await page
        .getByText(/^1 orders?$/)
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await page.waitForTimeout(800);
    },
  },
  {
    id: 'order-open',
    run: async ({ page, stage }) => {
      const row = rowWith(page, LIFE_REF);
      await stage.clickIt(row.getByRole('link', { name: /^SD-\d{4}-\d{2}-\d{6}$/ }).first(), {
        after: 1400,
      });
      await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await quiet(page);
      await page
        .getByText('Back in your stock')
        .first()
        .waitFor({ state: 'attached', timeout: WAIT });
      await stage.dwellOn(h1(page), 2800);
    },
  },
  { id: 'order-recipient', run: (ctx) => show(ctx, orderCard(ctx.page, 'Recipient'), 3200) },
  {
    id: 'order-reputation',
    run: (ctx) => show(ctx, ctx.page.getByText(/previous order/), 3200),
  },
  { id: 'order-payment', run: (ctx) => show(ctx, orderCard(ctx.page, 'Payment'), 3200) },
  { id: 'order-items', run: (ctx) => show(ctx, orderCard(ctx.page, /^Items \(\d+\)$/), 3200) },
  { id: 'order-charges', run: (ctx) => show(ctx, orderCard(ctx.page, 'Charges'), 3400) },
  { id: 'order-parcel', run: (ctx) => show(ctx, orderCard(ctx.page, 'Shipments'), 3400) },
  { id: 'order-tracker', run: (ctx) => show(ctx, orderCard(ctx.page, 'Order tracker'), 3400) },
  { id: 'order-history', run: (ctx) => show(ctx, orderCard(ctx.page, 'Full history'), 3400) },
  {
    id: 'order-attempt',
    run: (ctx) => show(ctx, ctx.page.getByText(/Delivery attempt \d/), 3800),
  },
  {
    id: 'si-open',
    run: async (ctx) => {
      await go(ctx, '/system-issues');
      await ctx.page.locator('li.af-qcard').first().waitFor({ state: 'visible', timeout: WAIT });
      await ctx.stage.dwellOn(h1(ctx.page), 2800);
    },
  },
  { id: 'si-counts', run: (ctx) => show(ctx, ctx.page.locator('.af-kpis'), 3400) },
  {
    id: 'si-card',
    run: async (ctx) => {
      const card = ctx.page.locator('li.af-qcard').first();
      await show(ctx, card.locator('.si-head'), 2200);
      await show(ctx, card.locator('.si-detail'), 3200);
    },
  },
  { id: 'si-meta', run: (ctx) => show(ctx, ctx.page.locator('.si-meta'), 3200) },
  {
    id: 'si-claim',
    run: (ctx) =>
      show(
        ctx,
        ctx.page
          .locator('li.af-qcard')
          .first()
          .getByRole('button', { name: /I.m on it/ }),
        3000,
      ),
  },
  {
    id: 'si-close',
    run: async (ctx) => {
      const { page, stage } = ctx;
      await openDialog(
        ctx,
        page.locator('li.af-qcard').first().getByRole('button', { name: 'Close', exact: true }),
      );
      await stage.typeIn(
        page.getByRole('dialog').getByRole('textbox').first(),
        'Courier credited it back.',
      );
      await stage.dwellOn(page.locator('.sk-dialog__body').first(), 2600);
    },
  },
  {
    id: 'si-history',
    run: async (ctx) => {
      await shut(ctx);
      await ctx.stage.clickIt(ctx.page.getByRole('button', { name: 'Show closed too' }).first(), {
        after: 1600,
      });
      await show(ctx, ctx.page.locator('.si-actions').first(), 3000);
    },
  },
  {
    id: 'si-notify',
    run: async (ctx) => {
      await ctx.stage.clickIt(ctx.page.getByRole('button', { name: 'Open only' }).first(), {
        after: 900,
      });
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Notify unannounced' }));
      await ctx.stage.dwellOn(ctx.page.locator('.sk-confirm__consequence').first(), 3600);
    },
  },
  {
    id: 'roles-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/roles');
      await ctx.page
        .getByText(/^\d+ roles?$/)
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await show(ctx, ctx.page.getByText(/permissions themselves are fixed by the system/), 3400);
    },
  },
  { id: 'roles-list', run: (ctx) => show(ctx, ctx.page.locator('table'), 3600) },
  { id: 'roles-super', run: (ctx) => show(ctx, rowWith(ctx.page, 'Super admin'), 3600) },
  {
    id: 'roles-editor',
    run: async (ctx) => {
      const { page } = ctx;
      await ctx.stage.clickIt(
        rowWith(page, 'Warehouse supervisor').getByRole('button', { name: 'Edit' }).first(),
        { after: 1400 },
      );
      await page
        .getByRole('heading', { name: /^Edit Warehouse supervisor$/ })
        .waitFor({ state: 'visible', timeout: WAIT });
      await show(ctx, page.locator('.ac-perms'), 2400);
    },
  },
  { id: 'roles-counts', run: (ctx) => show(ctx, ctx.page.locator('.ac-counts'), 3400) },
  { id: 'roles-groups', run: (ctx) => show(ctx, ctx.page.locator('fieldset.ac-fieldset'), 3400) },
  { id: 'roles-danger', run: (ctx) => show(ctx, ctx.page.locator('.ac-perm-danger'), 3400) },
  {
    id: 'roles-search',
    run: async ({ page, stage }) => {
      await stage.typeIn(page.getByLabel('Search permissions', { exact: true }).first(), 'return');
      await page
        .getByText(/\d+ match(es)?/)
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await stage.dwellOn(page.getByText('Finalise a return').first(), 2600);
      await stage.dwellOn(page.getByText('Act on a parcel at the courier').first(), 2800);
    },
  },
  {
    id: 'roles-cancel',
    run: async ({ page, stage }) => {
      await stage.clickIt(page.getByRole('button', { name: 'Cancel', exact: true }).first(), {
        after: 1200,
      });
      await page
        .getByRole('heading', { name: /^Edit Warehouse supervisor$/ })
        .waitFor({ state: 'hidden', timeout: WAIT });
      await stage.dwellOn(h1(page), 2200);
    },
  },
  {
    id: 'roles-boundary',
    run: async ({ page, stage }) => {
      await stage.dwellOn(page.locator('table').first(), 3400);
    },
  },
];

/* ─────────────────── I · call centre: narration + flow ───────────── */

const I_SAY = [
  {
    id: 'call-station',
    say: 'In India most parcels are paid in cash at the door, so somebody rings first and asks whether the customer still wants the order. That is the call centre, and nothing downstream moves until an agent records a result. Open Call centre. This is an agent’s whole shift on one screen.',
  },
  {
    id: 'call-availability',
    say: 'It opens saying you are not taking calls, and that is deliberate: being signed in is not the same as being at your desk, and an order handed to an empty chair waits. Start taking calls is the one switch that puts you on the roster. It is not pressed here, because pressing it would claim a real customer.',
  },
  {
    id: 'call-arrives',
    say: 'You never ask for work. Once you are available, the next customer in the queue, oldest first, is handed to you and claimed the instant it appears, so two agents are never given the same one. This call was already handed to the filming agent, which is why a call is on screen.',
  },
  {
    id: 'call-purpose',
    say: 'Read the purpose line before you dial. A call to confirm a new order and a call because a client asked us to chase one open with different sentences, and the wrong one loses the customer.',
  },
  {
    id: 'call-risk',
    say: 'Then the customer. This strip appears only when there is something to say, here that parcels of theirs came back before, which is worth knowing before agreeing to send another.',
  },
  {
    id: 'call-recipient',
    say: 'Who they are, where it is going, and what they will be asked to hand over at the door. Say that last figure aloud: agreeing to the parcel is agreeing to the money.',
  },
  {
    id: 'call-outcome',
    say: 'After the call, you record what happened. Open the Outcome list: nine outcomes, and the line underneath tells you what each does before you pick it. Choose Confirmed and read that line.',
  },
  {
    id: 'call-permanent',
    say: 'Confirmed is the one to be careful with: it holds stock for this order and sends it to the warehouse. And every attempt you log is permanent and counts toward the limit before we stop trying.',
  },
  {
    id: 'call-note',
    say: 'Then Notes. Write what they actually said. The next agent who rings them reads it, and so does the client asking why their order has not moved.',
  },
  {
    id: 'call-record',
    say: 'Record outcome writes the attempt, and the order moves by itself. There is no second confirmation, which is why you check the outcome before the press, not after. The pointer stays on it here; nothing is recorded.',
  },
  {
    id: 'call-release',
    say: 'If you cannot take a call, Release without attempt. No attempt is recorded and it goes back in the queue for somebody else, which is honest, unlike logging a call you did not make.',
  },
  {
    id: 'call-stop',
    say: 'At the end of the shift it is the same switch the other way: Stop taking calls. Nothing new is assigned and the queue keeps its place. Switching off does not hand back a call you already hold; the supervisor’s screen is for that.',
  },
  {
    id: 'q-open',
    say: 'The station shows an agent one call and nothing else. A supervisor needs the opposite: everything waiting, and whose hands it is in. That is Call queue, under Call centre.',
  },
  {
    id: 'q-tiles',
    say: 'Four counts: Open, which is the two live states together; how many nobody has taken; how many somebody has; and how many people are holding work right now.',
  },
  {
    id: 'q-filter',
    say: 'It opens on Open, deliberately. A finished attempt leaves its own row, and an order retried has one per round, so showing everything buries the live queue in history. Change the filter only to look backwards.',
  },
  {
    id: 'q-row',
    say: 'Each row is one order: how long it has waited, when it next becomes callable, how many calls are logged against the limit, and how many times it has been picked up.',
  },
  {
    id: 'q-stuck',
    say: 'The last two columns are the reason this page exists. This row was picked up once and called zero times: somebody took it and never rang, and until this screen existed nobody could see that. Look for picked up higher than called.',
  },
  {
    id: 'q-reassign',
    say: 'To move it, click Reassign on its row. The dialog promises that the order keeps its place in the queue and every attempt already logged; only the name changes.',
  },
  {
    id: 'q-reassign-pick',
    say: 'Choose the new agent from the list. Only agents marked available are offered, and each shows what they already carry, because handing a stuck call to someone at their limit moves the problem. Then press Reassign. Here we close the dialog without moving it.',
  },
  {
    id: 'q-reschedule',
    say: 'The other lever is timing. Every queued call has a time it becomes callable. Click Reschedule on a row to bring one forward when a customer rings back, or push one out.',
  },
  {
    id: 'q-reschedule-when',
    say: 'Pick a shortcut, such as Tomorrow, and write a reason. Moving when somebody gets telephoned is a decision you should be able to account for. Saving changes the callable time and nothing else: not the attempt count, not the order, not its place.',
  },
  {
    id: 'q-force-open',
    say: 'The third button, Force outcome, is not like those two. It records a call that did not happen, under your name, permanently. It is dangerous. Click it, and the dialog goes red with a gavel on the title: that is the screen telling you which kind of act this is.',
  },
  {
    id: 'q-force-warning',
    say: 'Read the line under the title, because it is the whole warning. This is recorded as a real attempt against your name, with exactly the effect an agent’s call would have had. It runs through the same service, so it is not a special case.',
  },
  {
    id: 'q-force-outcomes',
    say: 'Open the Outcome list: the same nine an agent sees. Read the line under the choice rather than the label. Choose Confirmed and it says it reserves stock and advances the order, which is a van and a parcel moving on a conversation you are asserting happened.',
  },
  {
    id: 'q-force-declined',
    say: 'Choose Customer declined and the line says the word that matters: terminal. The order is rejected and this screen has no way back. The only way out of a rejected order is a client asking us to call again, which comes later.',
  },
  {
    id: 'q-force-when',
    say: 'Next, when the call happened, not when you are typing. The ledger records real conversations, so enter the real time.',
  },
  {
    id: 'q-force-notes',
    say: 'Then say why. The attempt log is append-only, nothing can be edited afterwards, and this box is the only place your reason will ever live.',
  },
  {
    id: 'q-force-record',
    say: 'Record this outcome is one press with no second confirmation. It would write the attempt under your name, count toward the cap, move the order by the ordinary mapping, and cannot be undone. Use it only when you already know how the call ends. The dialog is closed here without pressing it.',
  },
  {
    id: 'q-agents',
    say: 'Now the people. Open Call agents: who is on, their hours, their languages, and how many calls each carries against a cap.',
  },
  {
    id: 'q-agent-cap',
    say: 'Click Details on a row. Off does not mean empty: going off shift hands nothing back, which is why a call can carry the name of someone who has gone home. The cap is here too. One at a time is the default, so raise it only for somebody genuinely idle, then press Save capacity. Here the field is filled and the dialog closed.',
  },
  {
    id: 'rr-open',
    say: 'One more queue belongs to the call centre. Every order here has a customer who was rung, answered and said no. The client thinks it was a misunderstanding and asks us to try once more. A refusal is terminal on purpose, so this request is the only way back. Open Call-again requests.',
  },
  {
    id: 'rr-card',
    say: 'A card is mostly its reason, printed at full width. You are being asked to ring somebody who already declined, so the reason is the decision. The test is whether anything has actually changed, such as the customer ringing the shop back.',
  },
  {
    id: 'rr-approve',
    say: 'To approve, click Approve — call again. The dialog restates what happens: the order leaves rejected, returns to waiting for confirmation, and joins the call queue like any other.',
  },
  {
    id: 'rr-extra',
    say: 'Then the part nobody expects: Extra calls. Approving does not reset the attempt count, so with none granted the order returns already out of chances and the first unanswered ring rejects it again. Grant one to five. Add a note if you know something the client does not, then press Approve. Here the dialog closes.',
  },
  {
    id: 'rr-decline',
    say: 'To refuse, click Decline on a card where nothing new has happened, say why in the note because the client reads it, and press Decline request. The order stays rejected, and they may ask again when something genuinely changes.',
  },
  {
    id: 'rr-history',
    say: 'Nothing here is deleted. Change the status filter to all, and every decided request is still listed, with what was granted and what was written beside it. A waiting queue here means somebody is waiting on a decision only a person can make; most days it should be empty.',
  },
];

/** The row of the stuck agent's call, or the free agent's. */
const queueRow = (page, who) => page.locator('.sk-tr', { hasText: who }).first();

const I_RUN = [
  {
    id: 'call-station',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/call-center');
      await ctx.stage.dwellOn(h1(ctx.page), 2800);
    },
  },
  { id: 'call-availability', run: (ctx) => show(ctx, ctx.page.locator('.cc-avail'), 4600) },
  {
    id: 'call-arrives',
    run: async (ctx) => {
      await ctx.page.locator('.cc-purpose').first().waitFor({ state: 'visible', timeout: 40_000 });
      await show(ctx, ctx.page.locator('.cc-call-head'), 3400);
    },
  },
  { id: 'call-purpose', run: (ctx) => show(ctx, ctx.page.locator('.cc-purpose'), 3600) },
  { id: 'call-risk', run: (ctx) => show(ctx, ctx.page.locator('.cc-risk'), 3200) },
  { id: 'call-recipient', run: (ctx) => show(ctx, ctx.page.locator('.cc-recipient'), 3600) },
  {
    id: 'call-outcome',
    run: async (ctx) => {
      /*
        A REGEX against the whole accessible name. `requiredMark` puts a
        character in the label, so the exact string finds nothing, and
        the plain substring also matches the "Record outcome" BUTTON.
      */
      await ctx.stage.point(ctx.page.getByLabel(/^Outcome\*?$/), { settle: 500 });
      await ctx.page.getByLabel(/^Outcome\*?$/).selectOption({ label: 'Confirmed' });
      await show(ctx, ctx.page.locator('.cc-form'), 3000);
    },
  },
  { id: 'call-permanent', run: (ctx) => show(ctx, ctx.page.locator('.cc-form__helper'), 3600) },
  {
    id: 'call-note',
    run: async ({ page, stage }) => {
      await stage.typeIn(
        page.getByLabel(/^Notes\*?$/).first(),
        'Customer confirmed the address and the amount on the call.',
      );
      await stage.dwellOn(page.locator('.cc-form').first(), 2000);
    },
  },
  {
    id: 'call-record',
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: 'Record outcome' }), 3400),
  },
  {
    id: 'call-release',
    run: (ctx) =>
      show(ctx, ctx.page.getByRole('button', { name: 'Release without attempt' }), 3200),
  },
  { id: 'call-stop', run: (ctx) => show(ctx, ctx.page.locator('.cc-avail'), 3800) },
  {
    id: 'q-open',
    run: async (ctx) => {
      await go(ctx, '/call-center/queue', ctx.page.locator('.sk-tr').first());
      await ctx.stage.dwellOn(h1(ctx.page), 2600);
    },
  },
  { id: 'q-tiles', run: (ctx) => show(ctx, ctx.page.locator('.oo-kpis'), 3600) },
  { id: 'q-filter', run: (ctx) => show(ctx, ctx.page.locator('.cc-filters'), 3400) },
  { id: 'q-row', run: (ctx) => show(ctx, ctx.page.locator('.sk-table'), 3800) },
  { id: 'q-stuck', run: (ctx) => show(ctx, queueRow(ctx.page, STUCK_AGENT), 3800) },
  {
    id: 'q-reassign',
    run: async (ctx) => {
      await openDialog(
        ctx,
        queueRow(ctx.page, STUCK_AGENT).getByRole('button', { name: 'Reassign' }),
      );
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-dialog__head'), 3200);
    },
  },
  {
    id: 'q-reassign-pick',
    run: async (ctx) => {
      const { page } = ctx;
      // By the option's own TEXT: the value is a uuid and differs on
      // every database.
      const value = await page
        .locator('#q-to option', { hasText: FREE_AGENT })
        .first()
        .getAttribute('value');
      await ctx.stage.point(page.locator('#q-to'), { settle: 500 });
      await page.selectOption('#q-to', value);
      await show(ctx, page.getByRole('dialog').locator('.oo-stack'), 3400);
    },
  },
  {
    id: 'q-reschedule',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(
        ctx,
        ctx.page.locator('.sk-tbody .sk-tr').first().getByRole('button', { name: 'Reschedule' }),
      );
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-dialog__head'), 3200);
    },
  },
  {
    id: 'q-reschedule-when',
    run: async ({ page, stage }) => {
      const dialog = page.getByRole('dialog');
      // "Tomorrow", not "In 1 hour": the list rounds to whole minutes
      // below an hour, so a sixty-minute preset reads 59m or 1h.
      await stage.clickIt(dialog.getByRole('button', { name: 'Tomorrow' }), { after: 800 });
      await stage.typeIn(dialog.locator('#q-why'), 'Customer asked to be rung tomorrow instead.');
      await stage.dwellOn(dialog.locator('.oo-stack').first(), 2600);
    },
  },
  {
    id: 'q-force-open',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(
        ctx,
        queueRow(ctx.page, STUCK_AGENT).getByRole('button', { name: 'Force outcome' }),
      );
      await ctx.page
        .getByRole('dialog')
        .getByRole('heading', { name: /Overrule this call/ })
        .waitFor({ state: 'visible', timeout: WAIT });
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-dialog__head'), 3200);
    },
  },
  {
    id: 'q-force-warning',
    run: async (ctx) => {
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-dialog__desc'), 3400);
      await show(ctx, ctx.page.getByRole('dialog').locator('.oo-p'), 3200);
    },
  },
  {
    id: 'q-force-outcomes',
    run: async (ctx) => {
      await ctx.page.selectOption('#fo-outcome', 'CONFIRMED');
      await show(ctx, ctx.page.getByText(/reserves stock and advances the order/), 3600);
    },
  },
  {
    id: 'q-force-declined',
    run: async (ctx) => {
      await ctx.page.selectOption('#fo-outcome', 'CUSTOMER_DECLINED');
      await show(ctx, ctx.page.getByText(/the order is rejected\. Terminal\./), 3600);
    },
  },
  { id: 'q-force-when', run: (ctx) => show(ctx, ctx.page.locator('#fo-started'), 3200) },
  {
    id: 'q-force-notes',
    run: async ({ page, stage }) => {
      await stage.typeIn(
        page.locator('#fo-notes'),
        'Client emailed: the customer cancelled by phone, so the call cannot be made.',
      );
      await stage.dwellOn(page.locator('#fo-notes'), 2000);
    },
  },
  {
    id: 'q-force-record',
    run: (ctx) =>
      show(
        ctx,
        ctx.page.getByRole('dialog').getByRole('button', { name: 'Record this outcome' }),
        3800,
      ),
  },
  {
    id: 'q-agents',
    run: async (ctx) => {
      await shut(ctx);
      await ctx.stage.clickIt(ctx.page.getByRole('link', { name: 'Call agents' }).first(), {
        after: 1200,
      });
      await ctx.page.waitForURL((u) => u.pathname === '/call-center/agents', { timeout: 20_000 });
      await withRetry(ctx.page, queueRow(ctx.page, FREE_AGENT));
      await show(ctx, ctx.page.locator('.sk-table'), 3400);
    },
  },
  {
    id: 'q-agent-cap',
    run: async (ctx) => {
      const { page, stage } = ctx;
      await openDialog(ctx, queueRow(page, FREE_AGENT).getByRole('button', { name: 'Details' }));
      const dialog = page.getByRole('dialog');
      await dialog.locator('#ag-max').waitFor({ state: 'visible', timeout: WAIT });
      await stage.typeIn(dialog.locator('#ag-max'), '3', { clear: true });
      await stage.dwellOn(dialog.getByRole('button', { name: 'Save capacity' }), 3000);
    },
  },
  {
    id: 'rr-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/reattempt-requests');
      await ctx.stage.dwellOn(ctx.page.locator('.sk-ph').first(), 3000);
    },
  },
  { id: 'rr-card', run: (ctx) => show(ctx, ctx.page.locator('.oo-body'), 3800) },
  {
    id: 'rr-approve',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Approve — call again' }));
      await show(
        ctx,
        ctx.page.getByText(/returns to PENDING_CONFIRMATION and is queued for calling/),
        3400,
      );
    },
  },
  {
    id: 'rr-extra',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await show(ctx, ctx.page.getByText(/puts the order back already out of chances/), 3000);
      await ctx.stage.typeIn(
        dialog.locator('#ra-note'),
        'Customer rang the shop back and wants it.',
      );
      await ctx.stage.dwellOn(dialog.locator('#ra-extra'), 2600);
    },
  },
  {
    id: 'rr-decline',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Decline' }).last());
      await ctx.stage.typeIn(
        ctx.page.getByRole('dialog').locator('#ra-note'),
        'Nothing has changed since the customer declined.',
      );
      await show(ctx, ctx.page.getByText(/The order stays rejected/), 3200);
    },
  },
  {
    id: 'rr-history',
    run: async (ctx) => {
      await shut(ctx);
      await ctx.page.selectOption('#ra-status', '');
      await show(ctx, ctx.page.locator('.oo-queue'), 3600);
    },
  },
];

/* ───────── J · warehouse, K · returns, L · stock: narration + flow ──── */

const J_SAY = [
  {
    id: 'wh-hub',
    say: 'Now the warehouse floor. Its hub lists the jobs in the order the building works: consignment arrives, receive, print, pick, pack, hand over, dispatch. This video follows that order. Open Warehouse.',
  },
  {
    id: 'bins-open',
    say: 'First, where things live. Open Bins. The top half is every bin across the business, with the product, the client and the batch on each. The lower half is the layout of one building. Filter the top by building, kind of bin, client, or a SKU you are hunting for.',
  },
  {
    id: 'bins-overview',
    say: 'Some stock is deliberately not sellable. Held, damaged and quarantine bins are counted but never picked from. In transit means stock that left one warehouse and has not arrived at the next, counted here so neither building goes looking for it.',
  },
  {
    id: 'bins-building',
    say: 'Everything below is one building at a time. Choose it with the Warehouse picker. Our Dhaka intake warehouse is the example: one floor, no shelving, nothing on it.',
  },
  {
    id: 'bins-tracking',
    say: 'Location tracking is the switch, and it is off. Off means everything lands on the floor and picking sheets name no shelf. On means receiving asks which bin and picking sheets name a shelf. You cannot turn it on until a bin exists. Turning it off later stops the system asking; it does not collapse anything you built.',
  },
  {
    id: 'bins-compose',
    say: 'To build a shelf, open Add a bin. Choose a zone, because zones carry pick order, so a picker walks the building in a sensible sequence. Then type three coordinates: aisle, rack, shelf. You never type the name.',
  },
  {
    id: 'bins-add',
    say: 'The page shows what those coordinates become before you commit, so one shelf cannot end up with three spellings. Add bin creates it, empty and pickable. It is not pressed here.',
  },
  {
    id: 'bins-move',
    say: 'Further down is re-shelving. You do not list what is in a bin: you name the two bins and the server moves everything in one transaction, or a list of lines that all commit or none do.',
  },
  {
    id: 'recv-queue',
    say: 'Goods are at the door. Until somebody counts them they are a promise on a screen; once counted they become stock a customer can be sold. Open Receive. It opens on what is waiting, which is the only list that matters on a delivery morning.',
  },
  {
    id: 'recv-open',
    say: 'Click a receipt. The declaration says who the client is, their own reference, which building it landed at, and what they say is in the boxes.',
  },
  {
    id: 'recv-declared',
    say: 'The expected figures are the client’s. Nothing has been counted, so each line says recorded nought.',
  },
  {
    id: 'recv-claimed',
    say: 'Start receiving claims the receipt in your name, so two people cannot count one pallet from two ends of the building and overwrite each other. This receipt is already claimed, which is why the count fields are showing.',
  },
  {
    id: 'recv-count',
    say: 'Each line asks three things: how many good ones you found, how many arrived damaged, and which shelf you are putting them on. This building keeps no shelf numbers, so the floor. Type what is really in the carton. Ten declared, ten counted, none damaged.',
  },
  {
    id: 'recv-short',
    say: 'The second line is short: twenty declared, eighteen good, one damaged. So one is missing outright and one arrived broken. Record what you found, not what was promised.',
  },
  {
    id: 'recv-record',
    say: 'Record all products saves the counts as what the bench says. Stock is not written yet.',
  },
  {
    id: 'recv-complete',
    say: 'Complete is dangerous. It writes stock for what was counted, closes the receipt, and cannot be cancelled afterwards; a miscount is corrected with a stock adjustment, a second entry. A variance never blocks: the gap is recorded and the goods carry on. Afterwards, Print product labels prints a sticker per unit received. The pointer stays on Complete.',
  },
  {
    id: 'print-open',
    say: 'Next, the morning’s paper. Every confirmed order already carries a waybill, and Labels and picking turns a list of them into paper somebody can walk the building with. The subtitle is the rule: nothing moves until somebody confirms the paper actually came out.',
  },
  {
    id: 'print-select',
    say: 'The Labels tab shows what is waiting: order, client, courier, waybill, destination, what the customer owes at the door, and item count. You do not print the whole queue. Tick the parcels you will walk in one go.',
  },
  {
    id: 'print-press',
    say: 'Print labels sends the file to the printer, then asks whether the paper came out and names anything it could not print. Answer Yes, they printed only for paper in your hand; saying yes moves those parcels along. The pointer stays on the button.',
  },
  {
    id: 'pick-tab',
    say: 'The second tab, Picking list, is the sheet that tells a person which shelves to visit and in what order. Same parcels, second paper.',
  },
  {
    id: 'pick-list',
    say: 'Tick a walk and press Print picking list. It says how many lines there are to walk and marks anything it could not allocate. Confirming it does the real work: it claims the exact units on the exact shelves and sends every order on it to be picked, so a shortfall surfaces here and not in an aisle.',
  },
  {
    id: 'pick-batches',
    say: 'Every sheet is a batch. Past batches shows when it was made, by whom, when it printed, and whether more than one copy is loose in the building. When the trolley comes back, Mark picked arrives parcels at the packing bench. Anything tracked unit by unit stays behind for the pick station, because a serial must be scanned.',
  },
  {
    id: 'pack-open',
    say: 'The packing bench has one field on it. Scan the shipping label to open a box, scan each product in, scan the label again to close. The packer never touches a keyboard. Open Pack.',
  },
  {
    id: 'pack-queue',
    say: 'With nothing in hand it lists what is coming, oldest first. Nothing here claims a parcel; the box does that. A parcel with no printed label is called out, because there is nothing to scan.',
  },
  {
    id: 'pack-lines',
    say: 'Scanning the label opens a box, one per parcel and one per packer, held by the database itself. The biggest thing on screen is what still has to go in, with a quantity beside each line. A satisfied line goes quiet rather than vanishing, so a packer is never left wondering whether they scanned it.',
  },
  {
    id: 'pack-scan',
    say: 'Scan each product in. One scan too many is refused at the scan with the item still in your hand, not at the end when the box is taped. A refusal stops the bench until the packer says I have fixed it, because a scanner types and presses Enter on its own. Scanning the label again closes the box and checks it as a set, then the parcel joins a manifest.',
  },
  {
    id: 'pack-cancel',
    say: 'A box that will not be finished is cancelled: click Cancel this box. The note says the important part: the scans are discarded and the parcel returns to the queue, and nothing goes back to inventory, because packing already took the stock out.',
  },
  {
    id: 'pack-cancel-reason',
    say: 'Type the reason, which is required and is the only record anywhere that this box was opened. Cancel the box then returns the parcel to the list. It is not pressed here.',
  },
  {
    id: 'pack-force',
    say: 'Sometimes the goods have nothing to scan: stock shelved before labels, or a sticker torn off. There is a way past it, and it is deliberately not beside the close button. Pack without scanning has its own panel below the cancel. It is a supervisor’s control, enforced by the server, since nobody waives the check they are the one performing.',
  },
  {
    id: 'pack-force-reason',
    say: 'Read what it says: it packs the parcel without checking what is inside, and an unverified box is a wrong item at somebody’s door. It wants a reason of at least twenty characters, and the button stays dead until you meet it. Pressing it would pack the parcel as if scanned and log a high-severity action under your name. It is not pressed.',
  },
  {
    id: 'hand-open',
    say: 'The van is at the door. Open Handover. This is the last look at a parcel before a driver takes it.',
  },
  {
    id: 'hand-waiting',
    say: 'It lists what is still standing at the bench, not what you have done, because that is the question someone loading a van has.',
  },
  {
    id: 'hand-scan',
    say: 'Scan the label as the box goes on the van, and that is all: no form afterwards. The parcel is dispatched the moment it is read, which makes it dangerous, because it tells the customer it is on the way. Scanning a box that already went stops everything, since it means two boxes carry one waybill or a pile already done is now suspect. The stop follows that packer, and only an admin lifts it.',
  },
  {
    id: 'van-open',
    say: 'Most days nobody opens Pickups. The courier is asked for a van automatically when the day’s first box is packed. It is one request per warehouse per day for the whole handover, not one per parcel.',
  },
  {
    id: 'van-failed',
    say: 'A row is a day: who collects, where from, under which registered name, what time, and how many parcels we told them to expect. Collected closes the day once the driver has been. The row this screen exists for is a failed attempt, with the courier’s own words on it.',
  },
  {
    id: 'van-free',
    say: 'Free the day is the sharp edge. It lets a new request be raised, which is right when nothing registered and books a second van when something did. They returned no id, so it probably never reached them; probably is why this is a deliberate act. Check the courier’s own panel first and say what you found. The dialog is opened and closed.',
  },
  {
    id: 'van-raise',
    say: 'Request a pickup raises one by hand, and it is a live call that books a real vehicle. The form is short because the courier needs little, which is exactly what makes it easy to do twice. Check the day’s row first.',
  },
  {
    id: 'man-open',
    say: 'A manifest answers one question: what went out on Tuesday’s van. Open Manifests. Nothing here needs doing unless something went wrong. A row is one van-load: courier, parcel count, when it opened, and when it closed.',
  },
  {
    id: 'man-draft',
    say: 'Filter by status if you need to. Draft is still collecting; dispatched has gone. The draft at the top is today, created when the first box was packed. Click it.',
  },
  {
    id: 'man-inside',
    say: 'Inside is the list itself, parcel by parcel with waybill and state. This is what you would read to a driver, or send the courier if they ever asked which parcels we say we handed over.',
  },
  {
    id: 'man-close',
    say: 'Move a shipment to another manifest is the one repair offered, and it needs a second draft for the same courier and building. Close manifest is a fallback: the handover scan closes it as the last parcel goes, so pressing it means something stopped before that.',
  },
];

const K_SAY = [
  {
    id: 'rto-open',
    say: 'A parcel has come back. Open Returns. It opens on the only urgent tab: parcels standing at our door, and every hour they do is an hour the client thinks their goods are moving.',
  },
  {
    id: 'rto-door',
    say: 'The note says how one leaves this list: receiving it starts the inspection, and nothing does that automatically. That is deliberate. The courier saying a parcel is back is not a parcel being back, and everything after this moves real stock.',
  },
  {
    id: 'rto-receive',
    say: 'Click the waybill in a row. It fills the AWB number box and puts you at the bench, because the person doing this holds a parcel, not a mouse. Receive is the press: the order moves, the clock stops, and the units are booked into the returns hold. It is counted, not sellable, and findable. The pointer stays on it.',
  },
  {
    id: 'rto-transit',
    say: 'The second tab is what is still travelling. Nothing to do here. It exists so the bench knows what is coming, and a return on the road for weeks is visible somewhere.',
  },
  {
    id: 'rto-bench',
    say: 'The third tab is what is here and not finished: boxes nobody has opened, and lines somebody looked at and could not decide about. Two different hold-ups, counted apart because they need different people.',
  },
  {
    id: 'rto-work',
    say: 'Click Work it on a row. You see what came back, line by line, with no verdict yet. From here everything you press moves real stock. The units are in the returns hold, a real place on the shelf plan.',
  },
  {
    id: 'rto-condition',
    say: 'Two questions per line. First, Condition: what you found in the box. Damaged or missing opens a damage ticket to the client, and that is where any money is settled.',
  },
  {
    id: 'rto-choices',
    say: 'Second, What happens to it: back in stock, kept aside, written off, or decide later. What each choice does explains each in words, so read it instead of remembering. Choose Back in stock for a Damaged unit and it warns without refusing: that unit goes to the next customer.',
  },
  {
    id: 'rto-split',
    say: 'When a line holds more than one unit, they need not have come back alike. Split by quantity adds rows, and the rows must add to the line’s units exactly or the server refuses the whole save. Make row one Good and Back in stock, which leaves the hold for a sellable shelf. Make row two Damaged and Keep aside, which goes to the damaged bin and stays the client’s.',
  },
  {
    id: 'rto-save',
    say: 'Save inspection marks the line inspected. Nothing has moved: it is a verdict written down, and you can come back and change it. The pointer stays on it.',
  },
  {
    id: 'rto-finalise',
    say: 'Finalize disposition is the act that cannot be taken back. It restates what it will do in units, not lines, and says stock moves now. One unit would be back on a shelf and sellable, one in the damaged bin, and the order would move on. It needs the permission marked dangerous in the role editor. Deciding later is honest: the parcel stays on this bench.',
  },
];

const L_SAY = [
  {
    id: 'adj-open',
    say: 'A stock adjustment is how a count gets put right: the one way a figure changes without a parcel being involved. Open Adjustments. The screen opens on the only thing here that is a job.',
  },
  {
    id: 'adj-tiles',
    say: 'These say what is waiting and what it stands to move: the value those corrections would take off the books or put back.',
  },
  {
    id: 'adj-review',
    say: 'Click Review on a row. Somebody counted, someone else is asked to agree, and nothing has moved yet, which is the only reason this screen exists.',
  },
  {
    id: 'adj-facts',
    say: 'Direction, reason, what it is worth, and the threshold it was measured against, written down when it was raised. Change the setting tomorrow and this row still says what the rule was.',
  },
  {
    id: 'adj-why',
    say: 'The approver reads the words and nothing else, so read them. Underneath is the line: a product, a shelf, a batch, and a quantity.',
  },
  {
    id: 'adj-choices',
    say: 'Two ways out. Rejecting wants a reason and keeps it for good. The other button says what it does: approving writes the movement, the shelf count changes from that press, and nothing on this screen can put it back. Approving is dangerous. The dialog is closed here.',
  },
  {
    id: 'adj-history',
    say: 'Clear the status filter and the history is there: a correction small enough to apply on its own beside the one that needed two people, each with what it moved.',
  },
  {
    id: 'adj-form',
    say: 'To raise one, click New adjustment. It asks for identifiers rather than dropdowns, on purpose: stock is held per batch per shelf, and whoever types this has the numbers on a count sheet.',
  },
  {
    id: 'adj-cost',
    say: 'Then how many, and what one is worth. That second figure is the gate: quantity times value decides whether it applies now or waits for somebody. Under the threshold it applies as you press Raise adjustment, so read whether the message says applied or waiting. Here the form closes unsent.',
  },
  {
    id: 'cyc-open',
    say: 'A cycle count is the floor checking the system, not the other way round. Open Cycle counts. The tiles say what is open and how much disagreed. A count that finds nothing is still worth running, since it is the only evidence the numbers mean anything.',
  },
  {
    id: 'cyc-schedule',
    say: 'Click Schedule a count. Scheduling changes nothing: it creates a job and waits, because someone has to go to the shelves. Choose the warehouse, then the scope: a whole building, one zone, a sample, a handful of products. Pick what the counters have time for. Schedule is not pressed.',
  },
  {
    id: 'cyc-count',
    say: 'Open a count that is under way. Each line is recorded per shelf and per batch, by identifiers off the count sheet. What the system believed is read when you record, not when the count was scheduled, and what was really on the shelf goes in beside it.',
  },
  {
    id: 'cyc-diff',
    say: 'The disagreement is said in three columns: what we thought, what was found, the difference. Nothing has changed yet. This is two people with different numbers.',
  },
  {
    id: 'cyc-complete',
    say: 'The button counts the consequence for you: Complete, raises this many corrections. A cycle count never moves stock itself. Every difference becomes an adjustment, and an adjustment has to be agreed by somebody. Completing is dangerous for that reason. The pointer stays on it.',
  },
  {
    id: 'mov-open',
    say: 'The stock ledger is the last page of almost every argument about inventory. Open Stock movements. Every change to a quantity we have ever made, and what caused it. The subtitle is a promise: append only. Nothing was edited or deleted, and no endpoint could.',
  },
  {
    id: 'mov-types',
    say: 'A row is one movement: when, what kind, which product and shelf, then what it changed and what the shelf held afterwards. The second number lets you check that the steps add up. The Type filter lists the vocabulary: Receiving is goods arriving, Pack confirm is goods leaving. Stock comes off the shelf when the box is sealed, not when the van takes it.',
  },
  {
    id: 'mov-bin',
    say: 'Two filters answer the questions people arrive with. Paste a product and you get its whole history. Or choose the warehouse first, since a shelf belongs to one building, then the shelf, and you get everything that happened there. A move between shelves is always two rows, out and in, with one cause.',
  },
  {
    id: 'mov-reason',
    say: 'Corrections carry a reason, and this is where it earns its keep. Filter Type to Adjustment decrease and read the reasons: months later that word is the whole of what anybody remembers. Come here when a number does not add up, and read until the rows stop agreeing with you.',
  },
  {
    id: 'xfer-open',
    say: 'Last in stock: moving goods between warehouses, the raw movement under everything else, which is why it asks for so much. Open Transfers.',
  },
  {
    id: 'xfer-ids',
    say: 'Client, product, quantity. These are identifiers, not names, and no screen in this console prints them. You arrive holding them off the sheet somebody walked the shelves with.',
  },
  {
    id: 'xfer-from',
    say: 'Where they leave: the building, the exact bin, and the exact batch. Stock lives in a place and belongs to a consignment, and both must be named.',
  },
  {
    id: 'xfer-to',
    say: 'Where they go. The destination batch is required and never created for you: a batch carries expiry, unit cost and the receipt that brought it in, and an invented one loses all three. Name the same building at both ends and it stops you; a move within one building is a different act.',
  },
  {
    id: 'xfer-press',
    say: 'Add a note, then Transfer stock, which asks once more, restating product, client, count and both buildings. It is dangerous: it writes one movement out and one in as a matched pair, and the form cannot take it back. That pair in the ledger is the only record. The pointer stays on the button.',
  },
];

/** The first row of the tab strip, or the nth. */
const rtoTab = (page, n) => page.locator('.wh-rto-tabs > *').nth(n);

const J_RUN = [
  {
    id: 'wh-hub',
    run: async (ctx) => {
      await go(ctx, '/warehouse');
      await ctx.stage.dwellOn(h1(ctx.page), 3400);
    },
  },
  {
    id: 'bins-open',
    run: async (ctx) => {
      await go(ctx, '/warehouse/bins', ctx.page.getByRole('heading', { level: 1, name: 'Bins' }));
      await show(ctx, ctx.page.locator('.stk-toolbar'), 3600);
    },
  },
  {
    id: 'bins-overview',
    run: (ctx) => show(ctx, ctx.page.locator('.stk-card', { hasText: 'not pickable' }), 3600),
  },
  {
    id: 'bins-building',
    run: async (ctx) => {
      const picker = ctx.page.locator('.sk-ph').getByLabel('Warehouse');
      await ctx.stage.point(picker, { settle: 500 });
      await picker.selectOption({ label: 'BD-DHK-1 — Dhaka Intake' });
      await ctx.page.waitForTimeout(1200);
      await ctx.stage.dwellOn(picker, 2400);
    },
  },
  {
    id: 'bins-tracking',
    run: (ctx) => show(ctx, ctx.page.locator('.stk-card', { hasText: 'Location tracking' }), 4600),
  },
  {
    id: 'bins-compose',
    run: async (ctx) => {
      const { page, stage } = ctx;
      const section = page.locator('.stk-section', { hasText: 'Add a bin' }).first();
      const zone = section.getByLabel(/^Zone$/);
      const main = await section
        .locator('option', { hasText: 'MAIN' })
        .first()
        .getAttribute('value');
      await stage.point(zone, { settle: 400 });
      await zone.selectOption(main ?? { index: 1 });
      await stage.typeIn(section.getByLabel(/^Aisle$/), 'A');
      await stage.typeIn(section.getByLabel(/^Rack$/), '1');
      await stage.typeIn(section.getByLabel(/^Shelf$/), '3');
      await show(ctx, section, 2000);
    },
  },
  {
    id: 'bins-add',
    run: async (ctx) => {
      await show(ctx, ctx.page.getByText(/Will be created as/), 2400);
      await show(ctx, ctx.page.getByRole('button', { name: 'Add bin' }), 2000);
    },
  },
  {
    id: 'bins-move',
    run: (ctx) =>
      show(ctx, ctx.page.locator('.stk-section', { hasText: 'Move stock between bins' }), 3600),
  },
  {
    id: 'recv-queue',
    run: async (ctx) => {
      await go(ctx, '/warehouse/receive', ctx.page.locator('.sk-tr').first());
      await show(ctx, ctx.page.locator('.sk-table'), 3600);
    },
  },
  {
    id: 'recv-open',
    run: async ({ page, stage }) => {
      await stage.clickIt(page.locator('.sk-tbody .sk-tr').first().getByRole('link').first(), {
        after: 1400,
      });
      await page.waitForURL(/\/warehouse\/receive\/.+/, { timeout: 30_000 });
      await quiet(page);
      await withRetry(page, page.locator('.wh-facts').first());
      await stage.dwellOn(page.locator('.wh-facts').first(), 3400);
    },
  },
  { id: 'recv-declared', run: (ctx) => show(ctx, ctx.page.locator('.wh-item'), 3600) },
  { id: 'recv-claimed', run: (ctx) => show(ctx, ctx.page.locator('.wh-facts'), 3600) },
  {
    id: 'recv-count',
    run: async ({ page, stage }) => {
      const received = page.getByLabel(/^Received qty$/);
      const damaged = page.getByLabel(/^Damaged$/);
      await received.first().waitFor({ state: 'visible', timeout: WAIT });
      await stage.typeIn(received.nth(0), '10', { clear: true });
      await stage.typeIn(damaged.nth(0), '0', { clear: true });
      await stage.dwellOn(page.locator('.wh-fields').first(), 2600);
    },
  },
  {
    id: 'recv-short',
    run: async ({ page, stage }) => {
      await stage.typeIn(page.getByLabel(/^Received qty$/).nth(1), '18', { clear: true });
      await stage.typeIn(page.getByLabel(/^Damaged$/).nth(1), '1', { clear: true });
      await stage.dwellOn(page.locator('.wh-fields').nth(1), 2800);
    },
  },
  {
    id: 'recv-record',
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: 'Record all products' }), 2800),
  },
  {
    id: 'recv-complete',
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: 'Complete', exact: true }), 4600),
  },
  {
    id: 'print-open',
    run: async (ctx) => {
      await go(ctx, '/warehouse/printing');
      await ctx.stage.dwellOn(ctx.page.locator('.sk-ph').first(), 3600);
    },
  },
  {
    id: 'print-select',
    run: async ({ page, stage }) => {
      await stage.dwellOn(page.locator('.sk-thead').first(), 2400);
      const rows = page.locator('.sk-tbody .sk-tr');
      for (let i = 0; i < 3; i += 1) {
        await stage.clickIt(rows.nth(i).locator('input.wh-check'), { settle: 220, after: 260 });
      }
      await stage.dwellOn(page.getByText('3 selected'), 2400);
    },
  },
  {
    id: 'print-press',
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: 'Print labels' }), 3800),
  },
  {
    id: 'pick-tab',
    run: async ({ page, stage }) => {
      await stage.clickIt(page.getByRole('button', { name: 'Picking list' }), { after: 1400 });
      await stage.dwellOn(page.locator('.sk-table').first(), 3000);
    },
  },
  {
    id: 'pick-list',
    run: async ({ page, stage }) => {
      const rows = page.locator('.sk-tbody .sk-tr');
      for (let i = 0; i < 3; i += 1) await rows.nth(i).locator('input.wh-check').click();
      await stage.dwellOn(page.getByRole('button', { name: 'Print picking list' }), 3800);
    },
  },
  {
    id: 'pick-batches',
    run: async ({ page, stage }) => {
      await stage.clickIt(page.getByRole('button', { name: 'Past batches' }), { after: 1400 });
      await stage.dwellOn(page.locator('.sk-table').first(), 3800);
    },
  },
  {
    id: 'pack-open',
    run: async (ctx) => {
      await go(ctx, '/warehouse/pack', ctx.page.locator('.wh-scan').first());
      await ctx.stage.dwellOn(ctx.page.locator('.wh-scan').first(), 3400);
    },
  },
  { id: 'pack-queue', run: (ctx) => show(ctx, ctx.page.locator('.wh-card__note'), 3400) },
  {
    id: 'pack-lines',
    run: async (ctx) => {
      await ctx.page.locator('.wh-scan__meta').waitFor({ state: 'visible', timeout: WAIT });
      await show(ctx, ctx.page.locator('[aria-label="What goes in this box"]'), 3800);
    },
  },
  { id: 'pack-scan', run: (ctx) => show(ctx, ctx.page.locator('.wh-lines'), 4800) },
  {
    id: 'pack-cancel',
    run: async ({ page, stage }) => {
      // Clicking this only REVEALS the reason panel; the destructive
      // button inside it is "Cancel the box" and is not pressed.
      await stage.clickIt(page.getByRole('button', { name: 'Cancel this box' }), { after: 900 });
      await stage.dwellOn(page.locator('.wh-note').first(), 3000);
    },
  },
  {
    id: 'pack-cancel-reason',
    run: async (ctx) => {
      await ctx.stage.typeIn(
        ctx.page.getByLabel(/^Reason for cancelling$/),
        'Outer carton crushed in the aisle; repacking from a new box.',
      );
      await show(ctx, ctx.page.getByRole('button', { name: 'Cancel the box' }), 2400);
    },
  },
  { id: 'pack-force', run: (ctx) => show(ctx, ctx.page.locator('.wh-divide'), 4600) },
  {
    id: 'pack-force-reason',
    run: async (ctx) => {
      const panel = ctx.page.locator('.wh-divide').first();
      await ctx.stage.typeIn(
        panel.getByLabel(/^Reason for packing without scanning$/),
        'Labels were never printed on this older stock; checked each item by hand against the order.',
      );
      await show(ctx, panel.getByRole('button', { name: 'Pack without scanning' }), 3200);
    },
  },
  {
    id: 'hand-open',
    run: async (ctx) => {
      await go(ctx, '/warehouse/handover');
      await ctx.stage.dwellOn(ctx.page.locator('.sk-ph').first(), 3000);
    },
  },
  { id: 'hand-waiting', run: (ctx) => show(ctx, ctx.page.locator('.wh-list').first(), 3600) },
  { id: 'hand-scan', run: (ctx) => show(ctx, ctx.page.locator('.sk-ph'), 5600) },
  {
    id: 'van-open',
    run: async (ctx) => {
      await go(ctx, '/warehouse/pickups');
      await show(ctx, ctx.page.locator('.sk-ph__subtitle'), 3600);
    },
  },
  { id: 'van-failed', run: (ctx) => show(ctx, ctx.page.locator('.sk-table'), 4600) },
  {
    id: 'van-free',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Free the day' }));
      await show(ctx, ctx.page.getByRole('dialog').locator('.pku-callout'), 4000);
    },
  },
  {
    id: 'van-raise',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Request a pickup' }));
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-dialog__body'), 3400);
    },
  },
  {
    id: 'man-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/warehouse/manifests');
      await show(ctx, ctx.page.locator('.sk-thead'), 3400);
    },
  },
  {
    id: 'man-draft',
    run: async ({ page, stage }) => {
      await stage.dwellOn(page.getByLabel('Status', { exact: true }), 2000);
      const draft = page.locator('.sk-tbody .sk-tr', { hasText: 'Draft' }).first();
      await stage.clickIt(draft.locator('a.stk-link').first(), { after: 1600 });
      await page.waitForURL(/\/warehouse\/manifests\/.+/, { timeout: 30_000 });
      await quiet(page);
      await withRetry(page, h1(page));
      await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2800);
    },
  },
  { id: 'man-inside', run: (ctx) => show(ctx, ctx.page.locator('.sk-table'), 3800) },
  {
    id: 'man-close',
    run: async (ctx) => {
      await show(
        ctx,
        ctx.page.getByRole('button', { name: 'Move a shipment to another manifest' }),
        2600,
      );
      await show(ctx, ctx.page.getByRole('button', { name: 'Close manifest' }), 3000);
    },
  },
];

const K_RUN = [
  {
    id: 'rto-open',
    run: async (ctx) => {
      await go(ctx, '/warehouse/rto');
      await ctx.stage.dwellOn(ctx.page.locator('.wh-rto-tabs').first(), 3400);
    },
  },
  { id: 'rto-door', run: (ctx) => show(ctx, ctx.page.locator('.wh-rto-panel > .wh-note'), 4000) },
  {
    id: 'rto-receive',
    run: async ({ page, stage }) => {
      await stage.clickIt(page.locator('.sk-tbody .sk-tr').first().locator('button.wh-awb-pick'), {
        after: 1400,
      });
      await stage.dwellOn(page.getByLabel(/^AWB number/), 2400);
      await stage.dwellOn(page.getByRole('button', { name: 'Receive', exact: true }), 3600);
    },
  },
  {
    id: 'rto-transit',
    run: async (ctx) => {
      await ctx.stage.clickIt(rtoTab(ctx.page, 1), { after: 1400 });
      await show(ctx, ctx.page.locator('.sk-table'), 3000);
    },
  },
  {
    id: 'rto-bench',
    run: async (ctx) => {
      await visit(ctx, '/warehouse/rto?tab=bench', ctx.page.locator('.sk-tbody .sk-tr').first());
      await show(ctx, ctx.page.locator('.sk-table'), 3600);
    },
  },
  {
    id: 'rto-work',
    run: async ({ page, stage }) => {
      await stage.clickIt(page.getByRole('button', { name: 'Work it' }).first(), { after: 1600 });
      await page.getByLabel(/^Condition$/).waitFor({ state: 'visible', timeout: WAIT });
      await stage.dwellOn(page.locator('.wh-row--between').first(), 3400);
    },
  },
  {
    id: 'rto-condition',
    run: async (ctx) => {
      const field = ctx.page.getByLabel(/^Condition$/);
      await ctx.stage.point(field, { settle: 500 });
      await field.selectOption('DAMAGED');
      await show(ctx, ctx.page.getByText(/opens a damage ticket to the client/i), 3400);
    },
  },
  {
    id: 'rto-choices',
    run: async (ctx) => {
      const field = ctx.page.getByLabel(/^What happens to it$/);
      await ctx.stage.point(field, { settle: 500 });
      await ctx.stage.clickIt(ctx.page.getByText('What each choice does').first(), { after: 900 });
      await show(ctx, ctx.page.locator('.wh-details p'), 3000);
      await field.selectOption('RESTOCK');
      await show(ctx, ctx.page.locator('.sk-field__msg[data-kind="notice"]'), 3000);
    },
  },
  {
    id: 'rto-split',
    run: async (ctx) => {
      await ctx.stage.clickIt(ctx.page.getByRole('button', { name: 'Split by quantity' }), {
        after: 1400,
      });
      await ctx.page.getByLabel(/^Condition, row 1$/).selectOption('GOOD');
      await ctx.page.getByLabel(/^Condition, row 2$/).selectOption('DAMAGED');
      await ctx.page.getByLabel(/^What happens to them, row 2$/).selectOption('HOLD_DAMAGED');
      await show(ctx, ctx.page.getByLabel(/^Condition, row 2$/), 4400);
    },
  },
  {
    id: 'rto-save',
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: 'Save inspection' }), 3200),
  },
  {
    id: 'rto-finalise',
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: 'Finalize disposition' }), 5200),
  },
];

const L_RUN = [
  {
    id: 'adj-open',
    run: async (ctx) => {
      await go(ctx, '/inventory/adjustments', ctx.page.locator('.sk-table').first());
      await show(ctx, ctx.page.locator('.sk-table'), 3000);
    },
  },
  { id: 'adj-tiles', run: (ctx) => show(ctx, ctx.page.locator('.stk-kpis'), 3400) },
  {
    id: 'adj-review',
    run: async (ctx) => {
      await openDialog(
        ctx,
        ctx.page
          .locator('.sk-tbody .sk-tr')
          .first()
          .getByRole('button', { name: /Review/ }),
      );
      await show(ctx, ctx.page.getByRole('dialog'), 2600);
    },
  },
  {
    id: 'adj-facts',
    run: (ctx) => show(ctx, ctx.page.getByRole('dialog').locator('.stk-dl'), 3600),
  },
  { id: 'adj-why', run: (ctx) => show(ctx, ctx.page.getByRole('dialog').getByRole('table'), 3600) },
  {
    id: 'adj-choices',
    run: (ctx) => show(ctx, foot(ctx.page).getByRole('button', { name: /^Approve/ }), 4600),
  },
  {
    id: 'adj-history',
    run: async (ctx) => {
      await shut(ctx);
      await ctx.stage.point(ctx.page.locator('#adj-status'), { settle: 400 });
      await ctx.page.locator('#adj-status').selectOption('');
      await ctx.page.waitForTimeout(1200);
      await show(ctx, ctx.page.locator('.sk-table'), 3600);
    },
  },
  {
    id: 'adj-form',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'New adjustment' }));
      await show(
        ctx,
        ctx.page.getByRole('dialog').getByText(/read them off the count sheet/i),
        3800,
      );
    },
  },
  {
    id: 'adj-cost',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await ctx.stage.typeIn(dialog.getByLabel(/^Quantity/), '1');
      await ctx.stage.typeIn(dialog.getByLabel(/^Unit cost/), '2400');
      await show(ctx, dialog.getByText(/decides whether this correction needs a second/i), 3400);
    },
  },
  {
    id: 'cyc-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/inventory/cycle-counts');
      await show(ctx, ctx.page.locator('.stk-kpis'), 3400);
    },
  },
  {
    id: 'cyc-schedule',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Schedule a count' }));
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-dialog__desc'), 3000);
      await ctx.stage.point(ctx.page.locator('#cc-wh'), { settle: 400 });
      await ctx.page.locator('#cc-wh').selectOption({ index: 1 });
      await show(ctx, ctx.page.locator('#cc-type'), 2800);
    },
  },
  {
    id: 'cyc-count',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(
        ctx,
        ctx.page
          .locator('.sk-tbody .sk-tr', { hasText: /in.progress|counting/i })
          .first()
          .getByRole('button', { name: 'Open' }),
      );
      await show(ctx, ctx.page.getByRole('dialog').getByRole('table').first(), 3800);
    },
  },
  {
    id: 'cyc-diff',
    run: (ctx) => show(ctx, ctx.page.getByRole('dialog').locator('.sk-table-wrap'), 3800),
  },
  {
    id: 'cyc-complete',
    run: (ctx) =>
      show(ctx, foot(ctx.page).getByRole('button', { name: /^Complete — raises/ }), 4800),
  },
  {
    id: 'mov-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(
        ctx,
        '/inventory/movements',
        ctx.page.getByRole('heading', { name: 'Stock movements' }),
      );
      await show(ctx, ctx.page.locator('.sk-ph__subtitle'), 3600);
    },
  },
  {
    id: 'mov-types',
    run: async (ctx) => {
      await show(ctx, ctx.page.locator('.sk-thead'), 2800);
      await show(ctx, ctx.page.locator('#mv-type'), 3400);
    },
  },
  {
    id: 'mov-bin',
    run: async (ctx) => {
      await ctx.stage.point(ctx.page.locator('#mv-wh'), { settle: 400 });
      await ctx.page.locator('#mv-wh').selectOption({ index: 1 });
      await ctx.page.waitForTimeout(1200);
      await show(ctx, ctx.page.locator('#mv-bin'), 3400);
    },
  },
  {
    id: 'mov-reason',
    run: async (ctx) => {
      await ctx.page.locator('#mv-wh').selectOption('');
      await ctx.page.locator('#mv-type').selectOption('ADJUSTMENT_DECREASE');
      await ctx.page.waitForTimeout(1500);
      await show(ctx, ctx.page.locator('.sk-table'), 3800);
    },
  },
  {
    id: 'xfer-open',
    run: async (ctx) => {
      await ctx.page.locator('#mv-type').selectOption('');
      await go(ctx, '/inventory/transfers', ctx.page.locator('#tr-seller'));
      await show(ctx, ctx.page.locator('.sk-ph__subtitle'), 3200);
    },
  },
  {
    id: 'xfer-ids',
    run: async (ctx) => {
      await ctx.stage.dwellOn(ctx.page.locator('#tr-seller'), 1800);
      await ctx.stage.dwellOn(ctx.page.locator('#tr-variant'), 1600);
      await ctx.stage.dwellOn(ctx.page.locator('#tr-qty'), 1600);
    },
  },
  { id: 'xfer-from', run: (ctx) => show(ctx, ctx.page.locator('#tr-src-wh'), 3600) },
  {
    id: 'xfer-to',
    run: async (ctx) => {
      await show(ctx, ctx.page.locator('#tr-dst-wh'), 1800);
      await show(ctx, ctx.page.getByText(/destination batch is required, not created/i), 3600);
    },
  },
  {
    id: 'xfer-press',
    run: async (ctx) => {
      await ctx.stage.typeIn(ctx.page.locator('#tr-desc'), 'Four returned to the wrong building.');
      await show(ctx, ctx.page.getByRole('button', { name: /^Transfer stock$/ }), 4600);
    },
  },
];

/* ───────────── M · couriers, N · money: narration + flow ─────────── */

const M_SAY = [
  {
    id: 'cour-open',
    say: 'Couriers. Open Courier accounts. One courier can have several accounts, and the difference between them is whose money and whose contract a parcel goes out on.',
  },
  {
    id: 'cour-several',
    say: 'The account that carried a parcel is recorded on the parcel. That is why this list exists rather than one set of credentials in a settings file: months later somebody asks which account a charge came from, and the answer has to be on the shipment.',
  },
  {
    id: 'cour-credentials',
    say: 'Now the sentence that governs everything here. Credentials are encrypted, the key is in the environment and never the database, and no endpoint will ever give one back. Nobody on staff can read a stored password, including a super admin.',
  },
  {
    id: 'cour-switches',
    say: 'Above the accounts, one master switch per courier decides whether any of them are used for new parcels. It is not a kill switch. A courier switched off still holds real parcels moving to real customers, so they keep being tracked and can still be cancelled or re-attempted. It stops only new ones.',
  },
  {
    id: 'cour-table',
    say: 'The table shows each account’s name, whose it is, whether it points at the real courier or a sandbox, and which pickup registration it ships from. The default is marked, one per courier and environment, so making something default decides for every client nobody routed elsewhere.',
  },
  {
    id: 'cour-add',
    say: 'To add one, click Add account. Choose the courier, the environment, production or sandbox, and a label. The label is what everybody reads this account by, so name it for what it is.',
  },
  {
    id: 'cour-secret',
    say: 'Credential fields come with their names filled in, and that matters: each courier reads its own, a token for one, an email and password for another. A name typed wrong fails at the first booking, not here. The value is a password box, legible only while you type, sent once and encrypted. Press Add account to save; here the dialog is closed.',
  },
  {
    id: 'cour-retire',
    say: 'To change a token, add a new account, then deactivate the old one with Deactivate. No new parcel books on it, and every parcel it carried keeps its record of it. Add and retire, never edit.',
  },
  {
    id: 'dlv-open',
    say: 'Three things decide whether we can still move a parcel, and all three fail quietly: nothing breaks, parcels stop. They are on the Delhivery page.',
  },
  {
    id: 'dlv-tracking',
    say: 'The first is the poll. Delhivery sends us nothing, so every order reaching delivered gets there because a scheduled job asked. Stop it and nothing errors; the parcels stop updating.',
  },
  {
    id: 'dlv-poll',
    say: 'Run it now is not a refresh button. It is the only thing that moves orders through in transit, out for delivery and delivered, and it acts: it writes tracking events, moves orders and credits money downstream. It needs dispatched parcels and a reason to run. The pointer rests on it.',
  },
  {
    id: 'dlv-lookup',
    say: 'Under it, the safe version of the same question. Type a waybill into AWB numbers and Look up asks the courier what they know. It reads only: no tracking event is written and no order moves. The answer is a line per waybill. A parcel we think we sent that they have never heard of shows up there, which is the first check when an order has stopped.',
  },
  {
    id: 'dlv-connection',
    say: 'Then the connection, which has two halves people conflate. The first is whether calls leave this process at all. The second is separate: whether we are allowed to do anything physical. Manifesting, pickups, cancels and re-attempts all reach the real account, and the sentence tells you to switch it off when you are done.',
  },
  {
    id: 'dlv-pool',
    say: 'Waybills. We fetch them in bulk and keep a pile, because the courier allows only five bulk requests every five minutes. An empty pile stops manifests. The row of counts is what is usable now, what exists but has not settled, what is spoken for, spent, and discarded. The first matters at four in the afternoon.',
  },
  {
    id: 'dlv-budget',
    say: 'The rate budget is per endpoint in five-minute windows, deliberately short of what the courier allows. Bulk waybills is the tight one, and it is tight on purpose: exhaust one and their firewall blocks our egress address, the whole of us, not the endpoint. One runaway loop takes the building off the air.',
  },
  {
    id: 'dlv-reach',
    say: 'Check connection is a live serviceability call that creates nothing, and it answers whether the stored credential still works. Pressing it spends one call; the pointer rests on it.',
  },
  {
    id: 'dlv-pickup',
    say: 'Last, the pickup location. Every shipment sends the warehouse name and the courier matches it exactly, case and spaces included, so one character out fails every booking. They offer no way to list what is registered, so this page cannot show you: the audit log is the only record.',
  },
  {
    id: 'mp-open',
    say: 'When a courier refuses a parcel, the dashboard lights Blocked. Open Manual placement. Every parcel here was confirmed, had stock put aside and a customer told, and then a courier said no. Nothing on this screen moves on its own.',
  },
  {
    id: 'mp-why',
    say: 'Why it is here comes in two parts. Courier refused is our summary; underneath is their own sentence, word for word. An address nobody serves and a consignee they distrust need completely different answers. Rows are ordered by wait, oldest first, because nothing escalates by itself and age is the only thing that gets worse alone.',
  },
  {
    id: 'mp-place',
    say: 'There are two ways out. The first is Place with another courier. Click it: the dialog opens by saying when to use it, once the parcel is really with whoever you booked, because this is what tells the customer it is on its way. It is dangerous for that reason.',
  },
  {
    id: 'mp-fields',
    say: 'Enter their waybill exactly as their label prints it. Nothing checks the shape, because we do not know what a Bluedart or DTDC docket looks like. Enter the courier, which is required, because left blank the client and the customer were told their parcel was with a courier called manual. Service tier is optional. Record AWB and dispatch has no second confirmation. It reports where the parcel went, for instance to the warehouse floor if it was never picked.',
  },
  {
    id: 'mp-unfulfillable',
    say: 'The other way out is Cannot be fulfilled. It releases the stock back, voids the parcel, and the client sees a cancelled order, so it asks for a reason in words they would recognise. Keep the order backs out. Neither is pressed here.',
  },
  {
    id: 'cd-open',
    say: 'One more courier queue exists. Courier decisions holds a parcel waiting on a person to choose a carrier when several were quoted. Price and days are side by side, cheapest and fastest are marked, and past the deadline the system books the cheapest itself and says so loudly. Booking real carriage is the act, so the choice is yours only when this page has rows. It is empty on most days and in this recording.',
  },
  {
    id: 'fd-open',
    say: 'A client whose parcel failed delivery can ask for three things, at wildly different cost. Delivery actions is the register of what was asked. The page says it before you click anything: a re-attempt sends a van, a return ends the sale, and a recall only queues one of our agents to pick up the telephone.',
  },
  {
    id: 'fd-register',
    say: 'One kind of request waits, and it is not ours to answer. A member store asked, and the client whose stock it is chose to see those first. Everything else is behind Show decided requests too: decided, not finished. A client acting on their own parcel is not queued behind an approval, so those were decided the moment they were made.',
  },
  {
    id: 'fd-relay',
    say: 'Each decided row says where the work went. A re-attempt becomes a ticket in the queue a person works from, because no courier accepts a re-attempt from software: somebody opens it on Delhivery’s own desk, marks it sent with their reference, and types the answer back on the ticket. A recall reaches no courier and lands in the call queue. This is a register, not an in-tray; act on the ticket.',
  },
];

const N_SAY = [
  {
    id: 'wal-open',
    say: 'Money. Everything here is a desk where staff decide, and several of the buttons move real cash, so each section says what pressing does. Start with how client money is organised. Open Client wallets. It adds up what Skydrop owes clients and what clients owe us.',
  },
  {
    id: 'wal-owed',
    say: 'The first figure is a liability, payable on demand: any client in credit can ask for it today. The second is the other direction, a wallet that has gone negative. A withdrawal asked for is still in the balance because a request is not a payment, and a top-up claimed is in no balance at all.',
  },
  {
    id: 'wal-row',
    say: 'One row per client, with what they can draw and what is waiting on us. Click Ledger on a row. Balance is what we owe them. Available to withdraw is that, less the floor we hold back and anything already requested, so the two agree only when nothing is pending.',
  },
  {
    id: 'wal-kinds',
    say: 'The ledger is the whole history, newest first, and only money that actually moved is on it. A top-up is money the client sent, matched against our statement. A COD credit is cash the courier collected, and it lands when the courier pays us, not at delivery. Beside it a tax line, extracted from a price that already included the tax. Order charges are what we billed for carrying; a return fee is the round trip; a damage settlement is us paying for goods spoiled in our hands, written in the same transaction as the ticket that closed.',
  },
  {
    id: 'wal-tabs',
    say: 'The other two tabs are what has merely been asked for: top-ups and withdrawal requests. Neither has moved a rupee, which is why the ledger does not know about them. The ledger is append-only: nothing on this screen edits a line. Everything after this page writes to what you have read.',
  },
  {
    id: 'top-open',
    say: 'A top-up is a client telling us they have sent money. Until someone here says otherwise it is only a claim and has moved nothing. Open Wallet top-ups. Accepting is the credit: there is no second step, and the client can draw against it from that moment.',
  },
  {
    id: 'top-row',
    say: 'Read the row first: who claimed, which of our accounts they say they paid into, how much, and what evidence. The label is our filing name; the number under it is what will appear on the statement.',
  },
  {
    id: 'top-statement',
    say: 'Evidence is a bank reference, an uploaded receipt, or both, and one is required. The job is to go to the bank, find that reference, and confirm the amount and date. The claim is a sentence someone typed; the statement is the only fact in this process.',
  },
  {
    id: 'top-accept',
    say: 'Once you have seen it, click Accept. The dialog names the amount and the account, so a click on the wrong row has one more chance to be caught. Accepting is dangerous: it adds the money immediately and is not reversible without an adjusting entry.',
  },
  {
    id: 'top-note',
    say: 'The note is optional and worth writing: it is what you will read in three months when someone asks why this transfer was credited.',
  },
  {
    id: 'top-credit',
    say: 'Credit the wallet would move the claim to Credited, carrying your note, the time and your name. The pointer stays on it.',
  },
  {
    id: 'top-reject',
    say: 'The other way out is Reject, and its reason is mandatory because the client reads it. Write what did not match or what you need. A claim you are unsure about is a claim you reject with a reason and ask again.',
  },
  {
    id: 'wd-open',
    say: 'Withdrawals are clients asking for their money back. Open Withdrawals. The top line is the rule to hold: nothing on this page moves any. A row shows who asked, how much, what they receive in their own currency at the rate when they asked, and how long they have waited.',
  },
  {
    id: 'wd-approve',
    say: 'What they may ask for is the balance less the floor less anything already requested, and a request the balance can no longer cover is rejected for them. Approving is step one of two and is not the payment. Click Approve and the dialog says nothing is paid yet; pay the account on the client’s profile and record the remittance. Cancel here.',
  },
  {
    id: 'rem-open',
    say: 'The payment is recorded on Remittances. Open it. This is where money actually moves: each entry debits the client’s wallet, and the approved request waits at the top with a Pay button.',
  },
  {
    id: 'rem-pay',
    say: 'Click Pay. The form opens with the destination beside it: the client’s own bank, masked, with the full number behind a deliberate reveal, so reading it is an act at the moment of typing a transfer.',
  },
  {
    id: 'rem-destination',
    say: 'Underneath, whether we can send it: every account in that currency with what it holds, so an account that cannot cover the payout is found out here, not halfway through a transfer. The account is chosen in Paid from.',
  },
  {
    id: 'rem-currencies',
    say: 'Two currencies, one payment. The wallet is debited in rupees, from the request, already filled in, while the bank sends taka. The only choice is Bank currency, the currency the money really left in.',
  },
  {
    id: 'rem-rate',
    say: 'The taka figure is not typed. It is the rupees times the rate we quoted the client, and whatever we achieved that day is a different number. That gap is ours either way, recorded as a spread and not taken off their balance.',
  },
  {
    id: 'rem-fee',
    say: 'A bank fee goes in its own field, because it is our cost. Netting it into the payout would charge the client for our bank.',
  },
  {
    id: 'rem-reference',
    say: 'Then the bank’s own reference, the only thing tying this entry to a line on a statement somebody will reconcile later.',
  },
  {
    id: 'rem-record',
    say: 'Record asks once more, then writes the debit. The wallet moves, our account moves and the request closes in one transaction. Of approve, pay the bank, record, only this one moves money, and it cannot be undone from here. The pointer stays on it.',
  },
  {
    id: 'bank-open',
    say: 'Bank detail changes: the shortest screen in this console and the highest stakes, because it decides where a client’s money goes. Open it. Withdrawals keep going to the account on file until somebody approves a change. Only a change needs approving; first-time details write straight through because there is nothing to divert.',
  },
  {
    id: 'bank-diff',
    say: 'The card is a diff: what is on file, what they ask for, and a marker on every field that moved. Read the marks, not the rows. The account number is the one that matters, and the card says when it has not moved.',
  },
  {
    id: 'bank-approve',
    say: 'Someone who gets into a client’s account cannot take their money out; they can only ask us to send it elsewhere, and this screen stops them. So verify outside the software: ring the number you already had, not the one on the request. Click Approve and read the consequence: from then on every withdrawal goes to the new account. Approve because you recognise the account. Reject, with a reason the client reads, when unsure.',
  },
  {
    id: 'set-open',
    say: 'Courier settlements: every rupee the courier pays us, matched to the orders it covers. Open it. The figure at the top is the float: delivered COD no payout covers yet. The customer paid, the courier holds it, and we owe the client meanwhile.',
  },
  {
    id: 'set-record',
    say: 'There is a window rather than a deadline. The courier states five to ten days, and we set it at the top of that; anything past it is listed overdue. When money lands in our account, click Record payout.',
  },
  {
    id: 'set-fields',
    say: 'Choose the Courier account, enter Amount received and the courier’s own Payout reference. The reference is unique per account, so recording the same bank credit twice is a refusal and not a double count.',
  },
  {
    id: 'set-allocate',
    say: 'Then allocate it to the orders it covers by dropping the courier’s export in the box. The payout is one bank credit and the orders are what it was for. Each line snapshots what the order was worth at delivery. Where the courier paid less, the difference is recorded and absorbed: the client is credited what the order was worth, and a short payment is our dispute with the courier.',
  },
  {
    id: 'set-reversal',
    say: 'The other direction has its own fields. A parcel the courier paid on and later brought back means the credit is taken back, and the form makes you name those orders under RTO reversal with Add reversed order.',
  },
  {
    id: 'set-press',
    say: 'Recording credits the client, withholds the tax and writes the bank entry in one transaction, so a credit with no payment behind it cannot exist. It cannot be edited afterwards; correct a mistake with another payout. The pointer stays on it.',
  },
  {
    id: 'wt-open',
    say: 'Wallet transfers move cash by hand, out of a client’s wallet into our bank or ours into theirs, when nothing in the ordinary flow can. It sits behind a permission of its own, so you may not see it in the rail. Open it. The first thing it says is what it is not: an adjustment corrects a figure and moves no cash; this moves the cash.',
  },
  {
    id: 'wt-client',
    say: 'Find the client. Everything after is about one account, and the page shows theirs before it shows a form.',
  },
  {
    id: 'wt-direction',
    say: 'Pick Which way. Debit takes from their wallet into our bank, rupees first and then other currencies at the rate they were credited at; beyond what they hold, their wallet goes negative and they owe us. Credit gives from our bank into theirs. Then the amount.',
  },
  {
    id: 'wt-reason',
    say: 'The Reason is the field that matters. The client reads it on their own wallet history word for word, so write what they will need. The Internal note is staff-only, kept with the audit record, and holds the ticket number and the half of the story they do not need.',
  },
  {
    id: 'wt-preview',
    say: 'Preview before posting. Nothing has moved, and what returns is a sentence you can check against what you meant, and two figures that are not the same thing: their wallet before and after, and the cash we hold for them before and after.',
  },
  {
    id: 'wt-post',
    say: 'Post transfer asks once more and says it moves real money and cannot be undone. A mistake is put right with a transfer the other way, a second entry and not an erasure. Every transfer is listed with its reason and who posted it, because this is the one money path with no document behind it. The pointer stays on the button.',
  },
  {
    id: 'tre-open',
    say: 'Treasury is the bank book: every rupee and taka we hold, in the account it sits in, and one question the page exists to answer: is the money we owe clients still here. Open it.',
  },
  {
    id: 'tre-covered',
    say: 'We owe is the sum of every positive wallet balance. Held for clients is cash in our accounts marked as theirs. A healthy treasury keeps held at or above owed. Covered means we could pay everybody now. Uncovered is not automatically wrong, since COD the courier collected and not yet settled looks the same, but it is the gap you must be able to explain.',
  },
  {
    id: 'tre-accounts',
    say: 'Per account, the split again: ours, held for clients, and the total the bank would show. A balance is the sum of its entries and not a stored figure, so it cannot go stale. Click an account and it says whose money is inside it.',
  },
  {
    id: 'tre-movements',
    say: 'Every movement, newest first, in an append-only table. A correction is a new entry saying who corrected it and by how much. Nothing is ever edited.',
  },
  {
    id: 'tre-move',
    say: 'Moving money between our own accounts has its own form: click Move money. What left one account and what arrived in the other are typed separately, from the two statements, because computing the second from a rate would silently absorb every bank charge.',
  },
  {
    id: 'tre-owner',
    say: 'Owner money is a third thing: click Owner money. What the owner puts in or takes out is equity, never income or expense, so the profit and loss does not read it. Anything else would show the business earning money it was given.',
  },
  {
    id: 'tre-reconcile',
    say: 'Reconcile is the one you will use most. The statement says one figure, the book another, and the difference posts as a new entry against whoever it belongs to. The exception is expensive: money the business already had when the book began is an Opening balance, not a correction. Posted as a correction it reads as profit; a hundred thousand taka of starting cash once spent a day counted as earnings. Type why the book was wrong, since the figure records what changed and this records why. Review adjustment then Post adjustment; here the dialog is closed.',
  },
  {
    id: 'frt-open',
    say: 'Inbound freight is what it cost to get a client’s goods from Bangladesh to India, billed to them. It is the one charge here not about a parcel. Open Freight. A bill is one per arrival, split over the units that actually landed. A unit owes its share when it leaves, so stock on the shelf owes nothing yet.',
  },
  {
    id: 'frt-record',
    say: 'Click Record freight bill. First, Which stop is being billed: on pay-now and pay-later terms the India arrival, which is what a forwarder invoices; on pay-in-advance the Bangladesh count. Then Agreed in, the currency of the invoice. A Dhaka forwarder quotes taka, so type the figures exactly as printed; the bill converts to rupees at the rate in force the moment you record.',
  },
  {
    id: 'frt-lines',
    say: 'Per line, Basis: per kilo or per piece, as the forwarder priced it, since a wrong basis is wrong by the weight of the carton. Then the rate and the chargeable weight. A product with no weight recorded cannot take a weight share; fix that in the catalogue instead of guessing.',
  },
  {
    id: 'frt-mode',
    say: 'Mode decides whether the wallet moves now. Pay now debits it in full on record. Pay later leaves a receivable collected a unit at a time as stock sells. Choosing one pins the consignment to it. Record bill writes it; here the dialog closes.',
  },
  {
    id: 'frt-settle',
    say: 'On a bill, Settle charges whatever is outstanding in one go instead of waiting for the stock to sell. The dialog says the part that matters: the ledger entry is permanent.',
  },
  {
    id: 'frt-void',
    say: 'Waive and Void are different acts and the screen keeps them apart. A waived bill was correct and we chose not to collect it. Void says the opposite: this bill should never have existed. It withdraws the bill, credits back what was charged, and frees the arrival to be billed again. The bill is kept under its own status, because the ledger behind it can only be added to.',
  },
  {
    id: 'pnl-open',
    say: 'Profit and loss: what each part of the business earns against what it costs, and, more usefully, how much of that we can actually see. Open it. Three figures: the margin from four sources, what it costs to exist, and the net. Read the label under the net before the net.',
  },
  {
    id: 'pnl-honest',
    say: 'A cost nobody recorded is reported as missing, never zero. Zero would report all that revenue as profit, and the page says plainly that nothing is guessed to fill the gap. Each line carries a coverage fraction: records with a real cost out of how many there are.',
  },
  {
    id: 'pnl-delivery',
    say: 'Read Delivery carefully. It names every reason a parcel has no cost yet: the courier has not billed us, a manual courier has no ledger, or it never got a waybill. A charge worked out but never debited is a quote, not revenue, so it is named and left out. Parcels still moving are on no line, since an order counts when its fate is known.',
  },
  {
    id: 'pnl-drill',
    say: 'Open any line to see what it is made of, then every record behind it. The total above and the rows below are the same computation, so a figure you cannot explain is a figure you can click. A return whose cost was never recorded makes that margin flattering, and the line says so.',
  },
  {
    id: 'pnl-costsync',
    say: 'Why is so much uncovered? Open Courier cost sync. Every night we sign in to the courier’s own portal and record what each parcel really cost. It fails by going quiet: the figures stop moving, and nobody notices for weeks. Coverage is stated as a fraction here too, and an unread charge is uncovered, not free.',
  },
  {
    id: 'pnl-runs',
    say: 'Check the run history first. It is blunt about not knowing: either it has never run, or never finished far enough to say so. Both look identical from the margin. So read the coverage before the margin.',
  },
  {
    id: 'pnl-month',
    say: 'Closing a month lives under Carry-forward, and it is the most permanent act in finance. It freezes the month’s figures for good. A closed month is never reopened; anything that changes it afterwards is carried into whichever month is open when we find it. This recording does not close one: a month filmed here would be a synthetic one, and the arithmetic matters more than the button.',
  },
];

const rowWithButton = (page, name) =>
  page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name }) })
    .first();

const WALLET_CLIENT = /Rangpur Silk House/;

const M_RUN = [
  {
    id: 'cour-open',
    run: async (ctx) => {
      await go(ctx, '/courier-accounts');
      await ctx.stage.dwellOn(ctx.page.locator('.sk-ph__title').first(), 2800);
    },
  },
  { id: 'cour-several', run: (ctx) => show(ctx, ctx.page.locator('.sk-ph__subtitle'), 3800) },
  {
    id: 'cour-credentials',
    run: (ctx) => show(ctx, ctx.page.getByText(/never returned by any endpoint/i), 4000),
  },
  { id: 'cour-switches', run: (ctx) => show(ctx, ctx.page.locator('.ca-switch'), 4600) },
  {
    id: 'cour-table',
    run: (ctx) => show(ctx, ctx.page.locator('.sk-tbody .sk-tr', { hasText: 'Default' }), 4200),
  },
  {
    id: 'cour-add',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Add account' }));
      await ctx.stage.point(ctx.page.locator('#ca-env'), { settle: 400 });
      await ctx.page.locator('#ca-env').selectOption('SANDBOX');
      await ctx.stage.typeIn(ctx.page.locator('#ca-label'), 'Training sandbox account');
      await ctx.stage.dwellOn(ctx.page.locator('#ca-label'), 1600);
    },
  },
  {
    id: 'cour-secret',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await show(ctx, dialog.getByLabel(/^Credential field name$/), 2400);
      await show(ctx, dialog.getByLabel(/^Credential value$/), 3200);
    },
  },
  {
    id: 'cour-retire',
    run: async (ctx) => {
      await shut(ctx);
      await show(ctx, ctx.page.getByRole('button', { name: 'Deactivate' }), 3000);
    },
  },
  {
    id: 'dlv-open',
    run: async (ctx) => {
      await go(
        ctx,
        '/delhivery',
        ctx.page.getByRole('heading', { name: 'Delhivery', exact: true }),
      );
      await ctx.stage.dwellOn(ctx.page.locator('.sk-ph__subtitle').first(), 3000);
    },
  },
  {
    id: 'dlv-tracking',
    run: (ctx) => show(ctx, ctx.page.getByText(/sends us no webhooks/i), 3800),
  },
  {
    id: 'dlv-poll',
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: /Run (it )?now/i }), 4600),
  },
  { id: 'dlv-lookup', run: (ctx) => show(ctx, ctx.page.getByLabel(/^AWB numbers$/), 5600) },
  { id: 'dlv-connection', run: (ctx) => show(ctx, ctx.page.locator('.af-card').nth(2), 5000) },
  { id: 'dlv-pool', run: (ctx) => show(ctx, ctx.page.locator('.af-kpis'), 5400) },
  {
    id: 'dlv-budget',
    run: (ctx) =>
      show(ctx, ctx.page.locator('.sk-tbody .sk-tr', { hasText: 'waybill bulk' }), 5400),
  },
  {
    id: 'dlv-reach',
    run: (ctx) =>
      show(
        ctx,
        ctx.page
          .locator('.af-card')
          .filter({ hasText: 'Reachability' })
          .getByRole('button', { name: 'Check connection' }),
        3000,
      ),
  },
  {
    id: 'dlv-pickup',
    run: (ctx) =>
      show(ctx, ctx.page.locator('.af-card').filter({ hasText: 'Pickup location' }), 5000),
  },
  {
    id: 'mp-open',
    run: async (ctx) => {
      await go(ctx, '/manual-placement', ctx.page.locator('.sk-tbody .sk-tr').first());
      await show(ctx, ctx.page.locator('.sk-ph__subtitle'), 3600);
    },
  },
  { id: 'mp-why', run: (ctx) => show(ctx, ctx.page.locator('.sk-tbody .sk-tr').first(), 5000) },
  {
    id: 'mp-place',
    run: async (ctx) => {
      await openDialog(
        ctx,
        ctx.page
          .locator('.sk-tbody .sk-tr')
          .first()
          .getByRole('button', { name: 'Place with another courier' }),
      );
      await show(ctx, ctx.page.getByRole('dialog').locator('.oo-p'), 3600);
    },
  },
  {
    id: 'mp-fields',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await ctx.stage.dwellOn(dialog.getByLabel(/^AWB number/).first(), 2200);
      await ctx.stage.dwellOn(dialog.getByLabel(/^Courier/).first(), 2400);
      await ctx.stage.dwellOn(dialog.getByLabel(/^Service type/).first(), 1800);
      await show(
        ctx,
        foot(ctx.page).getByRole('button', { name: /Record AWB and dispatch/ }),
        3200,
      );
    },
  },
  {
    id: 'mp-unfulfillable',
    run: async (ctx) => {
      await shut(ctx);
      await show(
        ctx,
        ctx.page
          .locator('.sk-tbody .sk-tr')
          .first()
          .getByRole('button', { name: 'Cannot be fulfilled' }),
        4000,
      );
    },
  },
  {
    id: 'cd-open',
    run: async (ctx) => {
      await go(ctx, '/courier-decisions');
      await ctx.stage.dwellOn(h1(ctx.page), 5800);
    },
  },
  {
    id: 'fd-open',
    run: async (ctx) => {
      await go(ctx, '/delivery-actions');
      await show(ctx, ctx.page.getByText(/Approving a re-attempt sends a van/), 4600);
    },
  },
  {
    id: 'fd-register',
    run: async (ctx) => {
      await show(
        ctx,
        ctx.page.getByRole('row').filter({ hasText: 'Waiting on client staff' }),
        3000,
      );
      await ctx.stage.clickIt(
        ctx.page.getByRole('checkbox', { name: /Show decided requests too/ }),
        {
          after: 1400,
        },
      );
      await show(ctx, ctx.page.getByText(/^All requests$/), 3600);
    },
  },
  {
    id: 'fd-relay',
    run: async (ctx) => {
      await show(ctx, ctx.page.getByRole('row').filter({ hasText: 'Re-attempt delivery' }), 5000);
      await show(ctx, ctx.page.getByRole('row').filter({ hasText: 'Return to us' }), 3200);
    },
  },
];

const N_RUN = [
  {
    id: 'wal-open',
    run: async (ctx) => {
      await go(
        ctx,
        '/seller-wallets',
        ctx.page.getByRole('heading', { name: 'Client wallets', exact: true }),
      );
      await show(ctx, ctx.page.locator('.sk-kpis, .mk-kpis'), 3400);
    },
  },
  { id: 'wal-owed', run: (ctx) => show(ctx, ctx.page.locator('.sk-kpis, .mk-kpis'), 5000) },
  {
    id: 'wal-row',
    run: async ({ page, stage }) => {
      const table = page.locator('table').filter({ hasText: 'Available balance' }).first();
      await stage.dwellOn(table, 2400);
      await stage.clickIt(table.getByRole('link', { name: /Ledger/ }).first(), { after: 1600 });
      await page.waitForURL(/\/seller-wallets\/.+/, { timeout: 30_000 });
      await quiet(page);
      await withRetry(page, page.locator('table').filter({ hasText: 'Balance after' }).first());
      await stage.dwellOn(page.locator('.mk-dl, .sk-kpis, .mk-kpis').first(), 3400);
    },
  },
  {
    id: 'wal-kinds',
    run: (ctx) => show(ctx, ctx.page.locator('table').filter({ hasText: 'Balance after' }), 8000),
  },
  {
    id: 'wal-tabs',
    run: async ({ page, stage }) => {
      await stage.clickIt(page.getByRole('tab', { name: 'Top-ups' }).first(), { after: 1600 });
      await stage.dwellOn(page.locator('table').first(), 2400);
      await stage.clickIt(page.getByRole('tab', { name: 'Withdrawal requests' }).first(), {
        after: 1600,
      });
      await stage.dwellOn(page.locator('table').first(), 2400);
      await stage.clickIt(page.getByRole('tab', { name: 'Ledger' }).first(), { after: 1000 });
    },
  },
  {
    id: 'top-open',
    run: async (ctx) => {
      await go(
        ctx,
        '/topups',
        ctx.page.getByRole('heading', { name: 'Wallet top-ups', exact: true }),
      );
      await show(ctx, ctx.page.getByText(/check it against the statement first/i), 3600);
    },
  },
  { id: 'top-row', run: (ctx) => show(ctx, ctx.page.locator('table'), 4400) },
  {
    id: 'top-statement',
    run: (ctx) => show(ctx, rowWithButton(ctx.page, 'Accept').locator('td').nth(4), 4800),
  },
  {
    id: 'top-accept',
    run: async (ctx) => {
      await openDialog(
        ctx,
        rowWithButton(ctx.page, 'Accept').getByRole('button', { name: 'Accept' }),
      );
      await show(ctx, ctx.page.getByRole('dialog').locator('.mk-subject'), 2600);
      await show(
        ctx,
        ctx.page.getByRole('dialog').getByText(/not reversible without an adjusting entry/i),
        3400,
      );
    },
  },
  {
    id: 'top-note',
    run: async (ctx) => {
      await ctx.stage.typeIn(
        ctx.page.getByRole('dialog').getByRole('textbox').first(),
        'Seen on the HDFC statement, same reference.',
      );
    },
  },
  {
    id: 'top-credit',
    run: (ctx) =>
      show(
        ctx,
        ctx.page.getByRole('dialog').getByRole('button', { name: /Credit the wallet/ }),
        3000,
      ),
  },
  {
    id: 'top-reject',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(
        ctx,
        rowWithButton(ctx.page, 'Reject').getByRole('button', { name: 'Reject' }),
      );
      await show(ctx, ctx.page.getByRole('dialog').getByText(/the client sees this reason/i), 3800);
    },
  },
  {
    id: 'wd-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(
        ctx,
        '/withdrawals',
        ctx.page.getByRole('heading', { name: 'Withdrawals', exact: true }),
      );
      await show(ctx, ctx.page.getByText(/Nothing here moves money/i), 3200);
      await show(ctx, ctx.page.locator('table'), 3000);
    },
  },
  {
    id: 'wd-approve',
    run: async (ctx) => {
      await openDialog(
        ctx,
        rowWithButton(ctx.page, 'Approve').getByRole('button', { name: 'Approve' }),
      );
      await show(ctx, ctx.page.getByRole('dialog').getByText(/Nothing is paid yet/i), 4600);
    },
  },
  {
    id: 'rem-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/remittances');
      await show(ctx, ctx.page.getByText(/debits the client.s wallet/i), 3600);
    },
  },
  {
    id: 'rem-pay',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: /^Pay$/ }), 1600);
      await show(ctx, ctx.page.getByRole('dialog').locator('.mk-panel .mk-panel__part'), 4400);
    },
  },
  {
    id: 'rem-destination',
    run: (ctx) => show(ctx, ctx.page.getByRole('dialog').getByLabel(/^Paid from/), 4400),
  },
  {
    id: 'rem-currencies',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await dialog.getByLabel(/Bank currency/).selectOption('BDT');
      await show(ctx, dialog.getByLabel(/^Source amount/), 3000);
    },
  },
  {
    id: 'rem-rate',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await show(ctx, dialog.getByLabel(/^FX rate/), 2600);
      await show(ctx, dialog.getByLabel(/^Destination amount/), 3000);
    },
  },
  {
    id: 'rem-fee',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await ctx.stage.typeIn(dialog.getByLabel(/^Bank fee/).first(), '250', { after: 600 });
      await ctx.stage.dwellOn(dialog.getByLabel(/^Bank fee/).first(), 1800);
    },
  },
  {
    id: 'rem-reference',
    run: async (ctx) => {
      await ctx.stage.typeIn(
        ctx.page
          .getByRole('dialog')
          .getByLabel(/^Bank reference/)
          .first(),
        'TRF-2026-10-01-88412',
      );
    },
  },
  {
    id: 'rem-record',
    run: (ctx) => show(ctx, foot(ctx.page).getByRole('button', { name: /^Record/ }), 4400),
  },
  {
    id: 'bank-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/bank-changes', ctx.page.locator('.mk-card').first());
      await show(ctx, ctx.page.getByText(/until you approve one/i), 4800);
    },
  },
  { id: 'bank-diff', run: (ctx) => show(ctx, ctx.page.locator('table').first(), 5000) },
  {
    id: 'bank-approve',
    run: async (ctx) => {
      await show(ctx, ctx.page.locator('.mk-card').first(), 3400);
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Approve' }));
      await show(ctx, ctx.page.getByRole('dialog').locator('.mk-subject'), 3400);
      await show(
        ctx,
        ctx.page.getByRole('dialog').getByText(/another change request and another approval/i),
        3800,
      );
    },
  },
  {
    id: 'set-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(
        ctx,
        '/settlements',
        ctx.page.getByRole('heading', { name: 'Courier settlements', exact: true }),
      );
      await show(ctx, ctx.page.getByText(/float we are carrying/i), 3600);
    },
  },
  {
    id: 'set-record',
    run: async (ctx) => {
      await show(ctx, ctx.page.getByText(/Delhivery states 5–10 days/i), 3600);
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Record payout' }));
    },
  },
  {
    id: 'set-fields',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await ctx.stage.dwellOn(dialog.getByLabel(/^Courier account/).first(), 2000);
      await ctx.stage.typeIn(dialog.getByLabel(/^Amount received/).first(), '84250');
      await ctx.stage.typeIn(
        dialog.getByLabel(/^Payout reference/).first(),
        'DLV-PAYOUT-TRAINING-01',
      );
    },
  },
  {
    id: 'set-allocate',
    run: (ctx) => show(ctx, ctx.page.getByRole('dialog').locator('.mk-drop'), 5600),
  },
  {
    id: 'set-reversal',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await show(ctx, dialog.getByLabel(/^RTO reversal/).first(), 2800);
      await show(ctx, dialog.getByRole('button', { name: 'Add reversed order' }).first(), 2400);
    },
  },
  {
    id: 'set-press',
    run: (ctx) => show(ctx, foot(ctx.page).getByRole('button', { name: /^Record/ }), 4400),
  },
  {
    id: 'wt-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(
        ctx,
        '/wallet-transfers',
        ctx.page.getByRole('heading', { name: 'Wallet transfers', exact: true }),
      );
      await show(ctx, ctx.page.getByText(/Not a correction/i), 4800);
    },
  },
  {
    id: 'wt-client',
    run: async ({ page, stage }) => {
      await stage.clickIt(page.getByRole('button', { name: WALLET_CLIENT }).first(), {
        after: 1600,
      });
      await page
        .getByLabel(/^Which way/)
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await stage.dwellOn(page.locator('.mk-card').first(), 2800);
    },
  },
  {
    id: 'wt-direction',
    run: async (ctx) => {
      await ctx.page
        .getByLabel(/^Which way/)
        .first()
        .selectOption('DEBIT');
      await show(
        ctx,
        ctx.page.getByText(/their wallet goes negative and they owe it to us/i),
        3600,
      );
      await ctx.stage.typeIn(ctx.page.getByLabel(/^Amount/).first(), '1200', { after: 600 });
    },
  },
  {
    id: 'wt-reason',
    run: async ({ page, stage }) => {
      await stage.typeIn(
        page.locator('#wt-reason'),
        'Refund of a duplicate top-up credited on 28 September.',
      );
      await stage.typeIn(
        page.locator('#wt-note'),
        'Ticket 4471. Finance confirmed the duplicate on the statement.',
      );
    },
  },
  {
    id: 'wt-preview',
    run: (ctx) =>
      show(ctx, ctx.page.getByRole('button', { name: /^Preview|Worked out|Working it out/ }), 4400),
  },
  {
    id: 'wt-post',
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: 'Post transfer' }), 5200),
  },
  {
    id: 'tre-open',
    run: async (ctx) => {
      await go(ctx, '/treasury', ctx.page.getByRole('heading', { name: 'Treasury', exact: true }));
      await show(ctx, ctx.page.getByText(/whether what we owe clients is covered/i), 3600);
    },
  },
  {
    id: 'tre-covered',
    run: (ctx) =>
      show(
        ctx,
        ctx.page.getByText(/covered by what we hold|We owe clients more than we are holding/i),
        5600,
      ),
  },
  {
    id: 'tre-accounts',
    run: async ({ page, stage }) => {
      await stage.dwellOn(page.getByText(/A balance is the sum of its entries/i).first(), 3000);
      await stage.clickIt(page.locator('button.tr-account').first(), { after: 1400 });
      await stage.dwellOn(page.locator('.tr-holders').first(), 3200);
    },
  },
  {
    id: 'tre-movements',
    run: (ctx) =>
      show(ctx, ctx.page.getByText(/A correction is a new entry saying who corrected it/i), 4000),
  },
  {
    id: 'tre-move',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Move money' }));
      await ctx.stage.dwellOn(ctx.page.getByRole('dialog').getByLabel(/^Left/).first(), 2200);
      await ctx.stage.dwellOn(
        ctx.page
          .getByRole('dialog')
          .getByLabel(/^Arrived/)
          .first(),
        2800,
      );
    },
  },
  {
    id: 'tre-owner',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(
        ctx,
        rowWithButton(ctx.page, 'Owner money').getByRole('button', { name: 'Owner money' }),
      );
      await ctx.stage.dwellOn(
        ctx.page
          .getByRole('dialog')
          .getByLabel(/^Which way/)
          .first(),
        2200,
      );
      await show(
        ctx,
        ctx.page.getByRole('dialog').getByText(/our own money in this account/i),
        3200,
      );
    },
  },
  {
    id: 'tre-reconcile',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(
        ctx,
        rowWithButton(ctx.page, 'Reconcile').getByRole('button', { name: 'Reconcile' }),
      );
      const dialog = ctx.page.getByRole('dialog');
      await ctx.stage.dwellOn(dialog.getByLabel(/^Whose balance/).first(), 2200);
      await ctx.stage.typeIn(dialog.getByLabel(/^What the statement says/).first(), '267500');
      await show(ctx, dialog.getByText(/Money the business already had/i), 3800);
      await ctx.stage.typeIn(
        dialog.getByLabel(/^Why the book was wrong/).first(),
        'Bank charge posted on the statement that the book did not have.',
      );
    },
  },
  {
    id: 'frt-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(
        ctx,
        '/freight',
        ctx.page.getByRole('heading', { name: 'Inbound freight', exact: true }),
      );
      await show(ctx, ctx.page.getByText(/split over the units that actually landed/i), 4400);
    },
  },
  {
    id: 'frt-record',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Record freight bill' }));
      const dialog = ctx.page.getByRole('dialog');
      const stop = dialog.getByLabel(/^Which stop is being billed/).first();
      await ctx.stage.point(stop, { settle: 400 });
      await ctx.stage.dwellOn(stop, 1800);
      const agreed = dialog.getByLabel(/^Agreed in/).first();
      await agreed.selectOption('BDT');
      await ctx.stage.dwellOn(agreed, 2400);
    },
  },
  {
    id: 'frt-lines',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await dialog
        .getByLabel(/^Basis for /)
        .first()
        .selectOption('PER_KG');
      await ctx.stage.typeIn(dialog.getByLabel(/^Rate for /).first(), '300');
      await ctx.stage.typeIn(dialog.getByLabel(/^Chargeable weight for /).first(), '12');
      await show(ctx, dialog.getByLabel(/^Chargeable weight for /).first(), 2000);
    },
  },
  {
    id: 'frt-mode',
    run: async (ctx) => {
      const mode = ctx.page.getByRole('dialog').getByLabel(/^Mode/).first();
      await mode.selectOption('PAY_LATER');
      await show(ctx, mode, 3000);
      await show(ctx, foot(ctx.page).getByRole('button', { name: /Record bill/ }), 2400);
    },
  },
  {
    id: 'frt-settle',
    run: async (ctx) => {
      await shut(ctx);
      const row = rowWithButton(ctx.page, 'Settle');
      await openDialog(ctx, row.getByRole('button', { name: 'Settle' }));
      await show(ctx, ctx.page.getByRole('dialog').getByText(/ledger entry is permanent/i), 3600);
    },
  },
  {
    id: 'frt-void',
    run: async (ctx) => {
      await shut(ctx);
      await show(
        ctx,
        rowWithButton(ctx.page, 'Waive').getByRole('button', { name: 'Waive' }),
        2200,
      );
      await openDialog(ctx, rowWithButton(ctx.page, 'Void').getByRole('button', { name: 'Void' }));
      await show(ctx, ctx.page.getByRole('dialog').getByText(/Not the same as a waiver/i), 4400);
    },
  },
  {
    id: 'pnl-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/pnl', ctx.page.getByRole('heading', { name: 'Profit & loss', exact: true }));
      await show(ctx, ctx.page.locator('.mo-kpis'), 4800);
    },
  },
  {
    id: 'pnl-honest',
    run: (ctx) => show(ctx, ctx.page.getByText(/nothing here is guessed to fill the gap/i), 5000),
  },
  {
    id: 'pnl-delivery',
    run: (ctx) =>
      show(
        ctx,
        ctx.page
          .locator('.sk-acc__item')
          .filter({ has: ctx.page.locator('.pl-line__label', { hasText: /^India delivery$/ }) }),
        6200,
      ),
  },
  {
    id: 'pnl-drill',
    run: async (ctx) => {
      const line = ctx.page
        .locator('.sk-acc__item')
        .filter({ has: ctx.page.locator('.pl-line__label', { hasText: /^India delivery$/ }) })
        .first();
      await ctx.stage.clickIt(line.locator('.sk-acc__trigger').first(), { after: 1600 });
      await show(ctx, ctx.page.locator('.pl-rows'), 4400);
    },
  },
  {
    id: 'pnl-costsync',
    run: async (ctx) => {
      await go(ctx, '/cost-sync');
      await show(ctx, ctx.page.getByText(/the way this fails is silence/i), 5400);
    },
  },
  {
    id: 'pnl-runs',
    run: (ctx) =>
      show(ctx, ctx.page.getByText(/it has never finished far enough to say so/i), 4200),
  },
  {
    id: 'pnl-month',
    run: async (ctx) => {
      await go(ctx, '/pnl/carry-forward');
      await ctx.stage.dwellOn(h1(ctx.page), 6400);
    },
  },
];

/* ──────────── O · clients and platform, P · the five ─────────────── */

const O_SAY = [
  {
    id: 'lead-open',
    say: 'Clients and the platform. Start at the top of the funnel. Open Invite requests. Everyone here filled in the form on our landing page and asked to be let in, so this is a queue and not a report. The stages across the top are new, contacted, qualified, converted, declined, and one for the rubbish, since a public form gets some.',
  },
  {
    id: 'lead-open-one',
    say: 'The column that should decide your day is how long somebody has waited for an answer, counted from the moment they asked. Click a row. The drawer holds everything the form collected, enough to tell whether this is a business we can serve before anyone picks up a phone: how they ship, roughly how much a month, what they sell, and their own words.',
  },
  {
    id: 'lead-status',
    say: 'Move them along as you work them, with the Status list. The stage is what the tabs filter on, so a lead you have spoken to and left on new is a lead someone else will ring tomorrow. The notes are ours: they never reach the person, so write what the next one of us needs, what they said, what you promised, what put you off.',
  },
  {
    id: 'lead-invite',
    say: 'Save leaves the tab you found it in, so the queue empties as you work it. When they are worth having, Send invite sends a registration link to the address on the form. We never make the account ourselves. The link is shown once: only a hash is stored, so nobody can look it up later, and resending issues a new link and kills the old one.',
  },
  {
    id: 'lead-pending',
    say: 'Every invitation out there is on the Clients page, folded under Pending invitations. From there you can send again, which replaces the link, or delete it. When they register, they arrive in the list below waiting for approval: invited is not in, and the account can do nothing yet.',
  },
  {
    id: 'cli-open',
    say: 'Clients. Search by any part of a name, email or phone, and open one. What opens is everything we know about one account, and the three levers we have over it.',
  },
  {
    id: 'cli-correct',
    say: 'First the name and the phone number, which are what we approved them as. A client cannot change either from their own portal; a staff correction is the only route. It sits behind Correct these details on purpose: it is a correction, not routine editing.',
  },
  {
    id: 'cli-correct-reason',
    say: 'The dialog opens filled with what is there, so you edit rather than retype. The reason is not optional: it is the single record of why an approved identity changed, and whoever reads it next year has nothing else. Apply correction would write it; here it closes.',
  },
  {
    id: 'cli-hold',
    say: 'The lever this page mostly exists for is the Account hold. It stops a client who owes us money from starting new work, and it takes itself off when their balance clears. Click Place a hold.',
  },
  {
    id: 'cli-hold-scope',
    say: 'Four things to stop them from, and each is an entry point: block those and nothing new begins, while every parcel already moving carries on. The three underneath are different. They do not protect the money, because a parcel already with the courier still has to be delivered, tracked and returned. Tick one and the dialog warns that it affects parcels in transit and is recorded as such. Reach for the first four.',
  },
  {
    id: 'cli-hold-clear',
    say: 'Then Lifts automatically at balance, usually zero: applied by a person, cleared by money. And the Reason, which the client reads on every page of their portal. Write it as you would say it to them, since a hold nobody understands is one they telephone about instead of fixing. Lift now takes it off by hand when you agree a date. Place hold is not pressed.',
  },
  {
    id: 'cli-suspend',
    say: 'Suspend account is the blunt lever. Click it and read the consequence: they lose the portal immediately, while their orders and parcels carry on under us. It stops them talking to us; it does not stop the goods. Give a reason and press Suspend; Reapprove account reverses it. A hold is the only one of these that undoes itself, so reach for it first.',
  },
  {
    id: 'cli-settings',
    say: 'Further down the same page, Settings for this client: every setting that can be agreed separately. Three columns, and the third is the one to read: what is in effect, the system default, and whether this client has been moved off it. Each row leads with what it does in words; the key beneath is for searching a log.',
  },
  {
    id: 'cli-override',
    say: 'Click Override on a row. The panel repeats the value and where it came from, so you change something you have read. Enter the agreed figure and a note, which is the only thing that will explain an odd price to whoever inherits the account. Set override saves it; Reset later removes the override, which is the act, there being no blank to type.',
  },
  {
    id: 'cli-currency',
    say: 'The row underneath is the trap. The fee and the currency it was agreed in are two separate settings. Move one without the other and you have changed the price by the exchange rate.',
  },
  {
    id: 'cli-couriers',
    say: 'The second half of the page is the Courier accounts this client’s parcels use. No links is the ordinary state and means the default. Click Add link, choose the account and a weight. A weight is a share, not a parcel count: two links at a hundred split the client evenly. Unlinking hands a share back, and unlinking the last returns them to the default. Parcels already booked keep the account that carried them.',
  },
  {
    id: 'cli-credit',
    say: 'One switch is deliberately not in that list: credit after confirmation, which lets a member store be paid days after a phone call and before the customer has paid. It has an endpoint of its own and the ordinary override writer refuses it by name.',
  },
  {
    id: 'sys-open',
    say: 'System settings change how the whole platform behaves, one row at a time, with every edit recorded with its before and after. Open Settings. They are grouped by what a setting decides: charges, cash on delivery, the warehouse, failed deliveries, and so on.',
  },
  {
    id: 'sys-row',
    say: 'A row leads with what it does in plain words, then what kind of value it is, which decides the editor, then the value now, with the raw key beneath for searching a log. The small i is the part worth knowing: what the setting decides, and an example at a given value, so you need not read the code. Some values look like secrets and are not: they are the name of the environment variable, because a secret in the database is a secret in every backup.',
  },
  {
    id: 'sys-edit',
    say: 'Click Edit. A yes-or-no setting is a list and not a tick box: each answer says what it does and gives an example. A number gets a number box, checked against the server’s bounds on Save. Some rows cannot be edited here at all, because they have a route with stricter guardrails. Cancel closes it.',
  },
  {
    id: 'sys-live',
    say: 'Saved settings are already true: there is no deploy between typing and taking effect, which is exactly why the page exists and why it is dangerous. Putting a value back is the same two clicks, but parcels that moved while it was wrong are not coming back. Read the i, change one row at a time.',
  },
  {
    id: 'stf-open',
    say: 'Staff are the people with a login to this console. Open Staff. You do three things to them: let someone in, change what they can do, and take the login away.',
  },
  {
    id: 'stf-invite',
    say: 'Click Invite staff. An invitation is an email address and the roles they will hold, as many as the job really is. The list is every role on the console, including the ones your team built. Create invitation then shows the link once. We keep a hash and nothing else, so no screen can show it again: copy it and send it yourselves. Until it is used it sits under pending, where re-issuing kills the old link and revoking discards it.',
  },
  {
    id: 'stf-role',
    say: 'To change what someone may do, click Change roles on their row. It replaces the whole set. Nothing has moved: the panel lists what they gain and lose, and until the set differs there is nothing to save. Save roles writes it, and it applies on their next request, not their next sign-in. What they can do is every role they hold, added together.',
  },
  {
    id: 'stf-deactivate',
    say: 'To take the login away, click Deactivate. The account is deactivated and they can no longer sign in. Nothing they did is touched, and the row stays, marked and with no actions, because a person who left is still the answer to who approved that client in March.',
  },
  {
    id: 'bc-open',
    say: 'The other half of that job is telling everybody something. Open Broadcast. The subtitle is the whole design: a broadcast cannot be recalled, so the count comes first.',
  },
  {
    id: 'bc-audience',
    say: 'The audience is a list of selectors resolved when you send, not a mailing list. Choose A staff role and enter its key. A role can be renamed, but a permission is a durable fact about what somebody does, so prefer the permission selectors.',
  },
  {
    id: 'bc-message',
    say: 'Choose the channels: in-app or email. In-app is the default because it arrives where the work is. Then a title and the message itself.',
  },
  {
    id: 'bc-count',
    say: 'You cannot reach Send without asking how many people that is. How many is that? answers with the number and the first few names, so it is checkable rather than merely alarming.',
  },
  {
    id: 'bc-send',
    say: 'Then the button names the figure, Send to that many, and the figure you saw travels with the send. If the population moved while you read it, the server refuses rather than sending to a different room than you agreed. What is stored is the audience you chose, not the names it landed on, because a month later the question is who you meant to tell. Never press Send on a number you have not read.',
  },
];

const P_SAY = [
  {
    id: 'god-open',
    say: 'The five acts that cannot be taken back. First, God mode. This order is paused: the call centre rang, nobody answered, and rather than reject it we asked the client what to do. The client has since rung us: the customer answered and wants it. No button does that. Open Orders, find it with the status Awaiting client decision, and click the order number.',
  },
  {
    id: 'god-stuck',
    say: 'Open the Actions section. The rules from here allow calling again, letting it go, or calling it off, and nothing else. God mode is for the state the rules do not offer.',
  },
  {
    id: 'god-panel',
    say: 'The god-mode panel says what it is. It bypasses the state machine and the edit rules, it is audited as critical, and it marks the order with a flag that is set once and never cleared. It needs the permission that super admins hold and few others.',
  },
  {
    id: 'god-dialog',
    say: 'Click Force-mutate…. The dialog goes red, names the rule it is breaking, and opens with a warning written by whoever built it. Everything worth reading sits above the button.',
  },
  {
    id: 'god-consequences',
    say: 'This is the half people miss. A forced status has the same consequences as a real one, except stock: emails to the customer and the client, webhooks, invoices, delivery-time billing, the call queue. A forced confirmation also gets a shipment and a waybill, which costs money the moment it is booked, and a waybill already issued is never cancelled with the courier by anything here.',
  },
  {
    id: 'god-fields',
    say: 'The fields are a whitelist, not free text: a fixed list, grouped, each printing what it holds today. Ticking a field is what sends it. Anything left alone is not touched. This is the Payment and value group, where getting it wrong costs money.',
  },
  {
    id: 'god-status',
    say: 'The status sits behind a checkbox of its own, which says plainly what it does and where this order stands now. Tick it and pick the target. Every status the system has is in the list, reachable or not. Here, Confirmed.',
  },
  {
    id: 'god-reason',
    say: 'Then the reason: thirty characters at least. The counter shows you have not finished, it is not grading you. Write it for the person reading this order next year.',
  },
  {
    id: 'god-ack',
    say: 'The acknowledgement is worth reading, not ticking. Stock is attempted and not enforced. Moving an order away from confirmed leaves its reservations held. And the flag is permanent.',
  },
  {
    id: 'god-press',
    say: 'Continue opens a second screen that restates exactly what will happen, and you type the words FORCE-MUTATE by hand. That is not a safety net; it is a pause long enough to change your mind. Then Force-mutate this order is one press with no undo: the order’s history now has an edge the rules forbid, under your name, permanently. It reports where the order landed, which fields applied, the flag now true, and a row per line it tried to reserve. The pointer stops on Continue.',
  },
  {
    id: 'god-release',
    say: 'Beside it are the two halves of one question, this order’s claim on the shelves. Release reservations gives back everything it holds, and is the only thing that will after you force an order away from confirmed. Restore re-reserves an order that lost its claim. Click Release reservations… and read the consequence; the order wears the override from now on as a badge, a critical audit row and an entry in its own history.',
  },
  {
    id: 'live-find',
    say: 'Second, live courier writes. A parcel the driver could not deliver is still with the courier, and everything we might ask them to do about it lives in one panel on the order. Open Orders, filter by Delivery failed, and open one.',
  },
  {
    id: 'live-closed',
    say: 'The panel is shut: Courier actions and costs. Opening it spends live calls to Delhivery, so a person checking a status is not made to pay for a lane being priced. Opening it is the consent to spend them. It is not opened in this recording.',
  },
  {
    id: 'live-writes',
    say: 'Inside are two reads and four writes. The reads: what they expect the parcel to take, what they will charge us, which zone; and proof of delivery and the signature, only if they still hold them. The writes. Request another delivery attempt, offered because the server says Delhivery would accept one on this code: a van goes out again at our expense. Correct the recipient, the gentlest: only the fields you fill are sent, and it is refused once a parcel is out for delivery. Cancel with courier is red for a reason: a moving parcel turns round and comes back at the cost of a return leg, and the button stays dead until you write at least ten characters of why. And Record a scan manually, for when their panel says delivered and ours does not.',
  },
  {
    id: 'live-no-sandbox',
    say: 'Two rules for all four. There is no sandbox: every button reaches the real Delhivery, so nothing in this video presses one. And none of it moves the order. The courier accepting a cancellation is their opinion about a parcel; the order’s status comes from their scans, which arrive later and may disagree. A scan you type is something you are asserting happened, and it carries the time of the scan, not of the typing.',
  },
  {
    id: 'tix-open',
    say: 'Third, refunds and disputes. Open Tickets: everything anybody is arguing about. Goods we damaged, a count that came up short, a member store that has fallen out with the client whose stock it sells.',
  },
  {
    id: 'tix-kinds',
    say: 'The type column comes first and changes how you read the rest. Software raised a receipt-short ticket; a person raised the dispute. Only some are ours to answer at all.',
  },
  {
    id: 'tix-thread',
    say: 'Click a ticket. This one is about a count, so it names a goods receipt where others name an order. We opened it, so it opens with our words: which leg lost the unit, that the goods were in our hands, and that nothing is on hold while we look.',
  },
  {
    id: 'tix-reply',
    say: 'Reply to the client is not an internal note. The client reads it on their own ticket, so write to them. It is the only free part of this page. Sending lands it in their conversation exactly as typed, and the ticket becomes a thread. Type here; the pointer stays on the button.',
  },
  {
    id: 'tix-stage',
    say: 'Moving it on is two questions. First, the stage. Only if you are closing does it ask the second, because that is where the money is. There are four outcomes: goods went back, the client accepted the loss, not upheld, and refunded the client. The first three record a decision and move nothing.',
  },
  {
    id: 'tix-refund',
    say: 'Refunded the client opens an amount field with no suggestion in it, on purpose, since what a lost unit was worth is a judgement. Type it and press Apply, which asks Refund the client? first. The refund is credited in the same transaction as the close, so neither can happen without the other. It is dangerous and cannot be undone. The confirmation is closed here.',
  },
  {
    id: 'tix-dispute',
    say: 'A dispute between a store and a client is a different animal. A member store sells a client’s goods under its own name, and when they disagree we only referee. The settle panel asks who pays whom, and the money moves between the store’s wallet and the client’s, never out of ours. Refunding the client is not offered: the server refuses it by name, because paying out of our pocket is not settling an argument.',
  },
  {
    id: 'col-link',
    say: 'Fourth, collapsing a warehouse’s shelving: the one act in the warehouse that destroys something. Everything else moves goods; this throws away the record of where they are. It is not in the sidebar. It is a sentence at the bottom of Bins, a link, so nothing lands on it while someone is re-shelving. It takes a super admin.',
  },
  {
    id: 'col-page',
    say: 'Click Collapse its bins into FLOOR. Every shelf merges into the floor. A backup is taken first, and this is the part worth reading twice: the goods keep selling while it is put back, so a restore is a head start and not a rewind.',
  },
  {
    id: 'col-choose',
    say: 'Nothing else is on the page until you choose a warehouse, deliberately. Every figure below is about one building, and a collapse aimed at the wrong one cannot be taken back.',
  },
  {
    id: 'col-backups',
    say: 'Backups. One is taken automatically before every collapse and before anything moves, so a crash between the two leaves a complete copy and an untouched warehouse. Each says when its own copy is swept.',
  },
  {
    id: 'col-restore',
    say: 'Put the layout back is best effort, line by line. Anything that has sold, moved or been picked since the collapse stays where it is and is listed as skipped. The dialog says so instead of promising a rewind.',
  },
  {
    id: 'col-danger',
    say: 'Then the collapse itself. Where each thing was becomes only the backup. Bins a picker can never reach are left alone, since held, damaged and quarantine are about not selling, not finding. Goods in transit between two warehouses are not in this building at all, and sweeping them onto the floor would make them sellable before they landed.',
  },
  {
    id: 'col-open',
    say: 'Click Collapse this warehouse…. Two steps, and the first moves nothing. It opens on what is about to stop being recorded, in the plainest words on the page: pickers will search the floor until the shelving is laid out again.',
  },
  {
    id: 'col-reason',
    say: 'Type the reason, thirty characters at least. The counter only tells you where you are; the server enforces it. This sentence is stored on the backup and the audit trail, and it is all anyone gets later.',
  },
  {
    id: 'col-ack',
    say: 'Then tick the acknowledgement, saying out loud what it costs: that you understand a restore recovers only the stock that has not moved or sold in between.',
  },
  {
    id: 'col-preview',
    say: 'Show me what this would move counts what would merge, and moves nothing, because two bins holding seven units and forty bins holding nine hundred are different decisions. It is not pressed here: it asks for a code.',
  },
  {
    id: 'col-code',
    say: 'After the preview, a six-digit code is emailed to the person who asked, not shown on screen, and you type this warehouse’s own code out too. Someone who got here by accident has neither. Then Collapse N bin(s) is the press that cannot be taken back. This video stops at the dialog, and the stopping is the lesson.',
  },
  {
    id: 'outro',
    say: 'Fifth, what we cannot undo, as a list. God mode forces a state the rules forbid and sets a flag that never clears. Completing a goods receipt writes stock with no cancel; a miscount is a second entry. Forcing a call outcome is a real attempt under your name. Packing without a scan is logged high severity. Freeing a pickup day may book a second van. Receiving a return starts an inspection that moves stock. Collapsing bins needs a code. Accepting a top-up credits money. Approving a bank change redirects it. And closing a month freezes it for good. None is forbidden. Each asks for a reason and records who you are, and if you cannot write the reason down, that is the sign to ask somebody before you press it.',
  },
];

const O_RUN = [
  {
    id: 'lead-open',
    run: async (ctx) => {
      await go(
        ctx,
        '/leads',
        ctx.page.getByRole('heading', { name: 'Invite requests', exact: true }),
      );
      await show(ctx, ctx.page.locator('.ac-toolbar'), 4600);
    },
  },
  {
    id: 'lead-open-one',
    run: async (ctx) => {
      const { page, stage } = ctx;
      await stage.dwellOn(page.locator('tbody tr').first().locator('td').last(), 2200);
      await openDialog(ctx, page.locator('tbody tr').first(), 1600);
      await show(ctx, page.getByRole('dialog').locator('.ac-meta'), 3600);
    },
  },
  {
    id: 'lead-status',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await ctx.stage.point(dialog.locator('#lead-status'), { settle: 500 });
      await dialog.locator('#lead-status').selectOption('QUALIFIED');
      await ctx.stage.typeIn(
        dialog.locator('#lead-notes'),
        'Spoke on the phone. Ships about 400 a month from Dhaka.',
      );
    },
  },
  {
    id: 'lead-invite',
    run: async (ctx) => {
      await show(ctx, foot(ctx.page).getByRole('button', { name: /^Save$/ }), 2200);
      await show(
        ctx,
        ctx.page.getByRole('dialog').getByRole('button', { name: /^Send invite$/ }),
        3600,
      );
    },
  },
  {
    id: 'lead-pending',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/sellers', ctx.page.locator('.sk-table').first());
      await show(ctx, ctx.page.getByRole('button', { name: /Pending invitations/ }), 3800);
    },
  },
  {
    id: 'cli-open',
    run: async ({ page, stage }) => {
      await stage.typeIn(page.getByPlaceholder(/Search by name/), 'a', { after: 900 });
      await stage.clickIt(page.locator('.sk-table a').first(), { after: 1400 });
      await page.waitForURL(/\/sellers\/.+/, { timeout: 30_000 });
      await quiet(page);
      await withRetry(page, page.getByRole('heading', { name: 'Profile', exact: true }));
      await stage.dwellOn(page.locator('.ac-meta').first(), 3200);
    },
  },
  {
    id: 'cli-correct',
    run: async (ctx) => {
      const card = ctx.page
        .locator('.ac-card')
        .filter({
          has: ctx.page.getByRole('heading', { name: 'Company name and phone', exact: true }),
        })
        .first();
      await show(ctx, card.locator('.ac-card__note'), 3800);
    },
  },
  {
    id: 'cli-correct-reason',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: /^Correct these details/ }));
      await ctx.stage.dwellOn(ctx.page.getByRole('dialog').locator('#identity-phone'), 2200);
      await ctx.stage.typeIn(
        ctx.page.getByRole('dialog').locator('#identity-reason'),
        'A digit was lost at registration, which is why nobody could reach them.',
      );
    },
  },
  {
    id: 'cli-hold',
    run: async (ctx) => {
      await shut(ctx);
      const card = ctx.page
        .locator('.ac-card')
        .filter({ has: ctx.page.getByRole('heading', { name: 'Account hold', exact: true }) })
        .first();
      await show(ctx, card.locator('.ac-card__note'), 3200);
      await openDialog(ctx, card.getByRole('button', { name: 'Place a hold' }));
    },
  },
  {
    id: 'cli-hold-scope',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await show(ctx, dialog.locator('fieldset').filter({ hasText: 'Stop them from' }), 3200);
      await show(ctx, dialog.getByText(/These do not protect the money/i), 3600);
    },
  },
  {
    id: 'cli-hold-clear',
    run: async (ctx) => {
      const dialog = ctx.page.getByRole('dialog');
      await ctx.stage.typeIn(dialog.getByLabel(/^Lifts automatically at balance/), '0', {
        clear: true,
      });
      await ctx.stage.typeIn(
        dialog.getByLabel(/^Reason\*?$/),
        'Your balance is overdue; new orders resume once it clears.',
      );
      await show(ctx, foot(ctx.page).getByRole('button', { name: /Place hold/ }), 2800);
    },
  },
  {
    id: 'cli-suspend',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Suspend account' }), 1600);
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-confirm__consequence'), 4600);
    },
  },
  {
    id: 'cli-settings',
    run: async (ctx) => {
      await shut(ctx);
      const section = ctx.page
        .locator('.ac-section')
        .filter({
          has: ctx.page.getByRole('heading', { name: 'Settings for this client', exact: true }),
        })
        .first();
      await show(ctx, section.locator('thead'), 3600);
    },
  },
  {
    id: 'cli-override',
    run: async (ctx) => {
      const fee = ctx.page.locator('tbody tr').filter({ hasText: 'Delivery fee per parcel' });
      await openDialog(ctx, fee.getByRole('button', { name: /^Override$|^Change$/ }));
      await ctx.stage.typeIn(
        ctx.page
          .getByRole('dialog')
          .getByLabel(/^Value$/)
          .first(),
        '180',
      );
      await ctx.stage.typeIn(
        ctx.page.getByRole('dialog').locator('#ov-note'),
        'Agreed on the phone, 3 October.',
      );
    },
  },
  {
    id: 'cli-currency',
    run: async (ctx) => {
      await shut(ctx);
      await show(
        ctx,
        ctx.page.locator('tbody tr').filter({ hasText: 'Delivery fee currency' }),
        4200,
      );
    },
  },
  {
    id: 'cli-couriers',
    run: async (ctx) => {
      const section = ctx.page
        .locator('.ac-section')
        .filter({ has: ctx.page.getByRole('heading', { name: 'Courier accounts', exact: true }) })
        .first();
      await show(ctx, section, 2800);
      await openDialog(ctx, section.getByRole('button', { name: 'Add link' }));
      await show(
        ctx,
        ctx.page.getByRole('dialog').getByText(/Two links at 100 split evenly/i),
        3800,
      );
    },
  },
  {
    id: 'cli-credit',
    run: async (ctx) => {
      await shut(ctx);
      const section = ctx.page
        .locator('.ac-section')
        .filter({ has: ctx.page.getByRole('heading', { name: /credit after confirmation$/ }) })
        .first();
      await show(ctx, section.locator('.sk-sh__note'), 4200);
    },
  },
  {
    id: 'sys-open',
    run: async (ctx) => {
      await go(
        ctx,
        '/settings',
        ctx.page.getByRole('heading', { name: 'System settings', exact: true }),
      );
      await show(ctx, ctx.page.locator('.sk-ph__subtitle, .sk-sh__note'), 3600);
    },
  },
  {
    id: 'sys-row',
    run: async (ctx) => {
      const row = ctx.page.locator('li.ac-row').first();
      await show(ctx, row, 2800);
      await ctx.stage.clickIt(row.locator('button.sss-info').first(), { after: 1000 });
      await show(ctx, ctx.page.locator('[role="tooltip"]'), 3600);
    },
  },
  {
    id: 'sys-edit',
    run: async (ctx) => {
      await openDialog(
        ctx,
        ctx.page.locator('li.ac-row').first().getByRole('button', { name: 'Edit' }),
      );
      await show(ctx, ctx.page.getByRole('dialog'), 4400);
    },
  },
  {
    id: 'sys-live',
    run: async (ctx) => {
      await shut(ctx);
      await ctx.stage.dwellOn(ctx.page.locator('.sk-ph__subtitle, .sk-sh__note').first(), 5000);
    },
  },
  {
    id: 'stf-open',
    run: async (ctx) => {
      await go(ctx, '/staff', ctx.page.getByRole('heading', { name: 'Staff', exact: true }));
      await show(ctx, ctx.page.locator('.sk-ph__subtitle'), 3400);
    },
  },
  {
    id: 'stf-invite',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Invite staff' }), 1600);
      await ctx.stage.typeIn(
        ctx.page
          .getByRole('dialog')
          .getByLabel(/^Email/)
          .first(),
        'new.joiner@skydrop.local',
      );
      await show(ctx, ctx.page.getByRole('dialog').getByLabel(/^Roles/), 4400);
    },
  },
  {
    id: 'stf-role',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(
        ctx,
        ctx.page
          .locator('tbody tr')
          .first()
          .getByRole('button', { name: /^Change roles/ }),
        1600,
      );
      await show(ctx, ctx.page.getByRole('dialog', { name: /^Roles for / }), 4600);
    },
  },
  {
    id: 'stf-deactivate',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(
        ctx,
        ctx.page.locator('tbody tr').first().getByRole('button', { name: 'Deactivate' }),
      );
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-confirm__consequence'), 4400);
    },
  },
  {
    id: 'bc-open',
    run: async (ctx) => {
      await shut(ctx);
      await go(
        ctx,
        '/notifications/broadcasts',
        ctx.page.getByRole('heading', { name: 'Broadcast', exact: true }),
      );
      await show(ctx, ctx.page.locator('.sk-ph__subtitle'), 3600);
    },
  },
  {
    id: 'bc-audience',
    run: async ({ page, stage }) => {
      await stage.point(page.locator('#bc-audience'), { settle: 400 });
      await page.locator('#bc-audience').selectOption({ label: 'A staff role' });
      await stage.dwellOn(page.getByLabel(/^Role key/).first(), 3200);
    },
  },
  {
    id: 'bc-message',
    run: async ({ page, stage }) => {
      await stage.dwellOn(page.locator('fieldset').filter({ hasText: 'Channels' }).first(), 2200);
      await stage.typeIn(page.locator('#bc-title'), 'Warehouse closed early on Friday');
      await stage.typeIn(
        page.locator('#bc-body'),
        'Last handover is at 14:00. Pack the remaining parcels before then.',
      );
    },
  },
  {
    id: 'bc-count',
    run: (ctx) =>
      show(ctx, ctx.page.getByRole('button', { name: /How many is that\?|Counting/ }), 3800),
  },
  {
    id: 'bc-send',
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: /^Send to / }), 5200),
  },
];

const P_RUN = [
  {
    id: 'god-open',
    run: async (ctx) => {
      const { page, stage } = ctx;
      await visit(ctx, GOD_SEARCH);
      await page
        .getByText(/^1 orders?$/)
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await stage.clickIt(page.getByRole('link', { name: /^SD-\d{4}-\d{2}-\d{6}$/ }).first(), {
        after: 1400,
      });
      await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await quiet(page);
      await page
        .getByText('Awaiting client decision', { exact: true })
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await stage.dwellOn(h1(page), 2600);
    },
  },
  {
    id: 'god-stuck',
    run: (ctx) => show(ctx, orderCard(ctx.page, 'Actions').locator('.oc-group'), 4000),
  },
  { id: 'god-panel', run: (ctx) => show(ctx, ctx.page.locator('.oc-god-panel__body'), 4200) },
  {
    id: 'god-dialog',
    run: async (ctx) => {
      await openDialog(
        ctx,
        ctx.page.getByRole('button', { name: 'Force-mutate…', exact: true }),
        1600,
      );
      await ctx.page
        .getByRole('dialog')
        .getByRole('heading', { name: 'God-mode override' })
        .waitFor({ state: 'visible', timeout: WAIT });
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-dialog__desc'), 3400);
    },
  },
  {
    id: 'god-consequences',
    run: (ctx) => show(ctx, ctx.page.getByRole('dialog').locator('.oo-god__banner'), 6800),
  },
  {
    id: 'god-fields',
    run: (ctx) =>
      show(
        ctx,
        ctx.page
          .getByRole('dialog')
          .locator('.oc-wl')
          .filter({ has: ctx.page.getByText('Payment + value', { exact: true }) }),
        4200,
      ),
  },
  {
    id: 'god-status',
    run: async (ctx) => {
      const { page, stage } = ctx;
      const box = page
        .getByRole('dialog')
        .locator('.oc-critical-box')
        .filter({ has: page.getByText('Bypasses the state-machine matrix.') });
      await stage.clickIt(box.locator('label.sk-check__row').first(), { after: 1000 });
      const target = page.getByRole('dialog').getByLabel(/^Target status$/);
      await target.waitFor({ state: 'visible', timeout: WAIT });
      await stage.point(target, { settle: 500 });
      await target.selectOption('CONFIRMED');
      await stage.dwellOn(box, 2800);
    },
  },
  {
    id: 'god-reason',
    run: async (ctx) => {
      await ctx.stage.typeIn(
        ctx.page.locator('#god-reason'),
        'Client confirmed by phone that the customer wants this order; the pause has no edge to confirmed.',
      );
      await show(ctx, ctx.page.getByRole('dialog').locator('.oc-counter'), 2800);
    },
  },
  {
    id: 'god-ack',
    run: async (ctx) => {
      const box = ctx.page
        .getByRole('dialog')
        .locator('.oc-critical-box')
        .filter({ has: ctx.page.getByText(/I acknowledge the data-integrity risk/) });
      await show(ctx, box, 3200);
      await ctx.stage.clickIt(box.locator('label.sk-check__row').first(), { after: 900 });
    },
  },
  {
    id: 'god-press',
    run: (ctx) =>
      show(ctx, ctx.page.getByRole('dialog').getByRole('button', { name: /Continue/ }), 6800),
  },
  {
    id: 'god-release',
    run: async (ctx) => {
      await shut(ctx);
      await openDialog(
        ctx,
        ctx.page.getByRole('button', { name: 'Release reservations…', exact: true }),
        1400,
      );
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-confirm__consequence'), 5200);
    },
  },
  {
    id: 'live-find',
    run: async (ctx) => {
      const { page, stage } = ctx;
      await shut(ctx);
      await visit(ctx, '/orders?status=DELIVERY_FAILED');
      await stage.clickIt(page.getByRole('link', { name: /^SD-\d{4}-\d{2}-\d{6}$/ }).first(), {
        after: 1400,
      });
      await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/, { timeout: 30_000 });
      await quiet(page);
      await page
        .getByText('Delivery failed', { exact: true })
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await stage.dwellOn(h1(page), 2800);
    },
  },
  {
    id: 'live-closed',
    run: async (ctx) => {
      await show(ctx, orderCard(ctx.page, 'Shipments').locator('.os-item__head'), 3000);
      await show(ctx, ctx.page.getByRole('button', { name: 'Courier actions & costs' }), 4400);
    },
  },
  {
    id: 'live-writes',
    run: async (ctx) => {
      await show(ctx, orderCard(ctx.page, 'Shipments'), 12_000);
    },
  },
  {
    id: 'live-no-sandbox',
    run: (ctx) =>
      show(ctx, ctx.page.getByRole('button', { name: 'Courier actions & costs' }), 8000),
  },
  {
    id: 'tix-open',
    run: async (ctx) => {
      await go(ctx, '/tickets');
      await show(ctx, ctx.page.locator('.sk-pg__summary'), 3000);
    },
  },
  { id: 'tix-kinds', run: (ctx) => show(ctx, ctx.page.locator('table'), 4400) },
  {
    id: 'tix-thread',
    run: async ({ page, stage }) => {
      await stage.clickIt(
        page
          .getByRole('row')
          .filter({ hasText: 'Goods receipt' })
          .first()
          .getByRole('link')
          .first(),
        {
          after: 1400,
        },
      );
      await page.waitForURL(/\/tickets\/.+/, { timeout: 30_000 });
      await quiet(page);
      await withRetry(page, page.locator('.af-card').first());
      await stage.dwellOn(page.locator('.af-card').first(), 3600);
    },
  },
  {
    id: 'tix-reply',
    run: async ({ page, stage }) => {
      await stage.typeIn(
        page.getByLabel('Reply to the client'),
        'We are checking the forwarder’s manifest and will write again today.',
      );
      await stage.dwellOn(page.getByRole('button', { name: 'Reply to client' }), 3400);
    },
  },
  {
    id: 'tix-stage',
    run: async (ctx) => {
      await ctx.page.selectOption('#admin-ticket-stage', 'CLOSED');
      await show(ctx, ctx.page.locator('#admin-ticket-stage'), 2000);
      await show(ctx, ctx.page.locator('#admin-ticket-to'), 3600);
    },
  },
  {
    id: 'tix-refund',
    run: async (ctx) => {
      const { page, stage } = ctx;
      await page.selectOption('#admin-ticket-to', 'RESOLVED_REFUND');
      await stage.typeIn(page.locator('#admin-ticket-refund'), '820');
      await openDialog(ctx, page.getByRole('button', { name: 'Apply' }), 1400);
      await page
        .getByRole('dialog')
        .getByRole('heading', { name: 'Refund the client?' })
        .waitFor({ state: 'visible', timeout: WAIT });
      await show(ctx, page.getByRole('dialog').locator('.sk-confirm__consequence'), 4200);
    },
  },
  {
    id: 'tix-dispute',
    run: async (ctx) => {
      const { page, stage } = ctx;
      await shut(ctx);
      await stage.clickIt(page.getByRole('link', { name: 'All tickets' }).first(), { after: 1400 });
      await page.waitForURL((u) => u.pathname === '/tickets', { timeout: 20_000 });
      await stage.clickIt(
        page
          .getByRole('row')
          .filter({ hasText: /dispute/i })
          .first()
          .getByRole('link')
          .first(),
        {
          after: 1400,
        },
      );
      await page.waitForURL(/\/tickets\/.+/, { timeout: 30_000 });
      await quiet(page);
      await show(
        ctx,
        page
          .locator('.af-section')
          .filter({ has: page.getByRole('heading', { name: 'Settle between store and client' }) }),
        6200,
      );
    },
  },
  {
    id: 'col-link',
    run: async (ctx) => {
      await go(ctx, '/warehouse/bins', ctx.page.getByRole('heading', { level: 1, name: 'Bins' }));
      await show(ctx, ctx.page.getByText(/Abandoning this warehouse/), 4600);
    },
  },
  {
    id: 'col-page',
    run: async ({ page, stage }) => {
      await stage.clickIt(page.getByRole('link', { name: 'Collapse its bins into FLOOR' }), {
        after: 1600,
      });
      await page.waitForURL((u) => u.pathname === '/warehouse/collapse', { timeout: 30_000 });
      await quiet(page);
      await withRetry(page, h1(page));
      await stage.dwellOn(page.getByText(/a head start, not a rewind/).first(), 4000);
    },
  },
  {
    id: 'col-choose',
    run: async (ctx) => {
      await ctx.stage.point(ctx.page.locator('#collapse-warehouse'), { settle: 500 });
      await ctx.page.locator('#collapse-warehouse').selectOption({ index: 1 });
      await ctx.page.waitForTimeout(1200);
      await ctx.stage.dwellOn(ctx.page.locator('#collapse-warehouse'), 2800);
    },
  },
  {
    id: 'col-backups',
    run: (ctx) => show(ctx, ctx.page.getByRole('row').filter({ hasText: 'day(s) left' }), 4200),
  },
  {
    id: 'col-restore',
    run: async (ctx) => {
      await openDialog(ctx, ctx.page.getByRole('button', { name: 'Put the layout back' }), 1400);
      await show(ctx, ctx.page.getByRole('dialog').locator('.sk-dialog__desc'), 4400);
    },
  },
  {
    id: 'col-danger',
    run: async (ctx) => {
      await shut(ctx);
      await show(
        ctx,
        ctx.page.getByText(/This merges every shelf in the warehouse into FLOOR/),
        3400,
      );
      await show(
        ctx,
        ctx.page.getByText(/goods still in transit between two of our warehouses/),
        3800,
      );
    },
  },
  {
    id: 'col-open',
    run: async (ctx) => {
      // A REGEX: the button's apostrophe is a right single quotation
      // mark and the dialog title's is ASCII, so either literal finds
      // one and waits thirty seconds for the other.
      const named = /Collapse this warehouse./;
      await openDialog(ctx, ctx.page.getByRole('button', { name: named }), 1400);
      await show(
        ctx,
        ctx.page.getByRole('dialog').getByText(/Pickers will find stock by searching FLOOR/),
        3800,
      );
    },
  },
  {
    id: 'col-reason',
    run: async (ctx) => {
      await ctx.stage.typeIn(
        ctx.page.locator('#collapse-reason'),
        'The racking is being replaced this weekend and every recorded location will be wrong.',
      );
      await show(ctx, ctx.page.locator('.sk-field__after .sk-figure, .sk-figure').last(), 2800);
    },
  },
  {
    id: 'col-ack',
    run: async (ctx) => {
      await ctx.stage.clickIt(ctx.page.getByRole('checkbox').first(), { after: 900 });
      await show(
        ctx,
        ctx.page.getByText(/I understand this destroys the record of where everything is/),
        3800,
      );
    },
  },
  {
    id: 'col-preview',
    run: (ctx) =>
      show(ctx, ctx.page.getByRole('button', { name: 'Show me what this would move' }), 4400),
  },
  {
    id: 'col-code',
    run: (ctx) => show(ctx, ctx.page.getByRole('dialog'), 6800),
  },
  {
    id: 'outro',
    run: async (ctx) => {
      await shut(ctx);
      await go(ctx, '/dashboard', ctx.page.locator('.db-attn').first());
      await ctx.page
        .getByText('What is waiting on someone right now', { exact: false })
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await show(ctx, ctx.page.locator('.db-attn-grid'), 14_000);
    },
  },
];

/* ──────────────────────────── the module ─────────────────────────── */

/*
  Each section's narration and run are kept side by side above and joined
  here, in watching order. The README's array-of-`{ id, run }` shape is
  unchanged; it is built from sections only because one 300-step literal
  is not something a person can review, and a step's say and run sit
  within a screen of each other in the source.
*/
export const narration = {
  slug: SLUG,
  title: 'Running the Skydrop operations desk',
  subtitle: 'Skydrop for staff',
  steps: [...H_SAY, ...I_SAY, ...J_SAY, ...K_SAY, ...L_SAY, ...M_SAY, ...N_SAY, ...O_SAY, ...P_SAY],
};

export const flow = {
  app: 'admin',

  /**
   * WHAT THE SEED MUST HAVE MADE.
   *
   * The union of the worlds the short videos film, because this video
   * visits all of them. Nothing here is spent: no step presses a button
   * that writes, so one seed serves every take (see the docblock).
   */
  seed: [
    'The filming staff user `tutorial-ops@skydrop.local` as SUPER_ADMIN (`lib/ops-user.mjs`), so every screen and every dangerous control is visible. The permission-gating lines are narrated, not filmed.',
    'D0 lifecycle orders (`seed-demo-data.mjs --lifecycle`): `RSH-LIFE-RESTOCKED` with a whole journey, a failed delivery, a return, a bench receipt and a disposition; at least one DELIVERY_FAILED order with a live shipment; `RSH-LIFE-REVIEW` in AWAITING_SELLER_DECISION (the god-mode order).',
    'The `the-ops-dashboard` world: lit attention tiles in Call centre, Merchant, Warehouse, Support and Settlements, with Dispatch and Stock at zero.',
    'The `things-the-system-has-raised` world: the real sweep run once, with OPEN issues including a High card carrying an Open the order link and a MEDIUM stale-exchange-rate card, plus closed history. Run it more than 11 minutes past the hour (the hourly sweep re-raises label cards).',
    'The `supervising-the-queue` world: two call agents (`asha.pillai` OFF and holding a stuck ASSIGNED call, `imran.shaikh` on and idle) and three queue entries back-dated to 5h, 3h and 39m. PLUS one confirmation call ASSIGNED to the filming ops user with availability OFF, so the station shows a call without anything being claimed on camera. A customer with a lifecycle history, so the risk strip renders.',
    'The `sellers-asking-to-call-again` world: two customer-rejected orders with open re-attempt requests (one with a good reason, one with nothing new).',
    'The `where-things-live` world: the Dhaka intake warehouse `BD-DHK-1` with no bins and tracking OFF, and a MAIN zone available to the Add a bin form.',
    'The `receive-a-consignment` world, EXCEPT that the receipt is already IN_PROGRESS and claimed by the filming user with two product lines (declared 10 and 20), so the count fields render without Start receiving being pressed.',
    'The `print-and-pick` world: at least three confirmed orders with printable waybills awaiting labels, and three more on the picking tab.',
    'The `pack-a-parcel` world, plus one box ALREADY OPEN for the filming user with a two-line order, so the lines, the cancel note and the pack-without-scanning panel render without a scan.',
    'The `hand-over-to-the-courier`, `book-the-van` and `what-went-out-together` worlds: waiting parcels, a failed pickup row carrying the courier’s own words, and a DRAFT manifest with parcels.',
    'The `take-a-return-in` and `inspect-and-finalise-a-return` worlds: a return AT THE DOOR with a waybill, one in transit, and a bench shipment with an uninspected multi-unit line.',
    'The `correct-a-count` world: one adjustment WAITING for approval above threshold, some applied history, and a DAMAGED bin. The `count-the-shelves` world with one cycle count already STARTED holding one differing line.',
    'The `read-the-stock-ledger` and `moving-stock-between-warehouses` worlds: movements of several types including PACK_CONFIRM and ADJUSTMENT_DECREASE, and two warehouses to transfer between.',
    'The `courier-accounts-and-credentials` and `is-the-courier-healthy` worlds against the local Delhivery simulator, with one parcel blocked in MANUAL placement (`when-nobody-will-carry-it`) and the failed-delivery requests of `acting-on-a-failed-delivery` (one waiting on client staff, the rest decided).',
    'The money worlds: `how-seller-money-works` (ledger lines of every kind), `accept-a-top-up` (a PENDING claim), `pay-a-seller-out` (a withdrawal row to approve and an approved one waiting on Remittances, destination bank on file), `approve-a-bank-change` (one change request), `record-a-courier-payout` (a settlements page with float), `move-money-by-hand` (the client `Rangpur Silk House`), `the-bank-book` (HDFC Current with reconcile and owner-money rows), `bill-the-freight` (a billable row with Settle, Waive and Void), `is-the-money-picture-true` (P&L with an India delivery line, and cost sync).',
    'The O worlds: `letting-a-seller-in` (a lead and a pending invitation), `managing-a-seller` and `per-seller-settings` (an APPROVED client reachable by searching “a”, with a delivery-fee setting and a courier link possible), `change-a-system-setting` (settings with info tooltips), `staff-and-broadcasts` (staff rows, a role).',
    'The P worlds: `god-mode` (above), `live-courier-writes` (a DELIVERY_FAILED parcel whose waybill the simulator knows), `refunds-and-disputes` (a goods-receipt-short ticket and a store-versus-client dispute), `collapse-the-shelves` (a warehouse with a backup row).',
    'apps/admin rebuilt and restarted by its LISTENING pid before the take: several of these shorts caught a defect only because the running build was stale.',
  ],

  steps: [...H_RUN, ...I_RUN, ...J_RUN, ...K_RUN, ...L_RUN, ...M_RUN, ...N_RUN, ...O_RUN, ...P_RUN],
};
