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
 * The recipient on the parcel the pack bench scans.
 *
 * Tied to `PACK_SCANNABLE` in `seed-demo-data.mjs`, which places the one
 * PICKED-and-labelled row in the pack queue. Named here rather than
 * matched by waybill because waybills are minted per run; named rather
 * than taken as "the first row" because the row beside it is the
 * deliberately UNLABELLED parcel behind the previous scene's callout.
 * Change one of these two and the other has to change with it.
 */
const PACK_SCAN_RECIPIENT = 'Devika Menon';

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
    sayBn:
      'এটা staff console — এখান থেকেই Skydrop-এর নিজের লোকেরা ব্যবসাটা চালায়। কল সেন্টারের এজেন্ট, গুদামের কর্মী, হিসাব বিভাগ, সুপারভাইজার। এটাই আবার একমাত্র console যেটা জিনিস নষ্টও করে ফেলতে পারে, তাই এই ভিডিওটা সাজানো হয়েছে প্রথম সপ্তাহের ধারায়: আগে পড়া, তারপর রোজকার কাজ, আর শেষে সেই অল্প কয়েকটা কাজ যেগুলো আর ফিরিয়ে নেওয়া যায় না।',
  },
  {
    id: 'saves-nothing',
    say: 'One rule for this recording. Every form you will see is opened and filled in, and none is submitted. Where a button writes stock, money or a courier booking, the video stops with the pointer on it and says what pressing it would do. On the real console you press it only once the reasons on screen are true.',
    sayBn:
      'এই রেকর্ডিংয়ের একটা নিয়ম। আপনি যে ফর্মগুলো দেখবেন, প্রতিটাই খোলা হবে আর পূরণ করা হবে, কিন্তু কোনোটাই জমা দেওয়া হবে না। যেখানে কোনো বোতাম স্টক, টাকা বা কুরিয়ারের বুকিং লিখে ফেলে, ভিডিওটা সেখানে পয়েন্টার রেখে থেমে যায় আর বলে দেয় ওটা চাপলে কী হতো। আসল console-এ আপনি ওটা তখনই চাপবেন, যখন পর্দায় লেখা কারণগুলো সত্যি।',
  },
  {
    id: 'rail',
    say: 'The rail on the left is the whole console, grouped by job. And it is yours alone: it shows only what your roles allow. A link that is missing means your role does not hold that permission, not that the screen is gone. A super admin sees every link; almost nobody else does.',
    sayBn:
      'বাঁ দিকের rail-টাই গোটা console, কাজ অনুযায়ী ভাগ করা। আর এটা শুধু আপনার নিজের: আপনার role যা অনুমতি দেয়, কেবল সেটাই দেখায়। কোনো লিঙ্ক না থাকার মানে আপনার role-এ ওই permission নেই — স্ক্রিনটা উঠে গেছে, তা নয়। একজন Super admin প্রতিটা লিঙ্ক দেখেন; আর প্রায় কেউই দেখেন না।',
  },
  {
    id: 'dash-bands',
    say: 'Start where every shift starts, the dashboard. It answers one question before any other: what is waiting on a person right now. The top band is the work queue: seven areas, each with a count, and the ones with work in them are lit, so the screen reads as a shape before you read a number.',
    sayBn:
      'শুরু করুন যেখান থেকে প্রতিটা শিফট শুরু হয় — Dashboard। এটা সবার আগে একটা প্রশ্নের উত্তর দেয়: এই মুহূর্তে কোন কাজটা কোনো মানুষের জন্য অপেক্ষা করছে। উপরের ব্যান্ডটা হলো কাজের সারি: সাতটা এলাকা, প্রতিটার সঙ্গে একটা সংখ্যা, আর যেগুলোতে কাজ আছে সেগুলো জ্বলে থাকে — তাই সংখ্যা পড়ার আগেই পর্দাটা একটা আকৃতি হিসেবে পড়া যায়।',
  },
  {
    id: 'dash-callcentre',
    say: 'Call centre comes first because nothing moves until a customer says yes. These are orders nobody has reached yet. Click the tile and it opens the screen that clears it. Every tile is a link, and none of them is a report.',
    sayBn:
      'Call centre সবার আগে, কারণ ক্রেতা হ্যাঁ না বলা পর্যন্ত কিছুই এগোয় না। এগুলো সেই অর্ডার যেগুলোতে এখনো কেউ পৌঁছায়নি। টাইলটায় ক্লিক করলে যে স্ক্রিন থেকে এটা সাফ করা যায়, সেটাই খুলে যায়। প্রতিটা টাইলই একটা লিঙ্ক, কোনোটাই রিপোর্ট নয়।',
  },
  {
    id: 'dash-merchant',
    say: 'Merchant is not yours to clear. These orders rang out until the cap, and the client has been asked whether to keep trying or let them go. It waits on them, not on us.',
    sayBn:
      'Merchant সাফ করা আপনার কাজ নয়। এই অর্ডারগুলোতে সীমা পর্যন্ত ফোন করা হয়ে গেছে, আর client-কে জিজ্ঞেস করা হয়েছে চেষ্টা চালিয়ে যাবেন কি না, নাকি ছেড়ে দেবেন। এটা তাঁদের জন্য অপেক্ষা করছে, আমাদের জন্য নয়।',
  },
  {
    id: 'dash-warehouse',
    say: 'Warehouse is confirmed orders with stock behind them, waiting for somebody to print a picking sheet. That count is a morning’s work, not a problem.',
    sayBn:
      'Warehouse হলো সেই Confirmed অর্ডার যেগুলোর পিছনে স্টক আছে, আর যেগুলো কারো picking sheet ছাপার অপেক্ষায় আছে। ওই সংখ্যাটা একটা সকালের কাজ, কোনো সমস্যা নয়।',
  },
  {
    id: 'dash-quiet',
    say: 'Dispatch and Stock are quiet here, and that is the point of the band. Dispatch lights when a courier refused to carry a parcel; Stock lights when something was confirmed against an empty shelf. A zero on either is good news.',
    sayBn:
      'এখানে Dispatch আর Stock চুপচাপ, আর ব্যান্ডটার উদ্দেশ্য ঠিক এটাই। কোনো কুরিয়ার একটা পার্সেল নিতে অস্বীকার করলে Dispatch জ্বলে ওঠে; ফাঁকা তাকের বিপরীতে কিছু confirm হয়ে গেলে Stock জ্বলে ওঠে। দুটোর যেকোনোটায় শূন্য থাকা ভালো খবর।',
  },
  {
    id: 'dash-support',
    say: 'Support is damage claims and client issues. It carries an Action badge because every one has somebody at the other end waiting to hear back from us.',
    sayBn:
      'Support মানে ক্ষতির দাবি আর client-দের সমস্যা। এটার গায়ে একটা Action ব্যাজ থাকে, কারণ এর প্রতিটার ওপাশে একজন মানুষ আমাদের উত্তরের অপেক্ষায় বসে আছেন।',
  },
  {
    id: 'dash-settlements',
    say: 'Settlements is money: clients who have asked to be paid out and have not been. It is marked Escrow because we are holding cash that belongs to somebody else. If your role holds no money permissions, this tile is not drawn, and the grid shows five tiles instead of seven.',
    sayBn:
      'Settlements মানে টাকা: যে client-রা টাকা তুলে নিতে চেয়েছেন কিন্তু এখনো পাননি। এটার গায়ে Escrow লেখা থাকে, কারণ আমরা অন্য কারো টাকা নিজেদের কাছে ধরে রেখেছি। আপনার role-এ টাকার কোনো permission না থাকলে এই টাইলটা আঁকাই হয় না, আর গ্রিডে সাতটার বদলে পাঁচটা টাইল দেখায়।',
  },
  {
    id: 'dash-performance',
    say: 'The second band is a different question: how the last thirty days went. Every figure is a rate with its denominator printed under it. Confirmed on call, out of orders placed. Delivered, out of everything dispatched. Returned, the same. Read together they say where parcels are being lost.',
    sayBn:
      'দ্বিতীয় ব্যান্ডটা আলাদা একটা প্রশ্ন: গত ত্রিশ দিন কেমন গেল। এখানের প্রতিটা সংখ্যাই একটা হার, আর তার নিচে কীসের উপর সেই হিসাব সেটা ছাপা থাকে। ফোনে Confirmed হয়েছে — মোট কতগুলো অর্ডার এসেছে তার মধ্যে। Delivered হয়েছে — যা যা পাঠানো হয়েছে তার মধ্যে। Returned-ও একইভাবে। তিনটা একসঙ্গে পড়লে বোঝা যায় পার্সেলগুলো কোথায় হারাচ্ছে।',
  },
  {
    id: 'dash-money',
    say: 'The third band is the money the last thirty days moved: what couriers collected, what we charged for carrying it, and what we paid out to clients.',
    sayBn:
      'তৃতীয় ব্যান্ডটা হলো গত ত্রিশ দিনে কত টাকা হাতবদল হয়েছে: কুরিয়াররা কত তুলেছে, বহন করার জন্য আমরা কত নিয়েছি, আর client-দের কত টাকা দিয়েছি।',
  },
  {
    id: 'dash-owed',
    say: 'The last tile is the one to read carefully. Outstanding owed is not revenue. It is client balances we hold and have not paid out, which is a debt. The link beside it opens the ledger behind it. So: the top band is today, the middle is the month, the bottom is whose money is where.',
    sayBn:
      'শেষ টাইলটা মন দিয়ে পড়ার জিনিস। Outstanding owed আমাদের আয় নয়। এটা client-দের ব্যালেন্স, যা আমরা ধরে রেখেছি আর এখনো দিইনি — অর্থাৎ এটা একটা দেনা। পাশের লিঙ্কটা এর পিছনের ledger খুলে দেয়। তাহলে দাঁড়াল: উপরের ব্যান্ড আজকের কথা, মাঝেরটা মাসের কথা, আর নিচেরটা বলে কার টাকা কোথায় আছে।',
  },
  {
    id: 'orders-list',
    say: 'Next, finding an order. Every order on the platform is on this one list, whoever sold it. Open Orders in the rail. The subtitle counts the rows, and it only appears once the list has answered, so a number there means the list is real.',
    sayBn:
      'এরপর, একটা অর্ডার খুঁজে বের করা। প্ল্যাটফর্মের প্রতিটা অর্ডারই এই একটা তালিকায় আছে, যে-ই বিক্রি করে থাকুক। rail থেকে Orders খুলুন। উপরের ছোট লেখাটা সারি গুনে দেখায়, আর তালিকা উত্তর দেওয়ার পরেই সেটা আসে — তাই ওখানে একটা সংখ্যা থাকার মানে তালিকাটা সত্যিই এসেছে।',
  },
  {
    id: 'orders-filters',
    say: 'Four filters sit over the list. Status is the whole lifecycle, thirty states. Then how the order arrived, which client it belongs to, and the day it was placed, read in India time and not yours. A filter lives in the page address, so a filtered list can be sent to a colleague as a link.',
    sayBn:
      'তালিকার উপরে চারটা filter আছে। Status হলো পুরো জীবনচক্র — ত্রিশটা অবস্থা। তারপর অর্ডারটা কীভাবে এসেছে, কোন client-এর অর্ডার, আর কোন দিন দেওয়া হয়েছে — তারিখটা ভারতের সময়ে পড়া হয়, আপনার সময়ে নয়। filter পৃষ্ঠার ঠিকানার মধ্যেই থাকে, তাই filter করা একটা তালিকা সহকর্মীকে লিঙ্ক হিসেবে পাঠিয়ে দেওয়া যায়।',
  },
  {
    id: 'orders-search',
    say: 'One search box takes several handles: our order number, the client’s own reference, the recipient’s name or their phone. Type it and press Enter. It is a form, not a live filter, so nothing happens until Enter. Whichever handle the person on the phone has is the right one.',
    sayBn:
      'একটাই search বাক্স, আর সেটা কয়েক রকম সূত্র নেয়: আমাদের অর্ডার নম্বর, client-এর নিজের reference, প্রাপকের নাম বা তাঁর ফোন নম্বর। লিখে Enter চাপুন। এটা একটা ফর্ম, চলতি filter নয়, তাই Enter না চাপা পর্যন্ত কিছুই হবে না। ফোনের ওপাশের মানুষটার কাছে যে সূত্রটা আছে, সেটাই ঠিক সূত্র।',
  },
  {
    id: 'order-open',
    say: 'Click the order number to open it. The page is a reading exercise first; every button on it is taught in its own place later in this video. This one came back: delivery failed, the parcel returned, the goods are on our shelf again, which makes it the fullest page there is.',
    sayBn:
      'অর্ডার নম্বরে ক্লিক করে এটা খুলুন। পৃষ্ঠাটা আগে পড়ার জিনিস; এখানের প্রতিটা বোতাম এই ভিডিওর পরের দিকে নিজের জায়গায় শেখানো হবে। এই অর্ডারটা ফিরে এসেছে: ডেলিভারি হয়নি, পার্সেল ফেরত এসেছে, পণ্য আবার আমাদের তাকে — আর এই কারণেই এটাই সবচেয়ে ভরা পৃষ্ঠা।',
  },
  {
    id: 'order-recipient',
    say: 'The recipient is a snapshot, frozen when the order was placed. Editing the customer record later never rewrites it, because this is where the parcel was actually sent.',
    sayBn:
      'Recipient একটা স্ন্যাপশট — অর্ডার দেওয়ার সময়ে যা ছিল, তাতেই আটকে আছে। পরে ক্রেতার রেকর্ড বদলালেও এটা কখনো বদলায় না, কারণ পার্সেলটা আসলে এখানেই পাঠানো হয়েছিল।',
  },
  {
    id: 'order-reputation',
    say: 'Beside it, what we know about this customer: how many orders, how many arrived, how many came back. The last number is the one a call agent wants before ringing.',
    sayBn:
      'এর পাশে, এই ক্রেতাকে নিয়ে আমরা যা যা জানি: কতগুলো অর্ডার, কতগুলো পৌঁছেছে, কতগুলো ফেরত এসেছে। ফোন করার আগে একজন কল এজেন্টের শেষ সংখ্যাটাই দরকার হয়।',
  },
  {
    id: 'order-payment',
    say: 'Payment holds two figures that are not the same: what the customer hands over at the door, and what the goods were declared to be worth. The courier needs both.',
    sayBn:
      'Payment-এ দুটো সংখ্যা আছে, আর দুটো এক নয়: ক্রেতা দরজায় কত টাকা হাতে দেবে, আর পণ্যের মূল্য কত বলে ঘোষণা করা হয়েছে। কুরিয়ারের দুটোই দরকার।',
  },
  {
    id: 'order-items',
    say: 'Items are a snapshot too, down to the SKU and weight. Reserved is stock actually held for this order; on a parcel that has shipped it is back to nothing.',
    sayBn:
      'Items-ও একটা স্ন্যাপশট, SKU আর ওজন পর্যন্ত। Reserved মানে এই অর্ডারের জন্য সত্যিই আটকে রাখা স্টক; যে পার্সেল পাঠানো হয়ে গেছে, তার ক্ষেত্রে এটা আবার শূন্যে নেমে আসে।',
  },
  {
    id: 'order-charges',
    say: 'Charges are what the client was billed, line by line, with a visibility column. This is the page that tells you whether the client can see the same line you are looking at.',
    sayBn:
      'Charges মানে client-এর কাছ থেকে কী কী নেওয়া হয়েছে, এক লাইনে একটা করে, সঙ্গে একটা visibility কলাম। আপনি যে লাইনটা দেখছেন সেটা client-ও দেখতে পান কি না, এই পৃষ্ঠাই সেটা বলে দেয়।',
  },
  {
    id: 'order-parcel',
    say: 'Shipments carries the waybill and which of our courier accounts booked it. Underneath, a panel says plainly what the courier will no longer accept, and why.',
    sayBn:
      'Shipments-এ থাকে waybill আর আমাদের কোন courier account দিয়ে এটা বুক করা হয়েছে। তার নিচে একটা প্যানেল পরিষ্কার করে বলে দেয় কুরিয়ার এখন আর কী কী নেবে না, আর কেন।',
  },
  {
    id: 'order-tracker',
    say: 'The tracker is the journey as rungs. It ends where the parcel actually got to. This one has no delivery rung because it never had one, and it finishes back in stock.',
    sayBn:
      'Tracker হলো পুরো যাত্রাটা ধাপে ধাপে সাজানো। পার্সেল আসলে যতদূর পৌঁছেছে, সেখানেই এটা শেষ হয়। এটায় ডেলিভারির কোনো ধাপ নেই, কারণ এর কোনোদিন ডেলিভারি হয়নি — আর এটা শেষ হয়েছে আবার স্টকে ফিরে এসে।',
  },
  {
    id: 'order-history',
    say: 'Full history is everything, newest first: our own events and the courier’s scans in one column, so you never hold two timelines in your head.',
    sayBn:
      'Full history-তে সবকিছু আছে, নতুনটা আগে: আমাদের নিজের ঘটনা আর কুরিয়ারের scan — সব এক কলামে, যাতে আপনাকে কখনো মাথায় দুটো আলাদা সময়রেখা ধরে রাখতে না হয়।',
  },
  {
    id: 'order-attempt',
    say: 'A failed delivery is drawn on the scan it belongs to, not as a second line, with the courier’s own reason code and whether that code allows another attempt. If you only ever read this page, you can still answer almost any question about an order.',
    sayBn:
      'ব্যর্থ একটা ডেলিভারি যে scan-এর সঙ্গে যায়, তার উপরেই আঁকা হয় — আলাদা দ্বিতীয় লাইন হিসেবে নয় — সঙ্গে থাকে কুরিয়ারের নিজের reason code আর ওই code আরেকবার চেষ্টা করতে দেয় কি না। আপনি যদি শুধু এই পৃষ্ঠাটাই পড়েন, তাতেও একটা অর্ডার নিয়ে প্রায় যেকোনো প্রশ্নের উত্তর দিতে পারবেন।',
  },
  {
    id: 'si-open',
    say: 'Now the page for failures that break nothing you can see. A login expires, a nightly job stops, and the only sign is a figure that quietly stops moving. Open System issues. These are the things the system could not fix by itself, gathered in one place instead of a log nobody reads.',
    sayBn:
      'এবার সেই পৃষ্ঠা, যেটা এমন গোলমালের জন্য যেগুলো চোখে পড়ার মতো কিছুই ভাঙে না। একটা login-এর মেয়াদ শেষ হয়ে যায়, রাতের একটা কাজ বন্ধ হয়ে যায়, আর তার একমাত্র চিহ্ন হলো একটা সংখ্যা চুপচাপ নড়া বন্ধ করে দেয়। System issues খুলুন। এগুলো সেই জিনিস যেগুলো সিস্টেম নিজে ঠিক করতে পারেনি — কেউ পড়ে না এমন একটা log-এর বদলে সব এক জায়গায় জমা করা।',
  },
  {
    id: 'si-counts',
    say: 'Three counts answer three questions: how many are open, how many nobody has claimed, and how many are urgent. The urgent one is the one to look at on a busy morning.',
    sayBn:
      'তিনটা সংখ্যা তিনটা প্রশ্নের উত্তর দেয়: কতগুলো খোলা আছে, কতগুলো এখনো কেউ নিজের হাতে নেয়নি, আর কতগুলো জরুরি। ব্যস্ত সকালে জরুরিটার দিকেই তাকাতে হয়।',
  },
  {
    id: 'si-card',
    say: 'Cards are sorted worst first, and severity is a word on the chip, not only a colour. High means money or parcels are affected right now. Read the body: it says what is wrong and what it costs. Where an issue is about one order, an Open the order link goes straight to it.',
    sayBn:
      'কার্ডগুলো সাজানো থাকে সবচেয়ে খারাপটা আগে, আর গুরুত্ব chip-এর গায়ে শব্দ হিসেবে লেখা থাকে — শুধু রঙ দিয়ে নয়। High মানে এই মুহূর্তে টাকা বা পার্সেল ক্ষতিগ্রস্ত হচ্ছে। ভিতরের লেখাটা পড়ুন: ওটা বলে দেয় কী ভুল হচ্ছে আর তাতে কত ক্ষতি হচ্ছে। কোনো issue যদি একটা নির্দিষ্ট অর্ডার নিয়ে হয়, তাহলে একটা Open the order লিঙ্ক সোজা সেখানে নিয়ে যায়।',
  },
  {
    id: 'si-meta',
    say: 'Underneath, three facts: which part of the system said it, when it was first seen, and how often. Seen once is usually one bad row. Seen every hour for days will not fix itself.',
    sayBn:
      'তার নিচে তিনটা তথ্য: সিস্টেমের কোন অংশ এটা বলেছে, কখন প্রথম দেখা গেছে, আর কতবার। একবার দেখা গেলে সেটা সাধারণত একটা খারাপ সারি। দিনের পর দিন প্রতি ঘণ্টায় দেখা গেলে সেটা নিজে থেকে ঠিক হবে না।',
  },
  {
    id: 'si-claim',
    say: 'I’m on it records that somebody is chasing the issue, so two people do not ring the same courier. It does not close the issue, because the problem is still there. Press it on the real console; here the pointer rests on it.',
    sayBn:
      'I’m on it লিখে রাখে যে কেউ একজন issue-টার পিছনে লেগেছে, যাতে দুজন মিলে একই কুরিয়ারকে ফোন না করেন। এটা issue-টা বন্ধ করে না, কারণ সমস্যাটা তো রয়েই গেছে। আসল console-এ এটা চাপবেন; এখানে পয়েন্টার শুধু এটার উপর রাখা আছে।',
  },
  {
    id: 'si-close',
    say: 'Close is a statement about the problem. Click Close on a card and the dialog insists on a few words, because that note is the record. Use it only for issues that needed a person. One whose text says it clears itself, such as a stale exchange rate, closes when the cause is fixed.',
    sayBn:
      'Close হলো সমস্যাটা নিয়ে একটা বিবৃতি। কোনো কার্ডে Close চাপলে ডায়ালগটা কয়েকটা শব্দ লেখার জন্য জোর করে, কারণ ওই নোটটাই রেকর্ড। শুধু সেই issue-গুলোর জন্য এটা ব্যবহার করুন যেগুলোতে একজন মানুষের হাত লাগা দরকার ছিল। যেটার লেখাতেই বলা আছে যে সেটা নিজে থেকেই সাফ হয়ে যায় — যেমন পুরোনো হয়ে যাওয়া exchange rate — সেটা কারণটা ঠিক হলেই বন্ধ হয়ে যায়।',
  },
  {
    id: 'si-history',
    say: 'Show closed too brings back the finished ones, each with when it closed and the note left. Nothing here is ever deleted; a closed issue is the record that it happened.',
    sayBn:
      'Show closed too শেষ হয়ে যাওয়াগুলোকে আবার ফিরিয়ে আনে, প্রতিটার সঙ্গে কখন বন্ধ হয়েছে আর কী নোট রেখে যাওয়া হয়েছে। এখানের কিছুই কখনো মুছে ফেলা হয় না; বন্ধ হয়ে যাওয়া একটা issue-ই প্রমাণ যে ঘটনাটা ঘটেছিল।',
  },
  {
    id: 'si-notify',
    say: 'Last, Notify unannounced. It sends a notification for every open issue nobody was ever told about, so it asks first and says what it is about to do. Read it, then Cancel unless you mean it. An empty page here is the good outcome, not a missing feature.',
    sayBn:
      'সবশেষে, Notify unannounced। এটা সেই প্রতিটা খোলা issue-র জন্য একটা notification পাঠায় যেগুলোর কথা কাউকে কখনো জানানো হয়নি, তাই এটা আগে জিজ্ঞেস করে আর বলে দেয় ঠিক কী করতে যাচ্ছে। লেখাটা পড়ুন, তারপর সত্যিই যদি এটা করতে না চান, Cancel চাপুন। এখানে পৃষ্ঠাটা ফাঁকা থাকা ভালো খবর — কোনো সুবিধা হারিয়ে যাওয়া নয়।',
  },
  {
    id: 'roles-open',
    say: 'Somebody cannot see a screen, and you have been asked to fix it. That is decided on Roles. A role is a set of permissions, and you make as many roles as the work needs. The permissions themselves are fixed by the system: you choose which a role holds, never what one means.',
    sayBn:
      'কেউ একটা স্ক্রিন দেখতে পাচ্ছেন না, আর আপনাকে সেটা ঠিক করতে বলা হয়েছে। এই সিদ্ধান্তটা হয় Roles থেকে। একটা role হলো কিছু permission-এর সমষ্টি, আর কাজের যতগুলো role দরকার আপনি ততগুলোই বানাতে পারেন। permission-গুলো নিজে সিস্টেমের ঠিক করে রাখা: আপনি শুধু বাছবেন কোন role কোনটা ধরে রাখবে, কোনো permission-এর মানে কী সেটা কখনো নয়।',
  },
  {
    id: 'roles-list',
    say: 'Each role shows what it covers and how many people hold it. Read that last column first: a role nobody holds is safe to change, and one held by thirty is not.',
    sayBn:
      'প্রতিটা role দেখায় সেটা কী কী ঢাকে আর কতজন মানুষ সেটা ধরে আছেন। শেষ কলামটা আগে পড়ুন: যে role কেউ ধরে নেই, সেটা বদলানো নিরাপদ, আর যেটা ত্রিশজন ধরে আছেন, সেটা নয়।',
  },
  {
    id: 'roles-super',
    say: 'One row has a padlock and no Delete. Super admin holds everything, including permissions that do not exist yet, which is what stops a new feature being invisible on the day it ships. It cannot be edited from here at all.',
    sayBn:
      'একটা সারিতে একটা তালা আছে আর কোনো Delete নেই। Super admin সবকিছু ধরে রাখে — এমনকি যে permission-গুলো এখনো তৈরিই হয়নি সেগুলোও — আর এই কারণেই নতুন কোনো সুবিধা চালু হওয়ার দিনে অদৃশ্য হয়ে থাকে না। এটা এখান থেকে একেবারেই বদলানো যায় না।',
  },
  {
    id: 'roles-editor',
    say: 'Click Edit on a real role, and the whole model is on one screen: every permission the system has, grouped, with the ones this role holds ticked. This editor is opened and then closed, so nothing is saved.',
    sayBn:
      'সত্যিকারের একটা role-এ Edit চাপলে পুরো ব্যবস্থাটা এক স্ক্রিনেই দেখা যায়: সিস্টেমের প্রতিটা permission, দলে দলে সাজানো, আর এই role যেগুলো ধরে আছে সেগুলোতে টিক দেওয়া। এই editor-টা খুলে তারপর বন্ধ করে দেওয়া হচ্ছে, তাই কিছুই সেভ হচ্ছে না।',
  },
  {
    id: 'roles-counts',
    say: 'Read the line above the list before anything else: how many permissions this role holds out of the total, and separately how many of those can move money or stock.',
    sayBn:
      'সবার আগে তালিকার উপরের লাইনটা পড়ুন: মোট কতগুলোর মধ্যে এই role কতগুলো permission ধরে আছে, আর আলাদাভাবে তার মধ্যে কতগুলো টাকা বা স্টক নাড়াতে পারে।',
  },
  {
    id: 'roles-groups',
    say: 'They are grouped by part of the business, and every one carries a sentence: not what it is called, but what somebody holding it can actually do.',
    sayBn:
      'এগুলো ব্যবসার অংশ অনুযায়ী দলে সাজানো, আর প্রতিটার সঙ্গে একটা বাক্য থাকে: এটার নাম কী তা নয়, বরং এটা যাঁর কাছে আছে তিনি আসলে কী করতে পারেন।',
  },
  {
    id: 'roles-danger',
    say: 'A triangle means it can move money or stock. It is not a different check, since the server treats every permission alike, but a mark, so a role quietly collecting six says so before it is saved.',
    sayBn:
      'একটা ত্রিভুজ মানে এটা টাকা বা স্টক নাড়াতে পারে। এটা আলাদা কোনো যাচাই নয় — সার্ভার প্রতিটা permission-কে একভাবেই দেখে — এটা শুধু একটা চিহ্ন, যাতে চুপচাপ এমন ছয়টা permission জমিয়ে ফেলা একটা role সেভ হওয়ার আগেই সেটা জানিয়ে দেয়।',
  },
  {
    id: 'roles-search',
    say: 'The search covers the name, the explanation and the key, which is how you answer the question you were actually asked. Somebody cannot finish a return? Type return. Finalise a return sounds like paperwork and permanently removes stock. Act on a parcel at the courier sounds like admin and sends a van.',
    sayBn:
      'search খোঁজে নাম, ব্যাখ্যা আর key — তিনটার মধ্যেই, আর এভাবেই আপনাকে যে প্রশ্নটা আসলে করা হয়েছিল তার উত্তর বের করেন। কেউ একটা ফেরত শেষ করতে পারছেন না? লিখুন return। Finalise a return শুনতে কাগজপত্রের কাজ মনে হয়, কিন্তু এটা স্টক চিরতরে সরিয়ে দেয়। Act on a parcel at the courier শুনতে অফিসের কাজ মনে হয়, কিন্তু এটা একটা গাড়ি পাঠিয়ে দেয়।',
  },
  {
    id: 'roles-cancel',
    say: 'Cancel closes it without saving. A role is held by real people, and changing one is not something to do while looking around. To change one for real: tick or untick, read the counts again, then Save.',
    sayBn:
      'Cancel সেভ না করেই এটা বন্ধ করে দেয়। একটা role সত্যিকারের মানুষেরা ধরে আছেন, আর ঘুরে ঘুরে দেখতে দেখতে সেটা বদলে ফেলার জিনিস নয়। সত্যিই বদলাতে হলে: টিক দিন বা টিক তুলে দিন, সংখ্যাগুলো আবার পড়ুন, তারপর Save চাপুন।',
  },
  {
    id: 'roles-boundary',
    say: 'Last, what keeps this honest. Hiding a button is a courtesy. The server checks the permission on every request, so a control you cannot see is refused anyway if somebody finds it.',
    sayBn:
      'সবশেষে, এই ব্যবস্থাটা কী দিয়ে সৎ থাকে। একটা বোতাম লুকিয়ে রাখা শুধু ভদ্রতা। সার্ভার প্রতিটা অনুরোধেই permission যাচাই করে, তাই আপনি যে নিয়ন্ত্রণটা দেখতে পান না, কেউ সেটা খুঁজে বের করলেও সেটা আটকে দেওয়া হয়।',
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
    sayBn:
      'ভারতে বেশির ভাগ পার্সেলের দাম দরজায় নগদে দেওয়া হয়, তাই আগে কেউ ফোন করে জিজ্ঞেস করে ক্রেতা অর্ডারটা এখনো চান কি না। এটাই কল সেন্টার, আর একজন এজেন্ট ফলাফল লিখে না রাখা পর্যন্ত তার পরের কিছুই এগোয় না। Call centre খুলুন। এটা একজন এজেন্টের গোটা শিফট, এক স্ক্রিনে।',
  },
  {
    id: 'call-availability',
    say: 'It opens saying you are not taking calls, and that is deliberate: being signed in is not the same as being at your desk, and an order handed to an empty chair waits. Start taking calls is the one switch that puts you on the roster. It is not pressed here, because pressing it would claim a real customer.',
    sayBn:
      'এটা খোলার সময় বলে যে আপনি এখন কল নিচ্ছেন না, আর এটা ইচ্ছে করেই: sign in করা থাকা মানে আপনি ডেস্কে বসে আছেন তা নয়, আর ফাঁকা চেয়ারে দেওয়া অর্ডার পড়ে থাকে। Start taking calls-ই একমাত্র সুইচ যেটা আপনাকে roster-এ তোলে। এখানে এটা চাপা হচ্ছে না, কারণ চাপলে একজন সত্যিকারের ক্রেতাকে নিজের হাতে নিয়ে নেওয়া হবে।',
  },
  {
    id: 'call-arrives',
    say: 'You never ask for work. Once you are available, the next customer in the queue, oldest first, is handed to you and claimed the instant it appears, so two agents are never given the same one. This call was already handed to the filming agent, which is why a call is on screen.',
    sayBn:
      'আপনাকে কখনো কাজ চাইতে হয় না। আপনি available হলেই সারির পরের ক্রেতা — সবচেয়ে পুরোনোটা আগে — আপনার হাতে দেওয়া হয়, আর পর্দায় আসার সঙ্গে সঙ্গেই সেটা আপনার নামে আটকে যায়, যাতে দুজন এজেন্ট কখনো একই ক্রেতা না পান। এই কলটা আগেই ফিল্ম করার এজেন্টের হাতে দেওয়া হয়েছিল, সেজন্যই পর্দায় একটা কল দেখা যাচ্ছে।',
  },
  {
    id: 'call-purpose',
    say: 'Read the purpose line before you dial. A call to confirm a new order and a call because a client asked us to chase one open with different sentences, and the wrong one loses the customer.',
    sayBn:
      'ফোন করার আগে purpose-এর লাইনটা পড়ুন। নতুন একটা অর্ডার confirm করার কল আর client-এর অনুরোধে তাগাদা দেওয়ার কল — দুটোর শুরুর কথা আলাদা, আর ভুলটা বললে ক্রেতা হাত থেকে চলে যায়।',
  },
  {
    id: 'call-risk',
    say: 'Then the customer. This strip appears only when there is something to say, here that parcels of theirs came back before, which is worth knowing before agreeing to send another.',
    sayBn:
      'তারপর ক্রেতা। বলার মতো কিছু থাকলেই কেবল এই অংশটা দেখা যায় — এখানে যেমন বলছে যে এঁর পার্সেল আগে ফেরত এসেছে, আর আরেকটা পাঠাতে রাজি হওয়ার আগে এটা জানা দরকার।',
  },
  {
    id: 'call-recipient',
    say: 'Who they are, where it is going, and what they will be asked to hand over at the door. Say that last figure aloud: agreeing to the parcel is agreeing to the money.',
    sayBn:
      'ইনি কে, পার্সেলটা কোথায় যাচ্ছে, আর দরজায় তাঁকে কত টাকা দিতে বলা হবে। শেষের ওই সংখ্যাটা মুখে বলে শুনিয়ে দিন: পার্সেলে রাজি হওয়া মানেই টাকায় রাজি হওয়া।',
  },
  {
    id: 'call-outcome',
    say: 'After the call, you record what happened. Open the Outcome list: nine outcomes, and the line underneath tells you what each does before you pick it. Choose Confirmed and read that line.',
    sayBn:
      'কল শেষ হলে কী হলো সেটা আপনি লিখে রাখবেন। Outcome তালিকাটা খুলুন: নয়টা outcome, আর নিচের লাইনটা বেছে নেওয়ার আগেই বলে দেয় প্রতিটা কী করে। Confirmed বেছে নিন আর ওই লাইনটা পড়ুন।',
  },
  {
    id: 'call-permanent',
    say: 'Confirmed is the one to be careful with: it holds stock for this order and sends it to the warehouse. And every attempt you log is permanent and counts toward the limit before we stop trying.',
    sayBn:
      'Confirmed নিয়েই সবচেয়ে সাবধান থাকতে হয়: এটা এই অর্ডারের জন্য স্টক আটকে রাখে আর অর্ডারটা গুদামে পাঠিয়ে দেয়। আর আপনি যে প্রতিটা চেষ্টা লিখে রাখেন সেটা চিরস্থায়ী, আর চেষ্টা বন্ধ করার আগে যে সীমা আছে তার হিসাবেও ধরা হয়।',
  },
  {
    id: 'call-note',
    say: 'Then Notes. Write what they actually said. The next agent who rings them reads it, and so does the client asking why their order has not moved.',
    sayBn:
      'তারপর Notes। তিনি আসলে যা বলেছেন সেটাই লিখুন। পরে যে এজেন্ট তাঁকে ফোন করবেন তিনি এটা পড়বেন, আর যে client জিজ্ঞেস করবেন তাঁর অর্ডারটা কেন এগোচ্ছে না, তিনিও এটা পড়বেন।',
  },
  {
    id: 'call-record',
    say: 'Record outcome writes the attempt, and the order moves by itself. There is no second confirmation, which is why you check the outcome before the press, not after. The pointer stays on it here; nothing is recorded.',
    sayBn:
      'Record outcome চেষ্টাটা লিখে ফেলে, আর অর্ডারটা নিজে থেকেই এগিয়ে যায়। দ্বিতীয়বার কোনো নিশ্চিতকরণ চাওয়া হয় না, আর সেজন্যই outcome-টা চাপার আগে মিলিয়ে নিতে হয়, পরে নয়। এখানে পয়েন্টার এটার উপরেই থাকছে; কিছুই লেখা হচ্ছে না।',
  },
  {
    id: 'call-release',
    say: 'If you cannot take a call, Release without attempt. No attempt is recorded and it goes back in the queue for somebody else, which is honest, unlike logging a call you did not make.',
    sayBn:
      'কোনো কল যদি আপনি নিতে না পারেন, Release without attempt চাপুন। কোনো চেষ্টা লেখা হয় না আর এটা অন্য কারো জন্য আবার সারিতে ফিরে যায় — এটাই সৎ কাজ, যে কলটা আপনি করেননি সেটা লিখে রাখার মতো নয়।',
  },
  {
    id: 'call-stop',
    say: 'At the end of the shift it is the same switch the other way: Stop taking calls. Nothing new is assigned and the queue keeps its place. Switching off does not hand back a call you already hold; the supervisor’s screen is for that.',
    sayBn:
      'শিফট শেষে সেই একই সুইচ উল্টো দিকে: Stop taking calls। নতুন কিছু আর আপনাকে দেওয়া হয় না, আর সারি নিজের জায়গাতেই থাকে। সুইচ বন্ধ করলে আপনার হাতে আগে থেকে থাকা কল ফিরিয়ে দেওয়া হয় না; সেটার জন্য সুপারভাইজারের স্ক্রিন আছে।',
  },
  {
    id: 'q-open',
    say: 'The station shows an agent one call and nothing else. A supervisor needs the opposite: everything waiting, and whose hands it is in. That is Call queue, under Call centre.',
    sayBn:
      'station একজন এজেন্টকে একটা কল দেখায়, আর কিছুই নয়। সুপারভাইজারের দরকার ঠিক উল্টোটা: যা যা অপেক্ষা করছে সবকিছু, আর কোনটা কার হাতে আছে। সেটাই Call queue, Call centre-এর নিচে।',
  },
  {
    id: 'q-tiles',
    say: 'Four counts: Open, which is the two live states together; how many nobody has taken; how many somebody has; and how many people are holding work right now.',
    sayBn:
      'চারটা সংখ্যা: Open, মানে চলতি দুটো অবস্থা একসঙ্গে; কতগুলো এখনো কেউ নেয়নি; কতগুলো কেউ নিয়েছে; আর এই মুহূর্তে কতজন মানুষ কাজ হাতে ধরে আছেন।',
  },
  {
    id: 'q-filter',
    say: 'It opens on Open, deliberately. A finished attempt leaves its own row, and an order retried has one per round, so showing everything buries the live queue in history. Change the filter only to look backwards.',
    sayBn:
      'এটা ইচ্ছে করেই Open-এ খোলে। শেষ হয়ে যাওয়া প্রতিটা চেষ্টা নিজের একটা সারি রেখে যায়, আর যে অর্ডারে আবার চেষ্টা হয়েছে তার প্রতি রাউন্ডে একটা করে সারি থাকে — তাই সব দেখালে চলতি সারিটা পুরোনো ইতিহাসের নিচে ঢাকা পড়ে যায়। পিছনের দিকে দেখার দরকার হলেই কেবল filter বদলান।',
  },
  {
    id: 'q-row',
    say: 'Each row is one order: how long it has waited, when it next becomes callable, how many calls are logged against the limit, and how many times it has been picked up.',
    sayBn:
      'প্রতিটা সারি একটা অর্ডার: কতক্ষণ অপেক্ষা করছে, পরের বার কখন থেকে ফোন করা যাবে, সীমার হিসাবে কতগুলো কল লেখা হয়েছে, আর কতবার এটা কারো হাতে নেওয়া হয়েছে।',
  },
  {
    id: 'q-stuck',
    say: 'The last two columns are the reason this page exists. This row was picked up once and called zero times: somebody took it and never rang, and until this screen existed nobody could see that. Look for picked up higher than called.',
    sayBn:
      'শেষ দুটো কলামের জন্যই এই পৃষ্ঠাটা আছে। এই সারিটা একবার picked up হয়েছে আর called হয়েছে শূন্যবার: কেউ এটা নিয়েছে কিন্তু কখনো ফোন করেনি, আর এই স্ক্রিনটা না থাকা পর্যন্ত কেউ সেটা দেখতেই পারত না। খুঁজবেন যেখানে picked up-এর সংখ্যা called-এর চেয়ে বেশি।',
  },
  {
    id: 'q-reassign',
    say: 'To move it, click Reassign on its row. The dialog promises that the order keeps its place in the queue and every attempt already logged; only the name changes.',
    sayBn:
      'এটা সরাতে হলে ওই সারির Reassign-এ ক্লিক করুন। dialog-টা নিশ্চিত করে যে অর্ডারটা queue-তে তার জায়গা আর আগে লেখা হয়ে যাওয়া প্রতিটা attempt — সবই ধরে রাখে; শুধু নামটা বদলায়।',
  },
  {
    id: 'q-reassign-pick',
    say: 'Choose the new agent from the list. Only agents marked available are offered, and each shows what they already carry, because handing a stuck call to someone at their limit moves the problem. Then press Reassign. Here we close the dialog without moving it.',
    sayBn:
      'তালিকা থেকে নতুন agent বেছে নিন। শুধু যাদের available লেখা আছে তাদেরই দেখানো হয়, আর প্রত্যেকের পাশে দেখা যায় তার হাতে আগেই কতটা আছে — কারণ আটকে থাকা একটা কল যদি এমন কাউকে দেন যার সীমা আগেই পূর্ণ, তাহলে সমস্যাটা শুধু জায়গা বদলায়। তারপর Reassign চাপুন। এখানে আমরা না সরিয়েই dialog-টা বন্ধ করছি।',
  },
  {
    id: 'q-reschedule',
    say: 'The other lever is timing. Every queued call has a time it becomes callable. Click Reschedule on a row to bring one forward when a customer rings back, or push one out.',
    sayBn:
      'আরেকটা হাতল হলো সময়। queue-তে থাকা প্রতিটা কলের একটা সময় আছে, যখন থেকে সেটা callable হয়। কোনো ক্রেতা নিজে ফোন করলে কলটা এগিয়ে আনতে, বা কলটা পিছিয়ে দিতে, সারির Reschedule-এ ক্লিক করুন।',
  },
  {
    id: 'q-reschedule-when',
    say: 'Pick a shortcut, such as Tomorrow, and write a reason. Moving when somebody gets telephoned is a decision you should be able to account for. Saving changes the callable time and nothing else: not the attempt count, not the order, not its place.',
    sayBn:
      'একটা shortcut বেছে নিন — যেমন Tomorrow — আর একটা কারণ লিখুন। কাউকে কখন ফোন করা হবে সেটা সরানো এমন একটা সিদ্ধান্ত, যার জবাব আপনার দিতে পারা উচিত। সেভ করলে শুধু callable সময়টা বদলায়, আর কিছুই নয়: attempt-এর সংখ্যা নয়, অর্ডার নয়, queue-তে তার জায়গাও নয়।',
  },
  {
    id: 'q-force-open',
    say: 'The third button, Force outcome, is not like those two. It records a call that did not happen, under your name, permanently. It is dangerous. Click it, and the dialog goes red with a gavel on the title: that is the screen telling you which kind of act this is.',
    sayBn:
      'তৃতীয় বোতামটা, Force outcome, ওই দুটোর মতো নয়। যে কলটা হয়নি সেটাই এটা আপনার নামে স্থায়ীভাবে লিখে রাখে। এটা বিপজ্জনক। এটায় ক্লিক করলে dialog-টা লাল হয়ে যায় আর শিরোনামের পাশে একটা হাতুড়ি আসে: স্ক্রিনটা এভাবেই আপনাকে বলছে এটা কোন ধরনের কাজ।',
  },
  {
    id: 'q-force-warning',
    say: 'Read the line under the title, because it is the whole warning. This is recorded as a real attempt against your name, with exactly the effect an agent’s call would have had. It runs through the same service, so it is not a special case.',
    sayBn:
      'শিরোনামের নিচের লাইনটা পড়ুন, কারণ পুরো সতর্কবার্তাটাই ওটা। এটা আপনার নামে একটা সত্যিকারের attempt হিসেবে লেখা হয়, আর একজন agent-এর কল যা করত ঠিক সেই প্রভাবই এটা ফেলে। এটা একই service দিয়ে চলে, তাই এটা কোনো আলাদা ব্যতিক্রম নয়।',
  },
  {
    id: 'q-force-outcomes',
    say: 'Open the Outcome list: the same nine an agent sees. Read the line under the choice rather than the label. Choose Confirmed and it says it reserves stock and advances the order, which is a van and a parcel moving on a conversation you are asserting happened.',
    sayBn:
      'Outcome তালিকাটা খুলুন: একজন agent যে নয়টা দেখে, হুবহু সেগুলোই। লেবেলটা নয়, পছন্দটার নিচের লাইনটা পড়ুন। Confirmed বাছলে লেখা থাকে যে এটা স্টক reserve করে আর অর্ডারটাকে এগিয়ে দেয় — মানে একটা গাড়ি আর একটা পার্সেল নড়ছে এমন একটা কথাবার্তার ভিত্তিতে, যেটা হয়েছে বলে আপনি দাবি করছেন।',
  },
  {
    id: 'q-force-declined',
    say: 'Choose Customer declined and the line says the word that matters: terminal. The order is rejected and this screen has no way back. The only way out of a rejected order is a client asking us to call again, which comes later.',
    sayBn:
      'Customer declined বাছলে লাইনটায় আসল শব্দটা লেখা থাকে: terminal। অর্ডারটা rejected হয়ে যায় আর এই স্ক্রিন থেকে ফেরার কোনো পথ নেই। rejected একটা অর্ডার থেকে বেরোনোর একমাত্র উপায় হলো client আমাদের আবার ফোন করতে বলা — সেটা পরে আসছে।',
  },
  {
    id: 'q-force-when',
    say: 'Next, when the call happened, not when you are typing. The ledger records real conversations, so enter the real time.',
    sayBn:
      'এরপর, কলটা কখন হয়েছিল — আপনি কখন টাইপ করছেন তা নয়। এই খাতায় সত্যিকারের কথাবার্তাই লেখা হয়, তাই আসল সময়টাই লিখুন।',
  },
  {
    id: 'q-force-notes',
    say: 'Then say why. The attempt log is append-only, nothing can be edited afterwards, and this box is the only place your reason will ever live.',
    sayBn:
      'তারপর কেন, সেটা লিখুন। attempt-এর লগে শুধু নতুন লাইন যোগ হয়, পরে কিছুই সম্পাদনা করা যায় না, আর আপনার কারণটা কোথাও বলতে একমাত্র এই বাক্সেই থেকে যাবে।',
  },
  {
    id: 'q-force-record',
    say: 'Record this outcome is one press with no second confirmation. It would write the attempt under your name, count toward the cap, move the order by the ordinary mapping, and cannot be undone. Use it only when you already know how the call ends. The dialog is closed here without pressing it.',
    sayBn:
      'Record this outcome একবার চাপলেই হয়ে যায়, দ্বিতীয় কোনো নিশ্চিতকরণ নেই। এটা attempt-টা আপনার নামে লিখবে, cap-এর হিসাবে গণ্য হবে, সাধারণ mapping অনুযায়ী অর্ডারটা সরাবে, আর ফেরানো যাবে না। কলটা কীভাবে শেষ হয় সেটা আগেই জানা থাকলেই শুধু এটা ব্যবহার করুন। এখানে এটা না চেপেই dialog-টা বন্ধ করা হচ্ছে।',
  },
  {
    id: 'q-agents',
    say: 'Now the people. Open Call agents: who is on, their hours, their languages, and how many calls each carries against a cap.',
    sayBn:
      'এবার মানুষগুলো। Call agents খুলুন: কে কাজে আছে, কার কী সময়, কে কোন ভাষা বলে, আর cap-এর তুলনায় প্রত্যেকের হাতে কতগুলো কল আছে।',
  },
  {
    id: 'q-agent-cap',
    say: 'Click Details on a row. Off does not mean empty: going off shift hands nothing back, which is why a call can carry the name of someone who has gone home. The cap is here too. One at a time is the default, so raise it only for somebody genuinely idle, then press Save capacity. Here the field is filled and the dialog closed.',
    sayBn:
      'কোনো সারির Details-এ ক্লিক করুন। Off মানে খালি নয়: shift শেষ করলে হাতের কিছুই ফিরে যায় না, আর সেজন্যই একটা কলের গায়ে এমন কারো নাম থাকতে পারে যে বাড়ি চলে গেছে। cap-ও এখানেই আছে। ডিফল্ট হলো একবারে একটা, তাই সত্যিই যার হাতে কাজ নেই শুধু তারই cap বাড়ান, তারপর Save capacity চাপুন। এখানে ঘরটা পূরণ করে dialog-টা বন্ধ করা হচ্ছে।',
  },
  {
    id: 'rr-open',
    say: 'One more queue belongs to the call centre. Every order here has a customer who was rung, answered and said no. The client thinks it was a misunderstanding and asks us to try once more. A refusal is terminal on purpose, so this request is the only way back. Open Call-again requests.',
    sayBn:
      'কল সেন্টারের আরও একটা queue আছে। এখানে প্রতিটা অর্ডারের ক্রেতাকে ফোন করা হয়েছে, সে ফোন ধরেছে আর না বলেছে। client মনে করে এটা একটা ভুল বোঝাবুঝি ছিল, তাই আমাদের আরেকবার চেষ্টা করতে বলে। না বলাটা ইচ্ছে করেই terminal, তাই ফেরার একমাত্র পথ এই অনুরোধ। Call-again requests খুলুন।',
  },
  {
    id: 'rr-card',
    say: 'A card is mostly its reason, printed at full width. You are being asked to ring somebody who already declined, so the reason is the decision. The test is whether anything has actually changed, such as the customer ringing the shop back.',
    sayBn:
      'একটা card-এর বেশিরভাগটাই তার কারণ, পুরো চওড়া জুড়ে লেখা। আপনাকে এমন একজনকে ফোন করতে বলা হচ্ছে যে আগেই না বলে দিয়েছে, তাই কারণটাই আসল সিদ্ধান্ত। দেখার বিষয় একটাই — সত্যিই কিছু বদলেছে কি না, যেমন ক্রেতা নিজে দোকানে ফোন করেছে কি না।',
  },
  {
    id: 'rr-approve',
    say: 'To approve, click Approve — call again. The dialog restates what happens: the order leaves rejected, returns to waiting for confirmation, and joins the call queue like any other.',
    sayBn:
      'অনুমোদন করতে Approve — call again-এ ক্লিক করুন। dialog-টা আবার বলে দেয় কী হবে: অর্ডারটা rejected থেকে বেরিয়ে আসে, আবার নিশ্চিতকরণের অপেক্ষায় ফিরে যায়, আর আর সবগুলোর মতোই call queue-তে ঢোকে।',
  },
  {
    id: 'rr-extra',
    say: 'Then the part nobody expects: Extra calls. Approving does not reset the attempt count, so with none granted the order returns already out of chances and the first unanswered ring rejects it again. Grant one to five. Add a note if you know something the client does not, then press Approve. Here the dialog closes.',
    sayBn:
      'তারপর যে অংশটা কেউ আশা করে না: Extra calls। অনুমোদন দিলে attempt-এর সংখ্যা শূন্য হয়ে যায় না, তাই একটাও বাড়তি কল না দিলে অর্ডারটা ফিরে আসে সুযোগ শেষ হয়ে যাওয়া অবস্থাতেই, আর প্রথম যে ফোনটা কেউ ধরবে না সেটাই আবার অর্ডারটা reject করে দেবে। এক থেকে পাঁচটা দিন। client যা জানে না আপনি যদি তেমন কিছু জানেন তাহলে একটা note যোগ করুন, তারপর Approve চাপুন। এখানে dialog-টা বন্ধ হয়ে যাচ্ছে।',
  },
  {
    id: 'rr-decline',
    say: 'To refuse, click Decline on a card where nothing new has happened, say why in the note because the client reads it, and press Decline request. The order stays rejected, and they may ask again when something genuinely changes.',
    sayBn:
      'না করতে হলে, যে card-এ নতুন কিছুই ঘটেনি তার Decline-এ ক্লিক করুন, note-এ কারণটা লিখুন — কারণ client এটা পড়বে — আর Decline request চাপুন। অর্ডারটা rejected-ই থাকে, আর সত্যিই কিছু বদলালে তারা আবার অনুরোধ করতে পারে।',
  },
  {
    id: 'rr-history',
    say: 'Nothing here is deleted. Change the status filter to all, and every decided request is still listed, with what was granted and what was written beside it. A waiting queue here means somebody is waiting on a decision only a person can make; most days it should be empty.',
    sayBn:
      'এখানে কিছুই মুছে ফেলা হয় না। status filter-টা all করে দিন, আর সিদ্ধান্ত হয়ে যাওয়া প্রতিটা অনুরোধ তালিকায় থেকে যায় — পাশে লেখা থাকে কী দেওয়া হয়েছিল আর কী লেখা হয়েছিল। এখানে অপেক্ষায় থাকা একটা queue মানে কেউ এমন একটা সিদ্ধান্তের অপেক্ষায় আছে যা শুধু একজন মানুষই নিতে পারে; বেশিরভাগ দিন এটা খালি থাকাই উচিত।',
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
    sayBn:
      'এবার গুদামের মেঝে। এর hub-টা কাজগুলো সেই ক্রমেই সাজিয়ে রাখে যে ক্রমে ভবনটা কাজ করে: consignment আসে, receive, print, pick, pack, hand over, dispatch। এই ভিডিওটা ওই ক্রমই অনুসরণ করবে। Warehouse খুলুন।',
  },
  {
    id: 'bins-open',
    say: 'First, where things live. Open Bins. The top half is every bin across the business, with the product, the client and the batch on each. The lower half is the layout of one building. Filter the top by building, kind of bin, client, or a SKU you are hunting for.',
    sayBn:
      'প্রথমে, জিনিসগুলো কোথায় থাকে। Bins খুলুন। উপরের অর্ধেকটা পুরো ব্যবসার প্রতিটা bin, প্রত্যেকটার গায়ে product, client আর batch লেখা। নিচের অর্ধেকটা একটা ভবনের ছক। উপরের অংশটা ছাঁকতে পারেন ভবন ধরে, bin-এর ধরন ধরে, client ধরে, বা আপনি যে SKU খুঁজছেন সেটা ধরে।',
  },
  {
    id: 'bins-overview',
    say: 'Some stock is deliberately not sellable. Held, damaged and quarantine bins are counted but never picked from. In transit means stock that left one warehouse and has not arrived at the next, counted here so neither building goes looking for it.',
    sayBn:
      'কিছু স্টক ইচ্ছে করেই বিক্রির জন্য রাখা হয় না। Held, damaged আর quarantine bin-গুলো গণনায় থাকে, কিন্তু সেখান থেকে কখনো pick করা হয় না। In transit মানে যে স্টক একটা গুদাম থেকে বেরিয়ে গেছে কিন্তু পরের গুদামে এখনো পৌঁছায়নি — এখানে গোনা হয় যাতে কোনো ভবনই সেটা খুঁজতে না বসে।',
  },
  {
    id: 'bins-building',
    say: 'Everything below is one building at a time. Choose it with the Warehouse picker. Our Dhaka intake warehouse is the example: one floor, no shelving, nothing on it.',
    sayBn:
      'নিচের সবকিছু একবারে একটা ভবনের। Warehouse picker দিয়ে ভবনটা বেছে নিন। উদাহরণ হিসেবে আমাদের ঢাকার intake গুদাম: একটা মেঝে, কোনো তাক নেই, তার উপরে কিছুই নেই।',
  },
  {
    id: 'bins-tracking',
    say: 'Location tracking is the switch, and it is off. Off means everything lands on the floor and picking sheets name no shelf. On means receiving asks which bin and picking sheets name a shelf. You cannot turn it on until a bin exists. Turning it off later stops the system asking; it does not collapse anything you built.',
    sayBn:
      'Location tracking হলো সেই switch, আর এটা এখন off আছে। Off মানে সবকিছু মেঝেতেই নামে আর picking sheet-এ কোনো তাকের নাম থাকে না। On মানে receiving জিজ্ঞেস করে কোন bin, আর picking sheet-এ তাকের নাম থাকে। একটা bin তৈরি না হওয়া পর্যন্ত আপনি এটা on করতে পারবেন না। পরে off করে দিলে সিস্টেম আর জিজ্ঞেস করা বন্ধ করে দেয়; আপনি যা বানিয়েছেন তার কিছুই ভেঙে ফেলে না।',
  },
  {
    id: 'bins-compose',
    say: 'To build a shelf, open Add a bin. Choose a zone, because zones carry pick order, so a picker walks the building in a sensible sequence. Then type three coordinates: aisle, rack, shelf. You never type the name.',
    sayBn:
      'একটা তাক বানাতে Add a bin খুলুন। একটা zone বেছে নিন, কারণ zone-এর সঙ্গে pick order জড়ানো থাকে, তাই picker ভবনটা একটা যুক্তিসঙ্গত ক্রমে হেঁটে যায়। তারপর তিনটা স্থানাঙ্ক লিখুন: aisle, rack, shelf। নামটা আপনি কখনোই লেখেন না।',
  },
  {
    id: 'bins-add',
    say: 'The page shows what those coordinates become before you commit, so one shelf cannot end up with three spellings. Add bin creates it, empty and pickable. It is not pressed here.',
    sayBn:
      'আপনি চূড়ান্ত করার আগেই পৃষ্ঠাটা দেখিয়ে দেয় ওই স্থানাঙ্কগুলো মিলে কী হবে, যাতে একটা তাকের তিন রকম বানান না হয়ে যায়। Add bin সেটা তৈরি করে — খালি আর pickable। এখানে এটা চাপা হচ্ছে না।',
  },
  {
    id: 'bins-move',
    say: 'Further down is re-shelving. You do not list what is in a bin: you name the two bins and the server moves everything in one transaction, or a list of lines that all commit or none do.',
    sayBn:
      'আরও নিচে আছে তাক বদলের কাজ। একটা bin-এ কী আছে সেটা আপনি তালিকা করেন না: আপনি শুধু দুটো bin-এর নাম বলেন আর server একটাই transaction-এ সবকিছু সরিয়ে দেয় — অথবা কয়েকটা লাইনের একটা তালিকা, যেখানে সবগুলোই commit হয় নয়তো একটাও হয় না।',
  },
  {
    id: 'recv-queue',
    say: 'Goods are at the door. Until somebody counts them they are a promise on a screen; once counted they become stock a customer can be sold. Open Receive. It opens on what is waiting, which is the only list that matters on a delivery morning.',
    sayBn:
      'পণ্য দরজায় এসে গেছে। কেউ গুনে না দেখা পর্যন্ত এগুলো শুধু স্ক্রিনে লেখা একটা প্রতিশ্রুতি; গোনা হয়ে গেলে এগুলো এমন স্টক হয়ে যায় যা একজন ক্রেতার কাছে বিক্রি করা যায়। Receive খুলুন। এটা খোলে যা অপেক্ষায় আছে তা দিয়ে — মাল আসার সকালে ওই তালিকাটাই একমাত্র দরকারি তালিকা।',
  },
  {
    id: 'recv-open',
    say: 'Click a receipt. The declaration says who the client is, their own reference, which building it landed at, and what they say is in the boxes.',
    sayBn:
      'একটা receipt-এ ক্লিক করুন। ঘোষণাটা বলে দেয় client কে, তাদের নিজের reference কী, কোন ভবনে মালটা নেমেছে, আর তারা বলছে বাক্সগুলোর ভিতরে কী আছে।',
  },
  {
    id: 'recv-declared',
    say: 'The expected figures are the client’s. Nothing has been counted, so each line says recorded nought.',
    sayBn:
      'expected সংখ্যাগুলো client-এর দেওয়া। এখনো কিছুই গোনা হয়নি, তাই প্রতিটা লাইনে recorded লেখা আছে শূন্য।',
  },
  {
    id: 'recv-claimed',
    say: 'Press Start receiving. That claims the receipt in your name, so two people cannot count one pallet from two ends of the building and overwrite each other. The count fields appear only once it is claimed, and the name on it is now yours.',
    sayBn:
      'Start receiving চাপুন। এতে receipt-টা আপনার নামে দাবি করা হয়ে যায়, যাতে দুজন মানুষ ভবনের দুই দিক থেকে একই pallet গুনে একজন আরেকজনের হিসাব মুছে না দেয়। count-এর ঘরগুলো দাবি করার পরেই দেখা যায়, আর এখন এর গায়ে আপনার নামই লেখা।',
  },
  {
    id: 'recv-count',
    say: 'Each line asks three things: how many good ones you found, how many arrived damaged, and which shelf you are putting them on. This building keeps no shelf numbers, so the floor. Type what is really in the carton. Ten declared, ten counted, none damaged.',
    sayBn:
      'প্রতিটা লাইন তিনটা জিনিস জিজ্ঞেস করে: আপনি কতগুলো ভালো পেলেন, কতগুলো damaged অবস্থায় এসেছে, আর আপনি সেগুলো কোন তাকে রাখছেন। এই ভবনে কোনো তাকের নম্বর রাখা হয় না, তাই মেঝে। কার্টনে আসলে যা আছে তাই লিখুন। declared দশ, গোনা হলো দশ, damaged একটাও নয়।',
  },
  {
    id: 'recv-short',
    say: 'The second line is short: twenty declared, eighteen good, one damaged. So one is missing outright and one arrived broken. Record what you found, not what was promised.',
    sayBn:
      'দ্বিতীয় লাইনটায় কম আছে: declared কুড়ি, ভালো আঠারো, damaged একটা। মানে একটা একেবারেই নেই আর একটা ভাঙা অবস্থায় এসেছে। যা প্রতিশ্রুতি দেওয়া হয়েছিল তা নয়, আপনি যা পেলেন সেটাই লিখুন।',
  },
  {
    id: 'recv-record',
    say: 'Record all products saves the counts as what the bench says. Stock is not written yet.',
    sayBn:
      'Record all products গণনাগুলোকে বেঞ্চের বক্তব্য হিসেবে সেভ করে রাখে। স্টক এখনো লেখা হয়নি।',
  },
  {
    id: 'recv-complete',
    say: 'Complete is dangerous. It writes stock for what was counted, closes the receipt, and cannot be cancelled afterwards; a miscount is corrected with a stock adjustment, a second entry. A variance never blocks: the gap is recorded and the goods carry on. Afterwards, Print product labels prints a sticker per unit received. The pointer stays on Complete.',
    sayBn:
      'Complete বিপজ্জনক। যা গোনা হয়েছে তার জন্য এটা স্টক লিখে দেয়, receipt-টা বন্ধ করে দেয়, আর পরে বাতিল করা যায় না; ভুল গোনা ঠিক করতে হয় একটা stock adjustment দিয়ে — মানে দ্বিতীয় একটা এন্ট্রি দিয়ে। পার্থক্য থাকলে কখনোই কিছু আটকায় না: ফাঁকটা লেখা থাকে আর পণ্য এগিয়ে চলে। এর পরে Print product labels যতগুলো unit এসেছে তার প্রতিটার জন্য একটা স্টিকার ছাপায়। পয়েন্টারটা Complete-এর উপরেই থাকে।',
  },
  {
    id: 'print-open',
    say: 'Next, the morning’s paper. Every confirmed order already carries a waybill, and Labels and picking turns a list of them into paper somebody can walk the building with. The subtitle is the rule: nothing moves until somebody confirms the paper actually came out.',
    sayBn:
      'এরপর, সকালের কাগজ। প্রতিটা confirmed অর্ডারের গায়ে আগেই একটা waybill থাকে, আর Labels and picking সেগুলোর একটা তালিকাকে এমন কাগজে বদলে দেয় যা নিয়ে কেউ ভবনটা হেঁটে ঘুরতে পারে। সাবটাইটেলটাই নিয়ম: কাগজটা সত্যিই বেরিয়েছে কেউ সেটা নিশ্চিত না করা পর্যন্ত কিছুই নড়ে না।',
  },
  {
    id: 'print-select',
    say: 'The Labels tab shows what is waiting: order, client, courier, waybill, destination, what the customer owes at the door, and item count. You do not print the whole queue. Tick the parcels you will walk in one go.',
    sayBn:
      'Labels tab দেখায় কী অপেক্ষায় আছে: order, client, কুরিয়ার, waybill, গন্তব্য, দরজায় ক্রেতা কত টাকা দেবে, আর কতগুলো জিনিস আছে। পুরো queue আপনি ছাপান না। একবারে যে পার্সেলগুলো নিয়ে হাঁটবেন শুধু সেগুলোতে টিক দিন।',
  },
  {
    id: 'print-press',
    say: 'Print labels sends the file to the printer, then asks whether the paper came out and names anything it could not print. Answer Yes, they printed only for paper in your hand; saying yes moves those parcels along. The pointer stays on the button.',
    sayBn:
      'Print labels ফাইলটা প্রিন্টারে পাঠায়, তারপর জিজ্ঞেস করে কাগজ বেরিয়েছে কি না, আর যা ছাপাতে পারেনি তার নাম বলে দেয়। Yes, they printed শুধু তখনই বলবেন যখন কাগজটা আপনার হাতে আছে; yes বললে ওই পার্সেলগুলো পরের ধাপে চলে যায়। পয়েন্টারটা বোতামের উপরেই থাকে।',
  },
  {
    id: 'pick-tab',
    say: 'The second tab, Picking list, is the sheet that tells a person which shelves to visit and in what order. Same parcels, second paper.',
    sayBn:
      'দ্বিতীয় tab-টা, Picking list, হলো সেই শিট যেটা একজনকে বলে দেয় কোন কোন তাকে যেতে হবে আর কোন ক্রমে। একই পার্সেল, দ্বিতীয় কাগজ।',
  },
  {
    id: 'pick-list',
    say: 'Tick a walk and press Print picking list. It says how many lines there are to walk and marks anything it could not allocate. Confirming it does the real work: it claims the exact units on the exact shelves and sends every order on it to be picked, so a shortfall surfaces here and not in an aisle.',
    sayBn:
      'একটা walk-এ টিক দিন আর Print picking list চাপুন। এটা বলে দেয় কতগুলো লাইন হেঁটে শেষ করতে হবে, আর যা allocate করতে পারেনি তা চিহ্নিত করে দেয়। আসল কাজটা হয় নিশ্চিত করার সময়ে: এটা ঠিক ঠিক তাকের ঠিক ঠিক unit-গুলো দাবি করে নেয় আর শিটের প্রতিটা অর্ডারকে pick করার জন্য পাঠিয়ে দেয়, তাই কোনো ঘাটতি থাকলে সেটা এখানেই ধরা পড়ে, গুদামের সারিতে গিয়ে নয়।',
  },
  {
    id: 'pick-batches',
    say: 'Every sheet is a batch. Past batches shows when it was made, by whom, when it printed, and whether more than one copy is loose in the building. When the trolley comes back, Mark picked arrives parcels at the packing bench. Anything tracked unit by unit stays behind for the pick station, because a serial must be scanned.',
    sayBn:
      'প্রতিটা শিট একটা batch। Past batches দেখায় এটা কখন তৈরি হয়েছে, কে করেছে, কখন ছাপা হয়েছে, আর ভবনের ভিতরে এর একাধিক কপি ছড়িয়ে আছে কি না। ট্রলি ফিরে এলে Mark picked পার্সেলগুলোকে প্যাকিং বেঞ্চে পৌঁছে দেয়। যেগুলোর হিসাব unit ধরে ধরে রাখা হয় সেগুলো pick station-এর জন্য পড়ে থাকে, কারণ একটা serial স্ক্যান করতেই হবে।',
  },
  {
    id: 'pack-open',
    say: 'The packing bench has one field on it. Scan the shipping label to open a box, scan each product in, scan the label again to close. The packer never touches a keyboard. Open Pack.',
    sayBn:
      'প্যাকিং বেঞ্চে একটাই ঘর আছে। একটা box খুলতে shipping label স্ক্যান করুন, প্রতিটা পণ্য স্ক্যান করে ভিতরে ঢোকান, আর বন্ধ করতে label-টা আবার স্ক্যান করুন। প্যাকারকে কখনো কিবোর্ড ছুঁতে হয় না। Pack খুলুন।',
  },
  {
    id: 'pack-queue',
    say: 'With nothing in hand it lists what is coming, oldest first. Nothing here claims a parcel; the box does that. A parcel with no printed label is called out, because there is nothing to scan.',
    sayBn:
      'হাতে কিছু না থাকলে এটা কী আসছে তার তালিকা দেখায়, সবচেয়ে পুরোনোটা আগে। এখানে কিছুই কোনো পার্সেল দাবি করে না; সেটা box-টাই করে। যে পার্সেলের label ছাপানো নেই তাকে আলাদা করে দেখিয়ে দেওয়া হয়, কারণ স্ক্যান করার মতো কিছুই নেই।',
  },
  {
    id: 'pack-lines',
    say: 'Scanning the label opens a box, one per parcel and one per packer, held by the database itself. The biggest thing on screen is what still has to go in, with a quantity beside each line. A satisfied line goes quiet rather than vanishing, so a packer is never left wondering whether they scanned it.',
    sayBn:
      'label স্ক্যান করলে একটা box খোলে — প্রতি পার্সেলে একটা আর প্রতি প্যাকারে একটা, আর সেটা ধরে রাখে ডেটাবেস নিজেই। স্ক্রিনে সবচেয়ে বড় করে দেখানো হয় এখনো কী কী ভিতরে ঢোকাতে হবে, প্রতিটা লাইনের পাশে পরিমাণ লেখা। যে লাইনটা পূরণ হয়ে গেছে সেটা মিলিয়ে যায় না, শুধু চুপ হয়ে যায়, যাতে প্যাকার কখনো দ্বিধায় না পড়ে যে সে ওটা স্ক্যান করেছিল কি না।',
  },
  {
    id: 'pack-scan',
    say: 'Scan each product in. One scan too many is refused at the scan with the item still in your hand, not at the end when the box is taped. A refusal stops the bench until the packer says I have fixed it, because a scanner types and presses Enter on its own. Scanning the label again closes the box and checks it as a set, then the parcel joins a manifest.',
    sayBn:
      'প্রতিটা পণ্য স্ক্যান করে ভিতরে ঢোকান। একটা স্ক্যান বেশি হয়ে গেলে সেটা স্ক্যানের মুহূর্তেই বাতিল হয়ে যায় — জিনিসটা তখনো আপনার হাতে, শেষে box টেপ দিয়ে আটকানোর পরে নয়। বাতিল হলে বেঞ্চটা থেমে থাকে, যতক্ষণ প্যাকার না বলে যে সে ঠিক করে ফেলেছে — কারণ একটা scanner নিজে থেকেই টাইপ করে আর Enter চেপে দেয়। label আবার স্ক্যান করলে box বন্ধ হয়ে যায় আর পুরোটা একসঙ্গে মিলিয়ে দেখা হয়, তারপর পার্সেলটা একটা manifest-এ ঢোকে।',
  },
  {
    id: 'pack-cancel',
    say: 'A box that will not be finished is cancelled: click Cancel this box. The note says the important part: the scans are discarded and the parcel returns to the queue, and nothing goes back to inventory, because packing already took the stock out.',
    sayBn:
      'যে box শেষ করা হবে না সেটা বাতিল করা হয়: Cancel this box-এ ক্লিক করুন। note-টায় আসল কথাটা লেখা আছে: স্ক্যানগুলো বাদ দেওয়া হয় আর পার্সেলটা queue-তে ফিরে যায়, কিন্তু inventory-তে কিছুই ফেরত যায় না, কারণ প্যাকিং আগেই স্টকটা বের করে নিয়েছে।',
  },
  {
    id: 'pack-cancel-reason',
    say: 'Type the reason, which is required and is the only record anywhere that this box was opened. Cancel the box then returns the parcel to the list. It is not pressed here.',
    sayBn:
      'কারণটা লিখুন — এটা দিতেই হবে, আর এই box যে খোলা হয়েছিল তার একমাত্র রেকর্ড কোথাও বলতে এটাই। তারপর Cancel the box পার্সেলটাকে তালিকায় ফিরিয়ে দেয়। এখানে এটা চাপা হচ্ছে না।',
  },
  {
    id: 'pack-force',
    say: 'Sometimes the goods have nothing to scan: stock shelved before labels, or a sticker torn off. There is a way past it, and it is deliberately not beside the close button. Pack without scanning has its own panel below the cancel. It is a supervisor’s control, enforced by the server, since nobody waives the check they are the one performing.',
    sayBn:
      'কখনো কখনো পণ্যের গায়ে স্ক্যান করার মতো কিছুই থাকে না: label আসার আগেই তাকে তোলা স্টক, বা স্টিকার ছিঁড়ে যাওয়া। এর পাশ কাটানোর একটা উপায় আছে, আর সেটা ইচ্ছে করেই বন্ধ করার বোতামের পাশে রাখা হয়নি। Pack without scanning-এর নিজের একটা panel আছে, cancel-এর নিচে। এটা একজন supervisor-এর নিয়ন্ত্রণ, আর server নিজেই সেটা মানতে বাধ্য করে — কারণ যে নিজে পরীক্ষাটা করছে, সে নিজেই সেই পরীক্ষা মাফ করে দিতে পারে না।',
  },
  {
    id: 'pack-force-reason',
    say: 'Read what it says: it packs the parcel without checking what is inside, and an unverified box is a wrong item at somebody’s door. It wants a reason of at least twenty characters, and the button stays dead until you meet it. Pressing it would pack the parcel as if scanned and log a high-severity action under your name. It is not pressed.',
    sayBn:
      'কী লেখা আছে পড়ুন: ভিতরে কী আছে তা না দেখেই এটা পার্সেলটা প্যাক করে দেয়, আর যে box যাচাই করা হয়নি সেটা মানে কারো দরজায় ভুল জিনিস। এটা অন্তত কুড়িটা অক্ষরের একটা কারণ চায়, আর সেটা না দেওয়া পর্যন্ত বোতামটা নিষ্ক্রিয় থাকে। এটা চাপলে পার্সেলটা স্ক্যান করা হয়েছে ধরে নিয়েই প্যাক হয়ে যাবে আর আপনার নামে একটা high-severity কাজ লেখা হবে। এটা চাপা হচ্ছে না।',
  },
  {
    id: 'hand-open',
    say: 'The van is at the door. Open Handover. This is the last look at a parcel before a driver takes it.',
    sayBn:
      'গাড়ি দরজায় এসে গেছে। Handover খুলুন। ড্রাইভার পার্সেলটা নিয়ে যাওয়ার আগে এটাই তার দিকে শেষ তাকানো।',
  },
  {
    id: 'hand-waiting',
    say: 'It lists what is still standing at the bench, not what you have done, because that is the question someone loading a van has.',
    sayBn:
      'এটা দেখায় বেঞ্চে এখনো কী কী পড়ে আছে — আপনি কী করে ফেলেছেন তা নয় — কারণ যে গাড়িতে মাল তুলছে তার প্রশ্নটা এটাই।',
  },
  {
    id: 'hand-scan',
    say: 'Scan the label as the box goes on the van, and that is all: no form afterwards. The parcel is dispatched the moment it is read, which makes it dangerous, because it tells the customer it is on the way. Scanning a box that already went stops everything, since it means two boxes carry one waybill or a pile already done is now suspect. The stop follows that packer, and only an admin lifts it.',
    sayBn:
      'box-টা গাড়িতে ওঠার সময়েই label স্ক্যান করুন, আর এটুকুই: পরে আর কোনো ফর্ম নেই। পড়ার সঙ্গে সঙ্গেই পার্সেলটা dispatched হয়ে যায়, আর সেজন্যই এটা বিপজ্জনক — কারণ এটা ক্রেতাকে জানিয়ে দেয় যে পার্সেল পথে আছে। যে box আগেই চলে গেছে সেটা স্ক্যান করলে সব থেমে যায়, কারণ তার মানে হয় দুটো box-এর গায়ে একটাই waybill, নয়তো আগে শেষ করা একটা গাদা এখন সন্দেহের মধ্যে পড়ে গেল। এই থেমে যাওয়াটা ওই প্যাকারের সঙ্গে সঙ্গে যায়, আর শুধু একজন admin-ই এটা তুলতে পারে।',
  },
  {
    id: 'van-open',
    say: 'Most days nobody opens Pickups. The courier is asked for a van automatically when the day’s first box is packed. It is one request per warehouse per day for the whole handover, not one per parcel.',
    sayBn:
      'বেশিরভাগ দিন কেউ Pickups খোলেই না। দিনের প্রথম box প্যাক হওয়ার সময়েই কুরিয়ারের কাছে গাড়ি চাওয়া হয়ে যায়, নিজে থেকেই। পুরো handover-এর জন্য প্রতি গুদামে দিনে একটাই অনুরোধ, প্রতি পার্সেলে একটা নয়।',
  },
  {
    id: 'van-failed',
    say: 'A row is a day: who collects, where from, under which registered name, what time, and how many parcels we told them to expect. Collected closes the day once the driver has been. The row this screen exists for is a failed attempt, with the courier’s own words on it.',
    sayBn:
      'একটা সারি মানে একটা দিন: কে নিতে আসবে, কোথা থেকে, কোন নিবন্ধিত নামে, কোন সময়ে, আর আমরা তাদের কতগুলো পার্সেলের কথা বলেছিলাম। ড্রাইভার এসে যাওয়ার পর Collected দিনটা বন্ধ করে দেয়। তবে এই স্ক্রিনটা আছে যে সারির জন্য, সেটা একটা failed attempt — তার গায়ে কুরিয়ারের নিজের কথাগুলোই লেখা থাকে।',
  },
  {
    id: 'van-free',
    say: 'Free the day is the sharp edge. It lets a new request be raised, which is right when nothing registered and books a second van when something did. They returned no id, so it probably never reached them; probably is why this is a deliberate act. Check the courier’s own panel first and say what you found. The dialog is opened and closed.',
    sayBn:
      'Free the day হলো ধারালো দিকটা। এটা একটা নতুন অনুরোধ তোলার সুযোগ দেয় — কিছুই যদি নিবন্ধিত না হয়ে থাকে তাহলে এটাই ঠিক কাজ, কিন্তু কিছু নিবন্ধিত হয়ে থাকলে এটা দ্বিতীয় একটা গাড়ি বুক করে বসে। তারা কোনো id ফেরত দেয়নি, তাই সম্ভবত অনুরোধটা তাদের কাছে পৌঁছায়ইনি; এই “সম্ভবত”-র জন্যই এটা ভেবে করা একটা কাজ। আগে কুরিয়ারের নিজের panel দেখে নিন আর আপনি কী পেলেন তা লিখে দিন। dialog-টা খুলে আবার বন্ধ করা হচ্ছে।',
  },
  {
    id: 'van-raise',
    say: 'Request a pickup raises one by hand, and it is a live call that books a real vehicle. The form is short because the courier needs little, which is exactly what makes it easy to do twice. Check the day’s row first.',
    sayBn:
      'Request a pickup হাতে করে একটা অনুরোধ তোলে, আর এটা একটা live call যা সত্যিকারের একটা গাড়ি বুক করে। ফর্মটা ছোট, কারণ কুরিয়ারের বেশি কিছু লাগে না — আর সেজন্যই এটা দুবার করে ফেলা খুব সহজ। আগে ওই দিনটার সারিটা দেখে নিন।',
  },
  {
    id: 'man-open',
    say: 'A manifest answers one question: what went out on Tuesday’s van. Open Manifests. Nothing here needs doing unless something went wrong. A row is one van-load: courier, parcel count, when it opened, and when it closed.',
    sayBn:
      'একটা manifest একটাই প্রশ্নের উত্তর দেয়: মঙ্গলবারের গাড়িতে কী কী গেল। Manifests খুলুন। কিছু ভুল না হলে এখানে কিছু করার দরকার নেই। একটা সারি মানে এক গাড়ির মাল: কুরিয়ার, কতগুলো পার্সেল, কখন এটা খুলেছিল, আর কখন বন্ধ হয়েছিল।',
  },
  {
    id: 'man-draft',
    say: 'Filter by status if you need to. Draft is still collecting; dispatched has gone. The draft at the top is today, created when the first box was packed. Click it.',
    sayBn:
      'দরকার হলে status ধরে ছেঁকে নিন। Draft মানে এখনো জমা হচ্ছে; dispatched মানে চলে গেছে। উপরের draft-টা আজকের, প্রথম box প্যাক হওয়ার সময়ে তৈরি হয়েছে। এটায় ক্লিক করুন।',
  },
  {
    id: 'man-inside',
    say: 'Inside is the list itself, parcel by parcel with waybill and state. This is what you would read to a driver, or send the courier if they ever asked which parcels we say we handed over.',
    sayBn:
      'ভিতরে আছে তালিকাটা নিজেই — পার্সেল ধরে ধরে, সঙ্গে waybill আর অবস্থা। একজন ড্রাইভারকে আপনি এটাই পড়ে শোনাবেন, বা কুরিয়ার যদি কখনো জিজ্ঞেস করে আমরা কোন কোন পার্সেল হাতে দিয়েছি বলে দাবি করছি, তাহলে এটাই তাদের পাঠাবেন।',
  },
  {
    id: 'man-close',
    say: 'Move a shipment to another manifest is the one repair offered, and it needs a second draft for the same courier and building. Close manifest is a fallback: the handover scan closes it as the last parcel goes, so pressing it means something stopped before that.',
    sayBn:
      'Move a shipment to another manifest — এটাই একমাত্র মেরামতের ব্যবস্থা, আর এর জন্য একই কুরিয়ার আর একই ভবনের জন্য দ্বিতীয় একটা draft দরকার। Close manifest হলো শেষ উপায়: শেষ পার্সেলটা বেরোনোর সঙ্গে হস্তান্তরের স্ক্যানই এটা বন্ধ করে দেয়, তাই এই বোতামটা চাপা মানে তার আগেই কোথাও কিছু আটকে গেছে।',
  },
];

const K_SAY = [
  {
    id: 'rto-open',
    say: 'A parcel has come back. Open Returns. It opens on the only urgent tab: parcels standing at our door, and every hour they do is an hour the client thinks their goods are moving.',
    sayBn:
      'একটা পার্সেল ফেরত এসেছে। Returns খুলুন। এটা যে tab-টায় খোলে সেটাই এখানকার একমাত্র জরুরি tab: যে পার্সেলগুলো আমাদের দরজায় দাঁড়িয়ে আছে — আর ওগুলো যত ঘণ্টা দাঁড়িয়ে থাকে, তত ঘণ্টা client ভাবছে তার মাল চলছে।',
  },
  {
    id: 'rto-door',
    say: 'The note says how one leaves this list: receiving it starts the inspection, and nothing does that automatically. That is deliberate. The courier saying a parcel is back is not a parcel being back, and everything after this moves real stock.',
    sayBn:
      'এই তালিকা থেকে বেরোনোর পথটা নোটেই লেখা আছে: receive করলেই পরীক্ষা শুরু হয়, আর এটা নিজে থেকে কিছুই শুরু করে না। এটা ইচ্ছে করেই এমন। কুরিয়ার বলল একটা পার্সেল ফিরে এসেছে — তার মানে পার্সেলটা সত্যিই ফিরে আসা নয়, আর এর পরের প্রতিটা ধাপ আসল স্টক নাড়ায়।',
  },
  {
    id: 'rto-receive',
    say: 'Click the waybill in a row. It fills the AWB number box and puts you at the bench, because the person doing this holds a parcel, not a mouse. Receive is the press: the order moves, the clock stops, and the units are booked into the returns hold. It is counted, not sellable, and findable. The pointer stays on it.',
    sayBn:
      'যেকোনো সারির waybill-এ ক্লিক করুন। এটা AWB number-এর ঘরটা ভরে দেয় আর আপনাকে বেঞ্চে নিয়ে বসায়, কারণ এই কাজটা যে করছে তার হাতে একটা পার্সেল থাকে, মাউস নয়। চাপার বোতামটা হলো Receive: অর্ডার এগোয়, ঘড়ি থামে, আর ইউনিটগুলো returns hold-এ জমা হয়ে যায়। ওগুলো গোনায় থাকে, বিক্রিযোগ্য নয়, আর খুঁজে পাওয়া যায়। পয়েন্টার ওটার উপরেই থাকে।',
  },
  {
    id: 'rto-transit',
    say: 'The second tab is what is still travelling. Nothing to do here. It exists so the bench knows what is coming, and a return on the road for weeks is visible somewhere.',
    sayBn:
      'দ্বিতীয় tab-এ আছে যেগুলো এখনো পথে। এখানে করার কিছু নেই। এটা আছে যাতে বেঞ্চ জানতে পারে কী কী আসছে, আর সপ্তাহের পর সপ্তাহ পথে পড়ে থাকা একটা ফেরত কোথাও একটা চোখে পড়ে।',
  },
  {
    id: 'rto-bench',
    say: 'The third tab is what is here and not finished: boxes nobody has opened, and lines somebody looked at and could not decide about. Two different hold-ups, counted apart because they need different people.',
    sayBn:
      'তৃতীয় tab-এ আছে যেগুলো এখানে এসে গেছে কিন্তু শেষ হয়নি: যে বাক্সগুলো কেউ খোলেনি, আর যে লাইনগুলো কেউ দেখেছে কিন্তু সিদ্ধান্ত নিতে পারেনি। দুটো আলাদা ধরনের আটকে যাওয়া, আলাদা করে গোনা হয় কারণ দুটোর জন্য আলাদা মানুষ দরকার।',
  },
  {
    id: 'rto-work',
    say: 'Click Work it on a row. You see what came back, line by line, with no verdict yet. From here everything you press moves real stock. The units are in the returns hold, a real place on the shelf plan.',
    sayBn:
      'একটা সারিতে Work it-এ ক্লিক করুন। কী কী ফেরত এসেছে তা লাইন ধরে ধরে দেখতে পাবেন, এখনো কোনো রায় ছাড়াই। এখান থেকে আপনি যা চাপবেন সবই আসল স্টক নাড়াবে। ইউনিটগুলো returns hold-এ আছে — তাকের নকশায় এটা সত্যিকারের একটা জায়গা।',
  },
  {
    id: 'rto-condition',
    say: 'Two questions per line. First, Condition: what you found in the box. Damaged or missing opens a damage ticket to the client, and that is where any money is settled.',
    sayBn:
      'প্রতিটা লাইনে দুটো প্রশ্ন। প্রথমটা Condition: বাক্সে আপনি কী অবস্থায় পেলেন। Damaged বা missing দিলে client-এর নামে একটা damage ticket খুলে যায়, আর টাকার হিসাব ওখানেই মেটে।',
  },
  {
    id: 'rto-choices',
    say: 'Second, What happens to it: back in stock, kept aside, written off, or decide later. What each choice does explains each in words, so read it instead of remembering. Choose Back in stock for a Damaged unit and it warns without refusing: that unit goes to the next customer.',
    sayBn:
      'দ্বিতীয়টা What happens to it: back in stock, kept aside, written off, নাকি পরে ঠিক করব। What each choice does-এ প্রতিটা বিকল্প কথায় বুঝিয়ে দেওয়া আছে, তাই মুখস্থ না রেখে ওটা পড়ে নিন। কোনো Damaged ইউনিটের জন্য Back in stock বাছলে এটা বাধা দেয় না, শুধু সতর্ক করে: ওই ইউনিটটা পরের ক্রেতার কাছে চলে যাবে।',
  },
  {
    id: 'rto-split',
    say: 'When a line holds more than one unit, they need not have come back alike. Split by quantity adds rows, and the rows must add to the line’s units exactly or the server refuses the whole save. Make row one Good and Back in stock, which leaves the hold for a sellable shelf. Make row two Damaged and Keep aside, which goes to the damaged bin and stays the client’s.',
    sayBn:
      'একটা লাইনে একের বেশি ইউনিট থাকলে ওগুলো সব একই অবস্থায় ফেরত নাও আসতে পারে। Split by quantity নতুন সারি যোগ করে, আর সারিগুলোর যোগফল লাইনের ইউনিট সংখ্যার সঙ্গে হুবহু মিলতে হবে, না মিললে সার্ভার পুরো save-টাই নেবে না। প্রথম সারিটা করুন Good আর Back in stock — এটা hold ছেড়ে বিক্রিযোগ্য তাকে চলে যায়। দ্বিতীয় সারিটা করুন Damaged আর Keep aside — এটা damaged bin-এ যায় আর client-এরই থাকে।',
  },
  {
    id: 'rto-save',
    say: 'Save inspection marks the line inspected. Nothing has moved: it is a verdict written down, and you can come back and change it. The pointer stays on it.',
    sayBn:
      'Save inspection লাইনটাকে পরীক্ষা-হয়ে-গেছে বলে চিহ্নিত করে। কিছুই নড়েনি: এটা শুধু লিখে রাখা একটা রায়, আর আপনি ফিরে এসে এটা বদলাতে পারবেন। পয়েন্টার ওটার উপরেই থাকে।',
  },
  {
    id: 'rto-finalise',
    say: 'Finalize disposition is the act that cannot be taken back. It restates what it will do in units, not lines, and says stock moves now. One unit would be back on a shelf and sellable, one in the damaged bin, and the order would move on. It needs the permission marked dangerous in the role editor. Deciding later is honest: the parcel stays on this bench.',
    sayBn:
      'Finalize disposition সেই কাজ, যেটা আর ফেরানো যায় না। এটা কী করবে সেটা আবার বলে দেয় — লাইন নয়, ইউনিট হিসেবে — আর বলে দেয় যে স্টক এখনই নড়বে। একটা ইউনিট তাকে ফিরে বিক্রিযোগ্য হবে, একটা যাবে damaged bin-এ, আর অর্ডারটা এগিয়ে যাবে। এর জন্য role editor-এ dangerous চিহ্ন দেওয়া অনুমতিটা লাগে। পরে সিদ্ধান্ত নেওয়াটা সৎ কাজ: পার্সেলটা এই বেঞ্চেই পড়ে থাকে।',
  },
];

const L_SAY = [
  {
    id: 'adj-open',
    say: 'A stock adjustment is how a count gets put right: the one way a figure changes without a parcel being involved. Open Adjustments. The screen opens on the only thing here that is a job.',
    sayBn:
      'স্টক adjustment হলো একটা গণনা ঠিক করার উপায়: পার্সেল ছাড়া কোনো সংখ্যা বদলানোর এটাই একমাত্র পথ। Adjustments খুলুন। স্ক্রিনটা যেটা দিয়ে খোলে, এখানে কাজ বলতে ওই একটাই।',
  },
  {
    id: 'adj-tiles',
    say: 'These say what is waiting and what it stands to move: the value those corrections would take off the books or put back.',
    sayBn:
      'এগুলো বলে দেয় কী কী অপেক্ষায় আছে আর তাতে কত টাকা নড়তে পারে: ওই সংশোধনগুলো হিসাবের খাতা থেকে কত টাকা কমিয়ে দেবে বা ফিরিয়ে দেবে।',
  },
  {
    id: 'adj-review',
    say: 'Click Review on a row. Somebody counted, someone else is asked to agree, and nothing has moved yet, which is the only reason this screen exists.',
    sayBn:
      'একটা সারিতে Review-তে ক্লিক করুন। একজন গুনেছে, আরেকজনকে রাজি হতে বলা হচ্ছে, আর এখনো কিছুই নড়েনি — এই স্ক্রিনটা থাকার কারণ ওটাই একমাত্র।',
  },
  {
    id: 'adj-facts',
    say: 'Direction, reason, what it is worth, and the threshold it was measured against, written down when it was raised. Change the setting tomorrow and this row still says what the rule was.',
    sayBn:
      'কোন দিকে, কী কারণে, কত টাকার, আর কোন threshold-এর সঙ্গে মিলিয়ে মাপা হয়েছিল — সবই তোলার সময়েই লিখে রাখা হয়েছে। কাল যদি setting বদলে দেন, তবুও এই সারিটা তখনকার নিয়মটাই বলবে।',
  },
  {
    id: 'adj-why',
    say: 'The approver reads the words and nothing else, so read them. Underneath is the line: a product, a shelf, a batch, and a quantity.',
    sayBn:
      'যিনি অনুমোদন দেন তিনি এই কথাগুলো ছাড়া আর কিছুই পড়েন না, তাই এগুলো পড়ুন। নিচে আছে লাইনটা: একটা পণ্য, একটা তাক, একটা batch, আর একটা পরিমাণ।',
  },
  {
    id: 'adj-choices',
    say: 'Two ways out. Rejecting wants a reason and keeps it for good. The other button says what it does: approving writes the movement, the shelf count changes from that press, and nothing on this screen can put it back. Approving is dangerous. The dialog is closed here.',
    sayBn:
      'বেরোনোর পথ দুটো। Reject করতে গেলে একটা কারণ চায়, আর সেটা চিরকালের জন্য রেখে দেয়। অন্য বোতামটা নিজেই বলে দেয় সে কী করবে: approve করলে movement লেখা হয়ে যায়, ওই চাপার সঙ্গে সঙ্গেই তাকের গণনা বদলে যায়, আর এই স্ক্রিনের কোনো কিছু দিয়েই সেটা ফেরানো যায় না। Approve করা dangerous। এখানে dialog-টা বন্ধ করে দেওয়া হচ্ছে।',
  },
  {
    id: 'adj-history',
    say: 'Clear the status filter and the history is there: a correction small enough to apply on its own beside the one that needed two people, each with what it moved.',
    sayBn:
      'status filter-টা মুছে দিলেই পুরো ইতিহাস সামনে আসে: এমন একটা সংশোধন যেটা এত ছোট যে নিজে থেকেই বসে গেছে, আর তার পাশেই আরেকটা যেটার জন্য দুজন মানুষ লেগেছে — প্রতিটার সঙ্গেই লেখা আছে সেটা কী নড়িয়েছে।',
  },
  {
    id: 'adj-form',
    say: 'To raise one, click New adjustment. It asks for identifiers rather than dropdowns, on purpose: stock is held per batch per shelf, and whoever types this has the numbers on a count sheet.',
    sayBn:
      'নতুন একটা তুলতে New adjustment-এ ক্লিক করুন। এটা dropdown-এর বদলে identifier চায়, আর সেটা ইচ্ছে করেই: স্টক রাখা হয় প্রতি batch, প্রতি তাক অনুযায়ী, আর যে এটা টাইপ করছে তার হাতে একটা count sheet-এ নম্বরগুলো আছে।',
  },
  {
    id: 'adj-cost',
    say: 'Then how many, and what one is worth. That second figure is the gate: quantity times value decides whether it applies now or waits for somebody. Under the threshold it applies as you press Raise adjustment, so read whether the message says applied or waiting. Here the form closes unsent.',
    sayBn:
      'তারপর কতগুলো, আর একটার দাম কত। দ্বিতীয় সংখ্যাটাই ফটক: পরিমাণ গুণ দাম ঠিক করে দেয় এটা এখনই বসবে নাকি কারো অনুমোদনের অপেক্ষায় থাকবে। threshold-এর নিচে থাকলে Raise adjustment চাপার সঙ্গে সঙ্গেই এটা বসে যায়, তাই বার্তাটা applied বলছে নাকি waiting বলছে সেটা পড়ে নিন। এখানে ফর্মটা না পাঠিয়েই বন্ধ করা হচ্ছে।',
  },
  {
    id: 'cyc-open',
    say: 'A cycle count is the floor checking the system, not the other way round. Open Cycle counts. The tiles say what is open and how much disagreed. A count that finds nothing is still worth running, since it is the only evidence the numbers mean anything.',
    sayBn:
      'cycle count হলো গুদামের মেঝে সিস্টেমকে যাচাই করা, উল্টোটা নয়। Cycle counts খুলুন। উপরের ঘরগুলো বলে দেয় কী কী খোলা আছে আর কতটা মিলল না। যে গণনায় কিছুই ধরা পড়ে না, সেটাও চালানোর মতো কাজ — কারণ সংখ্যাগুলোর কোনো মানে আছে তার একমাত্র প্রমাণ ওটাই।',
  },
  {
    id: 'cyc-schedule',
    say: 'Click Schedule a count. Scheduling changes nothing: it creates a job and waits, because someone has to go to the shelves. Choose the warehouse, then the scope: a whole building, one zone, a sample, a handful of products. Pick what the counters have time for. Schedule is not pressed.',
    sayBn:
      'Schedule a count-এ ক্লিক করুন। schedule করায় কিছুই বদলায় না: এটা একটা কাজ তৈরি করে অপেক্ষা করে, কারণ কাউকে তাকের কাছে যেতে হবে। গুদামটা বাছুন, তারপর পরিসর: পুরো একটা ভবন, একটা zone, নমুনা হিসেবে কিছু, বা হাতে গোনা কয়েকটা পণ্য। গণনাকারীদের যতটা গোনার সময় আছে, ততটাই বাছুন। Schedule এখানে চাপা হচ্ছে না।',
  },
  {
    id: 'cyc-count',
    say: 'Open a count that is under way. Each line is recorded per shelf and per batch, by identifiers off the count sheet. What the system believed is read when you record, not when the count was scheduled, and what was really on the shelf goes in beside it.',
    sayBn:
      'চলতি একটা count খুলুন। প্রতিটা লাইন লেখা হয় প্রতি তাক আর প্রতি batch ধরে, count sheet থেকে নেওয়া identifier দিয়ে। সিস্টেম কী ভেবেছিল সেটা পড়া হয় আপনি যখন লিখছেন তখন, count যখন schedule হয়েছিল তখন নয় — আর তার পাশেই বসে তাকে আসলে কী ছিল।',
  },
  {
    id: 'cyc-diff',
    say: 'The disagreement is said in three columns: what we thought, what was found, the difference. Nothing has changed yet. This is two people with different numbers.',
    sayBn:
      'অমিলটা তিনটা কলামে বলা থাকে: আমরা কী ভেবেছিলাম, কী পাওয়া গেল, আর তফাত কত। এখনো কিছুই বদলায়নি। এটা শুধু দুজন মানুষ, যাদের হাতে আলাদা সংখ্যা।',
  },
  {
    id: 'cyc-complete',
    say: 'The button counts the consequence for you: Complete, raises this many corrections. A cycle count never moves stock itself. Every difference becomes an adjustment, and an adjustment has to be agreed by somebody. Completing is dangerous for that reason. The pointer stays on it.',
    sayBn:
      'বোতামটা পরিণামটা আপনার হয়ে গুনে দেয়: Complete, আর এতে এতগুলো সংশোধন উঠবে। cycle count নিজে কখনো স্টক নাড়ায় না। প্রতিটা অমিল একটা adjustment হয়ে যায়, আর প্রতিটা adjustment-এ কাউকে রাজি হতে হয়। সেই কারণেই Complete করা dangerous। পয়েন্টার ওটার উপরেই থাকে।',
  },
  {
    id: 'mov-open',
    say: 'The stock ledger is the last page of almost every argument about inventory. Open Stock movements. Every change to a quantity we have ever made, and what caused it. The subtitle is a promise: append only. Nothing was edited or deleted, and no endpoint could.',
    sayBn:
      'স্টকের খতিয়ান হলো ইনভেন্টরি নিয়ে প্রায় প্রতিটা তর্কের শেষ পাতা। Stock movements খুলুন। পরিমাণে আমরা আজ পর্যন্ত যত বদল করেছি সব, আর কোনটার কারণ কী। সাবটাইটেলটা একটা প্রতিশ্রুতি: append only। কিছুই সম্পাদনা বা মুছে ফেলা হয়নি, আর কোনো endpoint দিয়ে সেটা করাও যেত না।',
  },
  {
    id: 'mov-types',
    say: 'A row is one movement: when, what kind, which product and shelf, then what it changed and what the shelf held afterwards. The second number lets you check that the steps add up. The Type filter lists the vocabulary: Receiving is goods arriving, Pack confirm is goods leaving. Stock comes off the shelf when the box is sealed, not when the van takes it.',
    sayBn:
      'একটা সারি মানে একটা movement: কখন, কোন ধরনের, কোন পণ্য আর কোন তাক, তারপর কতটা বদলেছে আর তার পরে তাকে কত ছিল। দ্বিতীয় সংখ্যাটা দিয়ে আপনি মিলিয়ে দেখতে পারেন ধাপগুলোর যোগ মিলছে কি না। Type filter-এ পুরো শব্দভাণ্ডারটা আছে: Receiving মানে মাল আসছে, Pack confirm মানে মাল বেরোচ্ছে। বাক্স সিল করার সময়েই স্টক তাক থেকে কমে, গাড়ি নিয়ে যাওয়ার সময় নয়।',
  },
  {
    id: 'mov-bin',
    say: 'Two filters answer the questions people arrive with. Paste a product and you get its whole history. Or choose the warehouse first, since a shelf belongs to one building, then the shelf, and you get everything that happened there. A move between shelves is always two rows, out and in, with one cause.',
    sayBn:
      'মানুষ যে প্রশ্ন নিয়ে এখানে আসে, দুটো filter-ই তার উত্তর দেয়। একটা পণ্য বসিয়ে দিলে তার পুরো ইতিহাস পেয়ে যাবেন। নয়তো আগে গুদামটা বাছুন — কারণ একটা তাক একটাই ভবনের — তারপর তাকটা, আর ওখানে যা যা হয়েছে সব পেয়ে যাবেন। এক তাক থেকে আরেক তাকে সরানো মানে সবসময় দুটো সারি, একটা বেরোনোর আর একটা ঢোকার, কারণ একটাই।',
  },
  {
    id: 'mov-reason',
    say: 'Corrections carry a reason, and this is where it earns its keep. Filter Type to Adjustment decrease and read the reasons: months later that word is the whole of what anybody remembers. Come here when a number does not add up, and read until the rows stop agreeing with you.',
    sayBn:
      'সংশোধনের সঙ্গে একটা কারণ থাকে, আর এখানেই সেই কারণটা তার দাম তুলে নেয়। Type filter-টা Adjustment decrease-এ দিয়ে কারণগুলো পড়ুন: কয়েক মাস পরে ওই শব্দটাই হবে কারো মনে থাকা একমাত্র জিনিস। কোনো সংখ্যা না মিললে এখানে আসুন, আর যতক্ষণ না সারিগুলো আপনার সঙ্গে মেলা বন্ধ করে ততক্ষণ পড়ে যান।',
  },
  {
    id: 'xfer-open',
    say: 'Last in stock: moving goods between warehouses, the raw movement under everything else, which is why it asks for so much. Open Transfers.',
    sayBn:
      'স্টকের শেষ জিনিস: এক গুদাম থেকে আরেক গুদামে মাল সরানো — বাকি সবকিছুর নিচে পড়ে থাকা কাঁচা movement, আর সেই কারণেই এটা এত কিছু জানতে চায়। Transfers খুলুন।',
  },
  {
    id: 'xfer-ids',
    say: 'Client, product, quantity. These are identifiers, not names, and no screen in this console prints them. You arrive holding them off the sheet somebody walked the shelves with.',
    sayBn:
      'client, পণ্য, পরিমাণ। এগুলো identifier, নাম নয়, আর এই console-এর কোনো স্ক্রিনই এগুলো ছাপে না। কেউ যে শিট হাতে নিয়ে তাকগুলো ঘুরে এসেছে, সেই শিট থেকেই এগুলো নিয়ে আপনি এখানে আসেন।',
  },
  {
    id: 'xfer-from',
    say: 'Where they leave: the building, the exact bin, and the exact batch. Stock lives in a place and belongs to a consignment, and both must be named.',
    sayBn:
      'কোথা থেকে বেরোবে: ভবনটা, ঠিক কোন bin, আর ঠিক কোন batch। স্টক একটা জায়গায় থাকে আর একটা consignment-এর অধীনে পড়ে, দুটোরই নাম বলতে হবে।',
  },
  {
    id: 'xfer-to',
    say: 'Where they go. The destination batch is required and never created for you: a batch carries expiry, unit cost and the receipt that brought it in, and an invented one loses all three. Name the same building at both ends and it stops you; a move within one building is a different act.',
    sayBn:
      'কোথায় যাবে। গন্তব্যের batch দিতেই হবে, আর এটা আপনার হয়ে কখনো তৈরি করে দেওয়া হয় না: একটা batch-এর সঙ্গে থাকে expiry, একক দাম আর যে receipt দিয়ে এটা ঢুকেছিল — বানানো একটা batch এই তিনটাই হারায়। দুই দিকেই একই ভবনের নাম দিলে এটা আপনাকে আটকে দেবে; একই ভবনের ভিতরে সরানো সম্পূর্ণ আলাদা একটা কাজ।',
  },
  {
    id: 'xfer-press',
    say: 'Add a note, then Transfer stock, which asks once more, restating product, client, count and both buildings. It is dangerous: it writes one movement out and one in as a matched pair, and the form cannot take it back. That pair in the ledger is the only record. The pointer stays on the button.',
    sayBn:
      'একটা নোট লিখুন, তারপর Transfer stock — এটা আরেকবার জিজ্ঞেস করে, আর পণ্য, client, সংখ্যা আর দুই ভবনের নাম আবার বলে দেয়। এটা dangerous: এটা একটা বেরোনোর movement আর একটা ঢোকার movement জোড়া বেঁধে লিখে দেয়, আর ফর্ম সেটা আর ফেরাতে পারে না। খতিয়ানের ওই জোড়াটাই একমাত্র নথি। পয়েন্টার বোতামটার উপরেই থাকে।',
  },
];

/** The first row of the tab strip, or the nth. */
/**
 * A tab in the returns strip, by its name.
 *
 * `.wh-rto-tabs` holds exactly ONE child — the `<Tabs>` component
 * (`rto-tabs.tsx:48`) — so the old `'.wh-rto-tabs > *'` nth(n) could
 * only ever resolve n = 0, and asking for the second tab waited for an
 * element the page does not have. The tabs themselves are nested
 * inside, as `role="tab"`.
 *
 * Named rather than indexed for the reason the pack row is: an index
 * silently points somewhere else the day a tab is added, and the strip
 * already has four.
 */
const rtoTab = (page, name) => page.getByRole('tab', { name });

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
  {
    id: 'recv-claimed',
    run: async ({ page, stage }) => {
      // PRESSED, not pre-arranged. `/warehouse/receive` opens filtered
      // to PENDING, so a receipt claimed by the seed is missing from
      // the queue scene before this one. Claiming is also not the
      // dangerous act here — "Complete and write stock" is, and this
      // video still stops before it.
      await stage.clickIt(page.getByRole('button', { name: 'Start receiving' }));
      await page
        .getByLabel(/^Received qty$/)
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await stage.dwellOn(page.locator('.wh-facts'), 3200);
    },
  },
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
      const { page, stage } = ctx;
      /*
        THE VIDEO SCANS, because nothing else can open a box.

        `pack-station.tsx` keeps the open box in local state and sets it
        only from a successful scan — it never asks the server whether
        one is already open. So a box opened behind the scenes is
        invisible here, and the narration for this very step already
        says "Scanning the label opens a box". The operator's action is
        the only thing that makes the screen exist.

        The waybill is READ OFF THE QUEUE rather than fixtured, and the
        row is found BY RECIPIENT — the same way the short pack video
        finds its parcels, because the waybill is minted per run and the
        recipient is not.

        It has to be this row and not simply the first: the parcel
        beside it is the UNLABELLED one that rendered the callout the
        previous step pointed at, and the narration there says "there is
        nothing to scan". Scanning it would contradict the sentence just
        spoken, and the bench would refuse it anyway.
      */
      const labelled = page.locator('.wh-list li', { hasText: PACK_SCAN_RECIPIENT }).first();
      await labelled.waitFor({ state: 'visible', timeout: WAIT });
      const awb = (await labelled.locator('.sk-lrow__title').innerText()).trim();
      if (!/^\d{6,}$/.test(awb)) {
        throw new Error(`Read "${awb}" as the parcel's waybill, which is not a waybill.`);
      }
      const field = page.locator('#pack-scan');
      await field.waitFor({ state: 'visible', timeout: WAIT });
      await stage.typeIn(field, awb, { after: 250 });
      await field.press('Enter');
      await page.locator('.wh-scan__meta').waitFor({ state: 'visible', timeout: WAIT });
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
  {
    id: 'pack-force',
    run: async (ctx) => {
      /*
        BACK OUT OF THE CANCEL PANEL FIRST.

        Two steps ago the camera pressed "Cancel this box", which sets
        `cancelling` true, and the pack-without-scanning panel is gated
        on `!cancelling` (`pack-station.tsx:485`). Nothing resets that
        flag except the "Keep packing" button, which no step pressed —
        so `.wh-divide` could never appear and this scene could never
        pass, whatever the seed did.

        Pressing "Keep packing" is also the honest thing for the
        narration: the previous two steps showed a cancel being
        considered and NOT carried out, and this is the operator
        declining it before moving on.
      */
      await ctx.stage.clickIt(ctx.page.getByRole('button', { name: 'Keep packing' }), {
        after: 700,
      });
      await show(ctx, ctx.page.locator('.wh-divide'), 4600);
    },
  },
  {
    id: 'pack-force-reason',
    run: async (ctx) => {
      const panel = ctx.page.locator('.wh-divide').first();
      /*
        THE PANEL OPENS IN TWO STAGES, like the cancel panel above it.
        `.wh-divide` starts as a single ghost button; the reason field
        and the destructive button live behind `{forcing}`
        (`pack-station.tsx:487`), which only this press sets. Without it
        the step typed into a field that was not on the page yet.
      */
      await ctx.stage.clickIt(
        panel.getByRole('button', { name: 'These products have no labels to scan' }),
        { after: 700 },
      );
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
      await ctx.stage.clickIt(rtoTab(ctx.page, /Still with the courier/), { after: 1400 });
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
    sayBn:
      'এবার কুরিয়ার। Courier accounts খুলুন। একটা কুরিয়ারের একাধিক account থাকতে পারে, আর ওগুলোর মধ্যে তফাত হলো একটা পার্সেল কার টাকায় আর কার চুক্তিতে বেরোচ্ছে।',
  },
  {
    id: 'cour-several',
    say: 'The account that carried a parcel is recorded on the parcel. That is why this list exists rather than one set of credentials in a settings file: months later somebody asks which account a charge came from, and the answer has to be on the shipment.',
    sayBn:
      'কোন account দিয়ে একটা পার্সেল গেছে, সেটা পার্সেলের গায়েই লেখা থাকে। একটা settings ফাইলে এক সেট credential রাখার বদলে এই তালিকাটা থাকার কারণ এটাই: কয়েক মাস পরে কেউ জিজ্ঞেস করবে একটা চার্জ কোন account থেকে এসেছে, আর উত্তরটা shipment-এর গায়েই থাকতে হবে।',
  },
  {
    id: 'cour-credentials',
    say: 'Now the sentence that governs everything here. Credentials are encrypted, the key is in the environment and never the database, and no endpoint will ever give one back. Nobody on staff can read a stored password, including a super admin.',
    sayBn:
      'এবার সেই বাক্যটা, যেটা এখানকার সবকিছু চালায়। Credential encrypt করা থাকে, চাবি থাকে environment-এ, কখনো ডেটাবেসে নয়, আর কোনো endpoint কোনোদিন একটাও ফিরিয়ে দেবে না। জমা থাকা কোনো পাসওয়ার্ড কর্মীদের কেউই পড়তে পারে না — super admin-ও পারে না।',
  },
  {
    id: 'cour-switches',
    say: 'Above the accounts, one master switch per courier decides whether any of them are used for new parcels. It is not a kill switch. A courier switched off still holds real parcels moving to real customers, so they keep being tracked and can still be cancelled or re-attempted. It stops only new ones.',
    sayBn:
      'account-গুলোর উপরে প্রতিটা কুরিয়ারের জন্য একটা করে master switch আছে, যেটা ঠিক করে নতুন পার্সেলের জন্য ওদের কোনোটা আদৌ ব্যবহার হবে কি না। এটা kill switch নয়। বন্ধ করে দেওয়া একটা কুরিয়ারের হাতেও আসল পার্সেল থাকে, যেগুলো আসল ক্রেতার দিকে যাচ্ছে — তাই ওগুলোর tracking চলতেই থাকে, আর ওগুলো এখনো বাতিল করা বা আবার চেষ্টা করা যায়। এটা শুধু নতুনগুলোকে আটকায়।',
  },
  {
    id: 'cour-table',
    say: 'The table shows each account’s name, whose it is, whether it points at the real courier or a sandbox, and which pickup registration it ships from. The default is marked, one per courier and environment, so making something default decides for every client nobody routed elsewhere.',
    sayBn:
      'টেবিলটা দেখায় প্রতিটা account-এর নাম, সেটা কার, সেটা আসল কুরিয়ারের দিকে তাকিয়ে আছে নাকি একটা sandbox-এর দিকে, আর কোন pickup registration থেকে সেটা মাল পাঠায়। default-টা চিহ্নিত থাকে — প্রতি কুরিয়ার আর প্রতি environment-এ একটা — তাই কোনো একটাকে default করা মানে যে সব client-কে কেউ আলাদা পথে পাঠায়নি, তাদের সবার হয়েই সিদ্ধান্ত নিয়ে ফেলা।',
  },
  {
    id: 'cour-add',
    say: 'To add one, click Add account. Choose the courier, the environment, production or sandbox, and a label. The label is what everybody reads this account by, so name it for what it is.',
    sayBn:
      'নতুন একটা যোগ করতে Add account-এ ক্লিক করুন। কুরিয়ারটা বাছুন, environment বাছুন — production নাকি sandbox — আর একটা label দিন। সবাই এই account-টাকে এই label দিয়েই চেনে, তাই এটা আসলে যা, সেই নামটাই দিন।',
  },
  {
    id: 'cour-secret',
    say: 'Credential fields come with their names filled in, and that matters: each courier reads its own, a token for one, an email and password for another. A name typed wrong fails at the first booking, not here. The value is a password box, legible only while you type, sent once and encrypted. Press Add account to save; here the dialog is closed.',
    sayBn:
      'credential-এর ঘরগুলোর নাম আগে থেকেই বসানো থাকে, আর এটা জরুরি: প্রতিটা কুরিয়ার নিজের নামগুলোই পড়ে — একটার লাগে একটা token, আরেকটার লাগে একটা email আর password। নাম ভুল টাইপ করলে সেটা এখানে ধরা পড়ে না, প্রথম booking-এর সময় ফেল করে। মানটা একটা password-এর ঘর, শুধু টাইপ করার সময়ই পড়া যায়, একবারই পাঠানো হয় আর encrypt হয়ে যায়। জমা দিতে Add account চাপুন; এখানে dialog-টা বন্ধ করে দেওয়া হচ্ছে।',
  },
  {
    id: 'cour-retire',
    say: 'To change a token, add a new account, then deactivate the old one with Deactivate. No new parcel books on it, and every parcel it carried keeps its record of it. Add and retire, never edit.',
    sayBn:
      'কোনো token বদলাতে হলে নতুন একটা account যোগ করুন, তারপর Deactivate দিয়ে পুরোনোটা বন্ধ করে দিন। ওটায় আর নতুন কোনো পার্সেল book হয় না, আর ওটা যে পার্সেলগুলো বহন করেছে সবগুলোতেই ওটার নথি থেকে যায়। নতুন যোগ করুন আর পুরোনোটা অবসরে পাঠান, কখনো সম্পাদনা করবেন না।',
  },
  {
    id: 'dlv-open',
    say: 'Three things decide whether we can still move a parcel, and all three fail quietly: nothing breaks, parcels stop. They are on the Delhivery page.',
    sayBn:
      'আমরা এখনো একটা পার্সেল সরাতে পারব কি না, সেটা ঠিক করে তিনটা জিনিস — আর তিনটাই চুপচাপ নষ্ট হয়: কিছুই ভাঙে না, শুধু পার্সেল থেমে যায়। তিনটাই আছে Delhivery পৃষ্ঠায়।',
  },
  {
    id: 'dlv-tracking',
    say: 'The first is the poll. Delhivery sends us nothing, so every order reaching delivered gets there because a scheduled job asked. Stop it and nothing errors; the parcels stop updating.',
    sayBn:
      'প্রথমটা হলো poll। Delhivery আমাদের নিজে থেকে কিছুই পাঠায় না, তাই যত অর্ডার delivered পর্যন্ত পৌঁছায়, সবই পৌঁছায় কারণ নির্দিষ্ট সময়ে চলা একটা job গিয়ে জিজ্ঞেস করেছে। এটা বন্ধ করে দিলে কোনো error আসবে না; শুধু পার্সেলগুলোর আপডেট থেমে যাবে।',
  },
  {
    id: 'dlv-poll',
    say: 'Run it now is not a refresh button. It is the only thing that moves orders through in transit, out for delivery and delivered, and it acts: it writes tracking events, moves orders and credits money downstream. It needs dispatched parcels and a reason to run. The pointer rests on it.',
    sayBn:
      'Run it now কোনো refresh বোতাম নয়। অর্ডারগুলোকে in transit, out for delivery আর delivered-এর ভিতর দিয়ে এগিয়ে নেয় একমাত্র এটাই, আর এটা সত্যিকারের কাজ করে: এটা tracking event লেখে, অর্ডার এগিয়ে দেয় আর পরের ধাপে টাকা জমা করে দেয়। এটা চালানোর জন্য dispatched পার্সেল লাগে, আর চালানোর একটা কারণও লাগে। পয়েন্টার ওটার উপরেই থাকে।',
  },
  {
    id: 'dlv-lookup',
    say: 'Under it, the safe version of the same question. Type a waybill into AWB numbers and Look up asks the courier what they know. It reads only: no tracking event is written and no order moves. The answer is a line per waybill. A parcel we think we sent that they have never heard of shows up there, which is the first check when an order has stopped.',
    sayBn:
      'তার নিচে একই প্রশ্নের নিরাপদ রূপটা। AWB numbers-এর ঘরে একটা waybill টাইপ করে Look up চাপলে কুরিয়ার কী জানে সেটা জিজ্ঞেস করা হয়। এটা শুধু পড়ে: কোনো tracking event লেখা হয় না, কোনো অর্ডারও নড়ে না। উত্তরে প্রতিটা waybill-এর জন্য একটা লাইন আসে। আমরা ভাবছি পাঠিয়েছি কিন্তু ওরা কোনোদিন নামই শোনেনি — এমন পার্সেল ওখানেই ধরা পড়ে, আর কোনো অর্ডার থেমে গেলে এটাই প্রথম পরীক্ষা।',
  },
  {
    id: 'dlv-connection',
    say: 'Then the connection, which has two halves people conflate. The first is whether calls leave this process at all. The second is separate: whether we are allowed to do anything physical. Manifesting, pickups, cancels and re-attempts all reach the real account, and the sentence tells you to switch it off when you are done.',
    sayBn:
      'তারপর connection, যার দুটো অংশ মানুষ গুলিয়ে ফেলে। প্রথমটা হলো এই process থেকে আদৌ কোনো call বাইরে যাচ্ছে কি না। দ্বিতীয়টা আলাদা: শারীরিকভাবে কিছু করার অনুমতি আমাদের আছে কি না। Manifest করা, pickup, বাতিল করা আর আবার চেষ্টা করা — সবই আসল account-এ গিয়ে পৌঁছায়, আর ওই বাক্যটা আপনাকে বলে দেয় কাজ শেষ হলে এটা বন্ধ করে দিতে।',
  },
  {
    id: 'dlv-pool',
    say: 'Waybills. We fetch them in bulk and keep a pile, because the courier allows only five bulk requests every five minutes. An empty pile stops manifests. The row of counts is what is usable now, what exists but has not settled, what is spoken for, spent, and discarded. The first matters at four in the afternoon.',
    sayBn:
      'এবার waybill। আমরা একসঙ্গে অনেকগুলো এনে একটা স্তূপ জমিয়ে রাখি, কারণ কুরিয়ার প্রতি পাঁচ মিনিটে মাত্র পাঁচটা bulk অনুরোধ করতে দেয়। স্তূপ খালি হয়ে গেলে manifest বন্ধ হয়ে যায়। সংখ্যার সারিটা দেখায় এখনই কাজে লাগানো যায় কতগুলো, কতগুলো আছে কিন্তু এখনো থিতু হয়নি, কতগুলো আগেই বরাদ্দ হয়ে গেছে, কতগুলো খরচ হয়ে গেছে আর কতগুলো বাদ দেওয়া হয়েছে। বিকেল চারটার সময় প্রথমটাই আসল কথা।',
  },
  {
    id: 'dlv-budget',
    say: 'The rate budget is per endpoint in five-minute windows, deliberately short of what the courier allows. Bulk waybills is the tight one, and it is tight on purpose: exhaust one and their firewall blocks our egress address, the whole of us, not the endpoint. One runaway loop takes the building off the air.',
    sayBn:
      'rate budget ধরা হয় প্রতিটা endpoint-এর জন্য পাঁচ মিনিটের জানালায়, আর কুরিয়ার যতটা দেয় তার চেয়ে ইচ্ছে করেই কম রাখা। সবচেয়ে আঁটোসাঁটো হলো bulk waybills, আর সেটা ইচ্ছে করেই আঁটোসাঁটো: একটা শেষ করে ফেললে ওদের firewall আমাদের egress address-টাই আটকে দেয় — পুরো আমাদেরই, শুধু ওই endpoint নয়। একটা বেয়াড়া loop পুরো ভবনটাকেই বাইরের জগৎ থেকে বিচ্ছিন্ন করে দেয়।',
  },
  {
    id: 'dlv-reach',
    say: 'Check connection is a live serviceability call that creates nothing, and it answers whether the stored credential still works. Pressing it spends one call; the pointer rests on it.',
    sayBn:
      'Check connection হলো একটা লাইভ serviceability call, যেটা কিছুই তৈরি করে না, আর জমা থাকা credential-টা এখনো কাজ করে কি না সেটার উত্তর দেয়। এটা চাপলে একটা call খরচ হয়; পয়েন্টার ওটার উপরেই থাকে।',
  },
  {
    id: 'dlv-pickup',
    say: 'Last, the pickup location. Every shipment sends the warehouse name and the courier matches it exactly, case and spaces included, so one character out fails every booking. They offer no way to list what is registered, so this page cannot show you: the audit log is the only record.',
    sayBn:
      'শেষে pickup location। প্রতিটা shipment গুদামের নামটা পাঠায় আর কুরিয়ার সেটা হুবহু মিলিয়ে দেখে — ছোট-বড় হাতের অক্ষর আর ফাঁকা জায়গা সমেত — তাই একটা অক্ষর এদিক-ওদিক হলে প্রতিটা booking ফেল করে। কী কী registered আছে তার তালিকা দেখার কোনো ব্যবস্থা ওরা রাখেনি, তাই এই পৃষ্ঠাটা আপনাকে দেখাতে পারবে না: audit log-ই একমাত্র নথি।',
  },
  {
    id: 'mp-open',
    say: 'When a courier refuses a parcel, the dashboard lights Blocked. Open Manual placement. Every parcel here was confirmed, had stock put aside and a customer told, and then a courier said no. Nothing on this screen moves on its own.',
    sayBn:
      'কোনো কুরিয়ার একটা পার্সেল নিতে অস্বীকার করলে dashboard-এ Blocked জ্বলে ওঠে। Manual placement খুলুন। এখানকার প্রতিটা পার্সেল নিশ্চিত হয়েছিল, এর জন্য স্টক আলাদা করে রাখা হয়েছিল আর ক্রেতাকে বলাও হয়েছিল — তারপর একটা কুরিয়ার না বলে দিয়েছে। এই স্ক্রিনের কিছুই নিজে থেকে নড়ে না।',
  },
  {
    id: 'mp-why',
    say: 'Why it is here comes in two parts. Courier refused is our summary; underneath is their own sentence, word for word. An address nobody serves and a consignee they distrust need completely different answers. Rows are ordered by wait, oldest first, because nothing escalates by itself and age is the only thing that gets worse alone.',
    sayBn:
      'এটা কেন এখানে, তার উত্তর দুই ভাগে আসে। Courier refused হলো আমাদের নিজের সারসংক্ষেপ; তার নিচে ওদের নিজের বাক্যটা, হুবহু শব্দে শব্দে। কোনো কুরিয়ার যে ঠিকানায় যায়ই না, আর যে প্রাপককে ওরা বিশ্বাস করে না — দুটোর উত্তর সম্পূর্ণ আলাদা। সারিগুলো সাজানো থাকে কতক্ষণ অপেক্ষা করছে সেই অনুযায়ী, সবচেয়ে পুরোনোটা আগে, কারণ কিছুই নিজে থেকে উপরে ওঠে না আর একমাত্র বয়সটাই নিজে নিজে খারাপ হতে থাকে।',
  },
  {
    id: 'mp-place',
    say: 'There are two ways out. The first is Place with another courier. Click it: the dialog opens by saying when to use it, once the parcel is really with whoever you booked, because this is what tells the customer it is on its way. It is dangerous for that reason.',
    sayBn:
      'বেরোনোর পথ দুটো। প্রথমটা Place with another courier। এটায় ক্লিক করুন: dialog-টা শুরুতেই বলে দেয় কখন এটা ব্যবহার করবেন — পার্সেলটা আপনি যার কাছে book করেছেন তার হাতে সত্যিই পৌঁছানোর পরে — কারণ ক্রেতাকে এটাই জানায় যে পার্সেল পথে আছে। সেই কারণেই এটা dangerous।',
  },
  {
    id: 'mp-fields',
    say: 'Enter their waybill exactly as their label prints it. Nothing checks the shape, because we do not know what a Bluedart or DTDC docket looks like. Enter the courier, which is required, because left blank the client and the customer were told their parcel was with a courier called manual. Service tier is optional. Record AWB and dispatch has no second confirmation. It reports where the parcel went, for instance to the warehouse floor if it was never picked.',
    sayBn:
      'ওদের label-এ যেভাবে ছাপা আছে, waybill-টা ঠিক সেভাবেই লিখুন। এর গড়ন কেউ যাচাই করে না, কারণ একটা Bluedart বা DTDC docket দেখতে কেমন হয় সেটা আমরা জানি না। কুরিয়ারটা লিখুন, এটা দিতেই হবে — কারণ ফাঁকা রাখলে client আর ক্রেতাকে বলা হয়েছিল তাদের পার্সেল manual নামের একটা কুরিয়ারের কাছে আছে। Service tier দেওয়া বাধ্যতামূলক নয়। Record AWB and dispatch-এ দ্বিতীয়বার কোনো নিশ্চিতকরণ নেই। এটা জানিয়ে দেয় পার্সেলটা কোথায় গেল — যেমন কখনো pick না হয়ে থাকলে গুদামের মেঝেতে।',
  },
  {
    id: 'mp-unfulfillable',
    say: 'The other way out is Cannot be fulfilled. It releases the stock back, voids the parcel, and the client sees a cancelled order, so it asks for a reason in words they would recognise. Keep the order backs out. Neither is pressed here.',
    sayBn:
      'বেরোনোর অন্য পথটা হলো Cannot be fulfilled। এটা স্টক ছেড়ে দেয়, পার্সেলটা বাতিল করে, আর client দেখে একটা cancelled অর্ডার — তাই এটা এমন ভাষায় একটা কারণ চায় যেটা সে চিনতে পারবে। Keep the order চাপলে এখান থেকে পিছিয়ে আসা হয়। এখানে কোনোটাই চাপা হচ্ছে না।',
  },
  {
    id: 'cd-open',
    say: 'One more courier queue exists. Courier decisions holds a parcel waiting on a person to choose a carrier when several were quoted. Price and days are side by side, cheapest and fastest are marked, and past the deadline the system books the cheapest itself and says so loudly. Booking real carriage is the act, so the choice is yours only when this page has rows. It is empty on most days and in this recording.',
    sayBn:
      'কুরিয়ারের আরও একটা কিউ আছে। একাধিক কুরিয়ার দর দিলে কোন কুরিয়ার বাছা হবে সেই সিদ্ধান্তের জন্য যে পার্সেল একজন মানুষের অপেক্ষায় বসে থাকে, সেটা থাকে Courier decisions-এ। দাম আর কত দিন লাগবে পাশাপাশি থাকে, সবচেয়ে সস্তা আর সবচেয়ে দ্রুতটা চিহ্নিত থাকে, আর সময়সীমা পেরিয়ে গেলে সিস্টেম নিজেই সবচেয়ে সস্তাটা book করে দেয় আর জোর গলায় সেটা জানিয়ে দেয়। এখানে কাজটা হলো সত্যিকারের বাহন book করা, তাই সিদ্ধান্তটা আপনার হাতে কেবল তখনই, যখন এই পৃষ্ঠায় সারি থাকে। বেশির ভাগ দিনই এটা খালি থাকে, এই রেকর্ডিংয়েও খালি।',
  },
  {
    id: 'fd-open',
    say: 'A client whose parcel failed delivery can ask for three things, at wildly different cost. Delivery actions is the register of what was asked. The page says it before you click anything: a re-attempt sends a van, a return ends the sale, and a recall only queues one of our agents to pick up the telephone.',
    sayBn:
      'যে client-এর পার্সেল ডেলিভারি হতে ব্যর্থ হয়েছে, সে তিনটা জিনিস চাইতে পারে — আর তিনটার খরচ আকাশ-পাতাল আলাদা। কী কী চাওয়া হয়েছে তার খাতাটাই Delivery actions। কিছুতে ক্লিক করার আগেই পৃষ্ঠাটা কথাটা বলে দেয়: আবার চেষ্টা করা মানে একটা গাড়ি পাঠানো, ফেরত মানে বিক্রিটাই শেষ, আর recall মানে শুধু আমাদের একজন এজেন্টকে ফোন তুলে নেওয়ার কিউতে বসানো।',
  },
  {
    id: 'fd-register',
    say: 'One kind of request waits, and it is not ours to answer. A member store asked, and the client whose stock it is chose to see those first. Everything else is behind Show decided requests too: decided, not finished. A client acting on their own parcel is not queued behind an approval, so those were decided the moment they were made.',
    sayBn:
      'একধরনের অনুরোধ অপেক্ষা করে, আর তার উত্তর দেওয়া আমাদের কাজ নয়। অনুরোধটা করেছে একটা member store, আর যে client-এর স্টক, সেই client ঠিক করে রেখেছে যে এগুলো সে আগে দেখে নেবে। বাকি সবকিছুও আছে Show decided requests-এর পিছনে: decided, মানে সিদ্ধান্ত হয়ে গেছে — শেষ হয়ে গেছে নয়। কোনো client নিজের পার্সেল নিয়ে কিছু করলে সেটা কোনো অনুমোদনের পিছনে কিউতে বসে না, তাই ওগুলো যে মুহূর্তে করা হয়েছে, সেই মুহূর্তেই decided হয়ে গেছে।',
  },
  {
    id: 'fd-relay',
    say: 'Each decided row says where the work went. A re-attempt becomes a ticket in the queue a person works from, because no courier accepts a re-attempt from software: somebody opens it on Delhivery’s own desk, marks it sent with their reference, and types the answer back on the ticket. A recall reaches no courier and lands in the call queue. This is a register, not an in-tray; act on the ticket.',
    sayBn:
      'সিদ্ধান্ত হয়ে যাওয়া প্রতিটা সারি বলে দেয় কাজটা কোথায় গেল। একটা re-attempt একটা ticket হয়ে কিউতে বসে, যেখান থেকে একজন মানুষ কাজ করে — কারণ কোনো কুরিয়ার সফটওয়্যারের কাছ থেকে re-attempt নেয় না: কেউ Delhivery-র নিজের ডেস্কে গিয়ে সেটা খোলে, তাদের reference দিয়ে পাঠানো হয়েছে বলে চিহ্নিত করে, আর উত্তরটা ticket-এ ফিরে লিখে দেয়। একটা recall কোনো কুরিয়ারের কাছে পৌঁছায় না, সেটা কল কিউতে গিয়ে পড়ে। এটা একটা নথি, কাজ করার ঝুড়ি নয়; কাজ করতে হবে ticket ধরে।',
  },
];

const N_SAY = [
  {
    id: 'wal-open',
    say: 'Money. Everything here is a desk where staff decide, and several of the buttons move real cash, so each section says what pressing does. Start with how client money is organised. Open Client wallets. It adds up what Skydrop owes clients and what clients owe us.',
    sayBn:
      'টাকা। এখানের সবকিছুই এমন একটা ডেস্ক যেখানে স্টাফ সিদ্ধান্ত নেয়, আর এখানের কয়েকটা বোতাম সত্যিকারের নগদ টাকা সরায় — তাই প্রতিটা অংশে বলা আছে চাপ দিলে কী হয়। শুরু হোক client-দের টাকা কীভাবে সাজানো আছে তা দিয়ে। Client wallets খুলুন। এটা যোগ করে দেখায় Skydrop client-দের কাছে কত দেনা আর client-রা আমাদের কাছে কত দেনা।',
  },
  {
    id: 'wal-owed',
    say: 'The first figure is a liability, payable on demand: any client in credit can ask for it today. The second is the other direction, a wallet that has gone negative. A withdrawal asked for is still in the balance because a request is not a payment, and a top-up claimed is in no balance at all.',
    sayBn:
      'প্রথম সংখ্যাটা একটা দেনা, চাইলেই দিতে হবে এমন: যে client-এর ব্যালেন্স জমার দিকে, সে আজই সেটা চাইতে পারে। দ্বিতীয়টা উল্টো দিকের — যে ওয়ালেট ঋণাত্মক হয়ে গেছে। চাওয়া হয়ে গেছে এমন withdrawal এখনো ওয়ালেট ব্যালেন্সের ভিতরেই থাকে, কারণ অনুরোধ মানে টাকা দেওয়া নয়; আর দাবি করা একটা top-up কোনো ব্যালেন্সেই থাকে না।',
  },
  {
    id: 'wal-row',
    say: 'One row per client, with what they can draw and what is waiting on us. Click Ledger on a row. Balance is what we owe them. Available to withdraw is that, less the floor we hold back and anything already requested, so the two agree only when nothing is pending.',
    sayBn:
      'প্রতি client-এর জন্য একটা সারি, সঙ্গে সে কত তুলতে পারে আর আমাদের কাছে কী অপেক্ষা করছে। একটা সারিতে Ledger-এ ক্লিক করুন। Balance মানে আমরা তাকে কত দেনা। Available to withdraw হলো সেটাই, তার থেকে বাদ যায় আমরা যে ন্যূনতম টাকাটা ধরে রাখি আর আগেই চাওয়া হয়ে গেছে এমন সব কিছু — তাই কিছুই বাকি না থাকলে কেবল তখনই দুটো সংখ্যা মেলে।',
  },
  {
    id: 'wal-kinds',
    say: 'The ledger is the whole history, newest first, and only money that actually moved is on it. A top-up is money the client sent, matched against our statement. A COD credit is cash the courier collected, and it lands when the courier pays us, not at delivery. Beside it a tax line, extracted from a price that already included the tax. Order charges are what we billed for carrying; a return fee is the round trip; a damage settlement is us paying for goods spoiled in our hands, written in the same transaction as the ticket that closed.',
    sayBn:
      'Ledger হলো পুরো ইতিহাস, নতুনটা আগে, আর শুধু যে টাকা সত্যিই নড়েছে সেটাই এতে থাকে। একটা top-up মানে client যে টাকা পাঠিয়েছে, আমাদের ব্যাংক স্টেটমেন্টের সঙ্গে মিলিয়ে দেখা। একটা COD credit হলো কুরিয়ার যে নগদ টাকা তুলেছে, আর সেটা জমা হয় কুরিয়ার আমাদের টাকা দিলে — ডেলিভারির সময় নয়। তার পাশেই একটা করের লাইন, যে দামের ভিতরে কর আগেই ধরা ছিল সেখান থেকে আলাদা করে বের করা। Order charges হলো বহন করার জন্য আমরা যা বিল করেছি; একটা return fee হলো যাওয়া-আসা পুরো পথটার; আর একটা damage settlement হলো আমাদের হাতে নষ্ট হওয়া পণ্যের দাম আমরা দিচ্ছি — যে ticket বন্ধ হলো তার সঙ্গে একই লেনদেনে লেখা।',
  },
  {
    id: 'wal-tabs',
    say: 'The other two tabs are what has merely been asked for: top-ups and withdrawal requests. Neither has moved a rupee, which is why the ledger does not know about them. The ledger is append-only: nothing on this screen edits a line. Everything after this page writes to what you have read.',
    sayBn:
      'বাকি দুটো tab-এ আছে যা কেবল চাওয়া হয়েছে: top-up আর withdrawal request। এর একটাও এক রুপিও সরায়নি, আর সেই কারণেই ledger এদের কথা জানে না। Ledger-এ শুধু নতুন লাইন যোগ হয়: এই স্ক্রিনের কিছুই কোনো লাইন বদলায় না। এই পৃষ্ঠার পরের সবকিছু আপনি যা পড়লেন তাতেই লেখে।',
  },
  {
    id: 'top-open',
    say: 'A top-up is a client telling us they have sent money. Until someone here says otherwise it is only a claim and has moved nothing. Open Wallet top-ups. Accepting is the credit: there is no second step, and the client can draw against it from that moment.',
    sayBn:
      'একটা top-up মানে একজন client আমাদের বলছে সে টাকা পাঠিয়েছে। এখানে কেউ অন্য কিছু না বলা পর্যন্ত এটা শুধু একটা দাবি, এতে কিছুই সরেনি। Wallet top-ups খুলুন। Accept করাটাই জমা দেওয়া: দ্বিতীয় কোনো ধাপ নেই, আর ওই মুহূর্ত থেকেই client সেই টাকা তুলতে পারে।',
  },
  {
    id: 'top-row',
    say: 'Read the row first: who claimed, which of our accounts they say they paid into, how much, and what evidence. The label is our filing name; the number under it is what will appear on the statement.',
    sayBn:
      'আগে সারিটা পড়ুন: কে দাবি করেছে, আমাদের কোন অ্যাকাউন্টে টাকা দিয়েছে বলে বলছে, কত টাকা, আর প্রমাণ কী। উপরের নামটা আমাদের নিজেদের খাতার নাম; তার নিচের নম্বরটাই ব্যাংক স্টেটমেন্টে দেখা যাবে।',
  },
  {
    id: 'top-statement',
    say: 'Evidence is a bank reference, an uploaded receipt, or both, and one is required. The job is to go to the bank, find that reference, and confirm the amount and date. The claim is a sentence someone typed; the statement is the only fact in this process.',
    sayBn:
      'প্রমাণ মানে একটা ব্যাংক reference, একটা আপলোড করা রসিদ, বা দুটোই — অন্তত একটা লাগবে। কাজটা হলো ব্যাংকে গিয়ে ওই reference খুঁজে বের করা, আর টাকার পরিমাণ ও তারিখ মিলিয়ে নেওয়া। দাবিটা কেউ টাইপ করে লেখা একটা বাক্য; এই পুরো কাজে ব্যাংক স্টেটমেন্টই একমাত্র সত্য।',
  },
  {
    id: 'top-accept',
    say: 'Once you have seen it, click Accept. The dialog names the amount and the account, so a click on the wrong row has one more chance to be caught. Accepting is dangerous: it adds the money immediately and is not reversible without an adjusting entry.',
    sayBn:
      'দেখে নেওয়ার পর Accept-এ ক্লিক করুন। ডায়ালগে টাকার পরিমাণ আর অ্যাকাউন্টের নাম লেখা থাকে, তাই ভুল সারিতে ক্লিক করলে সেটা ধরা পড়ার আরেকটা সুযোগ থেকে যায়। Accept করা বিপজ্জনক: এটা সঙ্গে সঙ্গে টাকা যোগ করে দেয়, আর একটা সংশোধনী এন্ট্রি ছাড়া সেটা আর ফেরানো যায় না।',
  },
  {
    id: 'top-note',
    say: 'The note is optional and worth writing: it is what you will read in three months when someone asks why this transfer was credited.',
    sayBn:
      'Note দেওয়া বাধ্যতামূলক নয়, কিন্তু লেখা ভালো: তিন মাস পরে কেউ যখন জিজ্ঞেস করবে এই টাকাটা কেন জমা দেওয়া হয়েছিল, তখন আপনি এটাই পড়বেন।',
  },
  {
    id: 'top-credit',
    say: 'Credit the wallet would move the claim to Credited, carrying your note, the time and your name. The pointer stays on it.',
    sayBn:
      'Credit the wallet চাপলে দাবিটা Credited অবস্থায় চলে যেত, সঙ্গে যেত আপনার note, সময় আর আপনার নাম। পয়েন্টার শুধু তার উপরেই থাকছে।',
  },
  {
    id: 'top-reject',
    say: 'The other way out is Reject, and its reason is mandatory because the client reads it. Write what did not match or what you need. A claim you are unsure about is a claim you reject with a reason and ask again.',
    sayBn:
      'বেরোনোর আরেকটা পথ হলো Reject, আর এর কারণ লেখা বাধ্যতামূলক — কারণ client সেটা পড়ে। কী মেলেনি বা আপনার কী দরকার সেটা লিখুন। যে দাবি নিয়ে আপনি নিশ্চিত নন, সেটা কারণ লিখে reject করতে হয় আর আবার জিজ্ঞেস করতে হয়।',
  },
  {
    id: 'wd-open',
    say: 'Withdrawals are clients asking for their money back. Open Withdrawals. The top line is the rule to hold: nothing on this page moves any. A row shows who asked, how much, what they receive in their own currency at the rate when they asked, and how long they have waited.',
    sayBn:
      'Withdrawal মানে client-রা নিজেদের টাকা ফেরত চাইছে। Withdrawals খুলুন। উপরের লাইনটাই ধরে রাখার নিয়ম: এই পৃষ্ঠার কিছুই কোনো টাকা সরায় না। একটা সারিতে দেখা যায় কে চেয়েছে, কত চেয়েছে, চাওয়ার সময়ের রেট ধরে নিজের মুদ্রায় সে কত পাবে, আর কত দিন অপেক্ষা করছে।',
  },
  {
    id: 'wd-approve',
    say: 'What they may ask for is the balance less the floor less anything already requested, and a request the balance can no longer cover is rejected for them. Approving is step one of two and is not the payment. Click Approve and the dialog says nothing is paid yet; pay the account on the client’s profile and record the remittance. Cancel here.',
    sayBn:
      'সে সর্বোচ্চ যা চাইতে পারে তা হলো ব্যালেন্স থেকে ন্যূনতম ধরে রাখা টাকা বাদ, আর আগেই চাওয়া হয়ে গেছে এমন সব কিছুও বাদ; আর ব্যালেন্সে আর কুলোয় না এমন অনুরোধ তার হয়ে বাতিল হয়ে যায়। Approve করা দুই ধাপের প্রথম ধাপ, এটা টাকা দেওয়া নয়। Approve-এ ক্লিক করলে ডায়ালগ বলে দেয় এখনো কোনো টাকা দেওয়া হয়নি; client-এর profile-এ দেওয়া অ্যাকাউন্টে টাকা পাঠান আর remittance-টা লিখে রাখুন। এখানে Cancel করছি।',
  },
  {
    id: 'rem-open',
    say: 'The payment is recorded on Remittances. Open it. This is where money actually moves: each entry debits the client’s wallet, and the approved request waits at the top with a Pay button.',
    sayBn:
      'টাকা দেওয়ার হিসাবটা লেখা হয় Remittances-এ। এটা খুলুন। এখানেই টাকা আসলে নড়ে: প্রতিটা এন্ট্রি client-এর ওয়ালেট থেকে টাকা কাটে, আর approve হয়ে যাওয়া অনুরোধটা একটা Pay বোতাম নিয়ে উপরে অপেক্ষা করে।',
  },
  {
    id: 'rem-pay',
    say: 'Click Pay. The form opens with the destination beside it: the client’s own bank, masked, with the full number behind a deliberate reveal, so reading it is an act at the moment of typing a transfer.',
    sayBn:
      'Pay-তে ক্লিক করুন। ফর্মটা খোলে, আর পাশেই থাকে টাকা কোথায় যাবে: client-এর নিজের ব্যাংক, নম্বরটা আংশিক ঢাকা, পুরো নম্বরটা দেখতে আলাদা করে চেপে দেখতে হয় — যাতে ট্রান্সফার টাইপ করার মুহূর্তে নম্বরটা পড়া নিজেই একটা কাজ হয়।',
  },
  {
    id: 'rem-destination',
    say: 'Underneath, whether we can send it: every account in that currency with what it holds, so an account that cannot cover the payout is found out here, not halfway through a transfer. The account is chosen in Paid from.',
    sayBn:
      'তার নিচে, আমরা টাকাটা পাঠাতে পারব কি না: ওই মুদ্রার প্রতিটা অ্যাকাউন্ট আর তাতে কত আছে — তাই যে অ্যাকাউন্টে এই টাকা দেওয়ার মতো যথেষ্ট নেই, সেটা এখানেই ধরা পড়ে, ট্রান্সফারের মাঝপথে নয়। অ্যাকাউন্ট বাছা হয় Paid from-এ।',
  },
  {
    id: 'rem-currencies',
    say: 'Two currencies, one payment. The wallet is debited in rupees, from the request, already filled in, while the bank sends taka. The only choice is Bank currency, the currency the money really left in.',
    sayBn:
      'দুটো মুদ্রা, একটাই পেমেন্ট। ওয়ালেট থেকে কাটা হয় রুপিতে — অনুরোধ থেকেই নেওয়া, আগেই বসানো আছে — আর ব্যাংক পাঠায় টাকা। বাছার একটাই জায়গা, Bank currency: টাকাটা আসলে যে মুদ্রায় বেরিয়ে গেল।',
  },
  {
    id: 'rem-rate',
    say: 'The taka figure is not typed. It is the rupees times the rate we quoted the client, and whatever we achieved that day is a different number. That gap is ours either way, recorded as a spread and not taken off their balance.',
    sayBn:
      'টাকার সংখ্যাটা হাতে লিখতে হয় না। এটা হলো রুপির পরিমাণ গুণ client-কে আমরা যে রেট বলেছিলাম সেই রেট; আর ওই দিন আমরা আসলে যেটা পেয়েছি সেটা আলাদা একটা সংখ্যা। ওই ফাঁকটা যেদিকেই যাক, সেটা আমাদেরই — একটা spread হিসেবে লেখা থাকে, তার ব্যালেন্স থেকে কাটা হয় না।',
  },
  {
    id: 'rem-fee',
    say: 'A bank fee goes in its own field, because it is our cost. Netting it into the payout would charge the client for our bank.',
    sayBn:
      'ব্যাংকের চার্জ নিজের আলাদা ঘরে বসে, কারণ এটা আমাদের খরচ। এটা payout-এর ভিতরে মিলিয়ে দিলে আমাদের ব্যাংকের খরচটা client-এর উপর চাপানো হতো।',
  },
  {
    id: 'rem-reference',
    say: 'Then the bank’s own reference, the only thing tying this entry to a line on a statement somebody will reconcile later.',
    sayBn:
      'তারপর ব্যাংকের নিজের reference — পরে কেউ যখন স্টেটমেন্ট মেলাতে বসবে, এই এন্ট্রিটাকে স্টেটমেন্টের একটা লাইনের সঙ্গে জুড়ে রাখার একমাত্র জিনিস এটাই।',
  },
  {
    id: 'rem-record',
    say: 'Record asks once more, then writes the debit. The wallet moves, our account moves and the request closes in one transaction. Of approve, pay the bank, record, only this one moves money, and it cannot be undone from here. The pointer stays on it.',
    sayBn:
      'Record আরেকবার জিজ্ঞেস করে, তারপর ডেবিটটা লিখে দেয়। ওয়ালেট নড়ে, আমাদের অ্যাকাউন্ট নড়ে আর অনুরোধটা বন্ধ হয়ে যায় — সবই একটাই লেনদেনে। Approve করা, ব্যাংকে টাকা পাঠানো, record করা — এই তিনটার মধ্যে কেবল এটাই টাকা সরায়, আর এখান থেকে এটা আর ফেরানো যায় না। পয়েন্টার শুধু তার উপরেই থাকছে।',
  },
  {
    id: 'bank-open',
    say: 'Bank detail changes: the shortest screen in this console and the highest stakes, because it decides where a client’s money goes. Open it. Withdrawals keep going to the account on file until somebody approves a change. Only a change needs approving; first-time details write straight through because there is nothing to divert.',
    sayBn:
      'Bank detail changes: এই console-এর সবচেয়ে ছোট স্ক্রিন, আর ঝুঁকি সবচেয়ে বেশি — কারণ এটাই ঠিক করে একজন client-এর টাকা কোথায় যাবে। এটা খুলুন। কেউ কোনো পরিবর্তন approve না করা পর্যন্ত withdrawal-এর টাকা ফাইলে থাকা অ্যাকাউন্টেই যেতে থাকে। শুধু পরিবর্তনই approve করতে হয়; প্রথমবারের তথ্য সোজা ঢুকে যায়, কারণ তখন ঘুরিয়ে দেওয়ার মতো কিছুই নেই।',
  },
  {
    id: 'bank-diff',
    say: 'The card is a diff: what is on file, what they ask for, and a marker on every field that moved. Read the marks, not the rows. The account number is the one that matters, and the card says when it has not moved.',
    sayBn:
      'কার্ডটা একটা তুলনা: ফাইলে কী আছে, সে কী চাইছে, আর যে ঘরগুলো বদলেছে প্রতিটার পাশে একটা চিহ্ন। সারি নয়, চিহ্নগুলো পড়ুন। সবচেয়ে জরুরি হলো অ্যাকাউন্ট নম্বর, আর সেটা না বদলালে কার্ডটা সেটাও বলে দেয়।',
  },
  {
    id: 'bank-approve',
    say: 'Someone who gets into a client’s account cannot take their money out; they can only ask us to send it elsewhere, and this screen stops them. So verify outside the software: ring the number you already had, not the one on the request. Click Approve and read the consequence: from then on every withdrawal goes to the new account. Approve because you recognise the account. Reject, with a reason the client reads, when unsure.',
    sayBn:
      'কেউ যদি কোনো client-এর অ্যাকাউন্টে ঢুকে পড়ে, সে সেখান থেকে টাকা তুলে নিতে পারে না; সে শুধু আমাদের বলতে পারে টাকাটা অন্য কোথাও পাঠাতে — আর এই স্ক্রিনটাই তাকে আটকায়। তাই যাচাই করুন সফটওয়্যারের বাইরে গিয়ে: আপনার কাছে আগে থেকেই যে নম্বরটা ছিল সেটায় ফোন করুন, অনুরোধে দেওয়া নম্বরে নয়। Approve-এ ক্লিক করুন আর ফলটা পড়ুন: এরপর থেকে প্রতিটা withdrawal নতুন অ্যাকাউন্টেই যাবে। অ্যাকাউন্টটা আপনি চিনতে পেরেছেন বলেই approve করুন। নিশ্চিত না হলে Reject করুন — সঙ্গে একটা কারণ, যেটা client পড়বে।',
  },
  {
    id: 'set-open',
    say: 'Courier settlements: every rupee the courier pays us, matched to the orders it covers. Open it. The figure at the top is the float: delivered COD no payout covers yet. The customer paid, the courier holds it, and we owe the client meanwhile.',
    sayBn:
      'Courier settlements: কুরিয়ার আমাদের যে প্রতিটা রুপি দেয়, সেটা কোন কোন অর্ডারের জন্য তার সঙ্গে মিলিয়ে দেওয়া। এটা খুলুন। উপরের সংখ্যাটা হলো ভাসমান টাকা: ডেলিভারি হয়ে যাওয়া COD, যেটা এখনো কোনো payout-এ ধরা পড়েনি। ক্রেতা টাকা দিয়ে দিয়েছে, কুরিয়ার সেটা ধরে রেখেছে, আর এর মাঝখানে আমরা client-এর কাছে দেনা।',
  },
  {
    id: 'set-record',
    say: 'There is a window rather than a deadline. The courier states five to ten days, and we set it at the top of that; anything past it is listed overdue. When money lands in our account, click Record payout.',
    sayBn:
      'এখানে কোনো নির্দিষ্ট শেষ তারিখ নেই, একটা সময়ের ব্যবধান আছে। কুরিয়ার বলে পাঁচ থেকে দশ দিন, আর আমরা সেটা ওই সীমার সবচেয়ে উপরেই ধরে রাখি; তার বেশি হয়ে গেলে সেটা overdue হিসেবে তালিকায় ওঠে। আমাদের অ্যাকাউন্টে টাকা ঢুকলে Record payout-এ ক্লিক করুন।',
  },
  {
    id: 'set-fields',
    say: 'Choose the Courier account, enter Amount received and the courier’s own Payout reference. The reference is unique per account, so recording the same bank credit twice is a refusal and not a double count.',
    sayBn:
      'Courier account বাছুন, Amount received লিখুন আর কুরিয়ারের নিজের Payout reference দিন। প্রতিটা অ্যাকাউন্টের জন্য এই reference একবারই চলে, তাই একই ব্যাংক জমা দুবার লিখতে গেলে সেটা বাতিল হয়ে যায় — দুবার গোনা হয় না।',
  },
  {
    id: 'set-allocate',
    say: 'Then allocate it to the orders it covers by dropping the courier’s export in the box. The payout is one bank credit and the orders are what it was for. Each line snapshots what the order was worth at delivery. Where the courier paid less, the difference is recorded and absorbed: the client is credited what the order was worth, and a short payment is our dispute with the courier.',
    sayBn:
      'তারপর কুরিয়ারের export ফাইলটা বাক্সে ফেলে দিয়ে টাকাটা কোন কোন অর্ডারের জন্য সেই অর্ডারগুলোতে বরাদ্দ করুন। Payout হলো ব্যাংকের একটা জমা, আর অর্ডারগুলো হলো সেটা কীসের জন্য ছিল। প্রতিটা লাইন ডেলিভারির সময় অর্ডারটার মূল্য কত ছিল তা ধরে রাখে। যেখানে কুরিয়ার কম টাকা দিয়েছে, সেই পার্থক্যটা লিখে রাখা হয় আর আমরাই বহন করি: client-কে অর্ডারটার যা মূল্য ছিল সেটাই জমা দেওয়া হয়, আর কম পাওয়া টাকাটা কুরিয়ারের সঙ্গে আমাদের নিজেদের বিবাদ।',
  },
  {
    id: 'set-reversal',
    say: 'The other direction has its own fields. A parcel the courier paid on and later brought back means the credit is taken back, and the form makes you name those orders under RTO reversal with Add reversed order.',
    sayBn:
      'উল্টো দিকটার জন্য নিজের আলাদা ঘর আছে। কুরিয়ার যে পার্সেলের টাকা দিয়ে দিয়েছে কিন্তু পরে সেটা ফেরত এনেছে, তার মানে জমাটা ফিরিয়ে নিতে হবে — আর ফর্ম আপনাকে বাধ্য করে RTO reversal-এর নিচে Add reversed order দিয়ে ওই অর্ডারগুলোর নাম লিখতে।',
  },
  {
    id: 'set-press',
    say: 'Recording credits the client, withholds the tax and writes the bank entry in one transaction, so a credit with no payment behind it cannot exist. It cannot be edited afterwards; correct a mistake with another payout. The pointer stays on it.',
    sayBn:
      'Record করলে client-কে টাকা জমা দেওয়া, কর কেটে রাখা আর ব্যাংকের এন্ট্রি লেখা — সবই একটাই লেনদেনে হয়, তাই পিছনে কোনো পেমেন্ট নেই এমন জমা থাকতেই পারে না। পরে এটা আর সম্পাদনা করা যায় না; ভুল হলে আরেকটা payout দিয়ে ঠিক করতে হয়। পয়েন্টার শুধু তার উপরেই থাকছে।',
  },
  {
    id: 'wt-open',
    say: 'Wallet transfers move cash by hand, out of a client’s wallet into our bank or ours into theirs, when nothing in the ordinary flow can. It sits behind a permission of its own, so you may not see it in the rail. Open it. The first thing it says is what it is not: an adjustment corrects a figure and moves no cash; this moves the cash.',
    sayBn:
      'Wallet transfers হাতে করে নগদ টাকা সরায় — একজন client-এর ওয়ালেট থেকে আমাদের ব্যাংকে, বা আমাদের ব্যাংক থেকে তার ওয়ালেটে — যখন স্বাভাবিক পথের কিছুই সেটা করতে পারে না। এটার নিজের আলাদা একটা অনুমতি লাগে, তাই সাইডবারে আপনি এটা না-ও দেখতে পারেন। এটা খুলুন। প্রথমেই এটা বলে দেয় এটা কী নয়: একটা adjustment একটা সংখ্যা ঠিক করে, কোনো নগদ সরায় না; আর এটা নগদটাই সরায়।',
  },
  {
    id: 'wt-client',
    say: 'Find the client. Everything after is about one account, and the page shows theirs before it shows a form.',
    sayBn:
      'client-কে খুঁজে বের করুন। এরপরের সবকিছু একটাই অ্যাকাউন্ট নিয়ে, আর পৃষ্ঠাটা ফর্ম দেখানোর আগে তার অ্যাকাউন্টটাই দেখায়।',
  },
  {
    id: 'wt-direction',
    say: 'Pick Which way. Debit takes from their wallet into our bank, rupees first and then other currencies at the rate they were credited at; beyond what they hold, their wallet goes negative and they owe us. Credit gives from our bank into theirs. Then the amount.',
    sayBn:
      'Which way বাছুন। Debit তার ওয়ালেট থেকে নিয়ে আমাদের ব্যাংকে আনে — আগে রুপি, তারপর অন্য মুদ্রাগুলো, যে রেটে সেগুলো জমা হয়েছিল সেই রেট ধরে; তার কাছে যা আছে তার বেশি নিলে তার ওয়ালেট ঋণাত্মক হয়ে যায় আর সে আমাদের কাছে দেনা হয়ে পড়ে। Credit আমাদের ব্যাংক থেকে তার ওয়ালেটে টাকা দেয়। তারপর টাকার পরিমাণ।',
  },
  {
    id: 'wt-reason',
    say: 'The Reason is the field that matters. The client reads it on their own wallet history word for word, so write what they will need. The Internal note is staff-only, kept with the audit record, and holds the ticket number and the half of the story they do not need.',
    sayBn:
      'Reason-ই আসল ঘর। client নিজের ওয়ালেটের ইতিহাসে এটা হুবহু পড়ে, তাই তার যা দরকার হবে সেটাই লিখুন। Internal note শুধু স্টাফের জন্য, audit-এর নথির সঙ্গে রাখা থাকে, আর এখানে থাকে ticket নম্বর আর ঘটনার যে অর্ধেকটা তার জানার দরকার নেই।',
  },
  {
    id: 'wt-preview',
    say: 'Preview before posting. Nothing has moved, and what returns is a sentence you can check against what you meant, and two figures that are not the same thing: their wallet before and after, and the cash we hold for them before and after.',
    sayBn:
      'Post করার আগে Preview করুন। কিছুই নড়েনি, আর যা ফিরে আসে তা হলো একটা বাক্য — আপনি কী করতে চেয়েছিলেন তার সঙ্গে মিলিয়ে দেখতে পারবেন — আর দুটো সংখ্যা, যেগুলো এক জিনিস নয়: তার ওয়ালেট আগে আর পরে, এবং তার হয়ে আমরা যে নগদ টাকা ধরে রেখেছি সেটা আগে আর পরে।',
  },
  {
    id: 'wt-post',
    say: 'Post transfer asks once more and says it moves real money and cannot be undone. A mistake is put right with a transfer the other way, a second entry and not an erasure. Every transfer is listed with its reason and who posted it, because this is the one money path with no document behind it. The pointer stays on the button.',
    sayBn:
      'Post transfer আরেকবার জিজ্ঞেস করে আর বলে দেয় এটা সত্যিকারের টাকা সরায় আর এটা আর ফেরানো যায় না। ভুল হলে উল্টো দিকে আরেকটা transfer করে সেটা ঠিক করতে হয় — দ্বিতীয় একটা এন্ট্রি, মুছে ফেলা নয়। প্রতিটা transfer তার কারণ আর কে post করেছে তা নিয়ে তালিকায় থাকে, কারণ টাকার পথগুলোর মধ্যে এটাই একমাত্র, যার পিছনে কোনো কাগজ নেই। পয়েন্টার শুধু বোতামটার উপরেই থাকছে।',
  },
  {
    id: 'tre-open',
    say: 'Treasury is the bank book: every rupee and taka we hold, in the account it sits in, and one question the page exists to answer: is the money we owe clients still here. Open it.',
    sayBn:
      'Treasury হলো ব্যাংকের খাতা: আমাদের হাতে থাকা প্রতিটা রুপি আর প্রতিটা টাকা, কোন অ্যাকাউন্টে সেটা আছে তা ধরে ধরে — আর একটা প্রশ্নের উত্তর দিতেই এই পৃষ্ঠার জন্ম: client-দের কাছে আমরা যে টাকা দেনা, সেটা কি এখনো আমাদের কাছে আছে। এটা খুলুন।',
  },
  {
    id: 'tre-covered',
    say: 'We owe is the sum of every positive wallet balance. Held for clients is cash in our accounts marked as theirs. A healthy treasury keeps held at or above owed. Covered means we could pay everybody now. Uncovered is not automatically wrong, since COD the courier collected and not yet settled looks the same, but it is the gap you must be able to explain.',
    sayBn:
      'We owe হলো জমার দিকে থাকা প্রতিটা ওয়ালেট ব্যালেন্সের যোগফল। Held for clients হলো আমাদের অ্যাকাউন্টে থাকা যে নগদ টাকা client-দের বলে চিহ্নিত। সুস্থ একটা treasury-তে held সংখ্যাটা owed-এর সমান বা তার বেশি থাকে। Covered মানে আমরা এখনই সবাইকে টাকা দিয়ে দিতে পারতাম। Uncovered হলেই সেটা আপনা-আপনি ভুল নয়, কারণ কুরিয়ার যে COD তুলেছে কিন্তু এখনো হিসাব মেটায়নি সেটাও ঠিক এমনই দেখায় — কিন্তু এই ফাঁকটা আপনাকে ব্যাখ্যা করতে পারতে হবে।',
  },
  {
    id: 'tre-accounts',
    say: 'Per account, the split again: ours, held for clients, and the total the bank would show. A balance is the sum of its entries and not a stored figure, so it cannot go stale. Click an account and it says whose money is inside it.',
    sayBn:
      'প্রতিটা অ্যাকাউন্টের জন্য আবার সেই ভাগ: আমাদের নিজের, client-দের হয়ে ধরে রাখা, আর ব্যাংক যে মোট সংখ্যাটা দেখাবে। কোনো ব্যালেন্স হলো তার এন্ট্রিগুলোর যোগফল, আলাদা করে জমিয়ে রাখা কোনো সংখ্যা নয় — তাই এটা পুরোনো হয়ে যেতে পারে না। একটা অ্যাকাউন্টে ক্লিক করলে সেটা বলে দেয় ভিতরের টাকাটা কার।',
  },
  {
    id: 'tre-movements',
    say: 'Every movement, newest first, in an append-only table. A correction is a new entry saying who corrected it and by how much. Nothing is ever edited.',
    sayBn:
      'প্রতিটা লেনদেন, নতুনটা আগে, এমন একটা টেবিলে যেখানে শুধু নতুন লাইন যোগ হয়। কোনো সংশোধন মানে একটা নতুন এন্ট্রি, যেখানে লেখা থাকে কে সেটা ঠিক করল আর কত দিয়ে ঠিক করল। কিছুই কখনো সম্পাদনা করা হয় না।',
  },
  {
    id: 'tre-move',
    say: 'Moving money between our own accounts has its own form: click Move money. What left one account and what arrived in the other are typed separately, from the two statements, because computing the second from a rate would silently absorb every bank charge.',
    sayBn:
      'আমাদের নিজেদের অ্যাকাউন্টগুলোর মধ্যে টাকা সরানোর জন্য আলাদা একটা ফর্ম আছে: Move money-তে ক্লিক করুন। এক অ্যাকাউন্ট থেকে কত বেরিয়েছে আর অন্যটায় কত পৌঁছেছে — দুটো আলাদা করে লিখতে হয়, দুটো স্টেটমেন্ট দেখে; কারণ রেট দিয়ে দ্বিতীয় সংখ্যাটা হিসাব করে নিলে ব্যাংকের প্রতিটা চার্জ চুপচাপ হারিয়ে যেত।',
  },
  {
    id: 'tre-owner',
    say: 'Owner money is a third thing: click Owner money. What the owner puts in or takes out is equity, never income or expense, so the profit and loss does not read it. Anything else would show the business earning money it was given.',
    sayBn:
      'Owner money তৃতীয় আরেকটা জিনিস: Owner money-তে ক্লিক করুন। মালিক যা ঢালেন বা যা তুলে নেন সেটা মূলধন, কখনো আয় বা খরচ নয় — তাই লাভ-ক্ষতির হিসাব এটা পড়ে না। অন্য কিছু করলে দেখা যেত ব্যবসাটা এমন টাকা আয় করেছে, যেটা আসলে তাকে দেওয়া হয়েছিল।',
  },
  {
    id: 'tre-reconcile',
    say: 'Reconcile is the one you will use most. The statement says one figure, the book another, and the difference posts as a new entry against whoever it belongs to. The exception is expensive: money the business already had when the book began is an Opening balance, not a correction. Posted as a correction it reads as profit; a hundred thousand taka of starting cash once spent a day counted as earnings. Type why the book was wrong, since the figure records what changed and this records why. Review adjustment then Post adjustment; here the dialog is closed.',
    sayBn:
      'Reconcile-টাই আপনি সবচেয়ে বেশি ব্যবহার করবেন। স্টেটমেন্ট একটা সংখ্যা বলে, খাতা আরেকটা, আর পার্থক্যটা একটা নতুন এন্ট্রি হিসেবে বসে — যার টাকা তার নামেই। ব্যতিক্রমটা দামি: খাতা শুরু হওয়ার সময় ব্যবসার কাছে আগে থেকেই যে টাকা ছিল সেটা একটা Opening balance, কোনো সংশোধন নয়। সংশোধন হিসেবে বসালে ওটা লাভ বলে পড়া যায়; শুরুর নগদ এক লাখ টাকা একবার পুরো একটা দিন আয় হিসেবে গোনা হয়েছিল। খাতা কেন ভুল ছিল সেটা লিখুন — কারণ সংখ্যাটা লিখে রাখে কী বদলেছে, আর এটা লিখে রাখে কেন। Review adjustment, তারপর Post adjustment; এখানে ডায়ালগটা বন্ধ করে দেওয়া হচ্ছে।',
  },
  {
    id: 'frt-open',
    say: 'Inbound freight is what it cost to get a client’s goods from Bangladesh to India, billed to them. It is the one charge here not about a parcel. Open Freight. A bill is one per arrival, split over the units that actually landed. A unit owes its share when it leaves, so stock on the shelf owes nothing yet.',
    sayBn:
      'Inbound freight মানে একজন client-এর পণ্য বাংলাদেশ থেকে ভারতে আনতে যা খরচ হলো, আর সেটা তার নামেই বিল করা হয়। এখানের চার্জগুলোর মধ্যে এটাই একমাত্র, যেটা কোনো পার্সেল নিয়ে নয়। Freight খুলুন। প্রতিবার পণ্য পৌঁছানোর জন্য একটা বিল, আর সেটা আসলে যতগুলো ইউনিট পৌঁছেছে তার উপর ভাগ করে দেওয়া হয়। একটা ইউনিট নিজের ভাগটা দেয় যখন সেটা বেরিয়ে যায়, তাই তাকের উপর পড়ে থাকা স্টকের এখনো কিছুই বাকি নেই।',
  },
  {
    id: 'frt-record',
    say: 'Click Record freight bill. First, Which stop is being billed: on pay-now and pay-later terms the India arrival, which is what a forwarder invoices; on pay-in-advance the Bangladesh count. Then Agreed in, the currency of the invoice. A Dhaka forwarder quotes taka, so type the figures exactly as printed; the bill converts to rupees at the rate in force the moment you record.',
    sayBn:
      'Record freight bill-এ ক্লিক করুন। প্রথমে Which stop — কোন ধাপের বিল হচ্ছে: pay-now আর pay-later শর্তে ভারতে পৌঁছানোর ধাপ, কারণ একজন forwarder এটারই invoice দেয়; pay-in-advance শর্তে বাংলাদেশের গণনা। তারপর Agreed in — invoice-টা কোন মুদ্রায়। ঢাকার একজন forwarder দাম বলে টাকায়, তাই সংখ্যাগুলো যেমন ছাপা আছে ঠিক তেমনই লিখুন; আপনি record করার মুহূর্তে যে রেট চালু আছে, সেই রেটে বিলটা রুপিতে বদলে যায়।',
  },
  {
    id: 'frt-lines',
    say: 'Per line, Basis: per kilo or per piece, as the forwarder priced it, since a wrong basis is wrong by the weight of the carton. Then the rate and the chargeable weight. A product with no weight recorded cannot take a weight share; fix that in the catalogue instead of guessing.',
    sayBn:
      'প্রতিটা লাইনের জন্য Basis: কিলো ধরে না কি পিস ধরে — forwarder যেভাবে দাম ধরেছে সেভাবে; কারণ ভুল basis দিলে ভুলটা হয় পুরো কার্টনের ওজনের সমান। তারপর রেট আর যে ওজনের উপর চার্জ হবে। যে product-এর কোনো ওজন লেখা নেই, সেটা ওজনের ভাগ নিতে পারে না; অনুমান না করে ক্যাটালগে গিয়ে ওটা ঠিক করুন।',
  },
  {
    id: 'frt-mode',
    say: 'Mode decides whether the wallet moves now. Pay now debits it in full on record. Pay later leaves a receivable collected a unit at a time as stock sells. Choosing one pins the consignment to it. Record bill writes it; here the dialog closes.',
    sayBn:
      'Mode ঠিক করে ওয়ালেট এখনই নড়বে কি না। Pay now বাছলে record করার সময়েই পুরো টাকা কেটে নেয়। Pay later একটা পাওনা রেখে দেয়, যেটা স্টক বিক্রি হওয়ার সঙ্গে সঙ্গে এক ইউনিট করে তোলা হয়। একটা বাছলে consignment-টা সেটার সঙ্গেই বাঁধা পড়ে যায়। Record bill চাপলে এটা লেখা হয়; এখানে ডায়ালগটা বন্ধ হয়ে যাচ্ছে।',
  },
  {
    id: 'frt-settle',
    say: 'On a bill, Settle charges whatever is outstanding in one go instead of waiting for the stock to sell. The dialog says the part that matters: the ledger entry is permanent.',
    sayBn:
      'কোনো একটা বিলে Settle চাপলে স্টক বিক্রি হওয়ার অপেক্ষা না করে বাকি থাকা পুরো টাকাটা একবারেই চার্জ করে দেয়। ডায়ালগে যে কথাটা জরুরি সেটাই লেখা থাকে: ledger-এর এন্ট্রিটা স্থায়ী।',
  },
  {
    id: 'frt-void',
    say: 'Waive and Void are different acts and the screen keeps them apart. A waived bill was correct and we chose not to collect it. Void says the opposite: this bill should never have existed. It withdraws the bill, credits back what was charged, and frees the arrival to be billed again. The bill is kept under its own status, because the ledger behind it can only be added to.',
    sayBn:
      'Waive আর Void দুটো আলাদা কাজ, আর স্ক্রিনটা দুটোকে আলাদা রাখে। Waive করা বিল ঠিকই ছিল, আমরা শুধু সেটা আদায় না করার সিদ্ধান্ত নিয়েছি। Void উল্টো কথা বলে: এই বিলটার কখনোই থাকা উচিত ছিল না। এটা বিলটাকে তুলে নেয়, যা চার্জ করা হয়েছিল তা ফেরত জমা দেয়, আর ওই পৌঁছানোটাকে আবার বিল করার জন্য মুক্ত করে দেয়। বিলটা নিজের একটা আলাদা status নিয়ে রেখে দেওয়া হয়, কারণ তার পিছনের ledger-এ শুধু নতুন লাইনই যোগ করা যায়।',
  },
  {
    id: 'pnl-open',
    say: 'Profit and loss: what each part of the business earns against what it costs, and, more usefully, how much of that we can actually see. Open it. Three figures: the margin from four sources, what it costs to exist, and the net. Read the label under the net before the net.',
    sayBn:
      'Profit and loss: ব্যবসার প্রতিটা অংশ কত আয় করছে আর তার বিপরীতে কত খরচ হচ্ছে — আর আরও কাজের কথা, এর কতটুকু আমরা আসলে দেখতে পাচ্ছি। এটা খুলুন। তিনটা সংখ্যা: চারটা জায়গা থেকে আসা মার্জিন, টিকে থাকতে যা খরচ হয়, আর নিট। নিট সংখ্যাটা পড়ার আগে তার নিচের লেখাটা পড়ুন।',
  },
  {
    id: 'pnl-honest',
    say: 'A cost nobody recorded is reported as missing, never zero. Zero would report all that revenue as profit, and the page says plainly that nothing is guessed to fill the gap. Each line carries a coverage fraction: records with a real cost out of how many there are.',
    sayBn:
      'কেউ যে খরচটা লিখে রাখেনি, সেটা অনুপস্থিত বলে দেখানো হয় — কখনো শূন্য বলে নয়। শূন্য দেখালে ওই পুরো আয়টাই লাভ হিসেবে দেখানো হতো, আর পৃষ্ঠাটা স্পষ্ট করেই বলে দেয় যে ফাঁকটা ভরাট করতে কিছুই অনুমান করা হয় না। প্রতিটা লাইনের সঙ্গে একটা coverage ভগ্নাংশ থাকে: মোট কতগুলো রেকর্ড আছে, তার মধ্যে কতগুলোর সত্যিকারের খরচ জানা আছে।',
  },
  {
    id: 'pnl-delivery',
    say: 'Read Delivery carefully. It names every reason a parcel has no cost yet: the courier has not billed us, a manual courier has no ledger, or it never got a waybill. A charge worked out but never debited is a quote, not revenue, so it is named and left out. Parcels still moving are on no line, since an order counts when its fate is known.',
    sayBn:
      'Delivery লাইনটা মন দিয়ে পড়ুন। একটা পার্সেলের খরচ এখনো কেন জানা নেই, তার প্রতিটা কারণ এটা বলে দেয়: কুরিয়ার আমাদের বিল করেনি, হাতে বসানো কুরিয়ারের কোনো ledger নেই, বা পার্সেলটা কখনো কোনো waybill-ই পায়নি। যে চার্জ হিসাব করা হয়েছে কিন্তু কখনো কাটা হয়নি, সেটা একটা দর — আয় নয়; তাই তার নাম বলা হয় আর হিসাবের বাইরে রাখা হয়। যে পার্সেলগুলো এখনো পথে আছে সেগুলো কোনো লাইনেই নেই, কারণ একটা অর্ডার হিসাবে ধরা হয় যখন তার পরিণতি জানা যায়।',
  },
  {
    id: 'pnl-drill',
    say: 'Open any line to see what it is made of, then every record behind it. The total above and the rows below are the same computation, so a figure you cannot explain is a figure you can click. A return whose cost was never recorded makes that margin flattering, and the line says so.',
    sayBn:
      'যেকোনো লাইন খুলে দেখুন সেটা কী কী নিয়ে তৈরি, আর তারপর তার পিছনের প্রতিটা রেকর্ড। উপরের মোট সংখ্যা আর নিচের সারিগুলো একই হিসাব, তাই যে সংখ্যাটা আপনি ব্যাখ্যা করতে পারছেন না, সেটা আপনি ক্লিক করে দেখতে পারেন। যে ফেরতের খরচ কখনো লেখা হয়নি, সেটা ওই মার্জিনটাকে আসলের চেয়ে ভালো দেখায় — আর লাইনটা সেটা বলেও দেয়।',
  },
  {
    id: 'pnl-costsync',
    say: 'Why is so much uncovered? Open Courier cost sync. Every night we sign in to the courier’s own portal and record what each parcel really cost. It fails by going quiet: the figures stop moving, and nobody notices for weeks. Coverage is stated as a fraction here too, and an unread charge is uncovered, not free.',
    sayBn:
      'এত কিছু uncovered কেন? Courier cost sync খুলুন। প্রতি রাতে আমরা কুরিয়ারের নিজের portal-এ সাইন ইন করে লিখে রাখি প্রতিটা পার্সেলের আসল খরচ কত ছিল। এটা নষ্ট হয় চুপ করে গিয়ে: সংখ্যাগুলো আর নড়ে না, আর কয়েক সপ্তাহ ধরে কেউ টের পায় না। এখানেও coverage একটা ভগ্নাংশ হিসেবে লেখা থাকে, আর যে চার্জ পড়াই হয়নি সেটা uncovered — বিনামূল্যে নয়।',
  },
  {
    id: 'pnl-runs',
    say: 'Check the run history first. It is blunt about not knowing: either it has never run, or never finished far enough to say so. Both look identical from the margin. So read the coverage before the margin.',
    sayBn:
      'আগে run-এর ইতিহাসটা দেখে নিন। না জানার কথাটা এটা সোজা ভাষায় বলে: হয় এটা কখনো চলেইনি, নয়তো বলার মতো দূর পর্যন্ত কখনো শেষ হয়নি। মার্জিনের দিক থেকে দুটোই একদম একরকম দেখায়। তাই মার্জিন পড়ার আগে coverage পড়ুন।',
  },
  {
    id: 'pnl-month',
    say: 'Closing a month lives under Carry-forward, and it is the most permanent act in finance. It freezes the month’s figures for good. A closed month is never reopened; anything that changes it afterwards is carried into whichever month is open when we find it. This recording does not close one: a month filmed here would be a synthetic one, and the arithmetic matters more than the button.',
    sayBn:
      'একটা মাস বন্ধ করার কাজটা আছে Carry-forward-এর নিচে, আর হিসাবের কাজগুলোর মধ্যে এটাই সবচেয়ে স্থায়ী। এটা ওই মাসের সংখ্যাগুলো চিরকালের জন্য জমিয়ে দেয়। বন্ধ হয়ে যাওয়া একটা মাস আর কখনো খোলা হয় না; পরে যা কিছু সেই মাসকে বদলায়, আমরা যখন সেটা ধরতে পারি তখন যে মাসটা খোলা আছে সেই মাসেই তা বসিয়ে দেওয়া হয়। এই রেকর্ডিংয়ে কোনো মাস বন্ধ করা হচ্ছে না: এখানে ক্যামেরায় যে মাসটা বন্ধ করা হতো সেটা হতো বানানো একটা মাস, আর বোতামটার চেয়ে হিসাবটাই বেশি জরুরি।',
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
    /*
      EXACT, because `hasText: 'Default'` is a case-insensitive
      SUBSTRING match and every other active row carries a "Make
      default" button. The loose filter therefore matched the default
      row AND all its siblings, and `show()` takes the first — so the
      scene about "the default is marked" could point at a row that is
      not the default. It resolves either way, which is why only reading
      it finds this.
    */
    run: (ctx) =>
      show(
        ctx,
        ctx.page
          .locator('.sk-tbody .sk-tr')
          .filter({ has: ctx.page.getByText('Default', { exact: true }) }),
        4200,
      ),
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
    // "Run a cycle now" (`cour.ts:1206`). The old pattern was
    // /Run (it )?now/i, which matches neither that nor anything else on
    // the page — no amount of seeding could have made this scene pass.
    run: (ctx) => show(ctx, ctx.page.getByRole('button', { name: /Run a cycle now/i }), 4600),
  },
  { id: 'dlv-lookup', run: (ctx) => show(ctx, ctx.page.getByLabel(/^AWB numbers$/), 5600) },
  {
    id: 'dlv-connection',
    /*
      BY ITS HEADING, NOT ITS POSITION — and this one would never have
      been caught by a check.

      `.af-card` nth(2) RESOLVES on this page: there are seven cards, and
      index 2 is the wallet-import drop-zone, not Connection (the panels
      mount in a fixed order at `delhivery-ops-index.tsx:92-94`, with the
      Connection cards at `:117` and `:135`). So the step found an
      element, filmed it happily for five seconds, and the narration
      talked about stub mode and the live-write guard over a picture of
      an xlsx upload box. A locator that is WRONG but still matches is
      worse than one that fails, because nothing reports it.

      Positional indexes into this page are fragile anyway: three of the
      seven cards are permission-gated, so the index moves with whoever
      is signed in.
    */
    run: (ctx) =>
      show(
        ctx,
        // `.af-section`, not `.af-card`: the heading belongs to the
        // SECTION (`AfSection title=…`) and the cards nest inside it, so
        // a card filtered by that heading contains nothing.
        ctx.page
          .locator('.af-section')
          .filter({ has: ctx.page.getByRole('heading', { name: 'Connection', exact: true }) }),
        5000,
      ),
  },
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
      /*
        THE DEMO CLIENT'S ROW, not the first one.

        `.first()` opened whichever client sorts first by name — here
        "Khulna Handloom", which has no top-ups and no withdrawals — and
        the next scene walks those two tabs, which render a bare
        paragraph and NO table when the list is empty. Every other
        client's wallet is a stranger's to this video anyway: the whole
        take follows Rangpur Silk House, and its ledger is the one the
        narration describes.

        `WALLET_CLIENT` is the same handle the later wallet-transfer
        scene uses, so the two agree about whose money is on screen.
      */
      const row = page.locator('tbody tr').filter({ hasText: WALLET_CLIENT }).first();
      await row.waitFor({ state: 'visible', timeout: WAIT });
      await stage.clickIt(row.getByRole('link', { name: /Ledger/ }).first(), { after: 1600 });
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
    run: async (ctx) => {
      const preview = ctx.page.getByRole('button', {
        name: /^Preview|Worked out|Working it out/,
      });
      await show(ctx, preview, 4400);
      /*
        PRESSED, not just pointed at. The next step shows "Post
        transfer", which `wallet-transfers-index.tsx:383` renders only
        once `shown !== null` — and `shown` is set by this preview
        alone. Dwelling on the button left the next scene waiting for an
        element that could never exist.

        Safe to press: the preview endpoint works the transfer out and
        returns it. Nothing is posted until "Post transfer", which the
        next step points at and does not press.
      */
      await ctx.stage.clickIt(preview, { after: 900 });
    },
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
      const dialog = ctx.page.getByRole('dialog');
      await ctx.stage.dwellOn(dialog.getByLabel(/^Which way/).first(), 2200);
      /*
        AN AMOUNT HAS TO BE TYPED before the sentence below exists.

        `owner-money-modal.tsx:92` builds `preview` only from a
        non-empty numeric amount, and the explanation at `:154` is
        inside `{preview !== null && …}`. Without this the scene pointed
        at text the dialog had not rendered — and never would have,
        because nothing else in the step types anything.

        Typing only. The dialog posts nothing until its own confirm,
        which this video does not press.
      */
      await ctx.stage.typeIn(dialog.getByLabel(/^Amount/).first(), '25000');
      await show(ctx, dialog.getByText(/our own money in this account/i), 3200);
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
      /*
        AN ARRIVAL HAS TO BE CHOSEN before the rest of the form exists.

        Everything below "Which stop is being billed" — the currency,
        the per-product basis and rate rows, the chargeable weight —
        lives inside `{goodsReceiptId !== '' && (…)}`
        (`record-freight-modal.tsx:375`). The step used to point at the
        select and then reach straight for "Agreed in", which was not on
        the page and never would have been.

        Index 1 because index 0 is the "Choose an arrival" placeholder;
        the real options are the COMPLETED inbound legs the freight
        world seeds.
      */
      await stop.selectOption({ index: 1 });
      await ctx.page.waitForTimeout(600);
      const agreed = dialog.getByLabel(/^Agreed in/).first();
      await agreed.waitFor({ state: 'visible', timeout: WAIT });
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
    sayBn:
      'client আর প্ল্যাটফর্ম। শুরু হোক একদম উপরের ধাপ থেকে। Invite requests খুলুন। এখানের প্রত্যেকে আমাদের landing page-এর ফর্মটা পূরণ করে ভিতরে ঢোকার আবেদন করেছে, তাই এটা একটা কিউ — কোনো রিপোর্ট নয়। উপরে যে ধাপগুলো আছে সেগুলো হলো new, contacted, qualified, converted, declined, আর একটা আছে আজেবাজে আবেদনের জন্য — কারণ খোলা একটা ফর্মে সেরকম কিছু আসেই।',
  },
  {
    id: 'lead-open-one',
    say: 'The column that should decide your day is how long somebody has waited for an answer, counted from the moment they asked. Click a row. The drawer holds everything the form collected, enough to tell whether this is a business we can serve before anyone picks up a phone: how they ship, roughly how much a month, what they sell, and their own words.',
    sayBn:
      'আপনার দিনের কাজ যে কলামটা ঠিক করে দেওয়া উচিত সেটা হলো — কেউ উত্তরের জন্য কত দিন অপেক্ষা করছে, সে যে মুহূর্তে আবেদন করেছিল সেখান থেকে গোনা। একটা সারিতে ক্লিক করুন। ফর্মে যা যা সংগ্রহ করা হয়েছিল সবই drawer-এ আছে — কেউ ফোন তোলার আগেই এটা বলে দেওয়ার মতো যথেষ্ট যে এই ব্যবসাটাকে আমরা সেবা দিতে পারব কি না: সে কীভাবে পণ্য পাঠায়, মাসে মোটামুটি কত, কী বিক্রি করে, আর তার নিজের কথায় কী বলেছে।',
  },
  {
    id: 'lead-status',
    say: 'Move them along as you work them, with the Status list. The stage is what the tabs filter on, so a lead you have spoken to and left on new is a lead someone else will ring tomorrow. The notes are ours: they never reach the person, so write what the next one of us needs, what they said, what you promised, what put you off.',
    sayBn:
      'কাজ করতে করতে এদের এগিয়ে নিয়ে যান, Status তালিকা দিয়ে। উপরের tab-গুলো এই stage ধরেই ছাঁকে, তাই যার সঙ্গে আপনি কথা বলে ফেলেছেন কিন্তু new-তেই রেখে দিয়েছেন, তাকে কাল আরেকজন আবার ফোন করবে। notes আমাদের নিজেদের জন্য: এটা ওই মানুষটার কাছে কখনো পৌঁছায় না, তাই আমাদের পরের জনের যা দরকার সেটাই লিখুন — সে কী বলেছে, আপনি কী কথা দিয়েছেন, আর কী দেখে আপনার আগ্রহ কমে গেছে।',
  },
  {
    id: 'lead-invite',
    say: 'Save leaves the tab you found it in, so the queue empties as you work it. When they are worth having, Send invite sends a registration link to the address on the form. We never make the account ourselves. The link is shown once: only a hash is stored, so nobody can look it up later, and resending issues a new link and kills the old one.',
    sayBn:
      'Save করলে lead-টা আপনি যে tab-এ এটা পেয়েছিলেন সেটা থেকে বেরিয়ে যায়, তাই কাজ করতে করতেই লাইনটা খালি হয়ে আসে। এদের নেওয়ার মতো মনে হলে Send invite ফর্মে দেওয়া ঠিকানায় একটা registration link পাঠিয়ে দেয়। অ্যাকাউন্টটা আমরা নিজেরা কখনো বানাই না। link-টা একবারই দেখানো হয়: শুধু একটা hash জমা থাকে, তাই পরে কেউ এটা খুঁজে বের করতে পারে না, আর আবার পাঠালে নতুন একটা link তৈরি হয় আর পুরোনোটা নষ্ট হয়ে যায়।',
  },
  {
    id: 'lead-pending',
    say: 'Every invitation out there is on the Clients page, folded under Pending invitations. From there you can send again, which replaces the link, or delete it. When they register, they arrive in the list below waiting for approval: invited is not in, and the account can do nothing yet.',
    sayBn:
      'বাইরে পাঠানো প্রতিটা invitation থাকে Clients পাতায়, Pending invitations-এর ভাঁজের ভিতরে। ওখান থেকে আবার পাঠাতে পারেন — তাতে link-টা বদলে যায় — বা মুছে দিতে পারেন। তারা registration করলে নিচের তালিকায় এসে approval-এর অপেক্ষায় বসে: invite পাওয়া মানে ভিতরে ঢুকে যাওয়া নয়, আর অ্যাকাউন্টটা তখনো কিছুই করতে পারে না।',
  },
  {
    id: 'cli-open',
    say: 'Clients. Search by any part of a name, email or phone, and open one. What opens is everything we know about one account, and the three levers we have over it.',
    sayBn:
      'Clients। নাম, email বা ফোন নম্বরের যেকোনো অংশ দিয়ে খুঁজুন, আর একটা খুলুন। যা খোলে তাতে একটা অ্যাকাউন্ট সম্পর্কে আমরা যা জানি সবই থাকে, আর তার উপর আমাদের হাতে যে তিনটা হাতল আছে সেগুলোও।',
  },
  {
    id: 'cli-correct',
    say: 'First the name and the phone number, which are what we approved them as. A client cannot change either from their own portal; a staff correction is the only route. It sits behind Correct these details on purpose: it is a correction, not routine editing.',
    sayBn:
      'প্রথমে নাম আর ফোন নম্বর — এই পরিচয়েই আমরা এদের approve করেছিলাম। একটা client নিজের portal থেকে এর কোনোটাই বদলাতে পারে না; staff-এর সংশোধনই একমাত্র পথ। এটা Correct these details-এর পিছনে রাখা হয়েছে ইচ্ছে করেই: এটা সংশোধন, রোজকার সম্পাদনা নয়।',
  },
  {
    id: 'cli-correct-reason',
    say: 'The dialog opens filled with what is there, so you edit rather than retype. The reason is not optional: it is the single record of why an approved identity changed, and whoever reads it next year has nothing else. Apply correction would write it; here it closes.',
    sayBn:
      'dialog-টা এখন যা আছে তা ভরা অবস্থাতেই খোলে, তাই আপনাকে নতুন করে লিখতে হয় না, শুধু বদলাতে হয়। reason দেওয়া ঐচ্ছিক নয়: approve করা একটা পরিচয় কেন বদলাল, তার একমাত্র নথি এটাই, আর আগামী বছর যে এটা পড়বে তার হাতে আর কিছুই থাকবে না। Apply correction চাপলে এটা লেখা হয়ে যেত; এখানে আমরা শুধু বন্ধ করে দিচ্ছি।',
  },
  {
    id: 'cli-hold',
    say: 'The lever this page mostly exists for is the Account hold. It stops a client who owes us money from starting new work, and it takes itself off when their balance clears. Click Place a hold.',
    sayBn:
      'এই পাতাটা মূলত যে হাতলটার জন্য আছে, সেটা Account hold। আমাদের কাছে যে client-এর টাকা বাকি, তাকে এটা নতুন কাজ শুরু করতে দেয় না, আর তার ব্যালেন্স পরিষ্কার হয়ে গেলে এটা নিজে নিজেই উঠে যায়। Place a hold-এ ক্লিক করুন।',
  },
  {
    id: 'cli-hold-scope',
    say: 'Four things to stop them from, and each is an entry point: block those and nothing new begins, while every parcel already moving carries on. The three underneath are different. They do not protect the money, because a parcel already with the courier still has to be delivered, tracked and returned. Tick one and the dialog warns that it affects parcels in transit and is recorded as such. Reach for the first four.',
    sayBn:
      'চারটা জিনিস আটকানো যায়, আর প্রতিটাই একটা ঢোকার দরজা: এগুলো বন্ধ করলে নতুন কিছু শুরু হয় না, অথচ যে পার্সেলগুলো আগেই চলতে শুরু করেছে সেগুলো চলতেই থাকে। নিচের তিনটা আলাদা। ওগুলো টাকা বাঁচায় না, কারণ কুরিয়ারের হাতে চলে যাওয়া পার্সেল তো ডেলিভারি করতেই হবে, track করতেই হবে, আর ফেরত আনতেও হবে। এর কোনোটায় টিক দিলে dialog সাবধান করে দেয় যে এটা চলতি পার্সেলের উপর প্রভাব ফেলে, আর সেভাবেই এটা নথিভুক্ত হয়। হাত বাড়ান প্রথম চারটার দিকে।',
  },
  {
    id: 'cli-hold-clear',
    say: 'Then Lifts automatically at balance, usually zero: applied by a person, cleared by money. And the Reason, which the client reads on every page of their portal. Write it as you would say it to them, since a hold nobody understands is one they telephone about instead of fixing. Lift now takes it off by hand when you agree a date. Place hold is not pressed.',
    sayBn:
      'তারপর Lifts automatically at balance — সাধারণত শূন্য: hold বসায় একজন মানুষ, আর ওঠায় টাকা। আর Reason, যেটা client তার portal-এর প্রতিটা পাতায় পড়তে পায়। যেভাবে মুখে বলতেন সেভাবেই লিখুন, কারণ যে hold কেউ বুঝতে পারে না, সেটা ঠিক করার বদলে মানুষ সেটা নিয়ে ফোন করে। Lift now দিয়ে হাতে করে এটা তুলে দেওয়া যায়, যখন আপনি একটা তারিখে রাজি হন। Place hold এখানে চাপা হচ্ছে না।',
  },
  {
    id: 'cli-suspend',
    say: 'Suspend account is the blunt lever. Click it and read the consequence: they lose the portal immediately, while their orders and parcels carry on under us. It stops them talking to us; it does not stop the goods. Give a reason and press Suspend; Reapprove account reverses it. A hold is the only one of these that undoes itself, so reach for it first.',
    sayBn:
      'Suspend account হলো ভোঁতা হাতলটা। ক্লিক করে পরিণামটা পড়ুন: ওরা সঙ্গে সঙ্গে portal হারায়, অথচ ওদের অর্ডার আর পার্সেল আমাদের হাতে চলতেই থাকে। এটা ওদের আমাদের সঙ্গে কথা বলা বন্ধ করে; মালপত্র চলা বন্ধ করে না। একটা reason দিন আর Suspend চাপুন; Reapprove account দিয়ে এটা উল্টে দেওয়া যায়। এগুলোর মধ্যে শুধু hold-ই নিজে নিজে উঠে যায়, তাই আগে ওটার দিকেই হাত বাড়ান।',
  },
  {
    id: 'cli-settings',
    say: 'Further down the same page, Settings for this client: every setting that can be agreed separately. Three columns, and the third is the one to read: what is in effect, the system default, and whether this client has been moved off it. Each row leads with what it does in words; the key beneath is for searching a log.',
    sayBn:
      'একই পাতার আরও নিচে, Settings for this client: যে যে setting আলাদা করে ঠিক করে নেওয়া যায়, সবগুলো। তিনটা কলাম, আর পড়ার জিনিস হলো তৃতীয়টা: এখন কোন মানটা চলছে, system-এর default কী, আর এই client-কে সেটা থেকে সরানো হয়েছে কি না। প্রতিটা সারির শুরুতেই কথায় লেখা আছে এটা কী করে; নিচের key-টা log-এ খোঁজার জন্য।',
  },
  {
    id: 'cli-override',
    say: 'Click Override on a row. The panel repeats the value and where it came from, so you change something you have read. Enter the agreed figure and a note, which is the only thing that will explain an odd price to whoever inherits the account. Set override saves it; Reset later removes the override, which is the act, there being no blank to type.',
    sayBn:
      'কোনো একটা সারিতে Override-এ ক্লিক করুন। panel-টা মানটা আর সেটা কোথা থেকে এসেছে আবার দেখিয়ে দেয়, যাতে আপনি পড়ে নিয়েই বদলান। যে সংখ্যায় রাজি হয়েছেন সেটা আর একটা note লিখুন — পরে যে এই অ্যাকাউন্টটা হাতে পাবে, তার কাছে একটা অদ্ভুত দাম ব্যাখ্যা করার এটাই একমাত্র জিনিস। Set override দিয়ে এটা সেভ হয়; পরে Reset দিয়ে override-টা তুলে দেওয়া হয় — ওটাই কাজটা, কারণ ফাঁকা করে লেখার মতো কিছু এখানে নেই।',
  },
  {
    id: 'cli-currency',
    say: 'The row underneath is the trap. The fee and the currency it was agreed in are two separate settings. Move one without the other and you have changed the price by the exchange rate.',
    sayBn:
      'নিচের সারিটাই ফাঁদ। চার্জটা, আর সেটা যে মুদ্রায় ঠিক হয়েছিল — এই দুটো আলাদা setting। একটা বদলে আরেকটা না বদলালে আপনি দামটাই বদলে ফেললেন, ঠিক বিনিময় হারের পরিমাণে।',
  },
  {
    id: 'cli-couriers',
    say: 'The second half of the page is the Courier accounts this client’s parcels use. No links is the ordinary state and means the default. Click Add link, choose the account and a weight. A weight is a share, not a parcel count: two links at a hundred split the client evenly. Unlinking hands a share back, and unlinking the last returns them to the default. Parcels already booked keep the account that carried them.',
    sayBn:
      'পাতার দ্বিতীয় অর্ধেকটা হলো Courier accounts — এই client-এর পার্সেল যেগুলো দিয়ে যায়। No links-ই স্বাভাবিক অবস্থা, আর তার মানে default। Add link-এ ক্লিক করুন, account আর একটা weight বেছে নিন। weight হলো একটা ভাগ, পার্সেলের সংখ্যা নয়: একশো করে দুটো link দিলে client-এর পার্সেল সমান দুই ভাগ হয়ে যায়। link তুলে নিলে সেই ভাগটা ফিরে যায়, আর শেষ link-টা তুলে নিলে ওরা আবার default-এ ফিরে আসে। যে পার্সেল আগেই বুক হয়ে গেছে, সেটা যে account-এ গেছে সেটাই রেখে দেয়।',
  },
  {
    id: 'cli-credit',
    say: 'One switch is deliberately not in that list: credit after confirmation, which lets a member store be paid days after a phone call and before the customer has paid. It has an endpoint of its own and the ordinary override writer refuses it by name.',
    sayBn:
      'একটা switch ইচ্ছে করেই ওই তালিকায় রাখা হয়নি: credit after confirmation — এটা একটা member store-কে ফোন কলের কয়েক দিন পরেই, ক্রেতা টাকা দেওয়ার আগেই টাকা পেয়ে যাওয়ার সুযোগ দেয়। এর নিজের আলাদা endpoint আছে, আর সাধারণ override লেখার জায়গাটা নাম ধরে এটাকে বাতিল করে দেয়।',
  },
  {
    id: 'sys-open',
    say: 'System settings change how the whole platform behaves, one row at a time, with every edit recorded with its before and after. Open Settings. They are grouped by what a setting decides: charges, cash on delivery, the warehouse, failed deliveries, and so on.',
    sayBn:
      'System settings পুরো platform-টা কীভাবে চলবে সেটাই বদলে দেয়, একবারে একটা সারি করে, আর প্রতিটা বদলের আগে-পরের মান নথিভুক্ত হয়ে থাকে। Settings খুলুন। একটা setting কী ঠিক করে, সেই অনুযায়ী এগুলো ভাগ করা: চার্জ, cash on delivery, গুদাম, ব্যর্থ ডেলিভারি, এরকম।',
  },
  {
    id: 'sys-row',
    say: 'A row leads with what it does in plain words, then what kind of value it is, which decides the editor, then the value now, with the raw key beneath for searching a log. The small i is the part worth knowing: what the setting decides, and an example at a given value, so you need not read the code. Some values look like secrets and are not: they are the name of the environment variable, because a secret in the database is a secret in every backup.',
    sayBn:
      'একটা সারির শুরুতে সহজ কথায় লেখা থাকে এটা কী করে, তারপর মানটা কোন ধরনের — সেটাই ঠিক করে কোন editor খুলবে — তারপর এখনকার মান, আর নিচে কাঁচা key-টা, log-এ খোঁজার জন্য। ছোট i-টাই জানার মতো অংশ: এই setting কী ঠিক করে, আর একটা নির্দিষ্ট মানে কী হয় তার একটা উদাহরণ, যাতে আপনাকে কোড পড়তে না হয়। কিছু মান দেখে গোপন তথ্য মনে হয়, কিন্তু নয়: ওগুলো environment variable-এর নাম, কারণ database-এ রাখা একটা গোপন তথ্য মানে প্রতিটা backup-এও সেই গোপন তথ্য।',
  },
  {
    id: 'sys-edit',
    say: 'Click Edit. A yes-or-no setting is a list and not a tick box: each answer says what it does and gives an example. A number gets a number box, checked against the server’s bounds on Save. Some rows cannot be edited here at all, because they have a route with stricter guardrails. Cancel closes it.',
    sayBn:
      'Edit-এ ক্লিক করুন। হ্যাঁ-না ধরনের setting এখানে একটা তালিকা, টিক বাক্স নয়: প্রতিটা উত্তর বলে দেয় সেটা কী করে, আর একটা উদাহরণও দেয়। সংখ্যার জন্য একটা সংখ্যার ঘর আসে, আর Save চাপলে server-এর বেঁধে দেওয়া সীমার সঙ্গে সেটা মিলিয়ে দেখা হয়। কিছু সারি এখানে একেবারেই বদলানো যায় না, কারণ ওগুলোর জন্য আরও কড়া পাহারা দেওয়া আলাদা পথ আছে। Cancel চাপলে এটা বন্ধ হয়ে যায়।',
  },
  {
    id: 'sys-live',
    say: 'Saved settings are already true: there is no deploy between typing and taking effect, which is exactly why the page exists and why it is dangerous. Putting a value back is the same two clicks, but parcels that moved while it was wrong are not coming back. Read the i, change one row at a time.',
    sayBn:
      'সেভ করা setting সঙ্গে সঙ্গেই সত্যি: লেখা আর কাজ শুরু করার মাঝখানে কোনো deploy নেই — আর এই কারণেই এই পাতাটা আছে, আর এই কারণেই এটা বিপজ্জনক। মানটা আগের জায়গায় ফিরিয়ে দিতেও ওই একই দুটো ক্লিক, কিন্তু মানটা ভুল থাকার সময় যে পার্সেলগুলো চলে গেছে সেগুলো আর ফিরে আসবে না। i-টা পড়ুন, আর একবারে একটা সারি বদলান।',
  },
  {
    id: 'stf-open',
    say: 'Staff are the people with a login to this console. Open Staff. You do three things to them: let someone in, change what they can do, and take the login away.',
    sayBn:
      'Staff মানে এই console-এ যাদের login আছে সেই মানুষগুলো। Staff খুলুন। এদের নিয়ে আপনি তিনটা কাজ করেন: কাউকে ভিতরে ঢোকানো, কে কী করতে পারবে সেটা বদলানো, আর login কেড়ে নেওয়া।',
  },
  {
    id: 'stf-invite',
    say: 'Click Invite staff. An invitation is an email address and the roles they will hold, as many as the job really is. The list is every role on the console, including the ones your team built. Create invitation then shows the link once. We keep a hash and nothing else, so no screen can show it again: copy it and send it yourselves. Until it is used it sits under pending, where re-issuing kills the old link and revoking discards it.',
    sayBn:
      'Invite staff-এ ক্লিক করুন। একটা invitation মানে একটা email ঠিকানা আর সে যে যে role পাবে — কাজটা আসলে যতগুলো, ততগুলোই। তালিকায় console-এর প্রতিটা role আছে, আপনার টিম যেগুলো বানিয়েছে সেগুলোসহ। তারপর Create invitation চাপলে link-টা একবার দেখানো হয়। আমরা শুধু একটা hash রাখি, আর কিছুই না, তাই কোনো পর্দা এটা আবার দেখাতে পারবে না: copy করে নিজেরাই পাঠিয়ে দিন। ব্যবহার না হওয়া পর্যন্ত এটা pending-এর তলায় পড়ে থাকে, যেখানে আবার issue করলে পুরোনো link নষ্ট হয়ে যায় আর revoke করলে এটা বাতিল হয়ে যায়।',
  },
  {
    id: 'stf-role',
    say: 'To change what someone may do, click Change roles on their row. It replaces the whole set. Nothing has moved: the panel lists what they gain and lose, and until the set differs there is nothing to save. Save roles writes it, and it applies on their next request, not their next sign-in. What they can do is every role they hold, added together.',
    sayBn:
      'কেউ কী কী করতে পারবে সেটা বদলাতে, তার সারিতে Change roles-এ ক্লিক করুন। এটা পুরো সেটটাই বদলে বসায়। এখানে কিছুই নড়েনি: panel দেখিয়ে দেয় সে কী পাচ্ছে আর কী হারাচ্ছে, আর সেটটা আলাদা না হওয়া পর্যন্ত সেভ করার কিছুই নেই। Save roles চাপলে এটা লেখা হয়, আর কাজ শুরু করে তার পরের request থেকে, পরের sign-in থেকে নয়। সে কী করতে পারবে, সেটা হলো তার হাতে থাকা সব role একসঙ্গে যোগ করলে যা দাঁড়ায়।',
  },
  {
    id: 'stf-deactivate',
    say: 'To take the login away, click Deactivate. The account is deactivated and they can no longer sign in. Nothing they did is touched, and the row stays, marked and with no actions, because a person who left is still the answer to who approved that client in March.',
    sayBn:
      'login কেড়ে নিতে Deactivate-এ ক্লিক করুন। অ্যাকাউন্টটা deactivated হয়ে যায় আর সে আর sign in করতে পারে না। সে যা যা করেছে তার কিছুই ছোঁয়া হয় না, আর সারিটা থেকে যায় — চিহ্ন দেওয়া অবস্থায়, কোনো action ছাড়া — কারণ যে চলে গেছে, মার্চ মাসে ওই client-কে কে approve করেছিল, তার উত্তর তো সে-ই।',
  },
  {
    id: 'bc-open',
    say: 'The other half of that job is telling everybody something. Open Broadcast. The subtitle is the whole design: a broadcast cannot be recalled, so the count comes first.',
    sayBn:
      'ওই কাজের বাকি অর্ধেকটা হলো সবাইকে কিছু জানানো। Broadcast খুলুন। নিচের ছোট লাইনটাই পুরো নকশাটা: একটা broadcast ফিরিয়ে আনা যায় না, তাই আগে আসে সংখ্যাটা।',
  },
  {
    id: 'bc-audience',
    say: 'The audience is a list of selectors resolved when you send, not a mailing list. Choose A staff role and enter its key. A role can be renamed, but a permission is a durable fact about what somebody does, so prefer the permission selectors.',
    sayBn:
      'audience কোনো mailing list নয় — এটা কয়েকটা selector-এর তালিকা, যেগুলো আপনি পাঠানোর মুহূর্তে হিসাব করে বের করা হয়। A staff role বেছে নিন আর তার key লিখুন। একটা role-এর নাম বদলে যেতে পারে, কিন্তু একটা permission হলো কেউ কী কাজ করে তার একটা টেকসই সত্য, তাই permission-এর selector-গুলোই বেশি পছন্দনীয়।',
  },
  {
    id: 'bc-message',
    say: 'Choose the channels: in-app or email. In-app is the default because it arrives where the work is. Then a title and the message itself.',
    sayBn:
      'channel বেছে নিন: in-app বা email। in-app-ই default, কারণ কাজ যেখানে হয় সেখানেই এটা পৌঁছায়। তারপর একটা title, আর তারপর বার্তাটা নিজেই।',
  },
  {
    id: 'bc-count',
    say: 'You cannot reach Send without asking how many people that is. How many is that? answers with the number and the first few names, so it is checkable rather than merely alarming.',
    sayBn:
      'কত জন মানুষ হচ্ছে সেটা জিজ্ঞেস না করে আপনি Send পর্যন্তই পৌঁছাতে পারবেন না। How many is that? সংখ্যাটা আর প্রথম কয়েকটা নাম দেখিয়ে উত্তর দেয়, যাতে এটা শুধু ভয় না দেখিয়ে মিলিয়ে দেখারও সুযোগ দেয়।',
  },
  {
    id: 'bc-send',
    say: 'Then the button names the figure, Send to that many, and the figure you saw travels with the send. If the population moved while you read it, the server refuses rather than sending to a different room than you agreed. What is stored is the audience you chose, not the names it landed on, because a month later the question is who you meant to tell. Never press Send on a number you have not read.',
    sayBn:
      'তারপর বোতামটা সংখ্যাটা ধরে নাম নেয় — Send to that many — আর আপনি যে সংখ্যাটা দেখেছিলেন সেটাই পাঠানোর সঙ্গে যায়। আপনি পড়ার ফাঁকে যদি মানুষের সংখ্যাটা বদলে যায়, তাহলে server পাঠাতেই রাজি হয় না — আপনি যে ঘরটায় রাজি হয়েছিলেন, তার বদলে অন্য ঘরে পাঠায় না। জমা থাকে আপনি যে audience বেছেছিলেন সেটা, যাদের কাছে গিয়ে পড়েছে তাদের নাম নয়, কারণ এক মাস পরে প্রশ্নটা হয় আপনি কাদের জানাতে চেয়েছিলেন। যে সংখ্যাটা আপনি পড়েননি, সেটার উপর কখনো Send চাপবেন না।',
  },
];

const P_SAY = [
  {
    id: 'god-open',
    say: 'The five acts that cannot be taken back. First, God mode. This order is paused: the call centre rang, nobody answered, and rather than reject it we asked the client what to do. The client has since rung us: the customer answered and wants it. No button does that. Open Orders, find it with the status Awaiting client decision, and click the order number.',
    sayBn:
      'এবার সেই পাঁচটা কাজ, যেগুলো আর ফিরিয়ে নেওয়া যায় না। প্রথম, god mode। এই অর্ডারটা থেমে আছে: call centre ফোন করেছিল, কেউ ধরেনি, আর এটা বাতিল করে দেওয়ার বদলে আমরা client-কে জিজ্ঞেস করেছি কী করব। তারপর client আমাদের ফোন করেছে: ক্রেতা ফোন ধরেছে আর জিনিসটা নিতে চায়। কোনো বোতাম এই কাজটা করে না। Orders খুলুন, Awaiting client decision status দিয়ে এটা খুঁজে বের করুন, আর অর্ডার নম্বরে ক্লিক করুন।',
  },
  {
    id: 'god-stuck',
    say: 'Open the Actions section. The rules from here allow calling again, letting it go, or calling it off, and nothing else. God mode is for the state the rules do not offer.',
    sayBn:
      'Actions অংশটা খুলুন। এখান থেকে নিয়ম যা যা করতে দেয়: আবার ফোন করা, এটা ছেড়ে দেওয়া, বা পুরো বাতিল করে দেওয়া — আর কিছুই না। god mode সেই অবস্থাটার জন্য, যেটা নিয়ম আপনাকে দেয়ই না।',
  },
  {
    id: 'god-panel',
    say: 'The god-mode panel says what it is. It bypasses the state machine and the edit rules, it is audited as critical, and it marks the order with a flag that is set once and never cleared. It needs the permission that super admins hold and few others.',
    sayBn:
      'god mode-এর panel নিজেই বলে দেয় এটা কী। এটা state machine আর edit-এর নিয়ম — দুটোই পাশ কাটিয়ে যায়, এটা critical হিসেবে audit হয়, আর অর্ডারটার উপর একটা flag বসিয়ে দেয়, যেটা একবার বসে আর কখনো ওঠে না। এর জন্য যে permission দরকার, সেটা super admin-দের থাকে, আর খুব কম লোকের।',
  },
  {
    id: 'god-dialog',
    say: 'Click Force-mutate…. The dialog goes red, names the rule it is breaking, and opens with a warning written by whoever built it. Everything worth reading sits above the button.',
    sayBn:
      'Force-mutate…-এ ক্লিক করুন। dialog-টা লাল হয়ে যায়, কোন নিয়মটা ভাঙা হচ্ছে তার নাম বলে দেয়, আর যে এটা বানিয়েছে তার লেখা একটা সতর্কবার্তা দিয়ে শুরু হয়। পড়ার মতো সবকিছু ওই বোতামটার উপরেই আছে।',
  },
  {
    id: 'god-consequences',
    say: 'This is the half people miss. A forced status has the same consequences as a real one, except stock: emails to the customer and the client, webhooks, invoices, delivery-time billing, the call queue. A forced confirmation also gets a shipment and a waybill, which costs money the moment it is booked, and a waybill already issued is never cancelled with the courier by anything here.',
    sayBn:
      'এই অর্ধেকটাই মানুষ খেয়াল করে না। জোর করে বসানো status-এর পরিণাম আসল status-এর মতোই — শুধু স্টক ছাড়া: ক্রেতা আর client-কে email, webhook, invoice, ডেলিভারির সময়ের বিল, call queue। জোর করে Confirmed করলে একটা shipment আর একটা waybill-ও তৈরি হয়, যেটা বুক হওয়ার মুহূর্তেই টাকা খরচ করে ফেলে — আর একবার বেরিয়ে যাওয়া waybill এখানকার কোনো কিছু দিয়েই কুরিয়ারের কাছে বাতিল করা হয় না।',
  },
  {
    id: 'god-fields',
    say: 'The fields are a whitelist, not free text: a fixed list, grouped, each printing what it holds today. Ticking a field is what sends it. Anything left alone is not touched. This is the Payment and value group, where getting it wrong costs money.',
    sayBn:
      'field-গুলো একটা whitelist, যা খুশি লেখার জায়গা নয়: একটা বাঁধা তালিকা, দলে দলে সাজানো, আর প্রতিটা দেখিয়ে দেয় আজ তার ভিতরে কী আছে। একটা field-এ টিক দেওয়াই সেটা পাঠিয়ে দেয়। যেটায় হাত দেননি, সেটা ছোঁয়াও হয় না। এটা Payment and value দলটা, যেখানে ভুল করলে টাকা যায়।',
  },
  {
    id: 'god-status',
    say: 'The status sits behind a checkbox of its own, which says plainly what it does and where this order stands now. Tick it and pick the target. Every status the system has is in the list, reachable or not. Here, Confirmed.',
    sayBn:
      'status-টা তার নিজের একটা checkbox-এর পিছনে থাকে, যেটা সোজা কথায় বলে দেয় এটা কী করে আর এই অর্ডারটা এখন কোথায় দাঁড়িয়ে আছে। টিক দিন আর যেখানে নিতে চান সেটা বেছে নিন। system-এর প্রতিটা status ওই তালিকায় আছে — ওখানে পৌঁছানো যায় কি না, তা নির্বিশেষে। এখানে, Confirmed।',
  },
  {
    id: 'god-reason',
    say: 'Then the reason: thirty characters at least. The counter shows you have not finished, it is not grading you. Write it for the person reading this order next year.',
    sayBn:
      'তারপর reason: অন্তত ত্রিশটা অক্ষর। counter-টা শুধু দেখায় আপনার লেখা শেষ হয়নি, এটা আপনাকে নম্বর দিচ্ছে না। আগামী বছর যে এই অর্ডারটা পড়বে, তার জন্যই লিখুন।',
  },
  {
    id: 'god-ack',
    say: 'The acknowledgement is worth reading, not ticking. Stock is attempted and not enforced. Moving an order away from confirmed leaves its reservations held. And the flag is permanent.',
    sayBn:
      'acknowledgement-টা পড়ার জিনিস, টিক দেওয়ার নয়। স্টকের বেলায় চেষ্টা করা হয়, জোর করা হয় না। একটা অর্ডারকে Confirmed থেকে সরিয়ে নিলে তার reservation ধরা অবস্থাতেই পড়ে থাকে। আর flag-টা স্থায়ী।',
  },
  {
    id: 'god-press',
    say: 'Continue opens a second screen that restates exactly what will happen, and you type the words FORCE-MUTATE by hand. That is not a safety net; it is a pause long enough to change your mind. Then Force-mutate this order is one press with no undo: the order’s history now has an edge the rules forbid, under your name, permanently. It reports where the order landed, which fields applied, the flag now true, and a row per line it tried to reserve. The pointer stops on Continue.',
    sayBn:
      'Continue চাপলে দ্বিতীয় একটা পর্দা খোলে, যেটা ঠিক কী ঘটবে সেটা আবার বলে দেয়, আর ওখানে আপনাকে হাতে করে FORCE-MUTATE শব্দটা লিখতে হয়। ওটা কোনো নিরাপত্তা-জাল নয়; ওটা শুধু এতটুকু থামা, যাতে মন বদলানোর সময় পান। তারপর Force-mutate this order একবারের একটা চাপ, যার কোনো undo নেই: অর্ডারটার ইতিহাসে এখন এমন একটা পদক্ষেপ ঢুকে গেল যেটা নিয়ম নিষেধ করে — আপনার নামে, চিরকালের জন্য। এটা জানিয়ে দেয় অর্ডারটা কোথায় গিয়ে দাঁড়াল, কোন কোন field বসল, flag এখন true, আর যে যে লাইনে reserve করার চেষ্টা হয়েছে তার প্রতিটার জন্য একটা সারি। পয়েন্টারটা Continue-তেই থেমে যাচ্ছে।',
  },
  {
    id: 'god-release',
    say: 'Beside it are the two halves of one question, this order’s claim on the shelves. Release reservations gives back everything it holds, and is the only thing that will after you force an order away from confirmed. Restore re-reserves an order that lost its claim. Click Release reservations… and read the consequence; the order wears the override from now on as a badge, a critical audit row and an entry in its own history.',
    sayBn:
      'তার পাশেই আছে একটা প্রশ্নের দুটো অর্ধেক — তাকের উপর এই অর্ডারটার দাবি। Release reservations এটা যা যা ধরে রেখেছে সব ফিরিয়ে দেয়, আর একটা অর্ডারকে জোর করে Confirmed থেকে সরিয়ে আনার পর একমাত্র এটাই সেই কাজটা করবে। Restore দিয়ে যে অর্ডার তার দাবি হারিয়েছে তাকে আবার reserve করা হয়। Release reservations…-এ ক্লিক করুন আর পরিণামটা পড়ুন; এরপর থেকে অর্ডারটা override-টা একটা ব্যাজের মতো গায়ে নিয়ে ঘোরে — একটা critical audit সারি, আর তার নিজের ইতিহাসে একটা ঘর।',
  },
  {
    id: 'live-find',
    say: 'Second, live courier writes. A parcel the driver could not deliver is still with the courier, and everything we might ask them to do about it lives in one panel on the order. Open Orders, filter by Delivery failed, and open one.',
    sayBn:
      'দ্বিতীয়, কুরিয়ারের কাছে সরাসরি live লেখা। ড্রাইভার যে পার্সেল ডেলিভারি করতে পারেনি, সেটা এখনো কুরিয়ারের হাতেই আছে, আর সেটা নিয়ে আমরা ওদের কাছে যা যা চাইতে পারি তার সবই অর্ডারের একটা panel-এর ভিতরে। Orders খুলুন, Delivery failed দিয়ে ছেঁকে নিন, আর একটা খুলুন।',
  },
  {
    id: 'live-closed',
    say: 'The panel is shut: Courier actions and costs. Opening it spends live calls to Delhivery, so a person checking a status is not made to pay for a lane being priced. Opening it is the consent to spend them. It is not opened in this recording.',
    sayBn:
      'panel-টা বন্ধ অবস্থায় থাকে: Courier actions and costs। এটা খুললে Delhivery-তে সত্যিকারের live call খরচ হয়, তাই কেউ শুধু একটা status দেখতে এলে তাকে একটা রুটের দাম বের করার খরচ দিতে হয় না। এটা খোলাই হলো ওই খরচ করার সম্মতি। এই রেকর্ডিংয়ে এটা খোলা হচ্ছে না।',
  },
  {
    id: 'live-writes',
    say: 'Inside are two reads and four writes. The reads: what they expect the parcel to take, what they will charge us, which zone; and proof of delivery and the signature, only if they still hold them. The writes. Request another delivery attempt, offered because the server says Delhivery would accept one on this code: a van goes out again at our expense. Correct the recipient, the gentlest: only the fields you fill are sent, and it is refused once a parcel is out for delivery. Cancel with courier is red for a reason: a moving parcel turns round and comes back at the cost of a return leg, and the button stays dead until you write at least ten characters of why. And Record a scan manually, for when their panel says delivered and ours does not.',
    sayBn:
      'ভিতরে দুটো পড়া আর চারটা লেখা। পড়াগুলো: পার্সেলটা পৌঁছাতে ওদের কত সময় লাগবে বলে ওরা মনে করছে, ওরা আমাদের কাছ থেকে কত নেবে, কোন zone; আর proof of delivery আর সই — তবে শুধু যদি ওগুলো তখনো ওদের কাছে থাকে। এবার লেখাগুলো। Request another delivery attempt — এটা দেখানো হচ্ছে কারণ server বলছে এই code-এ Delhivery আরেকবার চেষ্টা নিতে রাজি হবে: আমাদের খরচে আরেকবার একটা ভ্যান বেরোয়। Correct the recipient সবচেয়ে নরম কাজটা: আপনি যে field-গুলো ভরবেন শুধু সেগুলোই পাঠানো হয়, আর পার্সেল একবার out for delivery হয়ে গেলে এটা আর নেওয়া হয় না। Cancel with courier লাল, আর তার কারণ আছে: চলতি একটা পার্সেল ঘুরে দাঁড়িয়ে ফিরে আসে, আর তার জন্য একটা ফেরতের পথের খরচ গুনতে হয় — আর কেন করছেন সেটা অন্তত দশ অক্ষরে না লেখা পর্যন্ত বোতামটা নিষ্ক্রিয় পড়ে থাকে। আর Record a scan manually, যখন ওদের panel বলছে delivered আর আমাদেরটা বলছে না।',
  },
  {
    id: 'live-no-sandbox',
    say: 'Two rules for all four. There is no sandbox: every button reaches the real Delhivery, so nothing in this video presses one. And none of it moves the order. The courier accepting a cancellation is their opinion about a parcel; the order’s status comes from their scans, which arrive later and may disagree. A scan you type is something you are asserting happened, and it carries the time of the scan, not of the typing.',
    sayBn:
      'চারটার জন্যই দুটো নিয়ম। এখানে কোনো sandbox নেই: প্রতিটা বোতাম আসল Delhivery-তেই গিয়ে পৌঁছায়, তাই এই ভিডিওতে একটাও চাপা হচ্ছে না। আর এর কোনোটাই অর্ডারটাকে নড়ায় না। কুরিয়ার একটা cancellation মেনে নিল মানে পার্সেলটা নিয়ে ওটা ওদের মত; অর্ডারের status আসে ওদের scan থেকে, যেগুলো পরে আসে আর অন্য কথা বলতেও পারে। আপনি হাতে যে scan লিখছেন, সেটা দিয়ে আপনি দাবি করছেন যে ঘটনাটা ঘটেছে — আর সেটা scan-এর সময়টা বহন করে, আপনি যখন লিখছেন সেই সময়টা নয়।',
  },
  {
    id: 'tix-open',
    say: 'Third, refunds and disputes. Open Tickets: everything anybody is arguing about. Goods we damaged, a count that came up short, a member store that has fallen out with the client whose stock it sells.',
    sayBn:
      'তৃতীয়, টাকা ফেরত আর বিবাদ। Tickets খুলুন: যে যা নিয়ে তর্ক করছে, সবই এখানে। আমরা যে মাল ভেঙেছি, যে গণনায় কম পড়েছে, আর যে member store-এর সঙ্গে সেই client-এর মন কষাকষি হয়েছে যার স্টক সে বিক্রি করে।',
  },
  {
    id: 'tix-kinds',
    say: 'The type column comes first and changes how you read the rest. Software raised a receipt-short ticket; a person raised the dispute. Only some are ours to answer at all.',
    sayBn:
      'type কলামটা আগে আসে, আর বাকিটা আপনি কীভাবে পড়বেন সেটাই এটা বদলে দেয়। receipt-short ticket-টা তুলেছে software; dispute-টা তুলেছে একজন মানুষ। এর মধ্যে কেবল কয়েকটারই উত্তর দেওয়ার কাজ আমাদের।',
  },
  {
    id: 'tix-thread',
    say: 'Click a ticket. This one is about a count, so it names a goods receipt where others name an order. We opened it, so it opens with our words: which leg lost the unit, that the goods were in our hands, and that nothing is on hold while we look.',
    sayBn:
      'একটা ticket-এ ক্লিক করুন। এটা একটা গণনা নিয়ে, তাই এটা একটা goods receipt-এর নাম বলে, যেখানে বাকিগুলো একটা অর্ডারের নাম বলে। এটা আমরা খুলেছি, তাই এটা শুরু হয় আমাদের নিজেদের কথা দিয়ে: কোন পথে ইউনিটটা হারিয়েছে, মালটা আমাদের হাতেই ছিল, আর আমরা দেখার সময়টাতে কিছুই আটকে রাখা হচ্ছে না।',
  },
  {
    id: 'tix-reply',
    say: 'Reply to the client is not an internal note. The client reads it on their own ticket, so write to them. It is the only free part of this page. Sending lands it in their conversation exactly as typed, and the ticket becomes a thread. Type here; the pointer stays on the button.',
    sayBn:
      'Reply to the client কোনো ভিতরের নোট নয়। client এটা তার নিজের ticket-এ পড়ে, তাই তাকে উদ্দেশ্য করেই লিখুন। এই পাতার এটাই একমাত্র খোলা জায়গা। পাঠালে এটা যেমন লিখেছেন ঠিক তেমনই তার কথাবার্তার ঘরে গিয়ে বসে, আর ticket-টা একটা thread হয়ে যায়। এখানে লিখুন; পয়েন্টারটা বোতামেই পড়ে থাকছে।',
  },
  {
    id: 'tix-stage',
    say: 'Moving it on is two questions. First, the stage. Only if you are closing does it ask the second, because that is where the money is. There are four outcomes: goods went back, the client accepted the loss, not upheld, and refunded the client. The first three record a decision and move nothing.',
    sayBn:
      'এটাকে এগিয়ে নেওয়া মানে দুটো প্রশ্ন। প্রথমে stage। দ্বিতীয় প্রশ্নটা শুধু তখনই করা হয় যখন আপনি এটা বন্ধ করছেন, কারণ টাকার ব্যাপারটা ওখানেই। চারটা ফলাফল আছে: মাল ফেরত গেছে, client ক্ষতিটা মেনে নিয়েছে, দাবি টেকেনি, আর client-কে টাকা ফেরত দেওয়া হয়েছে। প্রথম তিনটা শুধু একটা সিদ্ধান্ত লিখে রাখে, কিছুই নড়ায় না।',
  },
  {
    id: 'tix-refund',
    say: 'Refunded the client opens an amount field with no suggestion in it, on purpose, since what a lost unit was worth is a judgement. Type it and press Apply, which asks Refund the client? first. The refund is credited in the same transaction as the close, so neither can happen without the other. It is dangerous and cannot be undone. The confirmation is closed here.',
    sayBn:
      'Refunded the client চাপলে টাকার ঘরটা খোলে, আর ওখানে কোনো পরামর্শ দেওয়া থাকে না — ইচ্ছে করেই, কারণ হারিয়ে যাওয়া একটা ইউনিটের দাম কত ছিল সেটা একটা বিচারের ব্যাপার। লিখে Apply চাপুন, আর তাতে আগে জিজ্ঞেস করা হয় Refund the client?। টাকা ফেরত আর ticket বন্ধ করা — দুটোই একই transaction-এ হয়, তাই একটা ছাড়া আরেকটা ঘটতেই পারে না। এটা বিপজ্জনক, আর এটা আর ফেরানো যায় না। এখানে confirmation-টা বন্ধ করে দেওয়া হচ্ছে।',
  },
  {
    id: 'tix-dispute',
    say: 'A dispute between a store and a client is a different animal. A member store sells a client’s goods under its own name, and when they disagree we only referee. The settle panel asks who pays whom, and the money moves between the store’s wallet and the client’s, never out of ours. Refunding the client is not offered: the server refuses it by name, because paying out of our pocket is not settling an argument.',
    sayBn:
      'একটা store আর একটা client-এর মধ্যের dispute পুরো আলাদা জিনিস। একটা member store একটা client-এর মাল নিজের নামে বিক্রি করে, আর ওদের মধ্যে মতের অমিল হলে আমরা শুধু মধ্যস্থতা করি। settle panel জিজ্ঞেস করে কে কাকে টাকা দেবে, আর টাকাটা store-এর ওয়ালেট আর client-এর ওয়ালেটের মধ্যেই যাওয়া-আসা করে, আমাদের পকেট থেকে কখনোই বেরোয় না। client-কে টাকা ফেরত দেওয়ার সুযোগ এখানে দেওয়াই হয় না: server নাম ধরে এটা বাতিল করে দেয়, কারণ নিজের পকেট থেকে টাকা দেওয়া কোনো তর্কের নিষ্পত্তি নয়।',
  },
  {
    id: 'col-link',
    say: 'Fourth, collapsing a warehouse’s shelving: the one act in the warehouse that destroys something. Everything else moves goods; this throws away the record of where they are. It is not in the sidebar. It is a sentence at the bottom of Bins, a link, so nothing lands on it while someone is re-shelving. It takes a super admin.',
    sayBn:
      'চতুর্থ, একটা গুদামের তাকের বিন্যাস collapse করা: গুদামের ভিতরে এই একটাই কাজ যেটা কিছু একটা ধ্বংস করে ফেলে। বাকি সব কাজ মাল সরায়; এটা মাল কোথায় আছে সেই নথিটাই ছুঁড়ে ফেলে দেয়। এটা sidebar-এ নেই। এটা Bins পাতার একেবারে নিচে একটা বাক্য, একটা link — যাতে কেউ তাক সাজানোর কাজ করার ফাঁকে ভুল করে এটার উপর গিয়ে না পড়ে। এটা করতে একজন super admin লাগে।',
  },
  {
    id: 'col-page',
    say: 'Click Collapse its bins into FLOOR. Every shelf merges into the floor. A backup is taken first, and this is the part worth reading twice: the goods keep selling while it is put back, so a restore is a head start and not a rewind.',
    sayBn:
      'Collapse its bins into FLOOR-এ ক্লিক করুন। প্রতিটা তাক FLOOR-এর মধ্যে মিশে যায়। আগে একটা backup নেওয়া হয়, আর এই অংশটা দুবার পড়ার মতো: বিন্যাসটা আবার সাজানোর সময়টাতেও মাল বিক্রি হতেই থাকে, তাই restore মানে একটা এগিয়ে থাকা শুরু — পিছনে ফিরে যাওয়া নয়।',
  },
  {
    id: 'col-choose',
    say: 'Nothing else is on the page until you choose a warehouse, deliberately. Every figure below is about one building, and a collapse aimed at the wrong one cannot be taken back.',
    sayBn:
      'আপনি একটা গুদাম বেছে না নেওয়া পর্যন্ত এই পাতায় আর কিছুই আসে না — এটা ইচ্ছে করেই এমন। নিচের প্রতিটা সংখ্যা একটাই ভবন নিয়ে, আর ভুল গুদামের দিকে তাক করা একটা collapse আর ফিরিয়ে নেওয়া যায় না।',
  },
  {
    id: 'col-backups',
    say: 'Backups. One is taken automatically before every collapse and before anything moves, so a crash between the two leaves a complete copy and an untouched warehouse. Each says when its own copy is swept.',
    sayBn:
      'Backups। প্রতিটা collapse-এর আগে, আর কিছু নড়ার আগেই, একটা backup নিজে নিজেই নেওয়া হয় — তাই এর মাঝখানে কিছু ভেঙে পড়লেও একটা পুরো copy আর একটা অস্পৃষ্ট গুদাম পড়ে থাকে। প্রতিটা backup নিজেই বলে দেয় তার নিজের copy কখন মুছে ফেলা হবে।',
  },
  {
    id: 'col-restore',
    say: 'Put the layout back is best effort, line by line. Anything that has sold, moved or been picked since the collapse stays where it is and is listed as skipped. The dialog says so instead of promising a rewind.',
    sayBn:
      'Put the layout back কাজটা সারির পর সারি ধরে যতটা সম্ভব চেষ্টা করে, তার বেশি কিছু নয়। collapse-এর পর যা বিক্রি হয়ে গেছে, সরে গেছে বা pick হয়ে গেছে, সেটা যেখানে আছে সেখানেই থাকে আর skipped হিসেবে তালিকায় ওঠে। dialog পিছনে ফিরিয়ে দেওয়ার কোনো কথা না দিয়ে সোজা এটাই বলে দেয়।',
  },
  {
    id: 'col-danger',
    say: 'Then the collapse itself. Where each thing was becomes only the backup. Bins a picker can never reach are left alone, since held, damaged and quarantine are about not selling, not finding. Goods in transit between two warehouses are not in this building at all, and sweeping them onto the floor would make them sellable before they landed.',
    sayBn:
      'তারপর collapse-টা নিজেই। কোন জিনিস কোথায় ছিল, সেটা এরপর শুধু backup-এর ভিতরেই থাকে। যে bin-এ একজন picker কখনোই পৌঁছাতে পারে না, সেগুলোয় হাত দেওয়া হয় না — কারণ held, damaged আর quarantine ব্যাপারটা বিক্রি না করা নিয়ে, খুঁজে পাওয়া নিয়ে নয়। দুটো গুদামের মাঝখানে পথে থাকা মাল এই ভবনেই নেই, আর ওগুলোকে FLOOR-এ ঝেঁটিয়ে আনলে ওগুলো পৌঁছানোর আগেই বিক্রিযোগ্য হয়ে যেত।',
  },
  {
    id: 'col-open',
    say: 'Click Collapse this warehouse…. Two steps, and the first moves nothing. It opens on what is about to stop being recorded, in the plainest words on the page: pickers will search the floor until the shelving is laid out again.',
    sayBn:
      'Collapse this warehouse…-এ ক্লিক করুন। দুটো ধাপ, আর প্রথমটা কিছুই নড়ায় না। এটা শুরু হয় কোন জিনিসটার হিসাব আর রাখা হবে না সেটা দিয়ে, আর পাতার সবচেয়ে সোজা কথায়: তাকের বিন্যাস আবার সাজানো না হওয়া পর্যন্ত picker-রা পুরো FLOOR খুঁজে বেড়াবে।',
  },
  {
    id: 'col-reason',
    say: 'Type the reason, thirty characters at least. The counter only tells you where you are; the server enforces it. This sentence is stored on the backup and the audit trail, and it is all anyone gets later.',
    sayBn:
      'reason লিখুন, অন্তত ত্রিশটা অক্ষর। counter শুধু বলে আপনি কোথায় আছেন; নিয়মটা server-ই মানায়। এই বাক্যটা backup আর audit trail — দুই জায়গাতেই জমা থাকে, আর পরে কেউ এটুকুই পায়, আর কিছুই না।',
  },
  {
    id: 'col-ack',
    say: 'Then tick the acknowledgement, saying out loud what it costs: that you understand a restore recovers only the stock that has not moved or sold in between.',
    sayBn:
      'তারপর acknowledgement-এ টিক দিন, যেটা মুখ ফুটে বলে দেয় এর দাম কী: আপনি বুঝেছেন যে restore শুধু সেই স্টকটাই ফিরিয়ে আনে, যেটা এর মাঝখানে সরেনি বা বিক্রি হয়ে যায়নি।',
  },
  {
    id: 'col-preview',
    say: 'Show me what this would move counts what would merge, and moves nothing, because two bins holding seven units and forty bins holding nine hundred are different decisions. It is not pressed here: it asks for a code.',
    sayBn:
      'Show me what this would move কী কী মিশে যাবে সেটা গুনে দেখায়, আর কিছুই নড়ায় না — কারণ সাতটা ইউনিট ধরে রাখা দুটো bin আর নয়শো ইউনিট ধরে রাখা চল্লিশটা bin, এই দুটো আলাদা সিদ্ধান্ত। এখানে এটা চাপা হচ্ছে না: এটাও একটা code চায়।',
  },
  {
    id: 'col-code',
    say: 'After the preview, a six-digit code is emailed to the person who asked, not shown on screen, and you type this warehouse’s own code out too. Someone who got here by accident has neither. Then Collapse N bin(s) is the press that cannot be taken back. This video stops at the dialog, and the stopping is the lesson.',
    sayBn:
      'preview-এর পরে, যিনি চেয়েছেন তার কাছে email-এ একটা ছয় অঙ্কের code যায় — পর্দায় এটা দেখানো হয় না — আর এই গুদামের নিজের code-টাও আপনাকে লিখে দিতে হয়। ভুল করে যে এখানে এসে পড়েছে, তার কাছে এর একটাও নেই। তারপর Collapse N bin(s) সেই চাপটা, যেটা আর ফিরিয়ে নেওয়া যায় না। এই ভিডিওটা dialog-এর কাছে এসেই থেমে যাচ্ছে, আর এই থেমে যাওয়াটাই শিক্ষা।',
  },
  {
    id: 'outro',
    say: 'Fifth, what we cannot undo, as a list. God mode forces a state the rules forbid and sets a flag that never clears. Completing a goods receipt writes stock with no cancel; a miscount is a second entry. Forcing a call outcome is a real attempt under your name. Packing without a scan is logged high severity. Freeing a pickup day may book a second van. Receiving a return starts an inspection that moves stock. Collapsing bins needs a code. Accepting a top-up credits money. Approving a bank change redirects it. And closing a month freezes it for good. None is forbidden. Each asks for a reason and records who you are, and if you cannot write the reason down, that is the sign to ask somebody before you press it.',
    sayBn:
      'পঞ্চম, যা যা আমরা আর ফেরাতে পারি না — তালিকা করে। god mode নিয়ম যে অবস্থাটা নিষেধ করে সেটাই জোর করে বসায়, আর এমন একটা flag বসিয়ে দেয় যেটা কখনো ওঠে না। একটা goods receipt শেষ করলে স্টক লেখা হয়ে যায়, বাতিল করার উপায় নেই; ভুল গণনার উত্তর হলো দ্বিতীয় একটা এন্ট্রি। জোর করে একটা call-এর outcome বসানো মানে আপনার নামে একটা সত্যিকারের চেষ্টা লেখা হয়ে গেল। scan ছাড়া প্যাক করলে সেটা high severity হিসেবে log হয়। একটা pickup-এর দিন ছেড়ে দিলে দ্বিতীয় একটা ভ্যান বুক হয়ে যেতে পারে। একটা ফেরত receive করলে একটা inspection শুরু হয়ে যায়, যেটা স্টক নড়ায়। bin collapse করতে একটা code লাগে। একটা top-up মেনে নেওয়া মানে টাকা জমা হয়ে গেল। ব্যাংক বদলের অনুমোদন দেওয়া মানে টাকাটা অন্য জায়গায় চলে গেল। আর একটা মাস বন্ধ করে দিলে সেটা চিরকালের জন্য জমে যায়। এর একটাও নিষেধ নয়। প্রতিটাই একটা reason চায় আর আপনি কে সেটা লিখে রাখে — আর যদি reason-টা লিখে ফেলতে না পারেন, তাহলে সেটাই ইঙ্গিত যে চাপার আগে কাউকে একবার জিজ্ঞেস করে নিন।',
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
      /*
        DWELL ON THE TRIGGER, NOT THE TOOLTIP.

        The tooltip card is portalled to `document.body`, so it is not
        inside the trigger's root — moving the pointer onto the card
        fires `pointerLeave` on that root and unmounts it
        (`tooltip-card/index.tsx:183-185`). `show()` reads the box
        before it moves, so nothing throws: the scene simply filmed
        three and a half seconds of an empty halo where the explanation
        used to be. Holding on the button keeps the card open and in
        frame, which is what the narration is describing.
      */
      const info = row.locator('button.sss-info').first();
      await ctx.stage.clickIt(info, { after: 1000 });
      await ctx.page
        .locator('[role="tooltip"]')
        .first()
        .waitFor({ state: 'visible', timeout: WAIT });
      await show(ctx, info, 3600);
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
      /*
        THE ROLE KEY HAS TO BE TYPED, not just pointed at.

        "A staff role" brings one required field with it, and
        `audienceComplete` (`broadcasts-view.tsx:179`) stays false while
        it is empty — which leaves "How many is that?" really DISABLED
        (`:296`). Two scenes later that press is what sets `previewed`,
        and "Send to …" only exists inside `{previewed !== null}`, so an
        unfilled box here silently killed both of them.

        The narration already says "Choose A staff role and enter its
        key", so typing it is the step the words describe.
      */
      const roleKey = page.getByLabel(/^Role key/).first();
      await stage.typeIn(roleKey, 'warehouse_supervisor');
      await stage.dwellOn(roleKey, 3200);
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
    run: async (ctx) => {
      const count = ctx.page.getByRole('button', { name: /How many is that\?|Counting/ });
      await show(ctx, count, 3800);
      /*
        PRESSED, for the same reason the wallet-transfer preview is:
        "Send to …" is gated on `previewed !== null`
        (`broadcasts-view.tsx:317`) and only this button sets it. It
        asks how many people match; it sends nothing.
      */
      await ctx.stage.clickIt(count, { after: 900 });
    },
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
          // "Receipt short" is what the list actually prints for a
          // RECEIPT_SHORTFALL ticket (`packages/ui/src/status/index.ts`).
          // The old filter said "Goods receipt", which appears nowhere
          // on this page, so the scene could never find its row.
          .filter({ hasText: 'Receipt short' })
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
      /*
        BY NAME, because index 1 is the WRONG BUILDING.

        The options are the warehouses ordered by CODE ascending, after
        a "Choose a warehouse" placeholder at index 0. The codes here are
        `BD-DHK-1`, `CCU-01`, `DEL-01` — so index 1 is the Dhaka INTAKE
        warehouse, which has no bins and no layout backup. The two scenes
        after this one read the backups table and press "Put the layout
        back", and both found an empty table: the data was there all
        along, on Kolkata.

        Selected by its visible label (`{name} · {code}`, see
        `bin-collapse-index.tsx:115`) rather than by index 2, because an
        index is only right until somebody adds a warehouse whose code
        sorts earlier — which is exactly how this broke.
      */
      await ctx.page
        .locator('#collapse-warehouse')
        .selectOption({ label: 'Kolkata Main · CCU-01' });
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
