/**
 * promo-reseller — 75 seconds for somebody in India with customers and
 * no stock.
 *
 * ── WHO THIS IS AIMED AT, AND THEREFORE WHAT IT OPENS WITH ──────────
 *
 * A shop, a page, a WhatsApp list, a person who can shift twenty sarees
 * a week and has never been able to afford twenty sarees. Their problem
 * is not software. It is that every brand worth selling wants the order
 * paid for before it ships, and the stock then lives in their room at
 * their risk. So scene one is three clauses long and mentions nothing we
 * built: you have the customers, not the stock, not the capital, not the
 * space. Everything after it is the turn on that one sentence.
 *
 * The 75-second rules are the same as the seller promo's — problem
 * first, few screens held long, no typing — WITH ONE EXCEPTION, and it
 * is deliberate: scene three types a price. Choosing what to sell at is
 * the thing this audience does not believe they will be allowed to do,
 * so the one place a keystroke earns its dead air is the field where
 * they set their own margin. Nothing else in the video is typed.
 *
 * ── WHAT IS CLAIMED, AND WHERE EACH CLAIM COMES FROM ────────────────
 *
 *   · "sells somebody else's stock under your own name" — a reseller
 *     store is RS-1; what the customer sees is RS-10.
 *   · "what each one costs you, and how many are really on the shelf" —
 *     the store catalogue carries the transfer price and RS-3's visible
 *     quantity. It does NOT carry the seller's own cost, and this video
 *     never implies it does (boundary 1 of docs/associates.md).
 *   · "inside a range the supplier agreed" — RS-3's min and max retail,
 *     enforced at the order (RETAIL_OUT_OF_RANGE).
 *   · "you buy nothing up front" — a cash-on-delivery store order takes
 *     no payment and no hold (RS-5, R5). Said as BUY rather than "pay"
 *     on purpose: a PREPAID store order does debit the store wallet,
 *     so "nothing is paid up front" would have been a claim with an
 *     exception sitting inside it.
 *   · "our call centre ringing to confirm" — every order is phoned
 *     (Module 7), reseller orders included.
 *   · "the parcel and the tracking page carry your store's name" —
 *     RS-10: the courier payload, our own label, the public tracking
 *     page's `soldBy` and the customer's emails all carry the store.
 *   · "worked out per order, not estimated" — RS-6 phase 3c plans and
 *     posts each party's share per order under the terms the order was
 *     PLACED on.
 *   · "a price you set for them, each seeing only the orders they
 *     placed" — `associate_prices` is per person per product, and
 *     `order_scope = own` narrows orders and customers (ASSOC-1).
 *
 * ── WHAT THE RUNNER OWES THIS FLOW ─────────────────────────────────
 *
 * Sign-in as the store OWNER, not an associate: scene seven is the
 * associates roster, which needs `associates.manage`. Scene one
 * navigates by URL, so where the prologue lands does not matter.
 */

export const narration = {
  slug: 'promo-reseller',
  title: 'Sell it before you buy it',
  subtitle: 'Skydrop for reseller stores',
  steps: [
    {
      id: 'problem',
      say: 'You have the customers. What you do not have is stock, the capital to buy it, or anywhere to keep it.',
      sayBn: 'ক্রেতা আপনার আছে। যা নেই তা হলো স্টক, সেটা কেনার পুঁজি, আর রাখার জায়গা।',
      sayHi: 'ग्राहक आपके पास हैं। जो नहीं है वह है स्टॉक, उसे ख़रीदने की पूँजी, और रखने की जगह।',
    },
    {
      id: 'catalogue',
      say: 'A Skydrop store sells somebody else’s stock under your own name. This is a supplier’s catalogue opened to you: what you may sell, what each one costs you, and how many are really on the shelf.',
      sayBn:
        'একটা Skydrop store অন্য কারও স্টক আপনার নিজের নামে বিক্রি করে। এটা একজন সরবরাহকারীর ক্যাটালগ, আপনার জন্য খুলে দেওয়া: আপনি কী বিক্রি করতে পারবেন, প্রতিটার জন্য আপনার কত খরচ, আর তাকে আসলে কতগুলো আছে।',
      sayHi:
        'एक Skydrop store किसी और का स्टॉक आपके अपने नाम से बेचता है। यह एक सप्लायर का कैटलॉग है, आपके लिए खोला गया: आप क्या बेच सकते हैं, हर चीज़ पर आपका कितना ख़र्च है, और शेल्फ़ पर असल में कितने पड़े हैं।',
    },
    {
      id: 'your-price',
      say: 'You choose what you sell each for, inside a range the supplier agreed. You buy nothing up front and keep nothing in your room.',
      sayBn:
        'প্রতিটা জিনিস কত দামে বিক্রি করবেন সেটা আপনি বাছেন, সরবরাহকারীর ঠিক করা একটা সীমার ভিতরে। আগে কিছু কিনতে হয় না, নিজের ঘরে কিছু রাখতেও হয় না।',
      sayHi:
        'हर चीज़ किस कीमत पर बेचेंगे यह आप चुनते हैं, सप्लायर की तय की हुई एक हद के अंदर। पहले से कुछ ख़रीदना नहीं पड़ता, और अपने कमरे में कुछ रखना भी नहीं पड़ता।',
    },
    {
      id: 'we-do-the-rest',
      say: 'An order needs a customer and a product. After that it is the supplier’s stock, our warehouse, our call centre ringing to confirm, and our courier account.',
      sayBn:
        'একটা অর্ডারের জন্য লাগে একজন ক্রেতা আর একটা পণ্য। এরপর সবই সরবরাহকারীর স্টক, আমাদের গুদাম, নিশ্চিত করতে আমাদের কল সেন্টারের ফোন, আর আমাদের কুরিয়ার অ্যাকাউন্ট।',
      sayHi:
        'एक ऑर्डर के लिए चाहिए एक ग्राहक और एक प्रोडक्ट। उसके बाद सब सप्लायर का स्टॉक, हमारा गोदाम, पक्का करने के लिए हमारे call centre का फ़ोन, और हमारा कूरियर अकाउंट।',
    },
    {
      id: 'your-name',
      say: 'Your customer never sees any of that. The parcel and the tracking page carry your store’s name, not your supplier’s.',
      sayBn:
        'আপনার ক্রেতা এর কিছুই দেখে না। পার্সেল আর tracking পৃষ্ঠায় আপনার দোকানের নাম থাকে, আপনার সরবরাহকারীর নাম নয়।',
      sayHi:
        'आपका ग्राहक इसमें से कुछ नहीं देखता। पार्सल पर और tracking पेज पर आपकी दुकान का नाम रहता है, आपके सप्लायर का नहीं।',
    },
    {
      id: 'money',
      say: 'When the order is paid for, your share lands in your store wallet: what you sold it for, less the supplier’s price and your share of the fees — worked out per order, not estimated.',
      sayBn:
        'অর্ডারের টাকা মিটে গেলে আপনার ভাগ আপনার store wallet-এ আসে: আপনি যে দামে বিক্রি করেছেন, তা থেকে সরবরাহকারীর দাম আর চার্জে আপনার ভাগ বাদ দিয়ে — প্রতিটা অর্ডারের জন্য আলাদা হিসাব করা, অনুমান নয়।',
      sayHi:
        'ऑर्डर का पैसा मिल जाने पर आपका हिस्सा आपके store wallet में आता है: आपने जिस कीमत पर बेचा, उसमें से सप्लायर की कीमत और शुल्कों में आपका हिस्सा काटकर — हर ऑर्डर का अलग हिसाब लगाकर, अंदाज़े से नहीं।',
    },
    {
      id: 'team',
      say: 'And you can put your own sales people on it, each selling at a price you set for them, each seeing only the orders they placed.',
      sayBn:
        'আর আপনি নিজের বিক্রয়কর্মীদেরও এতে বসাতে পারেন — প্রত্যেকে আপনার ঠিক করা দামে বিক্রি করবে, আর প্রত্যেকে শুধু নিজের দেওয়া অর্ডারগুলোই দেখতে পাবে।',
      sayHi:
        'और आप अपने बिक्री करने वालों को भी इस पर बैठा सकते हैं — हर कोई उसी कीमत पर बेचेगा जो आप उसके लिए तय करेंगे, और हर कोई सिर्फ़ अपने ही दिए ऑर्डर देख पाएगा।',
    },
    {
      id: 'outro',
      say: 'No stock, no capital, no logistics, and your name on the parcel. Ask the supplier you want to sell for to invite your store.',
      sayBn:
        'স্টক নেই, পুঁজি নেই, পরিবহনের ঝামেলা নেই, আর পার্সেলে আপনার নাম। যার হয়ে বিক্রি করতে চান, সেই সরবরাহকারীকে বলুন আপনার দোকানকে আমন্ত্রণ করতে।',
      sayHi:
        'न स्टॉक, न पूँजी, न ढुलाई का झंझट, और पार्सल पर आपका नाम। जिस सप्लायर के लिए बेचना चाहते हैं, उससे कहिए कि आपकी दुकान को न्योता भेजे।',
    },
  ],
};

export const flow = {
  app: 'reseller',

  /**
   * What the demo world has to hold.
   *
   * The store that films this is the one whose invitation is ACCEPTED —
   * Pune Silk Studio — because it is the only seeded store that can
   * sign in. Everything below is about that store having a trading
   * history rather than a first day: a promo opening on an empty
   * catalogue and a zero wallet argues against itself.
   */
  seed: [
    'Pune Silk Studio able to sign in as its owner (the `associates.manage` and `catalogue.view` permissions), with its current terms ACCEPTED — an unaccepted terms banner across the top of every scene is the wrong first impression and would also block the order form.',
    'At least six variants enabled on that store’s catalogue, each with a transfer price, a min and max retail, and a non-zero visible quantity — scene two is the table and scene three needs the picker to offer something.',
    'A first page of /orders holding a dozen store orders across the lifecycle, with at least one delivered and one returned, so scene four reads as a business running rather than one order in a demo.',
    'The FIRST row of /orders being an order far enough along to carry a waybill and a courier name, because scene five dwells on the order detail while the narration talks about what the customer sees.',
    'A store wallet with a positive balance and ledger rows showing an order credit and a fee share separately, plus one top-up or payout, so scene six has the arithmetic on screen.',
    'At least two ACCEPTED associates on the roster, with prices set for several products each and some orders placed by both — scene seven is that table, and two rows is the minimum that reads as a team.',
    'A dashboard past its first-run state (scene one and the closing scene), so the video neither opens nor closes on a setup checklist.',
  ],

  steps: [
    {
      /**
       * The store dashboard, breathing. As with the seller promo the
       * words do the work here; the picture only has to look like a
       * going concern.
       */
      id: 'problem',
      run: async ({ page, stage, baseUrl }) => {
        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2400);
        await stage.glide(360);
        await page.waitForTimeout(1600);
        await stage.glide(-360);
      },
    },
    {
      /**
       * The catalogue. The one click of the video that is navigation
       * for its own sake — it is worth showing a hand on the app once
       * before five held screens.
       */
      id: 'catalogue',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/catalogue"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/catalogue', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1800);
        await stage.dwellOn(page.locator('tbody tr').first(), 2800);
        await stage.glide(300);
      },
    },
    {
      /**
       * The order form, as far as the price and no further.
       *
       * The product picker is a native `<select>`, so `selectOption` is
       * the supported path (the same reasoning as the store tutorial's
       * own flow), and `index: 1` skips the placeholder option. The
       * line note that appears under it — what you pay the seller, how
       * many are available — is the figure the narration is standing
       * on, so it gets its own dwell before the price is typed.
       */
      id: 'your-price',
      run: async ({ page, stage, baseUrl }) => {
        await page.goto(`${baseUrl}/orders/new`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1400);

        const picker = page.getByLabel(/^Product\s*\*?$/).first();
        await stage.point(picker, { settle: 500 });
        await picker.selectOption({ index: 1 });
        await page.waitForTimeout(1200);
        await stage.dwellOn(page.locator('p.ro-line__note').first(), 1800);

        // The ONE typed field in this video. The figure is left to the
        // seed's own range rather than hard-coded here: a constant that
        // drifts outside the agreed range would film the refusal under
        // narration about choosing a price.
        const price = page.getByLabel('Retail price per unit').first();
        await stage.typeIn(price, '2950', { clear: true, delay: 150, after: 1800 });
      },
    },
    {
      /**
       * Orders already placed, at every stage.
       *
       * The call, the warehouse and the courier account cannot be
       * filmed from a store's login — none of them is the store's
       * screen — so the picture is what they produce: a status column
       * moving on its own.
       */
      id: 'we-do-the-rest',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/orders"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/orders', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        await stage.dwellOn(page.locator('tbody tr').first(), 2400);
        await stage.glide(320);
      },
    },
    {
      /**
       * One order, open at the parcel.
       *
       * `.ro-order-link` is the row's own order-number link; the first
       * row is the newest order, which the seed guarantees is far
       * enough along to carry a waybill. The glide goes to the parcel
       * block rather than the money block — this scene is about what
       * the customer sees, and the money is the next scene.
       */
      id: 'your-name',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a.ro-order-link').first(), { after: 1600 });
        await page.waitForURL(/\/orders\/[0-9a-f-]{20,}/, { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1800);
        await stage.glide(420);
        await page.waitForTimeout(2000);
      },
    },
    {
      id: 'money',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/wallet"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/wallet', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        await stage.glide(400);
        await page.waitForTimeout(2200);
      },
    },
    {
      /**
       * The associates roster. Held on the table rather than opening
       * one person's prices: the claim is "you can have a team", and
       * the roster is the only screen that says that in one frame.
       */
      id: 'team',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/associates"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/associates', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        await stage.dwellOn(page.locator('tbody tr').first(), 2600);
      },
    },
    {
      id: 'outro',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/dashboard"]').first(), { after: 1400 });
        await page.waitForURL((u) => u.pathname === '/dashboard', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2600);
      },
    },
  ],
};
