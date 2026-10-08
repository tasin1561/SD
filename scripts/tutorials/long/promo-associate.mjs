/**
 * promo-associate — 65 seconds for a sales person with a phone.
 *
 * ── PITCHED LOWEST OF THE THREE, ON PURPOSE ────────────────────────
 *
 * The seller promo is addressed to somebody running a company and the
 * reseller promo to somebody running a shop. This one is addressed to
 * one person who is good at selling and has never had anything to sell
 * that did not have to be bought first. So it is the shortest of the
 * three, it uses the fewest words per screen, and it promises the least:
 * five facts, in the order a sales person would ask them.
 *
 *   what can I sell → for how much → how do I place one → what happens
 *   to it → who are my customers → how do I get paid → how do I start
 *
 * Nothing about fee splits, terms, margins or the store's economics
 * appears, and that is not a simplification — an associate cannot see
 * any of it (docs/associates.md, boundary 2). A promo that showed a
 * figure this audience will never be shown would be selling the wrong
 * job.
 *
 * ── THE ONE CLAIM THIS VIDEO MUST NOT OVERSTATE ────────────────────
 *
 * "Get paid." An associate has NO Skydrop wallet — the store settles
 * with them outside Skydrop, which is the decision that keeps TRE-8c's
 * bank invariant one level deep. So the money scene says exactly that:
 * what you earn is between you and your store, and we are not in the
 * middle of it. Promising a payout here would be promising a feature
 * that does not exist and, worse, one somebody would wait for.
 *
 * ── THE OTHER CLAIMS ───────────────────────────────────────────────
 *
 *   · "the price is set for you, by name" — `associate_prices` is one
 *     row per person per product, FIXED, with no markup rule and no
 *     fallback; a retail that disagrees with the row is refused rather
 *     than accepted (ASSOC-1).
 *   · "only the orders you placed" — `store_roles.order_scope = own`,
 *     applied in the WHERE clause, over orders AND customers.
 *   · "the same orders your store is looking at" — the reseller sees
 *     every associate's orders beside their own.
 *   · "a note every day" — capability 6, the daily digest of delivered,
 *     returned and could-not-deliver, scoped per associate. It is
 *     IN-APP only (NOTIF-23), which is why the scene is the inbox and
 *     not an email.
 *   · "works on your phone" — FE-7: one shell, `lg` the single
 *     breakpoint, tables becoming cards below `md`.
 *
 * ── WHAT THE RUNNER OWES THIS FLOW ─────────────────────────────────
 *
 * Sign-in as an ASSOCIATE of the demo store, and an `app: 'associate'`
 * entry in the recorder's own table pointing at apps/associate. Note
 * for whoever wires that up: THIS APP HAS NO DASHBOARD. Its root
 * redirects to /orders, deliberately — every figure a dashboard would
 * carry is either the store's money or the store's margin — so a
 * sign-in helper that waits for `/dashboard` will time out here. Scene
 * one navigates to /orders by URL regardless, so the only requirement
 * is that the session exists.
 */

export const narration = {
  slug: 'promo-associate',
  title: 'Sell for a store, from your phone',
  subtitle: 'Skydrop for sales associates',
  steps: [
    {
      id: 'problem',
      say: 'You know how to sell. What you have never had is something to sell that does not cost you money up front.',
      sayBn:
        'বিক্রি করতে আপনি জানেন। যা কখনো পাননি, তা হলো এমন একটা জিনিস যেটা বিক্রি করতে আগে টাকা লাগে না।',
      sayHi:
        'बेचना आपको आता है। जो कभी नहीं मिला, वह है बेचने के लिए ऐसी चीज़ जिस पर पहले पैसा न लगे।',
    },
    {
      id: 'what-i-sell',
      say: 'A store can put you on its products. This is the list: what you may sell, what you sell each one for, and how many are left.',
      sayBn:
        'একটা দোকান আপনাকে তার পণ্যে বসাতে পারে। এই হলো তালিকা: আপনি কী বিক্রি করতে পারবেন, প্রতিটা কত দামে বিক্রি করবেন, আর কতগুলো বাকি আছে।',
      sayHi:
        'एक दुकान आपको अपने प्रोडक्ट पर बैठा सकती है। यह है लिस्ट: आप क्या बेच सकते हैं, हर चीज़ किस कीमत पर बेचेंगे, और कितने बचे हैं।',
    },
    {
      id: 'place',
      say: 'Placing an order is a product and a customer. The price is already set — your store sets it for you, by name — so there is nothing to quote and nothing to haggle over.',
      sayBn:
        'অর্ডার বসাতে লাগে একটা পণ্য আর একজন ক্রেতা। দাম আগেই ঠিক করা — আপনার দোকান আপনার নামে সেটা ঠিক করে দেয় — তাই দাম বলার কিছু নেই, দরদাম করারও কিছু নেই।',
      sayHi:
        'ऑर्डर डालने के लिए चाहिए एक प्रोडक्ट और एक ग्राहक। कीमत पहले से तय है — आपकी दुकान आपके नाम से तय कर देती है — इसलिए कीमत बताने की कोई बात नहीं, मोल-भाव की भी नहीं।',
    },
    {
      id: 'follow',
      say: 'You see only the orders you placed. Confirmed, dispatched, delivered, came back: the same orders your store is looking at.',
      sayBn:
        'আপনি শুধু নিজের দেওয়া অর্ডারগুলোই দেখেন। Confirmed, dispatched, delivered, ফেরত এসেছে: আপনার দোকান যে অর্ডারগুলো দেখছে, ঠিক সেগুলোই।',
      sayHi:
        'आप सिर्फ़ अपने दिए ऑर्डर देखते हैं। Confirmed, dispatched, delivered, वापस आ गया: आपकी दुकान जो ऑर्डर देख रही है, वही।',
    },
    {
      id: 'digest',
      say: 'And a note every day on what was delivered, what came back, and what the courier could not deliver — so you know who to ring.',
      sayBn:
        'আর প্রতিদিন একটা খবর: কী কী ডেলিভারি হলো, কী কী ফেরত এল, আর কুরিয়ার কী কী দিতে পারল না — যাতে আপনি জানেন কাকে ফোন করতে হবে।',
      sayHi:
        'और हर दिन एक ख़बर: क्या-क्या डिलीवर हुआ, क्या वापस आया, और कूरियर क्या नहीं पहुँचा पाया — ताकि आपको पता रहे कि किसे फ़ोन करना है।',
    },
    {
      id: 'customers',
      say: 'The people you sold to stay yours, with what each of them bought. Those are the people to call again next month.',
      sayBn:
        'যাদের কাছে বিক্রি করেছেন তারা আপনারই থাকে, আর কে কী কিনেছে সেটাও থাকে। সামনের মাসে আপনার ঘোরার তালিকা ওটাই।',
      sayHi:
        'जिन्हें आपने बेचा, वे आपके ही रहते हैं, और किसने क्या ख़रीदा यह भी। अगले महीने फिर फ़ोन करने के लिए लोग वही हैं।',
    },
    {
      id: 'paid',
      say: 'What you earn on a sale is between you and your store. Skydrop does not stand in the middle of it.',
      sayBn:
        'একটা বিক্রিতে আপনার কত আয় হবে, সেটা আপনার আর আপনার দোকানের মধ্যের ব্যাপার। Skydrop এর মাঝখানে দাঁড়ায় না।',
      sayHi:
        'एक बिक्री पर आपकी कितनी कमाई होगी, यह आपके और आपकी दुकान के बीच की बात है। Skydrop उसके बीच में नहीं आता।',
    },
    {
      id: 'outro',
      say: 'Nothing to buy, nothing to carry, nothing to store. Ask the store you sell for to send you a link — it works on your phone.',
      sayBn:
        'কিছু কিনতে হবে না, বইতে হবে না, রাখতেও হবে না। যে দোকানের হয়ে বিক্রি করবেন, তাকে বলুন একটা লিংক পাঠাতে — এটা আপনার ফোনেই চলে।',
      sayHi:
        'कुछ ख़रीदना नहीं, ढोना नहीं, रखना नहीं। जिस दुकान के लिए बेचेंगे, उससे कहिए कि एक लिंक भेज दे — यह आपके फ़ोन पर ही चलता है।',
    },
  ],
};

export const flow = {
  app: 'associate',

  /**
   * What the demo world has to hold.
   *
   * The hard one is the LAST line. Order scope is `own`, so every list
   * in this video is filtered to the person signed in — which means a
   * seeded associate with no orders of their own films six empty
   * tables while the narration describes a working day. Orders placed
   * BY THIS PERSON is the requirement, not orders at the store.
   */
  seed: [
    'An ACCEPTED associate of Pune Silk Studio who can sign in — the `associate` role, so `catalogue.sell` and `orders.*` and nothing wider — with `orders_paused_at` NULL, or scene three films the paused notice instead of the form.',
    'An associate price set for at least five of that store’s variants, each inside the seller’s agreed retail range, so scene two is a priced list and scene three’s picker offers something. One unpriced product is welcome — the "waiting for a price" notice is honest and the narration does not contradict it.',
    'At least eight orders PLACED BY THIS ASSOCIATE (`orders.placed_by_store_user_id` = them) spanning the lifecycle: something awaiting its call, something dispatched, at least two delivered, one returned and one failed delivery. Scope is `own`, so orders placed by anybody else at the store are invisible here and do not help.',
    'A second associate at the same store with orders of their own, so the scope is doing real work on camera rather than being a filter over a list that would look the same either way.',
    'That associate’s in-app inbox holding at least one daily digest entry naming delivered, returned and could-not-deliver counts — scene five is the inbox, and the digest is in-app only, so there is nowhere else to film it.',
    'At least four customers reachable from those orders, with more than one order between them, so "with what each of them bought" has a repeat buyer in it.',
    'No seller-side or staff-side state needed beyond what the store already has: nothing in this video reaches past the store’s own catalogue and the orders this one person placed.',
  ],

  steps: [
    {
      /**
       * "My orders" is the app's own landing page and the right opening
       * frame: the whole job in one table. Navigated by URL because the
       * root is a redirect and a sign-in helper written for the other
       * two apps may leave the page anywhere.
       */
      id: 'problem',
      run: async ({ page, stage, baseUrl }) => {
        await page.goto(`${baseUrl}/orders`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2400);
        await stage.glide(320);
        await page.waitForTimeout(1400);
        await stage.glide(-320);
      },
    },
    {
      /**
       * What I sell. The dwell is on the first row because the row IS
       * the sentence — product, price, how many left, in that order
       * across the table.
       */
      id: 'what-i-sell',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/catalogue"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/catalogue', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1800);
        await stage.dwellOn(page.locator('tbody tr').first(), 2800);
        await stage.glide(280);
      },
    },
    {
      /**
       * The order form, as far as the product and no further.
       *
       * The picker is a native `<select>` (`selectOption`, `index: 1`
       * to skip the placeholder) and the price appears BESIDE the line
       * as text rather than in a field, because the associate cannot
       * change it. That is the scene: a number that is already decided.
       * Nothing is typed in this video at all — the customer block
       * would be twelve seconds of somebody else's keystrokes.
       */
      id: 'place',
      run: async ({ page, stage, baseUrl }) => {
        await page.goto(`${baseUrl}/orders/new`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);

        const picker = page.getByLabel(/^Product\s*\*?$/).first();
        await stage.point(picker, { settle: 500 });
        await picker.selectOption({ index: 1 });
        await page.waitForTimeout(1600);
        await stage.glide(300);
        await page.waitForTimeout(1800);
      },
    },
    {
      id: 'follow',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/orders"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/orders', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1800);
        await stage.dwellOn(page.locator('tbody tr').first(), 2400);
        await stage.glide(300);
      },
    },
    {
      /**
       * The inbox, where the daily digest lives. It is in-app only, so
       * this screen is the only place it can be shown — and the only
       * reason the bell is in the header at every width.
       */
      id: 'digest',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/notifications"]').first(), { after: 1400 });
        await page.waitForURL((u) => u.pathname === '/notifications', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2200);
        await stage.glide(300);
      },
    },
    {
      id: 'customers',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/customers"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/customers', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        await stage.dwellOn(page.locator('tbody tr').first(), 2600);
      },
    },
    {
      /**
       * The money sentence over the orders list, deliberately.
       *
       * There is no wallet screen in this app and there is not meant to
       * be one, so the scene that says "we are not in the middle of
       * your money" is filmed over the only thing that IS ours: the
       * orders. Pointing at a figure here would undercut the sentence.
       */
      id: 'paid',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/orders"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/orders', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2400);
      },
    },
    {
      /**
       * Close on "New order": the last frame of a promo is the one
       * somebody acts on, and the act being asked for is to start
       * selling.
       */
      id: 'outro',
      run: async ({ page, stage, baseUrl }) => {
        await page.goto(`${baseUrl}/orders/new`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2600);
        await stage.clearHalo();
      },
    },
  ],
};
