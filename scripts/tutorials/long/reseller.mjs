/**
 * THE LONG RESELLER VIDEO — one path through the store portal, about
 * nine minutes, for somebody who has just been invited into it.
 *
 * ── WHO IS WATCHING ──────────────────────────────────────────────────
 * A shopkeeper in India. They own no stock, carry no warehouse and work
 * for nobody: a Bangladeshi seller has invited them to sell that
 * seller's goods under their own name. They are not Skydrop staff and
 * not the seller's employee, which is why the whole thing is filmed as
 * Anjali Deshpande of Pune Silk Studio (`app: 'reseller'`) and never as
 * the seller looking at a store. A store user cannot see unit cost, how
 * much stock there really is, the share held back from their catalogue,
 * or that any other store exists — filming this as the seller would
 * quietly show a shopkeeper the figures the reseller boundary exists to
 * withhold.
 *
 * ── THE SPINE ────────────────────────────────────────────────────────
 * What a reseller store is · the invitation and the login · THE TERMS ·
 * the catalogue · placing an order, singly and by CSV · following one,
 * and the seven things to do when it goes wrong · the wallet ·
 * associates · reports.
 *
 * The terms get four scenes and no apology. Every other screen here is
 * reversible; the terms decide whether an order makes money, they bind
 * every order placed after them, and each order records the version it
 * was placed under — so the one moment to read them is before
 * accepting, and this is the only video that will ever say so.
 *
 * Cut to one line each in `rest`, with a short video named: the store's
 * own expense book, the month-by-month analysis, team roles, keys and
 * webhooks, notification settings, and taking a dispute with the seller
 * through to a settlement (R10, R12, R14, R16, R17, R18 in the
 * curriculum).
 *
 * ── TWO THINGS THE FLOW DOES NOT DO, EACH ON PURPOSE ─────────────────
 * It fills the two MONEY forms and stops at the confirmation rather
 * than sending. A withdrawal request is an obligation on Skydrop and a
 * top-up claim is a row an operator then has to clear; creating one on
 * every take would leave litter the admin money videos then film. The
 * top-up's own confirm dialog is the teaching moment anyway — it reads
 * back the account, the amount and "nothing is credited until Skydrop
 * sees the money" — so the scene loses nothing by ending there. Same
 * shape as R3's `prepaid` step, which films the choice and places the
 * order on COD.
 *
 * It never sends a DELIVERY ask either. Those three turn a van round or
 * queue a real call at the seller's cost; the dialog states which of
 * them happens at once and which waits for the seller, in the app's own
 * words, which is the whole lesson. The one request this video really
 * sends is the CANCEL on the order it placed itself a minute earlier —
 * cancel is `ASK_SELLER` for this store, so it becomes a request the
 * seller answers and nothing is actually cancelled, which is exactly
 * the loop being taught and costs nothing to re-take.
 *
 * ── SELECTOR NOTES ───────────────────────────────────────────────────
 * The three rules `flows.mjs` records above section R all apply here:
 * `AsyncButton` holds all four phase labels in the DOM at once with the
 * accessible name pinned to the idle one, so `role` + name is the only
 * reach that works; every confirm dialog reuses its page button's
 * label, so every confirm is scoped through `getByRole('dialog')`; and
 * the status tabs and the status `<select>` carry the same words, so
 * tabs go by `role: 'tab'`.
 *
 * ONE CORRECTION TO SECTION R's OWN FLOWS, worth knowing before a
 * re-take of any of them: they reach for `.sk-ph__sub` for a page
 * subtitle, and that class exists NOWHERE in the repository —
 * `PageHeader` renders `.sk-ph__subtitle`
 * (`packages/ui/src/app/page-header`). `stage.dwellOn` calls
 * `scrollIntoViewIfNeeded` first, which THROWS on a locator matching
 * nothing rather than degrading, so those steps die rather than quietly
 * hold on the wrong thing. Day 1 has not been filmed, so nobody has met
 * it yet; this file uses the real class, through `subtitle()`.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { GENERATED_DIR } from '../lib/paths.mjs';

/**
 * The customer this video sells to, on camera.
 *
 * NOT `STORE_ORDER` from `flows.mjs` — R5 searches for that phone and
 * narrates finding one order by it, so a second order carrying the same
 * number would make that video's search ambiguous. The retail sits
 * inside Pune Silk Studio's agreed range for the jamdani
 * (₹2,400–₹3,200): the scene before has just taught that outside the
 * range an order is refused, so placing one outside it here would film
 * the refusal under narration about placing an order.
 */
/**
 * WHAT this store sells on camera, and why it is named rather than
 * taken by position.
 *
 * The retail below must sit inside the range the seller agreed for THIS
 * product (RS-5 refuses anything else), so the product and the price are
 * one decision and belong next to each other.
 */
const SELLING = {
  sku: 'RSH-JKURTI-ROSE-M',
  /** The seller's agreed window for it, for the reader: ₹2,300–₹3,000. */
  range: { min: 2300, max: 3000 },
};

const CUSTOMER = {
  name: 'Meera Kulkarni',
  phone: '+919822061174',
  pin: '411004',
  line1: '14 Prabhat Road, Lane 5',
  landmark: 'Opposite the Chitale sweet shop',
  retail: '2950',
};

/**
 * The live parcel this video acts on, found BY ITS CUSTOMER'S PHONE —
 * the last ten digits, which is what somebody types.
 *
 * It is `STORE_REQUEST_ORDERS.delivery` in the seed: a store parcel
 * driven out for delivery with one send-back ask already waiting on
 * seller staff, which is what makes both the three-ask panel and the
 * "sent to your seller" history real rather than empty. The list is
 * ordered `placedAt: 'desc'`, so `.first()` on the search result is the
 * live one even after a previous take spent an older parcel for the
 * same customer.
 */
const LIVE_PARCEL_PHONE = '9845070033';

/**
 * The CSV this video uploads, WRITTEN PER RUN by the seed.
 *
 * Deliberately not `fixtures/pune-store-bulk-orders.csv`, which R4
 * uploads: its `External Ref` values are constants, and a repeated
 * reference from a STORE is an error row rather than a patch (ORD-9 for
 * stores) — so that file imports four orders exactly once and three
 * error rows on every take after. A generated file is the
 * `GENERATED_DIR` case the courier remittance export already is: its
 * contents are this run's, and nothing in the narration names a
 * reference.
 */
const BULK_CSV = path.join(GENERATED_DIR, 'reseller-long-bulk-orders.csv');

/** Who is invited as an associate on camera. The seed clears the invitation. */
const INVITEE = { name: 'Kiran Pawar', email: 'kiran.pawar@punesilkstudio.test' };

/** What is typed into the two money forms. Neither is sent — see the header. */
const TOPUP = { amount: '20000', reference: 'HDFC-PSS-77301' };
const WITHDRAW_AMOUNT = '5000';

export const narration = {
  slug: 'reseller-everything',
  title: 'Selling a seller’s stock under your own name',
  subtitle: 'Skydrop for reseller stores',
  steps: [
    {
      id: 'intro',
      say: 'A reseller store sells somebody else’s stock under its own name. Your seller holds the goods in our Indian warehouse; we ring the customer, pack the parcel and send it. You set the price, and the difference is yours.',
      sayBn:
        'একটা reseller store অন্য কারও স্টক নিজের নামে বিক্রি করে। আপনার বিক্রেতা পণ্য রাখে আমাদের ভারতের গুদামে; আমরা ক্রেতাকে ফোন করি, পার্সেল প্যাক করি আর পাঠিয়ে দিই। দাম আপনি ঠিক করেন, আর পার্থক্যটা আপনার।',
      sayHi:
        'एक reseller store किसी और का स्टॉक अपने नाम से बेचता है। आपका विक्रेता माल भारत में हमारे गोदाम में रखता है; हम ग्राहक को फ़ोन करते हैं, पार्सल पैक करते हैं और भेज देते हैं। कीमत आप तय करते हैं, और फ़र्क़ आपका।',
    },
    {
      id: 'invitation',
      say: 'You cannot sign yourself up. Your seller invites you by email and the link sets your password once. Nor is this the seller’s own app — that line at the bottom is where a seller signs in.',
      sayBn:
        'আপনি নিজে থেকে সাইন আপ করতে পারবেন না। আপনার বিক্রেতা আপনাকে ইমেইলে আমন্ত্রণ পাঠায়, আর ওই লিংক দিয়ে একবারই পাসওয়ার্ড বসানো হয়। এটা বিক্রেতার নিজের অ্যাপও নয় — নিচের ওই লাইনটাই বিক্রেতার সাইন ইনের জায়গা।',
      sayHi:
        'आप ख़ुद से sign up नहीं कर सकते। आपका विक्रेता आपको ईमेल पर न्योता भेजता है, और उस लिंक से एक ही बार password बैठाया जाता है। यह विक्रेता का अपना ऐप भी नहीं है — नीचे की वह लाइन ही विक्रेता के sign in की जगह है।',
    },
    {
      id: 'sign-in',
      say: 'Sign in with the address the invitation went to. Five wrong tries in fifteen minutes and the form stops answering.',
      sayBn:
        'আমন্ত্রণ যে ইমেইল ঠিকানায় গিয়েছিল, সেটা দিয়েই সাইন ইন করুন। পনেরো মিনিটে পাঁচবার ভুল করলে ফর্মটা আর উত্তর দেওয়া বন্ধ করে দেয়।',
      sayHi:
        'न्योता जिस ईमेल पते पर गया था, उसी से sign in करें। पंद्रह मिनट में पाँच बार ग़लत करने पर फ़ॉर्म जवाब देना बंद कर देता है।',
    },
    {
      id: 'dashboard',
      say: 'The heading is your shop’s name as your customers see it, and under it who you resell for. No other store can see you, and you cannot see them.',
      sayBn:
        'উপরের শিরোনামটা আপনার দোকানের নাম — ক্রেতারা যে নামে আপনাকে চেনে — আর তার নিচে আপনি কার হয়ে বিক্রি করছেন। অন্য কোনো store আপনাকে দেখতে পায় না, আপনিও তাদের দেখতে পান না।',
      sayHi:
        'ऊपर का शीर्षक आपकी दुकान का नाम है — जिस नाम से ग्राहक आपको जानते हैं — और उसके नीचे यह कि आप किसके लिए बेच रहे हैं। कोई दूसरा store आपको नहीं देख सकता, और आप उन्हें नहीं देख सकते।',
    },
    {
      id: 'nav',
      say: 'Down the left, in the order you will want them: orders, the customers we could not reach, your customers, your catalogue, your sales people, your terms, your wallet, reports and tickets.',
      sayBn:
        'বাঁ দিকে, যে ক্রমে আপনার দরকার পড়বে সেই ক্রমেই: Orders, Unreachable customers, Customers, Catalogue, Associates, Terms, Wallet, Reports আর Tickets।',
      sayHi:
        'बाईं तरफ़, उसी क्रम में जिस क्रम में आपको ज़रूरत पड़ेगी: Orders, Unreachable customers, Customers, Catalogue, Associates, Terms, Wallet, Reports और Tickets।',
    },
    {
      id: 'terms-why',
      say: 'Start here, before selling anything. The terms are what your seller and Skydrop agreed about your store: which of Skydrop’s fees you pay, and when each of you is credited.',
      sayBn:
        'কিছু বিক্রি করার আগে এখান থেকেই শুরু করুন। Terms হলো আপনার দোকান নিয়ে আপনার বিক্রেতা আর Skydrop যা ঠিক করেছে: Skydrop-এর কোন কোন চার্জ আপনি দেবেন, আর আপনাদের দুজনের কে কখন টাকা পাবেন।',
      sayHi:
        'कुछ बेचने से पहले यहीं से शुरू करें। Terms वह है जो आपकी दुकान के बारे में आपके विक्रेता और Skydrop ने तय किया है: Skydrop के कौन-कौन से शुल्क आप देंगे, और आप दोनों में से किसको कब पैसा मिलेगा।',
    },
    {
      id: 'terms-fees',
      say: 'Who pays which fee, in words. Six of them: delivery, a return, a return the customer caused, cash handling, the tax taken off cash collected, and instant pay. Whatever share you carry, your seller carries the rest.',
      sayBn:
        'কোন চার্জ কে দেয়, কথায় লেখা। ছয়টা: ডেলিভারি চার্জ, ফেরত, ক্রেতার কারণে ফেরত, নগদ টাকা হাতে নেওয়ার চার্জ, আদায় করা নগদ থেকে কাটা কর, আর instant pay। আপনি যতটুকু ভাগ বহন করেন, বাকিটা আপনার বিক্রেতা বহন করে।',
      sayHi:
        'कौन-सा शुल्क कौन देता है, शब्दों में लिखा हुआ। छह हैं: डिलीवरी शुल्क, वापसी, ग्राहक की वजह से वापसी, नगद सँभालने का शुल्क, वसूले गए नगद से कटने वाला टैक्स, और instant pay। आप जितना हिस्सा उठाते हैं, बाकी आपका विक्रेता उठाता है।',
    },
    {
      id: 'terms-credit',
      say: 'And when the money reaches each of you: at delivery, a set number of days after it, a set number of days after the courier pays Skydrop, or once the customer confirms the order on our call.',
      sayBn:
        'আর টাকা কখন কার কাছে পৌঁছাবে: ডেলিভারির সময়, ডেলিভারির নির্দিষ্ট কিছু দিন পরে, কুরিয়ার Skydrop-কে টাকা দেওয়ার নির্দিষ্ট কিছু দিন পরে, নাকি আমাদের কলে ক্রেতা অর্ডারটা নিশ্চিত করার সঙ্গে সঙ্গে।',
      sayHi:
        'और पैसा आप दोनों तक कब पहुँचेगा: डिलीवरी के वक़्त, उसके तय कुछ दिन बाद, कूरियर Skydrop को पैसा देने के तय कुछ दिन बाद, या हमारी कॉल पर ग्राहक ऑर्डर पक्का करते ही।',
    },
    {
      id: 'terms-accepted',
      say: 'This version names who accepted it and when, and that is what binds it: every order after is priced this way, and each records the version it was placed under. A change is a new version, and you place no orders until it is accepted.',
      sayBn:
        'এই version-এ লেখা আছে কে এটা মেনে নিয়েছে আর কখন, আর ওই মেনে নেওয়াটাই এটাকে বাঁধে: এর পরের প্রতিটা অর্ডারের দাম এভাবেই হিসাব হয়, আর প্রতিটা অর্ডার লিখে রাখে সে কোন version-এর অধীনে বসেছিল। বদল মানে নতুন একটা version, আর সেটা মেনে না নেওয়া পর্যন্ত আপনি কোনো অর্ডার দিতে পারবেন না।',
      sayHi:
        'इस version में लिखा है कि इसे किसने माना और कब, और वही इसे बाँधता है: इसके बाद के हर ऑर्डर की कीमत इसी तरह लगती है, और हर ऑर्डर लिख रखता है कि वह किस version के तहत डला था। बदलाव का मतलब एक नया version, और उसे मान लेने तक आप कोई ऑर्डर नहीं डाल सकते।',
    },
    {
      id: 'catalogue',
      say: 'Your catalogue is the list your seller lets you sell from. You do not choose what is on it; a product they have not enabled is not here at all.',
      sayBn:
        'আপনার Catalogue হলো সেই তালিকা, যেখান থেকে আপনার বিক্রেতা আপনাকে বিক্রি করতে দেয়। এতে কী থাকবে সেটা আপনি বাছেন না; তারা যে পণ্য চালু করেনি, সেটা এখানে একদমই নেই।',
      sayHi:
        'आपका Catalogue वह लिस्ट है, जिसमें से आपका विक्रेता आपको बेचने देता है। इसमें क्या रहेगा यह आप नहीं चुनते; जो प्रोडक्ट उन्होंने चालू नहीं किया, वह यहाँ है ही नहीं।',
    },
    {
      id: 'you-pay',
      say: 'Four figures a product. The first is what you pay the seller per unit — the transfer price, set for your store, out of what you collect.',
      sayBn:
        'প্রতিটা পণ্যের জন্য চারটা সংখ্যা। প্রথমটা হলো প্রতি ইউনিটে আপনি বিক্রেতাকে কত দেবেন — You pay, অর্থাৎ আপনার দোকানের জন্য ঠিক করা transfer price, আপনি যা আদায় করবেন তার ভিতর থেকেই।',
      sayHi:
        'हर प्रोडक्ट के लिए चार आँकड़े। पहला यह कि हर यूनिट पर आप विक्रेता को कितना देंगे — You pay, यानी आपकी दुकान के लिए तय किया गया transfer price, आप जो वसूलेंगे उसी के अंदर से।',
    },
    {
      id: 'range',
      say: 'Then the range you may sell inside. The bottom protects your seller’s price, the top protects the brand, and an order outside it is refused as you place it rather than weeks later.',
      sayBn:
        'তারপর যে সীমার ভিতরে আপনি বিক্রি করতে পারবেন। নিচের সীমা আপনার বিক্রেতার দাম বাঁচায়, উপরের সীমা ব্র্যান্ড বাঁচায়, আর সীমার বাইরের কোনো অর্ডার কয়েক সপ্তাহ পরে নয়, অর্ডার দেওয়ার সময়েই বাতিল হয়।',
      sayHi:
        'फिर वह हद, जिसके अंदर आप बेच सकते हैं। नीचे की हद आपके विक्रेता की कीमत बचाती है, ऊपर की हद ब्रांड बचाती है, और हद के बाहर का ऑर्डर कुछ हफ़्ते बाद नहीं, डालते ही ख़ारिज हो जाता है।',
    },
    {
      id: 'stock',
      say: 'And how many you can sell today, out of the real warehouse. What is NOT here is as deliberate: not what the goods cost your seller, not how much stock there really is.',
      sayBn:
        'আর আজ আপনি কতগুলো বিক্রি করতে পারবেন, সত্যিকারের গুদাম থেকে। এখানে যা নেই, সেটাও ইচ্ছে করেই নেই: পণ্যটা আপনার বিক্রেতার কত খরচে কেনা, আর গুদামে আসলে কত স্টক আছে — দুটোই নেই।',
      sayHi:
        'और आज आप कितने बेच सकते हैं, असली गोदाम में से। यहाँ जो नहीं है, वह भी जान-बूझकर नहीं है: माल आपके विक्रेता को कितने में पड़ा, और गोदाम में असल में कितना स्टॉक है — दोनों नहीं हैं।',
    },
    {
      id: 'product',
      say: 'Now an order from one of your own customers: what they buy, where it goes, how they pay. The picker is your catalogue and nothing else, and a product with none available cannot be chosen.',
      sayBn:
        'এবার আপনার নিজের একজন ক্রেতার কাছ থেকে একটা অর্ডার: সে কী কিনছে, জিনিসটা কোথায় যাবে, কীভাবে টাকা দেবে। পণ্য বাছার তালিকাটা শুধু আপনার Catalogue, এর বাইরে কিছু নয়, আর যে পণ্যের একটাও মজুত নেই সেটা বাছাই করা যায় না।',
      sayHi:
        'अब आपके अपने एक ग्राहक का ऑर्डर: वह क्या ख़रीद रहा है, चीज़ कहाँ जाएगी, पैसा कैसे देगा। प्रोडक्ट चुनने की लिस्ट सिर्फ़ आपका Catalogue है, इसके बाहर कुछ नहीं, और जिस प्रोडक्ट का एक भी मौजूद नहीं, उसे चुना नहीं जा सकता।',
    },
    {
      id: 'retail',
      say: 'Under the line it repeats what you pay and how many are left, because that is the decision. Then what the customer pays: inside the range, and the difference less your fee share is your margin.',
      sayBn:
        'লাইনের নিচে আবার দেখানো হয় আপনি কত দেবেন আর কতগুলো বাকি আছে, কারণ সিদ্ধান্তটা ওটাই। তারপর ক্রেতা কত দেবে: সীমার ভিতরে, আর পার্থক্য থেকে আপনার চার্জের ভাগ বাদ দিলে যা থাকে সেটাই আপনার মুনাফা।',
      sayHi:
        'लाइन के नीचे फिर दिखाया जाता है कि आप कितना देंगे और कितने बचे हैं, क्योंकि फ़ैसला यही है। फिर यह कि ग्राहक कितना देगा: हद के अंदर, और उस फ़र्क़ में से शुल्क का आपका हिस्सा निकाल दें तो जो बचे वही आपका मुनाफ़ा।',
    },
    {
      id: 'customer',
      say: 'Who it goes to. The phone is what our call centre rings to confirm the order, so a wrong digit is a parcel that never ships. The PIN is what the courier routes on. And the second line is the landmark, required, because it decides whether a driver finds the door.',
      sayBn:
        'কার কাছে যাবে। অর্ডার নিশ্চিত করতে আমাদের কল সেন্টার এই ফোন নম্বরেই ফোন করে, তাই একটা অঙ্ক ভুল হলে পার্সেলটা কখনোই যাবে না। PIN code দেখেই কুরিয়ার পথ ঠিক করে। আর দ্বিতীয় লাইনটা ল্যান্ডমার্ক, এটা দিতেই হবে, কারণ ড্রাইভার দরজা খুঁজে পাবে কি না সেটা এটাই ঠিক করে।',
      sayHi:
        'किसके पास जाएगा। ऑर्डर पक्का करने के लिए हमारा call centre इसी फ़ोन नंबर पर फ़ोन करता है, इसलिए एक अंक ग़लत हो तो पार्सल कभी जाएगा ही नहीं। PIN code देखकर ही कूरियर रास्ता तय करता है। और दूसरी लाइन लैंडमार्क है, जो देनी ज़रूरी है, क्योंकि ड्राइवर दरवाज़ा ढूँढ पाएगा या नहीं यह वही तय करती है।',
    },
    {
      id: 'payment',
      say: 'Cash on delivery is the ordinary one, and the courier collects the retail you set. Prepaid means the customer has already paid you, so the goods come out of your wallet — and a balance that cannot cover it is refused.',
      sayBn:
        'Cash on delivery-ই সাধারণ নিয়ম, আর আপনি যে দাম ঠিক করেছেন কুরিয়ার সেটাই আদায় করে। Prepaid মানে ক্রেতা আপনাকে আগেই টাকা দিয়ে দিয়েছে, তাই পণ্যের দাম আপনার Wallet থেকে কাটা হয় — আর ব্যালেন্সে না কুলালে অর্ডারটা বাতিল হয়।',
      sayHi:
        'Cash on delivery ही आम तरीका है, और आपने जो कीमत तय की है कूरियर वही वसूलता है। Prepaid का मतलब है ग्राहक ने आपको पहले ही पैसा दे दिया है, इसलिए माल की कीमत आपके Wallet से कटती है — और बैलेंस में न पूरा पड़े तो ऑर्डर ख़ारिज हो जाता है।',
    },
    {
      id: 'placed',
      say: 'Confirm, and it exists: your reference and a Skydrop number to quote to us. From here the call centre rings, the warehouse picks it out of your seller’s stock, and a courier takes it.',
      sayBn:
        'Place order চাপলেই অর্ডারটা তৈরি: আপনার নিজের reference, আর আমাদের বলার জন্য একটা Skydrop নম্বর। এখান থেকে কল সেন্টার ফোন করে, গুদাম আপনার বিক্রেতার স্টক থেকে পণ্যটা তোলে, আর একটা কুরিয়ার সেটা নিয়ে যায়।',
      sayHi:
        'Place order दबाते ही ऑर्डर बन जाता है: आपका अपना reference, और हमें बताने के लिए एक Skydrop नंबर। यहाँ से call centre फ़ोन करता है, गोदाम आपके विक्रेता के स्टॉक से माल उठाता है, और एक कूरियर उसे ले जाता है।',
    },
    {
      id: 'bulk',
      say: 'A day’s worth at once. Use the template, because columns are matched by name. One row is one line, so an order with two products is two rows sharing your reference.',
      sayBn:
        'একদিনের সব অর্ডার একসঙ্গে। template-টা ব্যবহার করুন, কারণ কলাম মেলানো হয় নাম দেখে। একটা সারি মানে একটা লাইন, তাই দুটো পণ্যের একটা অর্ডার মানে একই reference-ওয়ালা দুটো সারি।',
      sayHi:
        'एक दिन के सारे ऑर्डर एक साथ। template इस्तेमाल करें, क्योंकि कॉलम नाम देखकर मिलाए जाते हैं। एक row का मतलब एक लाइन, इसलिए दो प्रोडक्ट वाले ऑर्डर का मतलब एक ही reference वाली दो row।',
    },
    {
      id: 'bulk-check',
      say: 'Upload, and it is checked before anything is created: how many orders your rows make, and which will not import, with the reason. One here is under the seller’s minimum. Nothing is placed yet.',
      sayBn:
        'আপলোড করলে কিছু তৈরি হওয়ার আগেই ফাইলটা পরীক্ষা করা হয়: আপনার সারিগুলো মিলে কতগুলো অর্ডার হয়, আর কোনটা import হবে না, কারণসহ। এখানে একটা সারি বিক্রেতার সবচেয়ে কম দামের নিচে পড়েছে। এখনো কোনো অর্ডার বসেনি।',
      sayHi:
        'अपलोड करने पर कुछ बनने से पहले ही फ़ाइल जाँची जाती है: आपकी row मिलकर कितने ऑर्डर बनाती हैं, और कौन-सी import नहीं होगी, कारण के साथ। यहाँ एक row विक्रेता की सबसे कम कीमत से नीचे पड़ गई है। अभी कोई ऑर्डर डला नहीं है।',
    },
    {
      id: 'bulk-import',
      say: 'Import, and it runs in the background. Every upload is listed with what went through and what did not, and the failures come back as a file to correct and send again.',
      sayBn:
        'Import করলে কাজটা পিছনে চলতে থাকে। প্রতিটা আপলোড তালিকায় থাকে — কোনটা হয়েছে আর কোনটা হয়নি — আর যেগুলো হয়নি সেগুলো একটা ফাইল হয়ে ফিরে আসে, ঠিক করে আবার পাঠানোর জন্য।',
      sayHi:
        'Import करने पर काम पीछे चलता रहता है। हर अपलोड लिस्ट में रहता है — क्या हो गया और क्या नहीं — और जो नहीं हुईं वे एक फ़ाइल बनकर लौट आती हैं, ठीक करके फिर भेजने के लिए।',
    },
    {
      id: 'orders-list',
      say: 'Everything your store has sold, newest first. The tabs are the stages an order passes through, each with its count, and the filter lives in the address. Search takes whatever the customer gives you.',
      sayBn:
        'আপনার দোকান যা যা বিক্রি করেছে সব, নতুনটা আগে। উপরের tab-গুলো হলো অর্ডারের ধাপ, প্রতিটার পাশে তার সংখ্যা, আর ফিল্টারটা ঠিকানার মধ্যেই থাকে। ক্রেতা আপনাকে যা-ই দিক, সার্চে সেটাই চলে।',
      sayHi:
        'आपकी दुकान ने जो-जो बेचा है सब, नया पहले। ऊपर के tab ऑर्डर के पड़ाव हैं, हर एक के साथ उसकी गिनती, और filter पते में ही रहता है। ग्राहक आपको जो भी दे, search में वही चलता है।',
    },
    {
      id: 'order-read',
      say: 'One order, top to bottom: the customer as they were when it was placed, the money in one place — collected, sold at, paid to the seller — and the products line by line.',
      sayBn:
        'একটা অর্ডার, উপর থেকে নিচ পর্যন্ত: অর্ডার দেওয়ার সময় ক্রেতা যেমন ছিল ঠিক তেমন, টাকার সব হিসাব এক জায়গায় — কত আদায় হলো, কত দামে বিক্রি হলো, বিক্রেতাকে কত দেওয়া হলো — আর পণ্যগুলো লাইনে লাইনে।',
      sayHi:
        'एक ऑर्डर, ऊपर से नीचे तक: ऑर्डर डालते वक़्त ग्राहक जैसा था ठीक वैसा, पैसे का सारा हिसाब एक जगह — कितना वसूला, किस कीमत पर बिका, विक्रेता को कितना गया — और प्रोडक्ट एक-एक लाइन में।',
    },
    {
      id: 'order-earns',
      say: 'Then what it earns you, worked out rather than guessed, with a word for where the money is. Waiting means the order is not finished; due means owed and timed; credited means already in your wallet.',
      sayBn:
        'তারপর এতে আপনার কত আয় হলো — অনুমান নয়, হিসাব করা — আর সঙ্গে একটা শব্দে টাকাটা কোথায় আছে। Waiting মানে অর্ডারটা এখনো শেষ হয়নি; due মানে পাওনা হয়ে গেছে আর সময়ও ঠিক আছে; credited মানে টাকা আপনার Wallet-এ চলে এসেছে।',
      sayHi:
        'फिर इससे आपकी कितनी कमाई हुई — अंदाज़ा नहीं, हिसाब लगाकर — और साथ में एक शब्द में यह कि पैसा कहाँ है। Waiting का मतलब ऑर्डर अभी ख़त्म नहीं हुआ; due का मतलब पैसा बनता है और वक़्त भी तय है; credited का मतलब पैसा आपके Wallet में पहुँच चुका है।',
    },
    {
      id: 'order-timeline',
      say: 'And the courier’s own scans as they arrive. It is what the driver’s app has, which is what makes it safe to read out to a customer who has rung.',
      sayBn:
        'আর কুরিয়ারের নিজের স্ক্যান, যেমন যেমন আসে। ড্রাইভারের অ্যাপে যা আছে এখানেও তাই, আর তাই কোনো ক্রেতা ফোন করলে এটা তাকে পড়ে শোনানো নিরাপদ।',
      sayHi:
        'और कूरियर के अपने स्कैन, जैसे-जैसे आते हैं। ड्राइवर के ऐप में जो है वही यहाँ भी है, और इसी वजह से कोई ग्राहक फ़ोन करे तो उसे यह पढ़कर सुनाना सुरक्षित है।',
    },
    {
      id: 'wrong-intro',
      say: 'Now the part to be clear about. When something goes wrong there are seven things you can ask for, and your seller decides, task by task, whether you do each yourself or whether they see it first.',
      sayBn:
        'এবার যে অংশটা পরিষ্কার থাকা দরকার। কিছু ভুল হলে আপনি সাতটা জিনিস চাইতে পারেন, আর আপনার বিক্রেতা কাজ ধরে ধরে ঠিক করে দেয় — কোনটা আপনি নিজে করবেন, আর কোনটা আগে তারা দেখবে।',
      sayHi:
        'अब वह हिस्सा जिस पर साफ़ रहना ज़रूरी है। कुछ ग़लत हो जाए तो आप सात चीज़ें माँग सकते हैं, और आपका विक्रेता काम-दर-काम तय करता है — कौन-सा आप ख़ुद करेंगे, और कौन-सा पहले वे देखेंगे।',
    },
    {
      id: 'delivery-asks',
      say: 'On a parcel out for delivery, or one whose delivery has failed, three of them: ring the customer again, ask for another attempt, or send it back. A lightning mark happens as you ask; a clock goes to your seller, and nothing moves until they answer.',
      sayBn:
        'Out for delivery অবস্থায় থাকা কোনো পার্সেলে, বা যার Delivery failed হয়েছে, তার মধ্যে তিনটা: ক্রেতাকে আবার ফোন করানো, আরেকবার ডেলিভারির চেষ্টা চাওয়া, বা জিনিসটা ফেরত পাঠানো। বিদ্যুতের চিহ্ন মানে আপনি চাওয়ার সঙ্গে সঙ্গেই কাজটা হয়ে যায়; ঘড়ির চিহ্ন মানে অনুরোধটা আপনার বিক্রেতার কাছে যায়, আর তারা উত্তর না দেওয়া পর্যন্ত কিছুই এগোয় না।',
      sayHi:
        'Out for delivery हालत में पड़े किसी पार्सल पर, या जिसकी Delivery failed हो गई है, उनमें से तीन: ग्राहक को फिर फ़ोन कराना, एक बार और डिलीवरी की कोशिश माँगना, या चीज़ वापस भेजना। बिजली का निशान मतलब आप माँगते ही काम हो जाता है; घड़ी का निशान मतलब माँग आपके विक्रेता के पास जाती है, और उनके जवाब देने तक कुछ भी आगे नहीं बढ़ता।',
    },
    {
      id: 'ask-dialog',
      say: 'Open one and it says which of the two it is before you send. What you type is read by whoever acts on it — the agent who rings, or the seller deciding — so write what changed.',
      sayBn:
        'একটা খুললে পাঠানোর আগেই এটা বলে দেয় দুটোর মধ্যে কোনটা হবে। আপনি যা লিখবেন সেটা পড়বে যে কাজটা করবে — যে এজেন্ট ফোন করবে, বা যে বিক্রেতা সিদ্ধান্ত নেবে — তাই কী বদলেছে সেটাই লিখুন।',
      sayHi:
        'कोई एक खोलें तो भेजने से पहले ही वह बता देता है कि दोनों में से कौन-सा होगा। आप जो लिखेंगे उसे वही पढ़ेगा जो काम करेगा — फ़ोन करने वाला agent, या फ़ैसला लेने वाला विक्रेता — इसलिए यही लिखें कि क्या बदला।',
    },
    {
      id: 'asked-before',
      say: 'Everything you have asked on this order, and where each got to: waiting, done, declined in their own words, or never answered, which closes after a few days and is then yours to chase.',
      sayBn:
        'এই অর্ডারে আপনি যা যা চেয়েছেন সব, আর প্রতিটা কোন অবস্থায় আছে: অপেক্ষায়, হয়ে গেছে, তাদের নিজের ভাষায় না করে দেওয়া হয়েছে, নাকি উত্তরই আসেনি — শেষটা কয়েক দিন পরে নিজেই বন্ধ হয়ে যায়, আর তারপর খোঁজ করা আপনার কাজ।',
      sayHi:
        'इस ऑर्डर पर आपने जो-जो माँगा है सब, और हर एक कहाँ तक पहुँचा: इंतज़ार में, हो गया, उनके अपने शब्दों में मना कर दिया गया, या जवाब ही नहीं आया — आख़िरी वाला कुछ दिन बाद ख़ुद बंद हो जाता है, और उसके बाद पीछे पड़ना आपका काम है।',
    },
    {
      id: 'chase',
      say: 'Two conversations. Wrong goods or an unexpected price goes to your seller. Damaged, lost or stuck with Skydrop goes to Skydrop. Both become a ticket with a number.',
      sayBn:
        'দুটো আলাদা আলাপ। ভুল পণ্য বা হিসাবের বাইরের দাম যায় আপনার বিক্রেতার কাছে। ভাঙা, হারিয়ে যাওয়া, বা Skydrop-এর কাছে আটকে থাকা জিনিস যায় Skydrop-এর কাছে। দুটোই নম্বরসহ একটা ticket হয়ে যায়।',
      sayHi:
        'दो अलग बातचीत। ग़लत माल या हिसाब से बाहर की कीमत जाती है आपके विक्रेता के पास। टूटा हुआ, खोया हुआ, या Skydrop के पास अटका हुआ माल जाता है Skydrop के पास। दोनों नंबर के साथ एक ticket बन जाते हैं।',
    },
    {
      id: 'change-order',
      say: 'Back on the order placed a minute ago, which nobody has confirmed. Until the customer confirms it you can change what is in it — products, quantities, price, their details. After that the contents stand and only the address can move.',
      sayBn:
        'এক মিনিট আগে দেওয়া অর্ডারটায় ফিরি, যেটা এখনো কেউ নিশ্চিত করেনি। ক্রেতা নিশ্চিত না করা পর্যন্ত এর ভিতরে কী আছে তা আপনি বদলাতে পারবেন — পণ্য, সংখ্যা, দাম, ক্রেতার তথ্য। তারপর ভিতরের জিনিস আর বদলায় না, শুধু ঠিকানাটা বদলানো যায়।',
      sayHi:
        'एक मिनट पहले डाले उस ऑर्डर पर लौटें, जिसे अभी किसी ने पक्का नहीं किया। ग्राहक के पक्का करने तक आप उसके अंदर की चीज़ें बदल सकते हैं — प्रोडक्ट, गिनती, कीमत, ग्राहक की जानकारी। उसके बाद अंदर की चीज़ें वैसी ही रहती हैं, सिर्फ़ पता बदल सकता है।',
    },
    {
      id: 'call-it-off',
      say: 'And calling it off, which works until the parcel is packed. Here the seller sees it first, so a reason is required and nothing is cancelled until they say yes.',
      sayBn:
        'আর অর্ডার বাতিল করা, যেটা পার্সেল প্যাক হওয়া পর্যন্ত করা যায়। এখানে বিক্রেতা আগে দেখে, তাই একটা কারণ লিখতেই হবে, আর তারা রাজি না হওয়া পর্যন্ত কিছুই বাতিল হয় না।',
      sayHi:
        'और ऑर्डर रद्द करना, जो पार्सल पैक होने तक हो सकता है। यहाँ विक्रेता पहले देखता है, इसलिए एक कारण लिखना ज़रूरी है, और उनकी हाँ मिलने तक कुछ भी रद्द नहीं होता।',
    },
    {
      id: 'wallet',
      say: 'The wallet is the ledger between you and Skydrop: your balance, what you could withdraw today, and how far below zero your seller lets it go — which is them extending you credit.',
      sayBn:
        'Wallet হলো আপনার আর Skydrop-এর মাঝের হিসাবের খাতা: আপনার ওয়ালেট ব্যালেন্স, আজ আপনি কত টাকা তুলতে পারবেন, আর আপনার বিক্রেতা শূন্যের কত নিচে পর্যন্ত যেতে দেয় — এটাই তাদের দেওয়া ধার।',
      sayHi:
        'Wallet आपके और Skydrop के बीच का हिसाब का खाता है: आपका वॉलेट बैलेंस, आज आप कितना निकाल सकते हैं, और आपका विक्रेता इसे शून्य से कितना नीचे जाने देता है — यही उनका दिया उधार है।',
    },
    {
      id: 'credited-when',
      say: 'Every movement, each naming the order behind it: cash collected credited to you, your fee share taken off, what a prepaid order cost you. The terms turn into money here.',
      sayBn:
        'প্রতিটা লেনদেন, আর প্রতিটার পিছনের অর্ডারের নাম সঙ্গে: আদায় করা নগদ আপনার নামে জমা, আপনার চার্জের ভাগ কেটে নেওয়া, একটা prepaid অর্ডারে আপনার কত খরচ হলো। Terms এখানেই টাকায় রূপ নেয়।',
      sayHi:
        'हर लेन-देन, और हर एक के साथ उसके पीछे के ऑर्डर का नाम: वसूला गया नगद आपके नाम जमा, शुल्क का आपका हिस्सा काटा गया, एक prepaid ऑर्डर पर आपका कितना ख़र्च हुआ। Terms यहीं आकर पैसा बन जाते हैं।',
    },
    {
      id: 'topup',
      say: 'Some sellers run this wallet themselves; the line at the top says which. When Skydrop runs it, you send money to our bank and then tell us — which account, how much, your reference. Nothing is credited until a person has seen it arrive.',
      sayBn:
        'কিছু বিক্রেতা এই Wallet নিজেরাই চালায়; উপরের লাইনটা বলে দেয় আপনার ক্ষেত্রে কে চালাচ্ছে। Skydrop চালালে আপনি আমাদের ব্যাংকে টাকা পাঠিয়ে তারপর আমাদের জানাবেন — কোন অ্যাকাউন্টে, কত টাকা, আপনার reference কী। একজন মানুষ টাকাটা আসতে না দেখা পর্যন্ত কিছুই জমা হয় না।',
      sayHi:
        'कुछ विक्रेता यह Wallet ख़ुद चलाते हैं; ऊपर की लाइन बता देती है कि आपके मामले में कौन चला रहा है। Skydrop चलाए तो आप हमारे बैंक में पैसा भेजकर फिर हमें बताएँगे — किस अकाउंट में, कितना, और आपका reference क्या। जब तक कोई आदमी पैसा आता हुआ न देख ले, कुछ भी जमा नहीं होता।',
    },
    {
      id: 'withdraw',
      say: 'Taking money out is the other side of the same page: ask for up to what you can withdraw, name the account, and it queues for Skydrop to pay.',
      sayBn:
        'টাকা তোলা একই পৃষ্ঠার উল্টো পিঠ: আপনি যত তুলতে পারবেন তার মধ্যে একটা পরিমাণ চান, অ্যাকাউন্টের নাম দিন, আর অনুরোধটা Skydrop-এর টাকা দেওয়ার তালিকায় গিয়ে বসে।',
      sayHi:
        'पैसा निकालना उसी पेज का दूसरा पहलू है: आप जितना निकाल सकते हैं उसके अंदर एक रकम माँगें, अकाउंट का नाम दें, और माँग Skydrop के भुगतान की कतार में जाकर लग जाती है।',
    },
    {
      id: 'assoc-intro',
      say: 'Associates are your own sales people. Each places orders for your store, sees only the orders they placed, and sells at a price you set for them product by product.',
      sayBn:
        'Associates হলো আপনার নিজের বিক্রয়কর্মী। প্রত্যেকে আপনার দোকানের হয়ে অর্ডার দেয়, শুধু নিজের দেওয়া অর্ডারগুলোই দেখতে পায়, আর আপনি পণ্য ধরে ধরে যে দাম ঠিক করে দেন সেই দামেই বিক্রি করে।',
      sayHi:
        'Associates आपके अपने बिक्री करने वाले हैं। हर कोई आपकी दुकान के लिए ऑर्डर डालता है, सिर्फ़ अपने दिए ऑर्डर देख पाता है, और आप प्रोडक्ट-दर-प्रोडक्ट जो कीमत उसके लिए तय करते हैं उसी पर बेचता है।',
    },
    {
      id: 'assoc-invite',
      say: 'Invite one by name and email. They get a link good for seven days and sign in to an app of their own. Until you give them a price for a product they cannot sell it.',
      sayBn:
        'নাম আর ইমেইল দিয়ে একজনকে আমন্ত্রণ করুন। সে সাত দিনের জন্য একটা লিংক পায় আর নিজের আলাদা একটা অ্যাপে সাইন ইন করে। কোনো পণ্যের দাম আপনি তাকে ঠিক করে না দেওয়া পর্যন্ত সে সেটা বিক্রি করতে পারবে না।',
      sayHi:
        'नाम और ईमेल देकर किसी एक को न्योता दें। उसे सात दिन तक चलने वाला एक लिंक मिलता है और वह अपने अलग ऐप में sign in करता है। जब तक आप उसे किसी प्रोडक्ट की कीमत तय करके न दें, वह उसे बेच नहीं सकता।',
    },
    {
      id: 'assoc-prices',
      say: 'Their prices, product by product. The figure is fixed, and it must sit inside your seller’s range — refused here while you are looking at it, rather than later at the order. A product with no price is called out.',
      sayBn:
        'তাদের দাম, পণ্য ধরে ধরে। সংখ্যাটা বাঁধা, আর এটা আপনার বিক্রেতার সীমার ভিতরে থাকতে হবে — সীমার বাইরে হলে পরে অর্ডারের সময় নয়, আপনি তাকিয়ে থাকা অবস্থায় এখানেই বাতিল হয়। যে পণ্যের দাম দেওয়া নেই, সেটার নাম বলে দেওয়া হয়।',
      sayHi:
        'उनकी कीमतें, प्रोडक्ट-दर-प्रोडक्ट। आँकड़ा बँधा हुआ है, और यह आपके विक्रेता की हद के अंदर होना चाहिए — हद के बाहर हो तो बाद में ऑर्डर के वक़्त नहीं, आपके देखते-देखते यहीं ख़ारिज हो जाता है। जिस प्रोडक्ट की कीमत नहीं दी गई, उसका नाम बता दिया जाता है।',
    },
    {
      id: 'assoc-doing',
      say: 'How each is doing over a window you choose, and the switch beside it. Switching somebody off stops new orders only — what is placed carries on. An associate never sees what you pay your seller.',
      sayBn:
        'আপনি যে সময়সীমা বাছবেন, সেই সময়ে প্রত্যেকে কেমন করছে, আর পাশে একটা সুইচ। কাউকে বন্ধ করলে শুধু নতুন অর্ডার বন্ধ হয় — যা আগে দেওয়া হয়ে গেছে সেগুলো চলতেই থাকে। আপনি বিক্রেতাকে কত দেন, একজন associate সেটা কখনোই দেখতে পায় না।',
      sayHi:
        'आप जो समय चुनेंगे, उसमें हर कोई कैसा कर रहा है, और उसके पास एक switch। किसी को बंद करने पर सिर्फ़ नए ऑर्डर रुकते हैं — जो डल चुके हैं वे चलते रहते हैं। आप विक्रेता को कितना देते हैं, यह कोई associate कभी नहीं देखता।',
    },
    {
      id: 'reports',
      say: 'Reports are your own profit and loss, month by month. Open a line and every entry behind it is there, adding up to the line. A closed month never changes.',
      sayBn:
        'Reports হলো আপনার নিজের লাভ-ক্ষতির হিসাব, মাস ধরে ধরে। কোনো লাইন খুললে তার পিছনের প্রতিটা এন্ট্রি সেখানে থাকে, যোগ করলে ঠিক ওই লাইনটাই হয়। বন্ধ হয়ে যাওয়া মাস আর কখনো বদলায় না।',
      sayHi:
        'Reports आपका अपना नफ़ा-नुक़सान है, महीने-दर-महीने। कोई लाइन खोलें तो उसके पीछे की हर entry वहाँ रहती है, और जोड़ने पर ठीक वही लाइन बनती है। बंद हो चुका महीना कभी नहीं बदलता।',
    },
    {
      id: 'rest',
      say: 'That is the spine. The rest has a short video each: your expense book, the month-by-month analysis, your team and what each may do, keys and webhooks, your notification settings, and taking a dispute to a settlement.',
      sayBn:
        'এই হলো মূল কাঠামো। বাকি সবকিছুর জন্য একটা করে ছোট ভিডিও আছে: আপনার খরচের খাতা, মাসে মাসে বিশ্লেষণ, আপনার টিম আর কে কী করতে পারবে, key আর webhook, আপনার notification-এর সেটিং, আর কোনো বিরোধ নিষ্পত্তি পর্যন্ত নিয়ে যাওয়া।',
      sayHi:
        'यह है पूरा ढाँचा। बाकी सब के लिए एक-एक छोटा वीडियो है: आपका ख़र्च का खाता, महीने-दर-महीने का विश्लेषण, आपकी टीम और कौन क्या कर सकता है, key और webhook, आपकी notification की सेटिंग, और किसी झगड़े को निपटारे तक ले जाना।',
    },
    {
      id: 'outro',
      say: 'One thing to end on. Your seller reads every one of these orders in full, your customer’s details included. It is their stock and their money at risk, and somebody who cannot see where a parcel is going cannot help you.',
      sayBn:
        'শেষে একটা কথা। এই অর্ডারগুলোর প্রতিটা আপনার বিক্রেতা পুরোপুরি দেখতে পায়, আপনার ক্রেতার তথ্যসহ। স্টক তাদের, ঝুঁকিতে থাকা টাকাও তাদের, আর পার্সেলটা কোথায় যাচ্ছে যে দেখতে পায় না, সে আপনাকে সাহায্যও করতে পারে না।',
      sayHi:
        'आख़िर में एक बात। इन ऑर्डरों में से हर एक आपका विक्रेता पूरा पढ़ सकता है, आपके ग्राहक की जानकारी समेत। स्टॉक उनका है और ख़तरे में पड़ा पैसा भी उनका, और जिसे यह दिखाई न दे कि पार्सल कहाँ जा रहा है, वह आपकी मदद भी नहीं कर सकता।',
    },
  ],
};

/* ── the flow ──────────────────────────────────────────────────────── */

/**
 * Sign in — `flows.mjs`'s own `signIn`, copied rather than imported
 * because that file exports `FLOWS` and nothing else.
 *
 * The refusal is read off the page on purpose: a store login is
 * throttled five per fifteen minutes per email and IP, and a take that
 * dies at scene three saying "did not reach the dashboard" sends the
 * next hour at the wrong problem.
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
        ? `Sign-in did not reach the dashboard: ${e.message}`
        : `Sign-in refused: ${line}\n(a store login is throttled 5 per 15 minutes per email+IP)`,
    );
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await stage.clearHalo();
  await page.waitForTimeout(900);
}

/**
 * Reach a page by CLICKING ITS NAV LINK, never `page.goto`.
 *
 * FE-1 keeps the access token in browser memory and nowhere else, so a
 * full load throws it away and the client has to fetch another before
 * anything it renders can ask the API. Under recording that race is
 * lost often enough to kill takes — section O lost four to it — and
 * clicking a link keeps the SPA alive, which is also what a person
 * does. `goto` stays as the fallback for a page with no nav entry.
 */
async function openNav(ctx, href) {
  const { page } = ctx;
  const link = page.locator(`a[href="${href}"]`).first();
  if ((await link.count()) > 0) {
    await link.scrollIntoViewIfNeeded();
    await link.click();
  } else {
    await page.goto(`${ctx.baseUrl}${href}`, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForURL((u) => u.pathname === href, { timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

/**
 * Wait for something the page only draws once it HAS data, pressing its
 * own Retry and reloading on alternate rounds.
 *
 * Same reasoning as `flows.mjs`'s `withRetry`: one Retry re-fires the
 * same token-less request, so a reload — which re-runs the SSR identity
 * resolve — is the stronger move, and alternating is what lands.
 */
async function settle(page, probe, { rounds = 4 } = {}) {
  const retry = page.getByRole('button', { name: 'Retry' }).first();
  for (let round = 0; round < rounds; round += 1) {
    const ok = await probe
      .waitFor({ state: 'attached', timeout: round === 0 ? 15_000 : 8_000 })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
    if ((await retry.count()) > 0) await retry.click();
    if (round % 2 === 1) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    await page.waitForTimeout(1500);
  }
  await probe.waitFor({ state: 'attached', timeout: 20_000 });
}

/** Close a popover or a dialog without pressing anything inside it. */
async function dismiss(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}

/**
 * Hold on something, or hold on nothing, for the same time.
 *
 * Half of what this video points at is CONDITIONAL — the parcel panel
 * on an order with no courier yet, the two money cards on a wallet the
 * seller runs, the copy button that needs a second associate — and
 * `stage.dwellOn` calls `scrollIntoViewIfNeeded`, which THROWS on a
 * locator matching nothing rather than degrading. A nine-minute take is
 * too expensive to lose to an absent panel, so every optional target
 * goes through this, and the narration never names a figure only one
 * world has.
 */
async function maybeDwell(page, stage, locator, ms) {
  if ((await locator.count()) > 0) await stage.dwellOn(locator, ms);
  else await page.waitForTimeout(ms);
}

/** The page subtitle. `.sk-ph__subtitle` — see the header's correction. */
function subtitle(page) {
  return page.locator('.sk-ph__subtitle').first();
}

/** One collapsible nav group, through its own heading button. */
function navGroup(page, heading) {
  return page
    .locator('.sk-nav__group')
    .filter({ has: page.getByRole('button', { name: heading, exact: true }) })
    .first();
}

/** One `.rm-card` of the money and terms pages, by the heading it carries. */
function rmCard(page, title) {
  return page
    .locator('.rm-card')
    .filter({ has: page.getByRole('heading', { name: title }) })
    .first();
}

/** One `RoSection` of a store order page, by its heading. */
function roSection(page, heading) {
  return page
    .locator('.ro-section')
    .filter({ has: page.getByRole('heading', { name: heading, exact: true }) })
    .first();
}

/** The nth cell of the first body row — for holding on one column. */
function firstBodyCell(page, nth) {
  return page.locator(`tbody tr:first-child td:nth-child(${nth})`).first();
}

export const flow = {
  app: 'reseller',

  /*
    THE CSV UPLOAD GOES THROUGH SPACES, SO THIS FLOW NEEDS THE SHIM.

    `/store/order-imports` presigns a DigitalOcean Spaces URL and the
    browser PUTs the file straight to it — our own origin never sees the
    bytes. On a filming stack there is no bucket, so that PUT fails and
    the page shows "The upload failed", `pending` stays null, and the
    preview paragraph the next scene waits for is never rendered. The
    failure reads as a missing element twenty seconds later, which is
    nowhere near the cause.

    `seller.mjs` and `associate.mjs` both declare this because both
    upload something; this one was missed because its upload is three
    quarters of the way through a forty-three-step script rather than
    near the top.
  */
  needsSpacesShim: true,

  /**
   * WHAT THE DEMO WORLD MUST HAVE. Every line is something a scene
   * reads out or acts on; a missing one is a scene narrating an empty
   * table.
   */
  seed: [
    'The TRADING store world (`tradingStoreWorld`): Pune Silk Studio, ACTIVE, with Anjali Deshpande’s invitation accepted and her password forced to `Store-Demo-2026` — she is the identity `record.mjs` signs in as.',
    'Her login throttle cleared (`lib/clear-login-throttle.mjs`, `anjali@punesilkstudio.test`): this video films the sign-in itself, so a throttled form kills the take at scene three.',
    'Terms PUBLISHED and ACCEPTED, with a non-zero store share on at least two of the six fees and a store credit timing that is not instant — four scenes read that card, and shares that are all 0% or all 100% teach nothing about a split.',
    'At least TWO terms versions, so "Every version" is a list rather than one row. The current one accepted and nothing left unaccepted: an unaccepted current version refuses every order this video places.',
    '`reseller.orders_enabled` ON for the seller — RS-5 seeds it FALSE and the create is refused by name without it.',
    'A priced, enabled catalogue of TWO products — `RSH-JAMDANI-IVORY` (transfer ₹1,850, range ₹2,400–₹3,200) and `RSH-KANTHA-BLUE` — both with stock available, so the picker offers a choice and Available carries a real number.',
    'The action policy with `recall: DIRECT` and the other six `ASK_SELLER`, which is what `tradingStoreWorld` already writes. BOTH marks have to be on one screen: the beat is "a lightning mark and a clock mark, and the screen tells you which".',
    'Settled store orders (`ensureSettledStoreOrders`) so the status tabs carry counts, with at least one DELIVERED and one that came back.',
    'The `STORE_REQUEST_ORDERS.delivery` parcel LIVE — OUT_FOR_DELIVERY or DELIVERY_FAILED, for Deepa Ranganathan on +919845070033 — with ONE delivery ask already waiting on seller staff (`ensureHeldDeliveryAsk`). It is found by searching the last ten digits of that phone; the list is newest-first, so an older spent parcel for the same customer does no harm.',
    'That parcel carrying a waybill and some real scans, so the Parcel panel and the timeline are not drawn on nothing.',
    'The store wallet MANAGED BY SKYDROP (`walletManagedBy: SKYDROP` on Pune Silk Studio). The column defaults to SELLER, and a seller-managed wallet hides both money cards entirely — three scenes are about those two forms.',
    'A non-zero negative limit on that wallet, and movements in its ledger: at least one order credit, one fee share and one top-up, each linked to the order it belongs to.',
    'At least one PLATFORM BANK ACCOUNT the store can pay into, so "Paid into" has an option and the top-up confirmation can read the account back.',
    'TWO accepted ASSOCIATES at the store (`store_roles.key = associate`) — one of them `ravi@punesilkstudio.test`, who is the identity the ASSOCIATE long video signs in as, so both videos want the same person rather than two. Each with orders they placed whose outcome is known, because the analysis divides its rates by exactly those; and the first of them with one product priced and one left UNPRICED, so the pricing screen shows both a figure and the "no price yet" warning. Two is also what makes "Copy prices from…" exist and the comparison table worth reading.',
    `NO open invitation and no existing user for \`${INVITEE.email}\` — ${INVITEE.name} is invited on camera, and a second pending one is refused as INVITATION_ALREADY_PENDING.`,
    `A per-run bulk CSV at \`${BULK_CSV}\`: six rows making FOUR orders (two of them two-line orders sharing a reference), with FRESH \`External Ref\` values every run, and ONE row priced under the seller’s minimum so the preview names a row that will not import. A committed file cannot do this — a repeated reference from a store is an error row, not a patch.`,
    'At least one CLOSED store P&L month with entries in it, so /reports shows a closed month rather than only the open one. The flow tolerates its absence and the narration names no figure.',
  ],

  /**
   * Nothing but the sign-in page. The sign-in is SCENE THREE, not the
   * prologue: the first thing this video has to say is how somebody got
   * a login at all, and that is two sentences over the login screen.
   */
  async prologue({ page, stage }) {
    await page.waitForLoadState('networkidle').catch(() => {});
    await stage.clearHalo();
    await page.waitForTimeout(600);
  },

  steps: [
    {
      id: 'intro',
      async run({ page, stage }) {
        await page.waitForTimeout(800);
        await stage.dwellOn(page.locator('.sk-signin__card').first(), 2600);
      },
    },
    {
      id: 'invitation',
      async run({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-signin__title').first(), 1200);
        await maybeDwell(page, stage, page.locator('.rd-auth-alt').first(), 2400);
      },
    },
    {
      id: 'sign-in',
      async run(ctx) {
        await signIn(ctx);
      },
    },
    {
      id: 'dashboard',
      async run({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__title').first(), 1400);
        await stage.dwellOn(subtitle(page), 2000);
      },
    },
    {
      id: 'nav',
      async run({ page, stage }) {
        await stage.dwellOn(navGroup(page, 'Store'), 3000);
        await maybeDwell(page, stage, navGroup(page, 'Setup'), 1400);
      },
    },

    /* ── the terms ─────────────────────────────────────────────────── */
    {
      id: 'terms-why',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, '/terms');
        await settle(page, page.getByRole('heading', { name: /^Version \d+$/ }).first());
        await stage.dwellOn(subtitle(page), 2600);
      },
    },
    {
      id: 'terms-fees',
      async run({ page, stage }) {
        await stage.dwellOn(
          page.locator('.rm-terms__block').filter({ hasText: 'Who pays which fee' }).first(),
          3200,
        );
        // The worked example underneath is the same split on a real
        // figure — the clause at the end of this line is reading it.
        await stage.glide(300);
        await maybeDwell(
          page,
          stage,
          page
            .locator('table')
            .filter({ hasText: /You pay/ })
            .first(),
          2400,
        );
      },
    },
    {
      id: 'terms-credit',
      async run({ page, stage }) {
        await stage.glide(-300);
        await stage.dwellOn(
          page
            .locator('.rm-terms__block')
            .filter({ hasText: 'When each of you is credited' })
            .first(),
          3600,
        );
      },
    },
    {
      id: 'terms-accepted',
      async run({ page, stage }) {
        // "Accepted by <name> on <date>" lives in the card's own
        // subtitle; the chip beside it says Accepted.
        await stage.dwellOn(page.locator('.rm-card__sub').first(), 2600);
        await stage.glide(560);
        await maybeDwell(
          page,
          stage,
          page.getByRole('heading', { name: 'Every version' }).first(),
          1000,
        );
        await maybeDwell(page, stage, page.locator('table').last(), 2000);
      },
    },

    /* ── the catalogue ─────────────────────────────────────────────── */
    {
      id: 'catalogue',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, '/catalogue');
        await settle(page, page.getByRole('columnheader', { name: 'Available' }).first());
        await stage.dwellOn(subtitle(page), 2200);
      },
    },
    {
      id: 'you-pay',
      async run({ page, stage }) {
        /*
          `You pay` is not a plain header: it is a `GlossaryTerm`, a real
          <button> inside the <th> that opens a tooltip card titled
          "Transfer price". Clicking it is the beat, and the card is what
          the narration is reading out.
        */
        await stage.clickIt(page.getByRole('button', { name: 'You pay', exact: true }).first(), {
          after: 1000,
        });
        await maybeDwell(page, stage, page.getByRole('tooltip').first(), 2400);
        await dismiss(page);
      },
    },
    {
      id: 'range',
      async run({ page, stage }) {
        await stage.dwellOn(firstBodyCell(page, 3), 2200);
        await stage.dwellOn(firstBodyCell(page, 4), 1200);
      },
    },
    {
      id: 'stock',
      async run({ page, stage }) {
        await stage.dwellOn(firstBodyCell(page, 5), 1800);
        // The argument is about what has NO column, so the shot is the
        // whole header row rather than any one of them.
        await stage.dwellOn(page.locator('thead tr').first(), 2600);
      },
    },

    /* ── one order ─────────────────────────────────────────────────── */
    {
      id: 'product',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, '/orders');
        await settle(page, page.getByRole('columnheader', { name: 'To collect' }).first());
        await stage.clickIt(page.getByRole('link', { name: 'New order', exact: true }).first(), {
          after: 1000,
        });
        await page.waitForURL((u) => u.pathname === '/orders/new', { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // The stepper names the three parts the narration opens on.
        await stage.dwellOn(page.locator('ol.sk-stepper__rail').first(), 1600);
        // A native <select>, so `selectOption` is the supported path —
        // and an option with nothing available is `disabled`, which is
        // the fact this line names.
        const picker = page.getByLabel(/^Product\s*\*?$/).first();
        await stage.point(picker, { settle: 600 });
        /*
          BY SKU, NOT BY POSITION.
          
          This was `selectOption({ index: 1 })`, which takes whatever the
          catalogue happens to list first — and that is the WALLET, whose
          agreed range is ₹1,400–₹1,900. The retail this video types is
          ₹2,950, written for the kurti (₹2,300–₹3,000), so the server
          correctly refused the order with `RETAIL_OUT_OF_RANGE` (RS-5)
          and the page never navigated. The failure read as a dead
          "Place order" button three scenes later.
          
          The kurti is also the right product on its own terms: it is
          what the seller video creates and what the narration follows
          through all three videos, so the parcel a viewer watches being
          sold is the one they watched being made.
        */
        const option = picker.locator('option', { hasText: SELLING.sku }).first();
        await option.waitFor({ state: 'attached', timeout: 15_000 });
        const value = await option.getAttribute('value');
        if (value === null) {
          throw new Error(`reseller: no option for ${SELLING.sku} in the product picker`);
        }
        await picker.selectOption(value);
        await page.waitForTimeout(1400);
        await stage.clearHalo();
      },
    },
    {
      id: 'retail',
      async run({ page, stage }) {
        await stage.dwellOn(page.locator('p.ro-line__note').first(), 2000);
        await stage.typeIn(page.getByLabel('Retail price per unit').first(), CUSTOMER.retail, {
          clear: true,
          after: 1000,
        });
      },
    },
    {
      id: 'customer',
      async run({ page, stage }) {
        await stage.typeIn(page.getByLabel(/^Name\s*\*?$/).first(), CUSTOMER.name, {
          after: 300,
        });
        await stage.typeIn(page.getByLabel(/^Phone\s*\*?$/).first(), CUSTOMER.phone, {
          clear: true,
          after: 300,
        });
        await stage.typeIn(page.getByLabel(/^PIN code\s*\*?$/).first(), CUSTOMER.pin, {
          after: 300,
        });
        await stage.typeIn(page.getByLabel(/^Address\s*\*?$/).first(), CUSTOMER.line1, {
          after: 300,
        });
        await stage.typeIn(page.getByLabel(/^Landmark\s*\*?$/).first(), CUSTOMER.landmark, {
          after: 900,
        });
      },
    },
    {
      id: 'payment',
      async run({ page, stage }) {
        await stage.glide(320);
        await stage.dwellOn(page.getByText('Cash on delivery', { exact: true }).first(), 1600);
        await stage.dwellOn(page.getByLabel(/Cash to collect/i).first(), 1400);
        /*
          The CHOICE is filmed; the order is still placed on COD.
          Choosing prepaid for real spends the seeded store's wallet,
          and a balance that cannot cover the goods is refused as
          STORE_BALANCE_INSUFFICIENT — a correct refusal, and a dead
          take under narration about placing an order.
        */
        await stage.dwellOn(page.getByText('Prepaid', { exact: true }).first(), 1600);
      },
    },
    {
      id: 'placed',
      async run(ctx) {
        const { page, stage } = ctx;
        await stage.clickIt(
          page.getByRole('button', { name: 'Place order', exact: true }).first(),
          {
            after: 1000,
          },
        );
        const dialog = page.getByRole('dialog');
        await dialog.first().waitFor({ timeout: 15_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm').first(), 1800);
        // The dialog's confirm carries the SAME label as the page
        // button, which is why this is scoped to the dialog.
        await stage.clickIt(
          dialog.getByRole('button', { name: 'Place order', exact: true }).first(),
          { after: 1200 },
        );
        await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        /*
          KEPT FOR TWO SCENES' TIME. `change-order` and `call-it-off`
          come back to THIS order — the only one in the world that is
          this store's, unconfirmed, and with nothing already waiting
          with the seller, which is what makes both panels offer their
          buttons rather than explain why they are closed.
        */
        ctx.placedOrderUrl = page.url();
        await stage.dwellOn(page.locator('.sk-ph__title').first(), 1400);
        await maybeDwell(page, stage, page.locator('.sk-ph__meta').first(), 1400);
      },
    },

    /* ── a day's worth at once ─────────────────────────────────────── */
    {
      id: 'bulk',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, '/orders');
        await stage.clickIt(page.getByRole('link', { name: 'Upload a CSV' }).first(), {
          after: 900,
        });
        await page.waitForURL((u) => u.pathname === '/orders/import', { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        // A <button> that builds a blob and clicks a synthetic anchor,
        // so there is no href to read and a real download event fires.
        const saved = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
        await stage.clickIt(page.getByRole('button', { name: 'Download the template' }).first(), {
          after: 1000,
        });
        await saved;
        // The subtitle states the one-row-one-line rule in the page's
        // own words, which is the second half of this line.
        await stage.dwellOn(subtitle(page), 2200);
      },
    },
    {
      id: 'bulk-check',
      async run({ page, stage }) {
        // Fails loudly rather than uploading nothing: a missing
        // generated CSV is a seed that did not run, and `setInputFiles`
        // on an absent path throws about the path rather than the seed.
        await fs.access(BULK_CSV).catch(() => {
          throw new Error(
            `No bulk CSV at ${BULK_CSV} — the reseller-everything seed writes it, with fresh ` +
              'references every run. Re-run the seed for this slug.',
          );
        });
        await page.locator('input[type="file"]').first().setInputFiles(BULK_CSV);
        await page.waitForTimeout(900);
        await stage.clickIt(page.getByRole('button', { name: 'Upload and check' }).first(), {
          after: 1200,
        });
        await settle(page, page.locator('p.ro-body').first());
        await stage.dwellOn(page.locator('p.ro-body').first(), 2000);
        await maybeDwell(
          page,
          stage,
          page
            .locator('.sk-notice')
            .filter({ hasText: /will not import/i })
            .first(),
          2400,
        );
      },
    },
    {
      id: 'bulk-import',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: /^Import \d+ orders?$/ }).first(), {
          after: 900,
        });
        const dialog = page.getByRole('dialog');
        await dialog.first().waitFor({ timeout: 15_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm').first(), 1600);
        await stage.clickIt(dialog.getByRole('button', { name: /^Import \d+ orders?$/ }).first(), {
          after: 1400,
        });
        // The uploads table refetches every few seconds while the run
        // is live, so this waits for the row rather than snapshotting.
        await settle(
          page,
          page.getByRole('cell', { name: /reseller-long-bulk-orders\.csv/i }).first(),
        );
        await stage.glide(320);
        await stage.dwellOn(page.locator('table').last(), 2200);
      },
    },

    /* ── following one ─────────────────────────────────────────────── */
    {
      id: 'orders-list',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, '/orders');
        await settle(page, page.getByRole('columnheader', { name: 'To collect' }).first());
        // Tabs by role: the status <select> beside them carries the same
        // words (section R's third selector rule).
        await stage.dwellOn(page.getByRole('tablist').first(), 2400);
        const box = page.getByLabel('Search orders').first();
        await stage.typeIn(box, LIVE_PARCEL_PHONE, { after: 600 });
        await box.press('Enter');
        await page.waitForLoadState('networkidle').catch(() => {});
        await settle(page, page.locator('a.ro-order-link').first());
        await page.waitForTimeout(600);
      },
    },
    {
      id: 'order-read',
      async run({ page, stage }) {
        await stage.clickIt(page.locator('a.ro-order-link').first(), { after: 900 });
        await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/i, { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await stage.dwellOn(roSection(page, 'Money'), 2200);
        await stage.glide(300);
        await maybeDwell(page, stage, roSection(page, 'Products'), 2000);
      },
    },
    {
      id: 'order-earns',
      async run({ page, stage }) {
        await stage.glide(320);
        const earns = roSection(page, 'What this order earns you');
        await maybeDwell(page, stage, earns, 2600);
        await maybeDwell(page, stage, earns.locator('.sk-chip').first(), 2200);
      },
    },
    {
      id: 'order-timeline',
      async run({ page, stage }) {
        await stage.glide(520);
        await maybeDwell(page, stage, page.locator('ol.sk-tl__steps').first(), 3200);
      },
    },

    /* ── when it goes wrong ────────────────────────────────────────── */
    {
      id: 'wrong-intro',
      async run({ page, stage }) {
        await stage.glide(-620);
        const panel = roSection(page, 'Something wrong with the delivery?');
        await maybeDwell(page, stage, panel.locator('.sk-sh__note').first(), 3800);
      },
    },
    {
      id: 'delivery-asks',
      async run({ page, stage }) {
        const panel = roSection(page, 'Something wrong with the delivery?');
        await maybeDwell(page, stage, panel.locator('ul.ro-offers').first(), 2400);
        // The note under ONE offer is the whole distinction, so it gets
        // its own hold: a lightning mark for recall (DIRECT for this
        // store) against a clock for the two the seller approves.
        await maybeDwell(page, stage, panel.locator('.ro-offer__note').first(), 2200);
      },
    },
    {
      id: 'ask-dialog',
      async run({ page, stage }) {
        /*
          OPENED AND READ, NEVER SENT. These three turn a van round or
          queue a real call at the seller's cost; the dialog's own
          description — "The seller sees this and decides. Nothing
          happens to the parcel until they answer." — is the lesson, and
          the one request this video does send is the cancel three
          scenes later, on the order it placed itself.
        */
        const button = page.getByRole('button', { name: 'Try delivering again' }).first();
        if ((await button.count()) === 0) {
          await page.waitForTimeout(3000);
          return;
        }
        await stage.clickIt(button, { after: 900 });
        const dialog = page.getByRole('dialog');
        await dialog.first().waitFor({ timeout: 15_000 });
        await stage.dwellOn(dialog.first(), 2800);
        await dismiss(page);
      },
    },
    {
      id: 'asked-before',
      async run({ page, stage }) {
        const sent = roSection(page, 'Sent to your seller to approve');
        if ((await sent.count()) > 0) {
          await stage.dwellOn(sent, 3200);
          return;
        }
        // Before a seller has ever been asked, the delivery panel's own
        // history table carries the same fact.
        await maybeDwell(
          page,
          stage,
          page
            .locator('table')
            .filter({ hasText: /What you asked/ })
            .first(),
          3200,
        );
      },
    },
    {
      id: 'chase',
      async run({ page, stage }) {
        await stage.glide(380);
        await maybeDwell(
          page,
          stage,
          page
            .locator('.sk-notice, .ro-notice')
            .filter({ hasText: /Raise it with/ })
            .first(),
          3000,
        );
      },
    },
    {
      id: 'change-order',
      async run(ctx) {
        const { page, stage } = ctx;
        // Back to the order this video placed. A `goto` because there is
        // no link to it from here, with `settle` behind it for the 401
        // that FE-1's in-memory token can cost on a fresh load.
        await page.goto(ctx.placedOrderUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle').catch(() => {});
        await settle(page, page.locator('.sk-ph__title').first());
        const panel = roSection(page, 'Something wrong with this order?');
        await maybeDwell(page, stage, panel.locator('.sk-sh__note').first(), 2400);
        await maybeDwell(
          page,
          stage,
          panel.getByRole('button', { name: 'Change this order' }).first(),
          2200,
        );
      },
    },
    {
      id: 'call-it-off',
      async run({ page, stage }) {
        /*
          THE ONE REQUEST THIS VIDEO REALLY SENDS. `cancel` is
          ASK_SELLER for this store, so it creates a request the seller
          answers and cancels nothing — the loop being taught, filmed
          end to end, on an order this take placed itself. The note is
          REQUIRED in that mode and the confirm is disabled without it,
          which is why it is typed before the press.
        */
        const ask = page
          .getByRole('button', {
            name: /^(Ask the seller to cancel|Cancel order|Cancel this order)/,
          })
          .first();
        if ((await ask.count()) === 0) {
          await page.waitForTimeout(3200);
          return;
        }
        await stage.clickIt(ask, { after: 900 });
        const dialog = page.getByRole('dialog');
        await dialog.first().waitFor({ timeout: 15_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2200);
        await stage.typeIn(
          dialog.getByLabel(/^Why/).first(),
          'The customer rang to say she has found the same thing locally.',
          { delay: 14, after: 600 },
        );
        /*
          THE CONFIRM IS "SEND IT", NOT A WORD FROM THE BUTTON THAT
          OPENED IT — and under ASK_SELLER there are TWO dialogs.

          This looked for `/cancel/i` inside the dialog, reasoning that
          the confirm would reuse the page button's words. It does not.
          With the store's `cancel` capability set to ASK_SELLER (which
          is what this video films, because the seller deciding is the
          point), the flow is: a reason dialog whose submit is "Send it",
          then a ConfirmDialog whose confirm is also "Send it" and whose
          dismiss is "Back". Neither says "cancel", so the step waited
          thirty seconds for a button that is not on the screen.

          Matching the submit by its real words and then clearing a
          second dialog if one appears keeps this right under DIRECT too,
          where the single dialog confirms the cancellation itself.
        */
        // THE CONFIRM'S WORDS, READ OFF THE PAGE.
        //
        // `orders/[id]/page.tsx` sets `cancelLabel` from the store's own
        // policy: "Send to your seller" when the seller decides
        // (ASK_SELLER, which is what this video films) and "Cancel the
        // order" when the store may do it itself. The dismiss beside it
        // is "Keep it". Nothing in the dialog says "cancel" when the
        // seller is being asked, and nothing says "Send it" — two
        // earlier guesses, each of which cost a thirty-second timeout
        // reported as a missing button.
        const submit = /^(Send to your seller|Cancel the order)/i;
        await stage.clickIt(dialog.getByRole('button', { name: submit }).first(), {
          after: 1200,
        });
        const second = page.getByRole('dialog');
        if ((await second.count()) > 0) {
          const confirm = second.getByRole('button', { name: submit }).last();
          if ((await confirm.count()) > 0) {
            await stage.clickIt(confirm, { after: 1600 });
          }
        }
        await page
          .getByRole('dialog')
          .first()
          .waitFor({ state: 'hidden', timeout: 20_000 })
          .catch(() => {});
        await page.waitForTimeout(700);
      },
    },

    /* ── the wallet ────────────────────────────────────────────────── */
    {
      id: 'wallet',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, '/wallet');
        await settle(page, page.locator('.rm-kpis').first());
        await stage.dwellOn(page.locator('.rm-kpis').first(), 2800);
      },
    },
    {
      id: 'credited-when',
      async run({ page, stage }) {
        await stage.glide(620);
        await maybeDwell(
          page,
          stage,
          page.getByRole('heading', { name: 'Every movement' }).first(),
          1000,
        );
        await maybeDwell(
          page,
          stage,
          page
            .locator('table')
            .filter({ hasText: /Wallet ledger|Every movement/ })
            .first(),
          2200,
        );
      },
    },
    {
      id: 'topup',
      async run({ page, stage }) {
        await stage.glide(-620);
        const card = rmCard(page, /^Top up/);
        if ((await card.count()) === 0) {
          // A seller-managed wallet has no card at all, and the page
          // subtitle says so in the app's own words — which is the
          // clause this line opens with.
          await stage.dwellOn(subtitle(page), 3400);
          return;
        }
        const account = page.locator('#tu-account');
        if ((await account.count()) > 0) {
          await stage.point(account, { settle: 500 });
          await account.selectOption({ index: 1 }).catch(() => {});
          await stage.clearHalo();
        }
        await stage.typeIn(page.locator('#tu-amount'), TOPUP.amount, { clear: true, after: 400 });
        await stage.typeIn(page.locator('#tu-ref'), TOPUP.reference, { after: 500 });
        await stage.clickIt(page.getByRole('button', { name: /^Tell Skydrop$/ }).first(), {
          after: 1000,
        });
        const dialog = page.getByRole('dialog');
        if ((await dialog.count()) > 0) {
          await stage.dwellOn(dialog.locator('.sk-confirm__consequence').first(), 2600);
          // NOT CONFIRMED — see the file header. The claim would be a
          // row an operator has to clear after every take.
          await dismiss(page);
        }
      },
    },
    {
      id: 'withdraw',
      async run({ page, stage }) {
        const card = rmCard(page, /withdraw/i);
        if ((await card.count()) === 0) {
          await stage.dwellOn(subtitle(page), 2800);
          return;
        }
        await stage.typeIn(page.locator('#wd-amount'), WITHDRAW_AMOUNT, {
          clear: true,
          after: 400,
        });
        await maybeDwell(page, stage, page.locator('#wd-account'), 1000);
        // Filled and read, never asked for: a withdrawal request is an
        // obligation on Skydrop, and one per take would stack up.
        await stage.dwellOn(card.getByRole('button', { name: /^Ask to withdraw$/ }).first(), 1800);
      },
    },

    /* ── your own sales people ─────────────────────────────────────── */
    {
      id: 'assoc-intro',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, '/associates');
        await settle(page, page.getByRole('columnheader', { name: 'Person' }).first());
        await stage.dwellOn(subtitle(page), 2000);
        await maybeDwell(page, stage, page.locator('.sk-sh__note').first(), 1800);
      },
    },
    {
      id: 'assoc-invite',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('button', { name: 'Invite an associate' }).first(), {
          after: 900,
        });
        const dialog = page.getByRole('dialog');
        await dialog.first().waitFor({ timeout: 15_000 });
        await stage.typeIn(dialog.locator('#associate-name'), INVITEE.name, { after: 300 });
        await stage.typeIn(dialog.locator('#associate-email'), INVITEE.email, { after: 500 });
        await stage.dwellOn(dialog.locator('.as-muted').first(), 1800);
        // `AsyncButton` holds all four phase labels in the DOM at once
        // with the accessible name pinned to the idle one, so `role` +
        // name is the only reach that works here.
        await stage.clickIt(dialog.getByRole('button', { name: 'Send invitation' }).first(), {
          after: 1600,
        });
        await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 20_000 });
        await maybeDwell(page, stage, page.locator('ul.as-invited').first(), 1800);
      },
    },
    {
      id: 'assoc-prices',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'Set prices' }).first(), { after: 900 });
        await page.waitForURL(/\/associates\/[0-9a-f-]{36}\/prices$/i, { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await settle(page, page.getByRole('columnheader', { name: 'They sell at' }).first());
        await stage.dwellOn(page.locator('thead tr').first(), 1800);
        // The price box carries an `aria-label` naming its product, and
        // an `aria-label` on the control IS the accessible name — so the
        // visible "₹" lead is not a handle.
        await maybeDwell(
          page,
          stage,
          page.getByLabel(/^What they sell .* at, in rupees$/).first(),
          1600,
        );
        await maybeDwell(page, stage, page.locator('p.as-price__note').first(), 2200);
      },
    },
    {
      id: 'assoc-doing',
      async run({ page, stage }) {
        await stage.clickIt(page.getByRole('link', { name: 'All associates' }).first(), {
          after: 800,
        });
        await page.waitForURL((u) => u.pathname === '/associates', { timeout: 20_000 });
        await stage.clickIt(page.getByRole('link', { name: 'How they are doing' }).first(), {
          after: 900,
        });
        await page.waitForURL((u) => u.pathname === '/associates/analysis', { timeout: 20_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await settle(page, page.locator('.as-kpis').first());
        await maybeDwell(page, stage, page.locator('.as-kpis').first(), 1800);
        await stage.glide(320);
        // `Switch` is a `role="switch"` button whose accessible name is
        // the same on every row, so it is reached THROUGH its row.
        const toggle = page
          .locator('tbody tr')
          .first()
          .getByRole('switch', { name: 'Can place orders' })
          .first();
        if ((await toggle.count()) === 0) {
          await page.waitForTimeout(2600);
          return;
        }
        // Switched OFF and straight back ON: the words under it are the
        // lesson, and leaving somebody unable to sell after a take is a
        // real change to the demo world.
        await stage.clickIt(toggle, { after: 1400 });
        await stage.clickIt(toggle, { after: 1000 });
      },
    },

    /* ── and the rest ──────────────────────────────────────────────── */
    {
      id: 'reports',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, '/reports');
        await settle(page, page.locator('.rm-kpis').first());
        await stage.dwellOn(page.locator('.rm-kpis').last(), 2000);
        await stage.glide(420);
        await maybeDwell(
          page,
          stage,
          page.getByRole('heading', { name: 'Profit and loss' }).first(),
          1200,
        );
        await maybeDwell(page, stage, page.locator('.sk-acc__item, .sk-acc').first(), 1800);
      },
    },
    {
      id: 'rest',
      async run(ctx) {
        const { page, stage } = ctx;
        await openNav(ctx, '/dashboard');
        await page.waitForTimeout(600);
        await stage.dwellOn(navGroup(page, 'Store'), 2400);
        await maybeDwell(page, stage, navGroup(page, 'Setup'), 1800);
      },
    },
    {
      id: 'outro',
      async run({ page, stage }) {
        await stage.dwellOn(page.locator('.sk-ph__title').first(), 1600);
        await stage.dwellOn(subtitle(page), 2400);
      },
    },
  ],
};
