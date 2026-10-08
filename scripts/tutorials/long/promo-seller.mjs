/**
 * promo-seller — 75 seconds for a Bangladeshi seller who has never
 * heard of us.
 *
 * ── WHY THIS IS NOT A TUTORIAL, AND WHAT CHANGES BECAUSE OF IT ──────
 *
 * A tutorial is for somebody who has already decided; it may spend its
 * first ten seconds on the shell and the sidebar, because the viewer has
 * agreed to be taught. A promo has no such agreement. The viewer is one
 * swipe from gone, and the only thing that buys the next sentence is
 * recognising their own week in the first one. So three rules hold here
 * that do not hold in the long videos:
 *
 *   1. THE PROBLEM COMES FIRST AND IT IS THEIRS, NOT OURS. Scene one
 *      says nothing about Skydrop. It says the four things a BD seller
 *      shipping into India cannot do — no warehouse, no way to phone a
 *      cash-on-delivery customer, no courier account, no route home for
 *      the money. If that is not their week, nothing after it matters.
 *
 *   2. FEWER SCREENS, HELD LONGER. Eight scenes over roughly 75 seconds
 *      is about nine seconds a screen. A tutorial earns a fast cut
 *      because the viewer knows where they are; here every cut costs a
 *      beat of re-orientation, so the flow walks ONE straight line —
 *      stock in, order in, call, parcel, scan, money — and never
 *      doubles back.
 *
 *   3. NO TYPING. Typing is how a tutorial shows a form being filled.
 *      In a promo it is dead air: the viewer is not going to fill this
 *      form today, and watching somebody else do it slowly is the
 *      fastest way to lose them. Every scene here is a real screen with
 *      real data on it, pointed at and held.
 *
 * ── WHAT IS CLAIMED, AND WHERE EACH CLAIM COMES FROM ────────────────
 *
 * Every sentence has to be true of the system as built. The ones most
 * worth checking when any of this changes:
 *
 *   · "counted in and told what arrived" — the goods receipt counts and
 *     records a variance in both directions (CNS-3), and a short count
 *     opens a ticket naming the leg (TKT-3).
 *   · "only a yes reserves your stock" — reservation is LATE (ORD-10):
 *     nothing is held until entry to CONFIRMED, which the call drives.
 *   · "packed against a barcode scan" — a parcel cannot be packed
 *     without a closed pack box (LBL-4).
 *   · "if one courier refuses it, another one takes it" — failover is
 *     symmetric by construction (CUR-14), and both refusing ends at
 *     manual placement with a person (CUR-8).
 *   · "a parcel that stops moving is flagged" — TRK-10's stranded
 *     tracking sweep.
 *   · "counted piece by piece" — RTO inspection is per quantity rather
 *     than per line (WMS-8d), and the good units go back to a sellable
 *     bin (WMS-8e).
 *   · "paid into your own bank in Bangladesh, in taka" — the remittance
 *     leaves in taka from the BD account (TRE-8).
 *   · "invite-only" — seller onboarding is invite-only (Phase 1A scope).
 *
 * NO FIGURE HERE IS COMMERCIAL. "One warehouse, one phone call, one
 * courier account, one balance" is structural and stays true at any
 * volume; a seller count or a parcel count is a number somebody has to
 * maintain, and a stale one in a promo is worse than none at all.
 *
 * ── WHAT THE RUNNER OWES THIS FLOW ─────────────────────────────────
 *
 * Sign-in, and nothing else: scene one navigates to the dashboard by
 * URL rather than assuming where the prologue landed, so this module is
 * indifferent to how the runner gets its session.
 */

export const narration = {
  slug: 'promo-seller',
  title: 'Sell into India without being in India',
  subtitle: 'Skydrop for sellers',
  steps: [
    {
      id: 'problem',
      say: 'You can sell into India. Operating there is the problem: no warehouse, nobody to ring a cash-on-delivery customer before the parcel leaves, no courier account, and no way home for the money.',
      sayBn:
        'ভারতে বিক্রি করা আপনি পারেন। সমস্যা হলো সেখানে কাজ চালানো: গুদাম নেই, পার্সেল বেরোনোর আগে COD ক্রেতাকে ফোন করার কেউ নেই, কুরিয়ার অ্যাকাউন্ট নেই, আর টাকা দেশে ফেরানোর কোনো পথও নেই।',
      sayHi:
        'भारत में बेचना आप कर सकते हैं। मुश्किल है वहाँ काम चलाना: न गोदाम, न पार्सल निकलने से पहले COD ग्राहक को फ़ोन करने वाला कोई, न कूरियर अकाउंट, और न पैसा देश लौटाने का कोई रास्ता।',
    },
    {
      id: 'stock-crosses',
      say: 'Skydrop is that operation. Your stock crosses the border once, into our Indian warehouse: you announce the consignment, we count every piece in and tell you what arrived.',
      sayBn:
        'Skydrop সেই কাজটাই করে। আপনার স্টক একবার সীমান্ত পার হয়, সোজা আমাদের ভারতের গুদামে: আপনি consignment ঘোষণা করেন, আমরা প্রতিটা জিনিস গুনে ঢোকাই আর কী কী পৌঁছেছে তা আপনাকে জানাই।',
      sayHi:
        'Skydrop वही काम करता है। आपका स्टॉक एक बार सीमा पार करता है, सीधे भारत में हमारे गोदाम में: आप consignment की घोषणा करते हैं, हम हर पीस गिनकर अंदर लेते हैं और आपको बताते हैं कि क्या-क्या पहुँचा।',
    },
    {
      id: 'on-the-shelf',
      say: 'After that it is on a shelf in India, counted per SKU, sellable the same day an order comes in.',
      sayBn:
        'এরপর জিনিসটা ভারতের একটা তাকে থাকে, SKU ধরে ধরে গোনা, আর অর্ডার এলে সেদিনই বিক্রিযোগ্য।',
      sayHi:
        'इसके बाद माल भारत में एक शेल्फ़ पर रहता है, SKU के हिसाब से गिना हुआ, और ऑर्डर आने पर उसी दिन बिकने के लिए तैयार।',
    },
    {
      id: 'the-call',
      say: 'And every order is phoned before it ships. We ring your customer, record what was said, and only a yes reserves your stock and starts the parcel.',
      sayBn:
        'আর প্রতিটা অর্ডার পাঠানোর আগে ফোন করা হয়। আমরা আপনার ক্রেতাকে ফোন করি, কী কথা হলো তা লিখে রাখি, আর সে হ্যাঁ বললেই আপনার স্টক আটকে রাখা হয় আর পার্সেলের কাজ শুরু হয়।',
      sayHi:
        'और हर ऑर्डर भेजने से पहले फ़ोन किया जाता है। हम आपके ग्राहक को फ़ोन करते हैं, जो बात हुई उसे लिख लेते हैं, और उसकी हाँ पर ही आपका स्टॉक रोका जाता है और पार्सल का काम शुरू होता है।',
    },
    {
      id: 'the-parcel',
      say: 'Then it is picked, packed against a barcode scan, and handed to a courier with a waybill on it. If one courier refuses the parcel, another one takes it.',
      sayBn:
        'তারপর পণ্যটা তাক থেকে তোলা হয়, বারকোড স্ক্যান মিলিয়ে প্যাক করা হয়, আর গায়ে waybill লাগিয়ে একটা কুরিয়ারের হাতে দেওয়া হয়। একটা কুরিয়ার পার্সেল নিতে না চাইলে আরেকটা নেয়।',
      sayHi:
        'फिर माल शेल्फ़ से उठाया जाता है, बारकोड स्कैन से मिलाकर पैक होता है, और ऊपर waybill लगाकर एक कूरियर के हाथ में दिया जाता है। एक कूरियर पार्सल लेने से मना कर दे, तो दूसरा ले लेता है।',
    },
    {
      id: 'tracking',
      say: 'Every scan lands here, and on a page your customer can open themselves. A parcel that stops moving is flagged to us; one that comes back is counted piece by piece, and the good pieces go back on your shelf.',
      sayBn:
        'প্রতিটা স্ক্যান এখানে আসে, আর সঙ্গে এমন একটা পৃষ্ঠাতেও আসে যেটা আপনার ক্রেতা নিজেই খুলতে পারে। কোনো পার্সেল চলা বন্ধ করলে সেটা আমাদের নজরে আনা হয়; আর কোনোটা ফেরত এলে সেটা একটা একটা করে গোনা হয়, আর ভালো জিনিসগুলো আপনার তাকে ফিরে যায়।',
      sayHi:
        'हर स्कैन यहाँ आता है, और साथ ही एक ऐसे पेज पर भी जिसे आपका ग्राहक ख़ुद खोल सकता है। कोई पार्सल चलना बंद कर दे तो वह हमारे सामने उठाया जाता है; और कोई वापस आ जाए तो उसे एक-एक पीस गिना जाता है, और अच्छे पीस आपकी शेल्फ़ पर लौट जाते हैं।',
    },
    {
      id: 'money',
      say: 'The cash collected on delivery lands in your wallet, and the shipping is billed on its own line. Ask for a payout and it leaves for your own bank in Bangladesh, in taka.',
      sayBn:
        'ডেলিভারিতে আদায় করা নগদ টাকা আপনার ওয়ালেটে আসে, আর পাঠানোর খরচ আলাদা লাইনে বসে। টাকা তোলার অনুরোধ করলে সেটা বাংলাদেশে আপনার নিজের ব্যাংকে চলে যায়, টাকায়।',
      sayHi:
        'डिलीवरी पर वसूला गया नगद आपके wallet में आता है, और भेजने का ख़र्च अपनी अलग लाइन पर लगता है। पैसा निकालने की माँग करें और वह बांग्लादेश में आपके अपने बैंक को चला जाता है, टाका में।',
    },
    {
      id: 'invite',
      say: 'One warehouse, one phone call, one courier account, one balance. Skydrop is invite-only for now — ask for an invitation at skydrop.global.',
      sayBn:
        'একটা গুদাম, একটা ফোন কল, একটা কুরিয়ার অ্যাকাউন্ট, একটা ব্যালেন্স। Skydrop এখন শুধু আমন্ত্রণে চলে — skydrop.global-এ গিয়ে আমন্ত্রণ চেয়ে নিন।',
      sayHi:
        'एक गोदाम, एक फ़ोन कॉल, एक कूरियर अकाउंट, एक बैलेंस। Skydrop अभी सिर्फ़ न्योते पर चलता है — skydrop.global पर जाकर न्योता माँग लीजिए।',
    },
  ],
};

export const flow = {
  app: 'seller',

  /**
   * What the demo world has to hold for this to film.
   *
   * A promo has nowhere to hide an empty table. There is no narration
   * explaining that the list would have rows in real life, and a held
   * nine-second shot of an empty state is the failure that records
   * perfectly and is found only by watching it. So every scene names
   * the rows it needs.
   */
  seed: [
    'The demo seller (Rangpur Silk House) able to sign in, with a dashboard past its first-run state — recent orders and a wallet figure — so scene one opens on a business rather than on a setup checklist.',
    'At least two consignments on /inbound, one of them arrived with a COUNTED goods receipt, so "we count every piece in and tell you what arrived" has a counted row underneath it.',
    'Stock for at least four variants on /inventory with a non-zero available quantity: a register of zeroes says the opposite of the sentence over it.',
    'A first page of /orders spanning the lifecycle — something awaiting its call, something confirmed, something dispatched, something delivered, and at least one returned. The BREADTH is the scene.',
    'At least three parcels on /tracking carrying a waybill and a courier name, and the FIRST row having real scan history behind its History button (several tracking events, not one).',
    'One of those parcels returned, so the returns half of the tracking sentence is on screen as well as spoken.',
    'A wallet with a positive INR balance and a ledger showing COD credits and order charges on separate lines, plus one withdrawal request, so "ask for a payout" points at something real.',
  ],

  steps: [
    {
      /**
       * The dashboard, breathing.
       *
       * The narration carries this scene; the picture's job is to look
       * like a real console running a real business, which a slow glide
       * down and back says better than a static frame — it shows there
       * is more below the fold without taking the viewer anywhere.
       */
      id: 'problem',
      run: async ({ page, stage, baseUrl }) => {
        await page.goto(`${baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2400);
        await stage.glide(380);
        await page.waitForTimeout(1800);
        await stage.glide(-380);
      },
    },
    {
      /**
       * Add stock → the consignment register.
       *
       * Clicked from the nav rail rather than navigated by URL: this is
       * the first move of the video and it is worth one shot of
       * somebody actually using the app before every scene after it is
       * a held screen. `a[href=...]` rather than the link's words — the
       * rail's labels are the app's to change, the route is not.
       */
      id: 'stock-crosses',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/inbound"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/inbound', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(1800);
        await stage.dwellOn(page.locator('tbody tr').first(), 2800);
        await stage.glide(280);
      },
    },
    {
      /**
       * The stock register. One sentence, one screen, no gesture past a
       * glide — the claim is "it is there and it is counted", and the
       * table says that on its own.
       */
      id: 'on-the-shelf',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/inventory"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/inventory', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        await stage.glide(320);
        await page.waitForTimeout(1200);
      },
    },
    {
      /**
       * The orders list, read for its STATUS column.
       *
       * The call is the hardest thing to film — it happens on a phone,
       * in our building, with nobody's screen in shot — so the picture
       * is the thing the call produces: a column of orders at every
       * stage of the lifecycle. The dwell is on the first rows rather
       * than a single row, because the breadth is what carries it.
       */
      id: 'the-call',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/orders"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/orders', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        await stage.dwellOn(page.locator('tbody tr').first(), 2200);
        await stage.glide(300);
        await page.waitForTimeout(1400);
      },
    },
    {
      /**
       * The parcel register: waybills and courier names.
       *
       * Deliberately NOT one order's own timeline. A promo cannot
       * depend on which order happens to be first in the list, and an
       * order still waiting for its call has a timeline two rows long —
       * which would be a held shot of nothing under a sentence about
       * picking, packing and handing over.
       */
      id: 'the-parcel',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/tracking"]').first(), { after: 1200 });
        await page.waitForURL((u) => u.pathname === '/tracking', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        await stage.dwellOn(page.locator('tbody tr').first(), 3000);
      },
    },
    {
      /**
       * The same register with one parcel's history open.
       *
       * The History button is per row and carries no other name on the
       * page, so the first one is unambiguous. What expands is the
       * courier's own scans, which is exactly the claim: these are
       * their words arriving, not our summary of them.
       */
      id: 'tracking',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.getByRole('button', { name: /^History$/ }).first(), {
          after: 1600,
        });
        await page.waitForTimeout(1600);
        await stage.glide(420);
        await page.waitForTimeout(2000);
      },
    },
    {
      /**
       * The wallet. The ledger lines are the point — COD in, charges
       * out, on separate rows — so the glide goes far enough to reach
       * them rather than holding on the balance alone.
       */
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
       * Back to the dashboard for the close: the whole operation in one
       * view, which is what the last sentence is about. The final frame
       * of a promo is the one somebody screenshots, so it ends on the
       * screen that looks most like the thing being offered.
       */
      id: 'invite',
      run: async ({ page, stage }) => {
        await stage.clickIt(page.locator('a[href="/dashboard"]').first(), { after: 1400 });
        await page.waitForURL((u) => u.pathname === '/dashboard', { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2600);
      },
    },
  ],
};
