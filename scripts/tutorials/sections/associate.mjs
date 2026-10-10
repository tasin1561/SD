/**
 * SECTION S — THE ASSOCIATE PORTAL, in seven short tutorials.
 *
 * ── WHO IS WATCHING ─────────────────────────────────────────────────
 * A SALES PERSON who sells for a reseller store: `apps/associate` at
 * `portal.skydrop.global`. Section R addresses the shopkeeper; this
 * section addresses the shopkeeper's salesperson — often on a phone,
 * often mid-call with a customer. They own nothing, hold no stock, have
 * no wallet, and settle up with their store outside Skydrop.
 *
 * So the register is PITCHED LOWER than the seller and reseller
 * sections. Short sentences, no jargon, and the word "SKU" is not in
 * this script at all — a sales person reads a product name down a
 * phone, not a code. Nothing explains a margin, a fee split, a wallet
 * or a terms version, because this person cannot see any of it and a
 * video that explains what is not on the screen teaches somebody to go
 * looking for a thing that is not there.
 *
 * ── THE THREE STRUCTURAL FACTS, TAUGHT WHERE EACH ONE BITES ─────────
 * ASSOC-1 builds three things as permissions and projections rather
 * than as filters, so none of them is going to change — and somebody
 * who discovers one by poking around concludes something is being
 * hidden from them. Each is said plainly, at the screen where it is
 * actually felt, rather than collected into one abstract "privacy"
 * video nobody would watch:
 *
 *   1. YOUR PRICE IS FIXED and the store sets it — S2 (the catalogue,
 *      where it is read out loud) and S3 (the order form, where the
 *      absence of a price field is the lesson).
 *   2. YOU SEE ONLY YOUR OWN — S5 (orders) and S6 (customers), where
 *      the subtitle says so and the count beside a customer's name
 *      does NOT, which is the part worth a sentence.
 *   3. YOU NEVER SEE WHAT THE STORE PAYS OR EARNS — S1, because it is
 *      why there is no dashboard, no wallet and no report in the rail,
 *      and the rail is the first thing anybody reads.
 *
 * ── WHY THIS LIVES IN ITS OWN FILE ──────────────────────────────────
 * `narration.mjs` is 5,500 lines and `flows.mjs` is 16,600, and two
 * agents were filming at once when this was written — section R into
 * both of those files on one stack, section S on another. The `long/`
 * directory already exists for exactly this reason and states it in as
 * many words: "four people writing a video each into them is four
 * people editing the same two files". So section S is registered the
 * same way, by ONE import and ONE line at the bottom of each shared
 * file, and the seven videos live here.
 *
 * It exports the SHAPE the runner wants (`VIDEOS` as narration entries,
 * `FLOWS` keyed by slug) rather than `long/`'s array-of-steps, because
 * these are ordinary short videos and nothing about them needs the
 * adapter that exists for a twelve-minute script.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────
 * PRESSING the two things an associate may do to a live order — asking
 * the courier for another delivery attempt, and cancelling — is the
 * long `associate-everything` video's. S5 opens a DELIVERED order on
 * purpose (every panel on that page that offers an action is
 * conditional on the order not being terminal, so a live one would put
 * things to press inside a video whose promise is that it presses
 * nothing), and then ends on a FAILED one read-only: the button is
 * shown and the line beside it is read, because "whether a van is
 * coming or your store has to answer first" is the one sentence an
 * associate must not get wrong to a customer. Nothing is clicked.
 *
 * The password reset and the invitation-acceptance page are also out:
 * both are signed-OUT screens an associate meets once, and the long
 * video films the invitation.
 */
import path from 'node:path';
import { GENERATED_DIR } from '../lib/paths.mjs';

/** The sheet S4 uploads — written per run by `seed-demo-data.mjs`. */
const BULK_CSV = path.join(GENERATED_DIR, 'associate-bulk-orders.csv');

/**
 * The order S3 places on camera.
 *
 * A CUSTOMER OF ITS OWN, not one of the seeded five. `assertNotDuplicate`
 * refuses a second open order for the same phone carrying the same
 * products (`DUPLICATE_ORDER_SUSPECTED`), and a `--check` pass places a
 * real order — so re-using a seeded customer would film the refusal
 * dialog under a line about placing an order. The seed removes this one
 * between takes (no reference, PENDING_CONFIRMATION, so
 * `clearPreviousOrders` sweeps it).
 *
 * No `retail` field, and that is the point of S3: an associate's price
 * is their `associate_prices` row and there is no box to type one in.
 */
const ORDER = {
  name: 'Pooja Deshpande',
  phone: '+919822078841',
  pin: '411007',
  line1: '12 Ganeshkhind Road, Shivajinagar',
  landmark: 'Opposite the university main gate',
};

/**
 * The issue S7 raises.
 *
 * The SUBJECT must not be the seeded ticket's: both are store-raised
 * issues opened by the same person on one of their own orders, so the
 * type and the actor say nothing, and `clearAssociateTakeArtefacts`
 * tells the take's apart from the world's by exactly this string.
 *
 * `onCustomer` is whose order it is raised against. The picker holds
 * the newest fifty and `{ index: 1 }` takes whatever is first, which
 * on this world is a CANCELLED leftover — a parcel that was never sent
 * is a strange thing to say a piece is missing from. Mahesh Patil's
 * newest is DELIVERED, which is the order this complaint belongs to.
 * The body names no quantity for the same reason: the line on that
 * order is one item, and a sentence about two would be a video
 * contradicting the screen behind it.
 */
const ISSUE = {
  onCustomer: 'Mahesh Patil',
  subject: 'Customer says one piece is missing from the box',
  /*
    SHORT, and the length is a timing decision rather than a style one.
    This is typed on camera at a human rate inside ONE scene, and the
    composer retimes a scene's picture to its clip — so a body that
    takes sixteen seconds to type under a nine-second line is played
    back at x0.59, which over a moving cursor reads as a fast-forward.
    Trimmed to about ninety characters it lands near x0.8, which is the
    ordinary factor on every other scene here.
  */
  body: 'She says the box was open at one corner when the driver handed it over.',
};

/* ────────────────────────────── narration ────────────────────────── */

export const VIDEOS = [
  {
    slug: 'assoc-find-your-way-around',
    title: 'Finding your way around',
    subtitle: 'Skydrop for sales people',
    steps: [
      {
        id: 'intro',
        say: 'This is your sales portal. You sell for a store, and Skydrop does the rest — it holds the stock in India, rings every customer, and delivers.',
      },
      {
        id: 'landing',
        say: 'It opens on your orders. There is no front page of figures in here, and that is deliberate — we come back to why at the end.',
      },
      {
        id: 'nav',
        say: 'Everything lives in this rail, and it is short on purpose. Three groups, eight links. That is the whole app.',
      },
      {
        id: 'selling',
        say: 'Selling is the day job: place one order, check what you are allowed to sell and for how much, or send a day’s worth up from a spreadsheet.',
      },
      {
        id: 'following',
        say: 'Following up is afterwards. The orders you placed, the people you sold to, and anything that needs somebody at Skydrop to go and look.',
      },
      {
        id: 'you',
        say: 'You is yours. Your inbox, and your own login. Both are about you rather than about the store, so everybody here can open them.',
      },
      {
        id: 'header',
        say: 'Your store’s name is on screen the whole time with your own email under it, so you always know whose shop you are placing orders for.',
      },
      {
        id: 'bell',
        say: 'The bell is that inbox. Skydrop puts things here rather than only emailing you, including a summary each morning of what happened to your parcels.',
      },
      {
        id: 'own-only',
        say: 'Now read the line under the heading. The orders you placed — not the rest of the store’s. Somebody else selling here has their own list, and you cannot see it.',
      },
      {
        id: 'absent',
        say: 'And what is not in that rail. No wallet, no money page, no report, no terms, and no price anywhere that you can change.',
      },
      {
        id: 'why',
        say: 'Because what the store pays for a product, and what it makes on one, is its arrangement with its supplier. Nothing is being kept back from you; it is simply not yours.',
      },
      {
        id: 'outro',
        say: 'So: five things to do, in a rail that fits on a phone. Next, the screen you will read out loud more than any other.',
      },
    ],
  },

  {
    slug: 'assoc-what-you-may-sell',
    title: 'What you may sell, and for how much',
    subtitle: 'Skydrop for sales people',
    steps: [
      {
        id: 'intro',
        say: 'This is the screen you will read out loud most. A customer asks what something costs and whether you have it; both answers are here.',
      },
      {
        id: 'subtitle',
        say: 'The line underneath says who decides. The products are your store’s to hand you, and the prices are your store’s to set — for you.',
      },
      {
        id: 'columns',
        say: 'Three columns, and that is all of it. The product, what you sell it for, and how many are left.',
      },
      {
        id: 'price',
        say: 'What you sell it for is a figure somebody at your store typed against your name. There is no box here, and nothing is added to anything as a percentage.',
      },
      {
        id: 'fixed',
        say: 'It is fixed. You cannot raise it at the desk, and the order form will not let you either — it sends back exactly this number.',
      },
      {
        id: 'available',
        say: 'Available is how many you may sell. It is not how many are in the warehouse: your store can hold a share back, or set stock aside for somebody else.',
      },
      {
        id: 'none-left',
        say: 'And if one ever reads None left instead of a figure, that is the end of the sale. It is words rather than a zero, because a zero reads like any other number.',
      },
      {
        id: 'unpriced',
        say: 'Some of these have no price set for you yet. They are named, with what to do about it: ask whoever runs your store to set one.',
      },
      {
        id: 'flag',
        say: 'The row says so too, and that matters — this is the screen somebody checks one price on, and a count at the top is not where they are looking.',
      },
      {
        id: 'refused',
        say: 'Until somebody sets it, that product cannot go on an order at all. It is missing from the order form rather than priced at a figure nobody chose.',
      },
      {
        id: 'absent',
        say: 'And what has no column: what your store pays for any of this, what it earns, how much stock there really is, and what anybody else sells it for.',
      },
      {
        id: 'search',
        say: 'The search is for mid-call. Type a word of the product name and the list narrows while the customer is still on the phone.',
      },
      {
        id: 'outro',
        say: 'So: your store decides the list and the price, Available is the figure to trust, and anything marked No price needs a word with them first.',
      },
    ],
  },

  {
    slug: 'assoc-place-an-order',
    title: 'Placing an order for a customer',
    subtitle: 'Skydrop for sales people',
    steps: [
      {
        id: 'intro',
        say: 'Somebody has bought something from you. This is how that becomes a parcel — you type it here, and a warehouse in India picks, packs and ships it.',
      },
      {
        id: 'open',
        say: 'New order is the first link in the rail. The form asks three things, in the order a phone call goes.',
      },
      {
        id: 'product',
        say: 'What they are buying, first. The list is yours — only products your store has priced for you, and anything with none left cannot be chosen at all.',
      },
      {
        id: 'quantity',
        say: 'Then how many. One line is one product, so add a second line if they are taking something else; it goes in the same parcel.',
      },
      {
        id: 'line-note',
        say: 'Under the line are the two facts you would read down a phone: what each one costs them, and how many are left.',
      },
      {
        id: 'no-price-field',
        say: 'Notice there is nowhere to type a price. Yours is already set, and the form sends that figure back unchanged — there is nothing to agree at the desk.',
      },
      {
        id: 'unpriced',
        say: 'If something you expected is missing from that list, this note names it and says why: nobody has set your price for it yet.',
      },
      {
        id: 'customer',
        say: 'Then where it is going. The name, the phone with its country code, and the PIN code — the courier works the city out from the PIN itself.',
      },
      {
        id: 'phone',
        say: 'The phone matters more than the rest. Skydrop’s call centre rings that number to confirm the order, so one wrong digit stops the parcel before it is packed.',
      },
      {
        id: 'landmark',
        say: 'The landmark is required, and it is the line that finds the door. Beside the bus depot gate gets delivered; a correct address with nothing to aim at often does not.',
      },
      {
        id: 'payment',
        say: 'Last, how it is paid for. Cash on delivery is the usual one — the courier collects at the door, and what it will collect is spelled out right here.',
      },
      {
        id: 'prepaid',
        say: 'Prepaid is for a customer who has already paid you. Nothing is collected; your store’s wallet covers the order when the call centre confirms it.',
      },
      {
        id: 'confirm',
        say: 'Place it, and you are asked once more with the name, the number and the amount set out. Read that box rather than clicking through it.',
      },
      {
        id: 'placed',
        say: 'Done. The order has its own number now, and that is what to quote if you ever ring Skydrop about it.',
      },
      {
        id: 'outro',
        say: 'Nothing more is needed from you. An agent rings your customer, and only once they say yes is stock held and a courier booked.',
      },
    ],
  },

  {
    slug: 'assoc-upload-bulk-orders',
    title: 'A day’s orders from a spreadsheet',
    subtitle: 'Skydrop for sales people',
    steps: [
      {
        id: 'intro',
        say: 'Twenty orders is twenty forms, and nobody has the afternoon. This is the same orders out of a spreadsheet, in one go.',
      },
      {
        id: 'template',
        say: 'Start by downloading the template. The columns have to be the ones Skydrop reads, and starting from our file saves you a refused upload.',
      },
      {
        id: 'no-price',
        say: 'Read what it does not ask for: there is no price column. Every line is sold at the price your store set for you, whatever a spreadsheet might say.',
      },
      {
        id: 'rows',
        say: 'One row is one product line. Give two rows the same reference and they become one order with two things in it — one parcel, one delivery.',
      },
      {
        id: 'file',
        say: 'Choose the file, then upload and check. Checking and importing are two presses on purpose: a spreadsheet is the easiest place here to make fifty mistakes at once.',
      },
      {
        id: 'preview',
        say: 'The check reads the whole file and reports back: how many rows, how many orders those make, and any row it will not take.',
      },
      {
        id: 'bad-row',
        say: 'Here is the one it will not, by row number and with the reason. That row has no landmark, and the landmark is the field a driver needs.',
      },
      {
        id: 'rest',
        say: 'The rest are fine and will go in. A bad row is refused on its own; it does not hold up the other five.',
      },
      {
        id: 'import',
        say: 'Now import, and it confirms the count first. Each good row becomes one of your orders and goes to the call centre exactly as a typed one does.',
      },
      {
        id: 'progress',
        say: 'It runs in the background, so you can watch it or walk away. The orders appear on your own list as they are made.',
      },
      {
        id: 'uploads',
        say: 'Every upload stays here with how many orders it made and how many rows failed. A failed one gives you a report to download, with the reason against each row.',
      },
      {
        id: 'reference',
        say: 'One rule worth remembering. A reference you have already used comes back as an error, not as a change — re-uploading never quietly rewrites an order you have placed.',
      },
      {
        id: 'outro',
        say: 'So: start from the template, remember a shared reference means one order, and read the check before you press import.',
      },
    ],
  },

  {
    slug: 'assoc-find-an-order',
    title: 'Finding and reading an order',
    subtitle: 'Skydrop for sales people',
    steps: [
      {
        id: 'intro',
        say: 'A customer rings asking where their parcel is. They will not have an order number. This is how you find it from whatever they do give you.',
      },
      {
        id: 'list',
        say: 'My orders is everything you placed, newest first — the order, the customer, where it has got to, what is being collected, and when you placed it.',
      },
      {
        id: 'own-only',
        say: 'Only what you placed. Somebody else selling for this store has a list of their own, and neither of you sees the other’s.',
      },
      {
        id: 'search',
        say: 'The search takes whatever they hand you: the order number, your own reference, their name, part of their phone number, or the waybill off the parcel.',
      },
      {
        id: 'status',
        say: 'Or narrow it by where things have got to. Pending confirmation is waiting on the call centre; delivery failed is the one to look at first in the morning.',
      },
      {
        id: 'reload',
        say: 'And the filter survives a reload, because it is kept in the page’s own web address rather than inside the page. Which also makes the view a link you can send somebody.',
      },
      {
        id: 'open',
        say: 'Open one and the whole story is on a page. This one is delivered, so there is nothing left to press on it — only to read.',
      },
      {
        id: 'inside',
        say: 'What was in the parcel, line by line, at the price you sold each for, and underneath it the total your customer was charged.',
      },
      {
        id: 'where',
        say: 'Where it went, exactly as it was when the order was placed, and how it was paid for. This block does not quietly rewrite itself behind you.',
      },
      {
        id: 'parcel',
        say: 'The parcel: which courier carried it, and the waybill. That is the number your customer can track themselves, and the one to quote if you have to chase it.',
      },
      {
        id: 'history',
        say: 'Then every step in order — ours, like the call that confirmed it and the box being packed, and the courier’s own scans as they arrived rather than our guesses.',
      },
      {
        id: 'closed',
        say: 'This panel is on every order and it is closed on this one. Another delivery attempt can only be asked for while a parcel is out for delivery, or has just failed.',
      },
      {
        id: 'failed',
        say: 'So here is one that failed. Same page, same panel — and now there is something to press, because this is the moment asking would actually help.',
      },
      {
        id: 'who',
        say: 'Read the line beside that button before you promise anybody anything. It says whether the courier is asked straight away, or whether your store has to answer first.',
      },
      {
        id: 'outro',
        say: 'So: search from whatever they have, the filter survives a reload, and the history at the bottom is where the parcel really got to rather than where it should be.',
      },
    ],
  },

  {
    slug: 'assoc-my-customers',
    title: 'Your customers',
    subtitle: 'Skydrop for sales people',
    steps: [
      {
        id: 'intro',
        say: 'Everyone you have sold to, in one list. It is the other way into an order — from the person, rather than from the parcel.',
      },
      {
        id: 'list',
        say: 'The name, the number, how many orders that customer has given the shop, and when the last one was. Newest at the top.',
      },
      {
        id: 'own-only',
        say: 'The people you placed an order for. Not the shop’s whole book — the same rule as your orders list, and for the same reason.',
      },
      {
        id: 'count',
        say: 'But read the Orders column carefully. Who appears in this list is decided by what you sold; the figure beside a name is every order that number has given the shop.',
      },
      {
        id: 'why',
        say: 'Because a customer is one record between all of you. Two people selling to the same phone number are selling to the same person, not to two of them.',
      },
      {
        id: 'repeat',
        say: 'Which makes a name with two or three beside it the row worth noticing. Somebody who has bought before is the easiest sale you will make today.',
      },
      {
        id: 'open',
        say: 'The name is a link, and it does the thing you actually want from a name: it opens your orders, already narrowed to that person’s number.',
      },
      {
        id: 'no-detail',
        say: 'There is no customer page behind it, deliberately. What a sales person wants from a name is what they have bought, and that is one screen rather than two.',
      },
      {
        id: 'search',
        say: 'The search commits when you press Enter, and part of a number is enough — which is usually all somebody reads out over a bad line.',
      },
      {
        id: 'read-only',
        say: 'Nothing on this page can be edited. Correcting somebody’s name or number is your store’s to do, so a wrong one is a message to them rather than a field here.',
      },
      {
        id: 'outro',
        say: 'So: who is listed is what you sold, the count beside them is the shop’s, and the name is the fastest way to everything you have sent them.',
      },
    ],
  },

  {
    slug: 'assoc-issues-and-account',
    title: 'Raising an issue, your inbox and your login',
    subtitle: 'Skydrop for sales people',
    steps: [
      {
        id: 'intro',
        say: 'Three screens that are about you rather than about one order: raising something with Skydrop, your inbox, and your own login.',
      },
      {
        id: 'list',
        say: 'Issues is anything that needs a person to go and look. Everything you have raised is here, with which order it was about and where it has got to.',
      },
      {
        id: 'stages',
        say: 'Open is waiting on somebody, being looked at means they have it in hand, and closed means it is settled — with the answer still readable afterwards.',
      },
      {
        id: 'thread',
        say: 'Open one and it is a conversation rather than a log: your side, and Skydrop’s, in the order the two of you said them.',
      },
      {
        id: 'raise',
        say: 'Raise one from the order itself, or from here and pick the order. It always hangs off one, so whoever reads it knows which parcel is being talked about.',
      },
      {
        id: 'subject',
        say: 'One line for what it is about, so it can be found again later, and then what happened in as much detail as the customer gave you.',
      },
      {
        id: 'no-money',
        say: 'And notice there is no amount anywhere on this form. Money between your store and its supplier is settled between them; your job is to report what went wrong.',
      },
      {
        id: 'sent',
        say: 'Raise it, and the thread opens. Skydrop and your store both read it, and both reply on this same one.',
      },
      {
        id: 'inbox',
        say: 'Your inbox is what the bell counts. Things land here rather than only in an email, and clearing one only hides it from your list.',
      },
      {
        id: 'digest',
        say: 'Including this, waiting every morning: what was delivered yesterday, what came back, and what could not be delivered. Only your parcels.',
      },
      {
        id: 'digest-body',
        say: 'Open it and the order numbers are inside, so it is a worklist rather than a headline. The ones that did not arrive are the calls to make first.',
      },
      {
        id: 'account',
        say: 'My account is your own login — your name, your email, the store you sell for, and the role you hold in it.',
      },
      {
        id: 'what-you-see',
        say: 'And one line worth reading once: what you see. The orders and customers you placed. It is written down rather than left for you to work out.',
      },
      {
        id: 'sessions',
        say: 'If you have ever signed in somewhere you should not have, sign out everywhere ends every session of yours — including the one you are using.',
      },
      {
        id: 'outro',
        say: 'So: issues for anything needing a person, the bell for what Skydrop tells you, and your account for your own login and what it reaches.',
      },
    ],
  },
];

/* ──────────────────────────────── flows ──────────────────────────── */

/**
 * The helpers are LOCAL COPIES, exactly as `long/associate.mjs`'s are
 * and for the same reason: `flows.mjs` has `signIn`, `withRetry` and
 * `signInAndOpen` and exports none of them — and it IMPORTS this module
 * to register the flows, so reaching back into it would close a cycle.
 */

/**
 * Wait for the page's own data, pressing its Retry and reloading when
 * the first fetch loses the race for an access token.
 *
 * FE-1 keeps the access token in BROWSER MEMORY, so any full page load
 * throws it away and the client has to get another through the
 * `__Host-` cookie. Normally invisible; under video recording it is
 * not. Press Retry, and reload every other round — pressing Retry alone
 * re-fires the same token-less request.
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
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    await page.waitForTimeout(1500);
  }
  await probe.waitFor({ state: 'attached', timeout: 20_000 });
}

/**
 * Sign in and land where THIS app lands.
 *
 * `/orders`, never `/dashboard`: this portal has no dashboard (ASSOC-1
 * — every figure one would carry is the store's cost or the store's
 * earnings), so `flows.mjs`'s shared `signIn` would wait thirty seconds
 * and report a failed login. The refusal on the page is the only useful
 * thing to say when the URL never changes, because a throttled login
 * and a wrong password look identical from here.
 *
 * The sign-in form HARD-NAVIGATES on success, so the wait is on the URL
 * and then on the list's own data — the fresh load has no access token
 * yet (FE-1).
 */
async function signInAssoc({ page, stage, baseUrl, seller }) {
  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  // Hydration, before the click. The form is a client component and its
  // submit handler is what turns the press into an API call; press it a
  // beat too early and the browser does a NATIVE GET submit instead,
  // which lands back on `/login?` with no error anywhere and reads as a
  // refused password.
  await page.waitForLoadState('networkidle').catch(() => {});
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
    await page.waitForURL((u) => u.pathname === '/orders', { timeout: 25_000 });
  } catch (e) {
    const body =
      (await page
        .locator('body')
        .innerText()
        .catch(() => '')) ?? '';
    const line = body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => /\[[A-Z_]+\]|too many|invalid|incorrect/i.test(l));
    throw new Error(
      line === undefined
        ? `Sign-in never reached /orders: ${e.message}`
        : `Sign-in refused: ${line}\n(a store login is throttled 5 per 15 minutes per email+IP)`,
    );
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await withRetry(page, page.getByRole('heading', { name: 'My orders' }).first());
  await stage.clearHalo();
  await page.waitForTimeout(800);
}

/**
 * Reach a page THE WAY THE APP DOES — by clicking its nav link.
 *
 * Never `page.goto` once signed in: a full load drops the in-memory
 * access token (FE-1) and the first render races the refresh, which
 * under video recording is a race the page loses. Clicking keeps the
 * SPA alive, so there is nothing to lose, and it is what a person does.
 */
async function openFromNav({ page, stage }, href, probe) {
  await stage.clickIt(railLink(page, href), { after: 900 });
  await page.waitForURL((u) => u.pathname === href, { timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (probe !== undefined) await withRetry(page, probe);
}

/**
 * A nav link in the RAIL.
 *
 * `a[href="…"]` alone matches TWICE: the rail and the off-canvas drawer
 * render the same `NavList`, and the drawer's copy is in the DOM at
 * every width. `.first()` would be DOM order rather than a fact about
 * which one a person can see.
 */
function railLink(page, href) {
  return page.locator(`.sk-rail__nav a[href="${href}"]`).first();
}

/**
 * One collapsible group of the rail, through its own heading.
 *
 * The heading is a BUTTON (it folds the group), so haloing the button
 * alone outlines a word rather than the thing being shown — the group's
 * container is what carries the links. Scoped to the rail for the same
 * reason `railLink` is.
 */
function navGroup(page, heading) {
  return page
    .locator('.sk-rail__nav .sk-nav__group')
    .filter({ has: page.getByRole('button', { name: heading, exact: true }) })
    .first();
}

/** One `section.as-section`, found through its own heading text. */
function section(page, heading) {
  return page.locator('section.as-section').filter({ hasText: heading }).first();
}

/**
 * The price cell of the first row that HAS a price.
 *
 * Not a row index: the shelf is ordered by product name and the
 * unpriced ones are mixed through it, so which row carries a figure
 * moves whenever the store enables another product. `Money` renders
 * `.skydrop-tabular`; the availability column renders `.sk-figure`, so
 * the class is what tells the two numeric cells apart.
 */
function pricedCell(page) {
  return page
    .locator('tbody tr')
    .filter({ has: page.locator('td .skydrop-tabular') })
    .first()
    .locator('td')
    .nth(1);
}

/** One `.as-notice`, found through its words rather than its tone. */
function notice(page, words) {
  return page.locator('.as-notice').filter({ hasText: words }).first();
}

/**
 * One dialog BY ITS OWN TITLE.
 *
 * Every confirm in this app REUSES its page button's label, so a
 * `getByRole('button', { name })` on the page matches the dialog's
 * confirm too once it is open — and a flow with two dialogs stacked
 * cannot tell them apart by DOM order.
 */
function dialogTitled(page, title) {
  return page.getByRole('dialog').filter({ hasText: title }).first();
}

/**
 * Narrow the orders list to one status.
 *
 * The `<select>` carries `aria-label="Filter by status"` beside a
 * visible `label="Status"`, and an `aria-label` on the control IS the
 * accessible name — so the word on screen is not the handle. The regex
 * is matched against the WHOLE name, which is the only form that means
 * "this field and nothing else": `getByLabel('Status')` is a
 * case-insensitive substring and also matches the column header.
 */
async function filterByStatus({ page, stage }, status) {
  const filter = page.getByLabel(/^Filter by status\s*\*?$/).first();
  await stage.point(filter, { settle: 500 });
  await filter.selectOption(status);
  await page.waitForTimeout(1500);
  await stage.clearHalo();
}

/** Open the first row of the orders list. */
async function openFirstOrder({ page, stage }) {
  const row = page.locator('tbody tr').first().locator('a[href^="/orders/"]').first();
  await withRetry(page, row);
  await stage.clickIt(row, { after: 1200 });
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/i, { timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await withRetry(page, page.locator('.sk-ph__title').first());
}

export const FLOWS = {
  'assoc-find-your-way-around': {
    app: 'associate',

    async prologue(ctx) {
      await signInAssoc(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await page.waitForTimeout(900);
        // The brand block — "Skydrop" over "Sales", which is what names
        // this app rather than the page heading underneath it.
        await stage.dwellOn(page.locator('.sk-rail__brand').first(), 2600);
      },

      async landing({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { name: 'My orders' }).first(), 2600);
      },

      async nav({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-rail__nav').first(), 3200);
      },

      async selling({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Selling'), 3400);
      },

      async following({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Following up'), 3400);
      },

      async you({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'You'), 3000);
      },

      async header({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-rail__user .sk-identity__text').first(), 3000);
      },

      async bell({ page, stage }) {
        // `aria-label` is "Notifications, N unread" when anything is
        // unread, so the name is a PREFIX match. A `role: 'button'`
        // reach is what tells it from the nav LINK of the same name.
        const bell = page.getByRole('button', { name: /^Notifications/ }).first();
        await stage.clickIt(bell, { after: 1200 });
        const panel = page.getByRole('dialog', { name: 'Notifications' }).first();
        await panel.waitFor({ state: 'visible', timeout: 10_000 });
        await page.waitForTimeout(600);
        await stage.dwellOn(panel, 2600);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      },

      async 'own-only'({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3600);
      },

      async absent({ page, stage }) {
        // The whole rail again: the argument is about what has NO link,
        // so the shot is the complete set of eight.
        await stage.dwellOn(page.locator('.sk-rail__nav').first(), 3000);
      },

      async why({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-rail__nav').first(), 3800);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Selling'), 3000);
      },
    },
  },

  'assoc-what-you-may-sell': {
    app: 'associate',

    /*
      ARMED FOR THE PICTURES, not for an upload. A product thumbnail is
      a presigned READ, which under `DEV_MOCK_SPACES` is a `mock://`
      string the browser puts straight into an `<img src>` — and an
      unknown scheme renders as a BROKEN image, in the middle of a
      catalogue. The shim swaps those for the bytes as a `data:` URL and
      is a no-op for every other URL, so it costs the rest of the take
      nothing.
    */
    needsSpacesShim: true,

    async prologue(ctx) {
      await signInAssoc(ctx);
      await openFromNav(ctx, '/catalogue', ctx.page.locator('table tbody tr').first());
    },

    steps: {
      async intro({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { name: 'What I sell' }).first(), 2600);
      },

      async subtitle({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3000);
      },

      async columns({ page, stage }) {
        await stage.dwellOn(page.locator('thead tr').first(), 2600);
      },

      async price({ page, stage }) {
        await stage.dwellOn(
          page.getByRole('columnheader', { name: 'You sell it for' }).first(),
          1400,
        );
        await stage.dwellOn(pricedCell(page), 2400);
      },

      async fixed({ page, stage }) {
        await stage.dwellOn(pricedCell(page), 3000);
      },

      async available({ page, stage }) {
        await stage.dwellOn(page.getByRole('columnheader', { name: 'Available' }).first(), 1200);
        await stage.dwellOn(page.locator('tbody tr td .sk-figure').first(), 2600);
      },

      async 'none-left'({ page, stage }) {
        // Nothing is out of stock in the seeded world, so the line is
        // written CONDITIONALLY ("if one ever reads None left") and the
        // shot is the column those words would appear in. Narrating a
        // row that is not there teaches somebody to go looking for it;
        // emptying a product to produce one would take the shelf out
        // from under every other video that shares this world.
        const out = page.locator('span.as-flag[data-tone="bad"]').first();
        if ((await out.count()) > 0) await stage.dwellOn(out, 3000);
        else await stage.dwellOn(page.locator('tbody tr td .sk-figure').first(), 3000);
      },

      async unpriced({ page, stage }) {
        await stage.dwellOn(notice(page, 'Waiting for a price'), 3400);
      },

      async flag({ page, stage }) {
        const flagged = page.locator('span.as-flag[data-tone="warn"]').first();
        await flagged.scrollIntoViewIfNeeded();
        await stage.dwellOn(flagged, 3200);
      },

      async refused({ page, stage }) {
        await stage.dwellOn(page.locator('span.as-flag[data-tone="warn"]').first(), 3200);
      },

      async absent({ page, stage }) {
        await stage.dwellOn(page.locator('thead tr').first(), 3400);
      },

      async search({ page, stage }) {
        const box = page.getByLabel('Search what you sell').first();
        await stage.typeIn(box, 'kantha', { after: 1400 });
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.locator('.sk-sh__note').first(), 1600);
      },

      async outro({ page, stage }) {
        // The whole shelf back, BEFORE the closing line: it names what
        // is marked No price, and over a list narrowed to one row there
        // would be nothing on screen to point at.
        await page.getByLabel('Search what you sell').first().fill('');
        await page.waitForTimeout(900);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3200);
      },
    },
  },

  'assoc-place-an-order': {
    app: 'associate',

    /*
      ARMED FOR THE PICTURES, not for an upload. A product thumbnail is
      a presigned READ, which under `DEV_MOCK_SPACES` is a `mock://`
      string the browser puts straight into an `<img src>` — and an
      unknown scheme renders as a BROKEN image, in the middle of a
      catalogue. The shim swaps those for the bytes as a `data:` URL and
      is a no-op for every other URL, so it costs the rest of the take
      nothing.
    */
    needsSpacesShim: true,

    async prologue(ctx) {
      await signInAssoc(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { name: 'My orders' }).first(), 2400);
      },

      async open(ctx) {
        const { page, stage } = ctx;
        await openFromNav(ctx, '/orders/new', page.getByLabel(/^Product\s*\*?$/).first());
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2200);
      },

      async product({ page, stage }) {
        // A native `<select>`, so `selectOption` is the supported path,
        // and BY INDEX: the option text carries the live availability
        // ("… — 26 available"), which moves between takes. The picker
        // only ever holds the PRICED variants anyway, and an
        // out-of-stock one is `disabled` — the fact the line names.
        const picker = page.getByLabel(/^Product\s*\*?$/).first();
        await stage.point(picker, { settle: 600 });
        await picker.selectOption({ index: 1 });
        await page.waitForTimeout(1400);
        await stage.clearHalo();
      },

      async quantity({ page, stage }) {
        await stage.typeIn(page.getByLabel(/^Quantity\s*\*?$/).first(), '2', {
          clear: true,
          after: 900,
        });
        await stage.dwellOn(
          page.getByRole('button', { name: 'Add another product' }).first(),
          1800,
        );
      },

      async 'line-note'({ page, stage }) {
        await stage.dwellOn(page.locator('p.as-line__note').first(), 3200);
      },

      async 'no-price-field'({ page, stage }) {
        // The section HEADING carries the sentence — "Your store sets
        // these prices" — and the row underneath it has a quantity box
        // and no money box. Both halves, in that order.
        await stage.dwellOn(page.locator('.sk-sh__note').first(), 2000);
        await stage.dwellOn(page.locator('li.as-line').first(), 2600);
      },

      async unpriced({ page, stage }) {
        await stage.dwellOn(notice(page, 'Waiting for a price'), 3200);
      },

      async customer({ page, stage }) {
        await stage.typeIn(page.getByLabel(/^Name\s*\*?$/).first(), ORDER.name, { after: 400 });
        await stage.typeIn(page.getByLabel(/^PIN code\s*\*?$/).first(), ORDER.pin, { after: 400 });
        await stage.typeIn(page.getByLabel(/^Address\s*\*?$/).first(), ORDER.line1, { after: 600 });
      },

      async phone({ page, stage }) {
        await stage.typeIn(page.getByLabel(/^Phone\s*\*?$/).first(), ORDER.phone, {
          clear: true,
          after: 1800,
        });
      },

      async landmark({ page, stage }) {
        await stage.typeIn(page.getByLabel(/^Landmark\s*\*?$/).first(), ORDER.landmark, {
          after: 1800,
        });
      },

      async payment({ page, stage }) {
        await stage.glide(320);
        await stage.dwellOn(page.getByText('Cash on delivery', { exact: true }).first(), 2000);
        // The hint under the box spells out what is collected if it is
        // left blank, which is what the line is reading out.
        await stage.dwellOn(page.getByLabel(/Cash to collect/i).first(), 2600);
      },

      async prepaid({ page, stage }) {
        /*
          The CHOICE is filmed; the order is placed on COD.

          Choosing prepaid for real spends the store's wallet, and a
          balance that cannot cover the goods is refused outright
          (`STORE_BALANCE_INSUFFICIENT`) — a correct refusal, and a
          failed take under a line about placing an order.
        */
        await stage.dwellOn(page.getByText('Prepaid', { exact: true }).first(), 3400);
      },

      async confirm({ page, stage }) {
        await stage.clickIt(
          page.getByRole('button', { name: 'Place order', exact: true }).first(),
          {
            after: 1200,
          },
        );
        const dialog = dialogTitled(page, 'Place this order?');
        await dialog.waitFor({ timeout: 15_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm').first(), 3200);
        // The page's submit and the dialog's confirm carry the SAME
        // accessible name, which is why this is scoped to the dialog.
        await stage.clickIt(
          dialog.getByRole('button', { name: 'Place order', exact: true }).first(),
          { after: 1400 },
        );
      },

      async placed({ page, stage }) {
        await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await withRetry(page, page.locator('.sk-ph__title').first());
        await stage.dwellOn(page.locator('.sk-ph__title').first(), 2600);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('span.sk-chip').first(), 3200);
      },
    },
  },

  'assoc-upload-bulk-orders': {
    app: 'associate',

    /*
      The upload PUTs the CSV at whatever `presignPutUrl` handed back,
      which on a filming stack is a `mock://` string Chromium cannot
      fetch at all. The shim is a no-op for every other URL, so arming
      it costs the rest of the take nothing.
    */
    needsSpacesShim: true,

    async prologue(ctx) {
      await signInAssoc(ctx);
      await openFromNav(
        ctx,
        '/orders/import',
        ctx.page.getByRole('heading', { name: 'Upload orders' }).first(),
      );
    },

    steps: {
      async intro({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { name: 'Upload orders' }).first(), 2400);
      },

      async template({ page, stage }) {
        // A `<button>` that builds a blob and clicks a synthetic anchor,
        // so there is no href to read — but a real download event fires,
        // which is what proves the file was produced.
        const saved = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
        await stage.clickIt(page.getByRole('button', { name: 'Download the template' }).first(), {
          after: 1600,
        });
        await saved;
        await page.waitForTimeout(900);
      },

      async 'no-price'({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3400);
      },

      async rows({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3400);
      },

      async file({ page, stage }) {
        await page.locator('input[type="file"]').first().setInputFiles(BULK_CSV);
        await page.waitForTimeout(1000);
        await stage.clickIt(page.getByRole('button', { name: 'Upload and check' }).first(), {
          after: 1600,
        });
      },

      async preview({ page, stage }) {
        // Six rows making four orders — the clause only renders when the
        // two numbers differ, which is why the seed shapes the file so.
        await withRetry(page, page.locator('p.as-body').first());
        await stage.dwellOn(page.locator('p.as-body').first(), 3000);
      },

      async 'bad-row'({ page, stage }) {
        await stage.dwellOn(notice(page, 'will not import'), 3400);
      },

      async rest({ page, stage }) {
        await stage.dwellOn(
          page.getByRole('button', { name: /^Import \d+ orders?$/ }).first(),
          2600,
        );
      },

      async import({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Import \d+ orders?$/ }).first(), {
          after: 1200,
        });
        const dialog = dialogTitled(page, 'Import these orders?');
        await dialog.waitFor({ timeout: 15_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm').first(), 2600);
        await stage.clickIt(dialog.getByRole('button', { name: /^Import \d+ orders?$/ }).first(), {
          after: 1800,
        });
      },

      async progress({ page, stage }) {
        // The run this page started, drawn as a parachute. It finishes
        // in a second or two on a local box, so this dwells on whatever
        // the panel is saying rather than waiting for a phase.
        const run = page.locator('.sk-parachute').first();
        if ((await run.count()) > 0) await stage.dwellOn(run, 3000);
        else await page.waitForTimeout(3000);
      },

      async uploads({ page, stage }) {
        // The uploads table re-fetches every five seconds while the run
        // is live, so this waits for the row rather than snapshotting.
        await withRetry(
          page,
          page.getByRole('cell', { name: /associate-bulk-orders\.csv/i }).first(),
        );
        await stage.glide(320);
        await stage.dwellOn(section(page, 'Recent uploads'), 3600);
      },

      async reference({ page, stage }) {
        await stage.glide(-320);
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3600);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(
          page.getByRole('button', { name: 'Download the template' }).first(),
          3000,
        );
      },
    },
  },

  'assoc-find-an-order': {
    app: 'associate',

    /*
      ARMED FOR THE PICTURES, not for an upload. A product thumbnail is
      a presigned READ, which under `DEV_MOCK_SPACES` is a `mock://`
      string the browser puts straight into an `<img src>` — and an
      unknown scheme renders as a BROKEN image, in the middle of a
      catalogue. The shim swaps those for the bytes as a `data:` URL and
      is a no-op for every other URL, so it costs the rest of the take
      nothing.
    */
    needsSpacesShim: true,

    async prologue(ctx) {
      await signInAssoc(ctx);
    },

    steps: {
      async intro({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { name: 'My orders' }).first(), 2400);
      },

      async list({ page, stage }) {
        await stage.dwellOn(page.locator('thead tr').first(), 2600);
        await stage.dwellOn(page.locator('tbody tr').first(), 2200);
      },

      async 'own-only'({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3600);
      },

      async search({ page, stage }) {
        // A FORM, so it commits on Enter; and the field's own
        // `aria-label` is the accessible name, not the visible "Search".
        const box = page.getByLabel('Search orders').first();
        await stage.typeIn(box, '9822061104', { after: 700 });
        await box.press('Enter');
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1600);
        await stage.dwellOn(page.locator('.sk-sh__note').first(), 1800);
        // Back to everything, or the status filter below is ANDed with
        // this search and the narrowed list would be two rows of one
        // customer rather than the morning's failed deliveries.
        await stage.clickIt(page.getByRole('button', { name: 'Reset', exact: true }).first(), {
          after: 1200,
        });
        await page.waitForLoadState('networkidle').catch(() => {});
      },

      async status(ctx) {
        const { page, stage } = ctx;
        await filterByStatus(ctx, 'DELIVERED');
        await stage.dwellOn(page.locator('.sk-sh__note').first(), 2600);
      },

      async reload({ page, stage }) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await withRetry(page, page.locator('tbody tr').first());
        await stage.dwellOn(page.getByLabel(/^Filter by status\s*\*?$/).first(), 1800);
        await stage.dwellOn(page.locator('.sk-sh__note').first(), 2200);
      },

      /*
        A DELIVERED order on purpose. Every panel on that page that
        offers an action is conditional on the order NOT being terminal
        — the cancel in the header, and the ask inside the delivery
        panel — so a live one would put things to press in the middle of
        a video whose promise is that it presses nothing.
      */
      async open(ctx) {
        await openFirstOrder(ctx);
        await ctx.stage.dwellOn(ctx.page.locator('.sk-ph__title').first(), 2400);
      },

      async inside({ page, stage }) {
        await stage.dwellOn(section(page, 'What is inside'), 3400);
      },

      async where({ page, stage }) {
        await stage.dwellOn(section(page, 'Where it is going'), 2200);
        await stage.glide(300);
        await stage.dwellOn(section(page, 'How it is paid for'), 2200);
      },

      async parcel({ page, stage }) {
        await stage.dwellOn(section(page, 'The parcel'), 3400);
      },

      async history({ page, stage }) {
        await stage.glide(380);
        await stage.dwellOn(section(page, 'What has happened'), 3600);
      },

      async closed({ page, stage }) {
        // The panel RENDERS on a delivered order and offers nothing:
        // the store's policy is not OFF, so the section exists and says
        // when an ask would be open instead. That sentence is the shot.
        const panel = section(page, 'The delivery did not work?');
        await panel.scrollIntoViewIfNeeded();
        await stage.dwellOn(panel, 3600);
      },

      async failed(ctx) {
        const { page, stage } = ctx;
        // Back through the app's own link rather than `page.goto` (FE-1).
        await stage.clickIt(page.locator('a.as-back').first(), { after: 900 });
        await page.waitForURL((u) => u.pathname === '/orders', { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await filterByStatus(ctx, 'DELIVERY_FAILED');
        await openFirstOrder(ctx);
        const panel = section(page, 'The delivery did not work?');
        await panel.scrollIntoViewIfNeeded();
        await stage.dwellOn(panel, 2600);
      },

      async who({ page, stage }) {
        // The note beside the button is the honest half: it says whether
        // this happens now or waits on the store, BEFORE anybody clicks.
        // NOTHING IS PRESSED — pressing it files a real request, which
        // is the long video's job.
        await stage.dwellOn(
          page.getByRole('button', { name: 'Try delivering again' }).first(),
          1800,
        );
        await stage.dwellOn(page.locator('.as-offer__note').first(), 3400);
      },

      async outro({ page, stage }) {
        await stage.glide(-900);
        await stage.dwellOn(page.locator('.sk-ph__title').first(), 2800);
      },
    },
  },

  'assoc-my-customers': {
    app: 'associate',

    async prologue(ctx) {
      await signInAssoc(ctx);
      await openFromNav(ctx, '/customers', ctx.page.locator('tbody tr').first());
    },

    steps: {
      async intro({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { name: 'My customers' }).first(), 2400);
      },

      async list({ page, stage }) {
        await stage.dwellOn(page.locator('thead tr').first(), 2600);
        await stage.dwellOn(page.locator('tbody tr').first(), 2000);
      },

      async 'own-only'({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3400);
      },

      async count({ page, stage }) {
        await stage.dwellOn(page.getByRole('columnheader', { name: 'Orders' }).first(), 1600);
        await stage.dwellOn(page.locator('tbody tr:first-child td:nth-child(4)').first(), 3000);
      },

      async why({ page, stage }) {
        await stage.dwellOn(page.locator('tbody tr:first-child td:nth-child(2)').first(), 3400);
      },

      async repeat({ page, stage }) {
        await stage.dwellOn(page.locator('tbody tr:first-child').first(), 3400);
      },

      async open({ page, stage }) {
        await stage.clickIt(page.locator('tbody tr:first-child a.as-link').first(), {
          after: 1200,
        });
        await page.waitForURL((u) => u.pathname === '/orders', { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await withRetry(page, page.locator('tbody tr').first());
        await stage.dwellOn(page.locator('.sk-sh__note').first(), 2200);
      },

      async 'no-detail'({ page, stage }) {
        await stage.dwellOn(page.locator('tbody tr').first(), 3200);
      },

      async search(ctx) {
        const { page, stage } = ctx;
        await openFromNav(ctx, '/customers', page.locator('tbody tr').first());
        const box = page.getByLabel('Search customers').first();
        await stage.typeIn(box, '98220611', { after: 700 });
        await box.press('Enter');
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);
        await stage.dwellOn(page.locator('.sk-sh__note').first(), 1800);
      },

      async 'read-only'({ page, stage }) {
        await stage.dwellOn(page.locator('thead tr').first(), 3400);
      },

      async outro({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3000);
      },
    },
  },

  'assoc-issues-and-account': {
    app: 'associate',

    async prologue(ctx) {
      await signInAssoc(ctx);
      await openFromNav(ctx, '/tickets', ctx.page.getByRole('heading', { name: 'Issues' }).first());
    },

    steps: {
      async intro({ page, stage }) {
        await stage.dwellOn(page.getByRole('heading', { name: 'Issues' }).first(), 2400);
      },

      async list({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2000);
        await stage.dwellOn(page.locator('thead tr').first(), 2400);
      },

      async stages({ page, stage }) {
        await stage.dwellOn(page.getByRole('tablist').first(), 3400);
      },

      async thread({ page, stage }) {
        await stage.clickIt(page.locator('tbody tr a[href^="/tickets/"]').first(), { after: 1200 });
        await page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/i, { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await withRetry(page, page.locator('.sk-ph__title').first());
        await stage.dwellOn(section(page, 'The conversation'), 3600);
      },

      async raise({ page, stage }) {
        await stage.clickIt(page.locator('a.as-back').first(), { after: 900 });
        await page.waitForURL((u) => u.pathname === '/tickets', { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.clickIt(
          page.getByRole('link', { name: 'Raise an issue', exact: true }).first(),
          {
            after: 1200,
          },
        );
        await page.waitForURL((u) => u.pathname === '/tickets/new', { timeout: 20_000 });
        await withRetry(page, page.getByLabel(/^Which order\?\s*\*?$/).first());
        const which = page.getByLabel(/^Which order\?\s*\*?$/).first();
        await stage.point(which, { settle: 500 });
        // BY THE CUSTOMER'S NAME, read off the option, rather than by
        // index: the order numbers are minted per run so there is
        // nothing stable to name an option by, and the first one is
        // whatever this world placed last.
        const option = which.locator('option', { hasText: ISSUE.onCustomer }).first();
        const value = await option.getAttribute('value');
        if (value === null) throw new Error(`No order of ${ISSUE.onCustomer}'s in the picker`);
        await which.selectOption(value);
        await page.waitForTimeout(900);
        await stage.clearHalo();
      },

      async subject({ page, stage }) {
        await stage.typeIn(page.getByLabel(/^What is it about\?\s*\*?$/).first(), ISSUE.subject, {
          after: 600,
        });
        await stage.typeIn(
          page.getByLabel('What happened?', { exact: false }).first(),
          ISSUE.body,
          {
            delay: 28,
            after: 900,
          },
        );
      },

      async 'no-money'({ page, stage }) {
        await stage.dwellOn(section(page, 'The issue'), 3400);
      },

      async sent({ page, stage }) {
        /*
          RAISED FOR REAL. It writes a `tickets` row against one of this
          person's own orders, which is fine in a world rebuilt before
          every take — and it is the only way to film the thread it
          opens. The seed sweeps it by its SUBJECT, which is why that
          string must not be the seeded ticket's.
        */
        await stage.clickIt(page.getByRole('button', { name: /^Raise it$/ }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/i, { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await withRetry(page, page.locator('.sk-ph__title').first());
        await stage.dwellOn(section(page, 'The conversation'), 3000);
      },

      async inbox(ctx) {
        const { page, stage } = ctx;
        await openFromNav(
          ctx,
          '/notifications',
          page.getByRole('heading', { name: 'Notifications' }).first(),
        );
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 3200);
      },

      async digest({ page, stage }) {
        const digest = page
          .locator('li.as-ntf-item')
          .filter({ hasText: /delivered/i })
          .first();
        await digest.scrollIntoViewIfNeeded();
        await stage.dwellOn(digest.locator('.as-ntf-item__title').first(), 3000);
      },

      async 'digest-body'({ page, stage }) {
        const digest = page
          .locator('li.as-ntf-item')
          .filter({ hasText: /delivered/i })
          .first();
        await stage.clickIt(digest.locator('button.as-ntf-item__open').first(), { after: 1400 });
        await stage.dwellOn(digest, 3200);
      },

      async account(ctx) {
        const { page, stage } = ctx;
        await openFromNav(
          ctx,
          '/account',
          page.getByRole('heading', { name: 'My account' }).first(),
        );
        await stage.dwellOn(section(page, 'You'), 3000);
      },

      async 'what-you-see'({ page, stage }) {
        await stage.dwellOn(page.getByText('What you see', { exact: true }).first(), 1600);
        await stage.dwellOn(
          page.getByText('The orders and customers you placed', { exact: true }).first(),
          2800,
        );
      },

      async sessions({ page, stage }) {
        await stage.glide(300);
        await stage.dwellOn(section(page, 'Sessions'), 3400);
      },

      async outro({ page, stage }) {
        await stage.glide(-600);
        await stage.dwellOn(page.locator('.sk-ph__title').first(), 3000);
      },
    },
  },
};
