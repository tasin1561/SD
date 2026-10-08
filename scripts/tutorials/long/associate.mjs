/**
 * THE ASSOCIATE LONG VIDEO — `portal.skydrop.global`, ASSOC-1.
 *
 * ── WHO IS WATCHING, AND WHY THIS ONE IS DIFFERENT ──────────────────
 * A SALES PERSON who sells for a reseller store. Often on a phone,
 * often mid-call with a customer. They own nothing, hold no stock, have
 * no wallet, and settle up with their store outside Skydrop.
 *
 * So the register is PITCHED LOWER than the seller and reseller
 * videos. Short sentences, and no jargon: the word "SKU" is not in this
 * script at all — a sales person reads a product name down a phone, not
 * a code. Nothing here explains a margin, a fee split, a wallet or a
 * terms version either, because this person cannot see any of it, and a
 * video that explains what is not on the screen teaches somebody to go
 * looking for a thing that is not there.
 *
 * ── WHAT IS DELIBERATELY NOT IN IT ──────────────────────────────────
 * The app is deliberately narrow, and this covers the eight screens
 * that are the job. Left out, each on purpose: the account page (it is a
 * password and a name — the one per-person preference on it, motion, is
 * not worth a sales person's minute), the password reset, and the
 * orders-paused notice. The pause is the ONE thing a viewer might miss
 * and it is still out: the spine is eleven beats and the pause is not
 * one of them, the video has to place a real order (so the filming
 * associate cannot be paused), and the notice says plainly on screen
 * what it is when it appears. It is named in this module's report
 * rather than hidden.
 *
 * ── THE CLOSING BEAT IS LOAD-BEARING ────────────────────────────────
 * The last scene says out loud that this person will never see what
 * their store pays for a product or earns on it. ASSOC-1 builds that as
 * a PERMISSION and a second endpoint rather than a filter, so it is not
 * going to change — and somebody who discovers it by poking around
 * concludes something is being hidden from them. Said plainly, once, at
 * the end, with the reason (it is their store's arrangement with its
 * supplier) and with what they DO control, it is a fact about the job
 * rather than a slight.
 *
 * Exports `narration` and `flow` in the shape `long/README.md` sets
 * out; `long/index.mjs` is the seam that keys the step array by id on
 * the way into `narration.mjs` and `flows.mjs`.
 */
import path from 'node:path';
import { GENERATED_DIR } from '../lib/paths.mjs';
import { readFixture } from '../lib/fixture.mjs';

/**
 * The slug — the mp4's name, and the key `long/index.mjs` registers
 * under. `-everything` to sit beside `seller-everything` and
 * `reseller-everything`, and to leave `promo-associate` unambiguous.
 */
const SLUG = 'associate-everything';

/**
 * The bulk CSV, written by the seed rather than committed.
 *
 * `fixtures/` next door holds the files whose CONTENTS are narrated
 * word for word; this one's rows have to name SKUs and a reference that
 * exist in the box being filmed, so it belongs with the other
 * seed-written files in `GENERATED_DIR` (the `courier-remittance.csv`
 * precedent). It carries NO price column: an associate does not set one
 * (ASSOC-1 — `associate_prices` is the store's to write), which is the
 * one way this file differs from the store's own.
 */
const BULK_CSV = path.join(GENERATED_DIR, 'associate-bulk-orders.csv');

/** What goes into the order the video places. */
const ORDER = {
  name: 'Meera Raghavan',
  phone: '+919845117260',
  pin: '560034',
  line1: '48 Wilson Garden, 9th Cross',
  landmark: 'Beside the Jayanagar bus depot gate',
  quantity: '2',
};

/* ────────────────────────────── narration ────────────────────────── */

export const narration = {
  slug: SLUG,
  title: 'Selling for your store',
  subtitle: 'Skydrop for sales people',
  steps: [
    {
      id: 'intro',
      say: 'This is your sales portal. Your store sells things, you sell them for your store, and Skydrop does the rest: it holds the stock in India, rings every customer, and gets the parcel to the door.',
      sayBn:
        'এটা আপনার বিক্রির জায়গা। আপনার দোকান জিনিস বিক্রি করে, আপনি দোকানের হয়ে সেগুলো বিক্রি করেন, আর বাকি কাজ Skydrop করে: স্টক ভারতে রাখে, প্রতিটা ক্রেতাকে ফোন করে, আর পার্সেলটা দরজা পর্যন্ত পৌঁছে দেয়।',
      sayHi:
        'यह आपकी बिक्री की जगह है। आपकी दुकान चीज़ें बेचती है, आप दुकान के लिए वे चीज़ें बेचते हैं, और बाकी काम Skydrop करता है: स्टॉक भारत में रखता है, हर ग्राहक को फ़ोन करता है, और पार्सल दरवाज़े तक पहुँचाता है।',
    },
    {
      id: 'invitation',
      say: 'Whoever runs your store sends you a link. It opens this page, and the page says what you are being let into before you agree: which store, what you will be able to do, and the address it went to. You pick a password.',
      sayBn:
        'আপনার দোকান যে চালায়, সে আপনাকে একটা লিংক পাঠায়। লিংকটা এই পৃষ্ঠাটা খোলে। রাজি হওয়ার আগেই পৃষ্ঠাটা বলে দেয় আপনাকে কোথায় ঢোকানো হচ্ছে: কোন দোকান, আপনি কী কী করতে পারবেন, আর লিংকটা কোন ইমেইলে গিয়েছিল। আপনি একটা পাসওয়ার্ড বাছবেন।',
      sayHi:
        'आपकी दुकान जो चलाता है, वह आपको एक लिंक भेजता है। लिंक यही पेज खोलता है। राज़ी होने से पहले ही पेज बता देता है कि आपको कहाँ अंदर लिया जा रहा है: कौन-सी दुकान, आप क्या-क्या कर पाएँगे, और लिंक किस ईमेल पर गया था। आप एक password चुनते हैं।',
    },
    {
      id: 'sign-in',
      say: 'After that, this is where you come back. The same email, the password you chose. Nobody else can set that password for you, so if you lose it, use the reset link underneath.',
      sayBn:
        'এরপর থেকে আপনি এখানেই ফিরে আসবেন। একই ইমেইল, আপনার বাছা পাসওয়ার্ড। ওই পাসওয়ার্ড আর কেউ আপনার হয়ে বসাতে পারবে না। ভুলে গেলে নিচের reset লিংকটা ব্যবহার করুন।',
      sayHi:
        'इसके बाद आप यहीं लौटकर आएँगे। वही ईमेल, और आपका चुना हुआ password। वह password आपके लिए कोई और नहीं बैठा सकता, इसलिए भूल जाएँ तो नीचे दिया reset लिंक इस्तेमाल करें।',
    },
    {
      id: 'nav',
      say: 'That rail is the whole app. Place an order. Check what you may sell. Upload a lot at once. Follow the ones you placed, and the people you sold to. Raise an issue. There is no money screen in here, and we come to that at the end.',
      sayBn:
        'বাঁ দিকের ওই সারিটাই পুরো অ্যাপ। New order দিয়ে অর্ডার বসান। What I sell-এ দেখুন কী বিক্রি করতে পারবেন। Upload a CSV দিয়ে একসঙ্গে অনেকগুলো দিন। My orders আর My customers-এ নিজের অর্ডার আর ক্রেতাদের খোঁজ রাখুন। Issues-এ সমস্যা জানান। এখানে টাকার কোনো স্ক্রিন নেই, আর সে কথায় আমরা শেষে আসছি।',
      sayHi:
        'बाईं तरफ़ की वह पट्टी ही पूरा ऐप है। New order से ऑर्डर डालें। What I sell में देखें कि क्या बेच सकते हैं। Upload a CSV से एक साथ कई ऑर्डर डालें। My orders और My customers में अपने ऑर्डर और ग्राहकों की ख़बर रखें। Issues में कोई दिक्कत बताएँ। यहाँ पैसे की कोई स्क्रीन नहीं है, और उस बात पर हम आख़िर में आएँगे।',
    },
    {
      id: 'catalogue',
      say: 'Start here, because this is the screen you will read out loud most. Every product your store has given you, what you sell each for, and how many are left. The price is your store’s to set, for you; you cannot change it.',
      sayBn:
        'এখান থেকে শুরু করুন, কারণ এই স্ক্রিনটাই আপনি সবচেয়ে বেশি পড়ে শোনাবেন। আপনার দোকান আপনাকে যে যে পণ্য দিয়েছে, প্রতিটা আপনি কত দামে বিক্রি করবেন, আর কতগুলো বাকি আছে। দামটা আপনার দোকান আপনার জন্য ঠিক করে দেয়; আপনি সেটা বদলাতে পারবেন না।',
      sayHi:
        'यहीं से शुरू करें, क्योंकि यही स्क्रीन आप सबसे ज़्यादा पढ़कर सुनाएँगे। आपकी दुकान ने आपको जो-जो प्रोडक्ट दिए हैं, हर एक को आप किस कीमत पर बेचेंगे, और कितने बचे हैं। कीमत आपकी दुकान आपके लिए तय करती है; आप उसे बदल नहीं सकते।',
    },
    {
      id: 'unpriced',
      say: 'A product with no price yet is named rather than quietly dropped. Nobody has set your figure for it, so it cannot go on an order — ask whoever runs your store. One that disappeared with no word is how somebody stops selling something and never learns why.',
      sayBn:
        'যে পণ্যের দাম এখনো দেওয়া হয়নি, সেটা চুপচাপ সরিয়ে না দিয়ে নাম ধরে দেখানো হয়। আপনার জন্য কেউ এর দাম ঠিক করে দেয়নি, তাই এটা কোনো অর্ডারে বসবে না — দোকান যে চালায় তাকে বলুন। কোনো কথা ছাড়াই একটা পণ্য হারিয়ে গেলে মানুষ সেটা বিক্রি করা বন্ধ করে দেয়, আর কেন বন্ধ হলো তা কখনো জানতেও পারে না।',
      sayHi:
        'जिस प्रोडक्ट की कीमत अभी नहीं दी गई, उसे चुपचाप हटाने के बजाय नाम लेकर दिखाया जाता है। आपके लिए उसकी कीमत किसी ने तय नहीं की, इसलिए वह किसी ऑर्डर में नहीं जाएगा — दुकान जो चलाता है उससे कहें। कोई प्रोडक्ट बिना कुछ कहे गायब हो जाए, तो आदमी उसे बेचना बंद कर देता है और कभी जान भी नहीं पाता कि क्यों।',
    },
    {
      id: 'new-order',
      say: 'Now place one. The form asks three things, in the order a phone call goes: what they are buying, where it is going, and how it is paid for.',
      sayBn:
        'এবার একটা অর্ডার বসান। ফর্মটা তিনটা জিনিস জিজ্ঞেস করে, যে ক্রমে ফোনের আলাপ এগোয় সেই ক্রমেই: সে কী কিনছে, জিনিসটা কোথায় যাবে, আর টাকা কীভাবে আসবে।',
      sayHi:
        'अब एक ऑर्डर डालिए। फ़ॉर्म तीन चीज़ें पूछता है, उसी क्रम में जिस क्रम में फ़ोन पर बात आगे बढ़ती है: वह क्या ख़रीद रहा है, चीज़ कहाँ जाएगी, और पैसा कैसे आएगा।',
    },
    {
      id: 'products',
      say: 'Pick the product and say how many. Add a line if they are buying more than one thing. Anything out of stock you cannot choose at all. Under the line are the two facts you would read down a phone: the price, and how many are left.',
      sayBn:
        'পণ্যটা বাছুন আর কতগুলো লাগবে বলুন। সে একটার বেশি জিনিস কিনলে আরেকটা লাইন যোগ করুন। স্টকে নেই এমন কিছু আপনি বাছতেই পারবেন না। লাইনের নিচে ওই দুটো তথ্য থাকে, যা আপনি ফোনে পড়ে শোনাতেন: দাম, আর কতগুলো বাকি আছে।',
      sayHi:
        'प्रोडक्ट चुनिए और बताइए कितने चाहिए। वह एक से ज़्यादा चीज़ ख़रीद रहा हो तो एक और लाइन जोड़ दें। स्टॉक में जो नहीं है, उसे आप चुन ही नहीं सकते। लाइन के नीचे वही दो बातें रहती हैं जो आप फ़ोन पर पढ़कर सुनाते: कीमत, और कितने बचे हैं।',
    },
    {
      id: 'customer',
      say: 'Then who it is going to. Name, phone with the country code, PIN code, street. The phone matters: Skydrop’s call centre rings that number to confirm the order, so a wrong digit stops the parcel before it is packed.',
      sayBn:
        'তারপর জিনিসটা কার কাছে যাবে। নাম, দেশের কোডসহ ফোন নম্বর, PIN code, রাস্তার ঠিকানা। ফোন নম্বরটা জরুরি: অর্ডার নিশ্চিত করতে Skydrop-এর কল সেন্টার ওই নম্বরেই ফোন করে, তাই একটা অঙ্ক ভুল হলে পার্সেল প্যাক হওয়ার আগেই থেমে যায়।',
      sayHi:
        'फिर चीज़ किसके पास जाएगी। नाम, देश के कोड के साथ फ़ोन नंबर, PIN code, गली का पता। फ़ोन नंबर ज़रूरी है: ऑर्डर पक्का करने के लिए Skydrop का call centre उसी नंबर पर फ़ोन करता है, इसलिए एक अंक ग़लत हो तो पार्सल पैक होने से पहले ही रुक जाता है।',
    },
    {
      id: 'landmark',
      say: 'And a landmark — what a driver looks for to find the door. It is required, because it is what finds a house with no number on it. Beside the bus depot gate gets delivered; a correct address with nothing to aim at often does not.',
      sayBn:
        'আর একটা ল্যান্ডমার্ক — দরজা খুঁজে পেতে ড্রাইভার যেটা দেখে। এটা দিতেই হবে, কারণ নম্বর নেই এমন বাড়ি এটাই খুঁজে বের করে। বাস ডিপোর গেটের পাশে — এটুকু লেখা থাকলে জিনিস পৌঁছে যায়; আর নিশানা ছাড়া নিখুঁত ঠিকানা অনেক সময় পৌঁছায় না।',
      sayHi:
        'और एक लैंडमार्क — दरवाज़ा ढूँढने के लिए ड्राइवर जो देखता है। यह देना ज़रूरी है, क्योंकि जिस घर पर नंबर नहीं है उसे यही ढूँढकर निकालता है। बस डिपो के गेट के पास — इतना लिखा हो तो चीज़ पहुँच जाती है; और निशानी के बिना पूरा सही पता अक्सर नहीं पहुँचता।',
    },
    {
      id: 'payment',
      say: 'Last, how it is paid for. Cash on delivery is the usual one: the courier collects from your customer on the doorstep, and what it collects is shown right there. Prepaid means they have already paid you.',
      sayBn:
        'শেষে, টাকা কীভাবে আসবে। Cash on delivery-ই সাধারণ নিয়ম: কুরিয়ার আপনার ক্রেতার কাছ থেকে দরজায় টাকা নেয়, আর কত নেবে সেটা ঠিক ওখানেই দেখানো থাকে। Prepaid মানে সে আপনাকে আগেই টাকা দিয়ে দিয়েছে।',
      sayHi:
        'आख़िर में, पैसा कैसे आएगा। Cash on delivery ही आम तरीका है: कूरियर आपके ग्राहक से दरवाज़े पर पैसा लेता है, और कितना लेगा यह वहीं दिखा दिया जाता है। Prepaid का मतलब है उसने आपको पहले ही पैसा दे दिया है।',
    },
    {
      id: 'place',
      say: 'Place it, and you are asked once more with the name, the number and the amount spelled out. Read that box rather than clicking through it: it is the last point at which a wrong number costs nothing.',
      sayBn:
        'Place order চাপলে আরেকবার জিজ্ঞেস করা হয়, আর সঙ্গে নাম, নম্বর আর টাকার পরিমাণ স্পষ্ট করে লেখা থাকে। ওই বাক্সটা না পড়ে পার হয়ে যাবেন না: এটাই শেষ জায়গা, যেখানে একটা ভুল নম্বরে কোনো ক্ষতি হয় না।',
      sayHi:
        'Place order दबाने पर एक बार फिर पूछा जाता है, और साथ में नाम, नंबर और रकम साफ़-साफ़ लिखी रहती है। उस डिब्बे को पढ़े बिना आगे न बढ़ें: यही आख़िरी जगह है, जहाँ एक ग़लत नंबर का कोई नुक़सान नहीं होता।',
    },
    {
      id: 'placed',
      say: 'Done. The order has its own number now, and that is what to quote if you ring Skydrop about it. Next, with nothing more from you: the call centre rings your customer, and only once they say yes is it packed.',
      sayBn:
        'হয়ে গেল। অর্ডারটার এখন নিজের একটা নম্বর আছে, আর এটা নিয়ে Skydrop-কে ফোন করলে ওই নম্বরটাই বলবেন। এরপর আপনার আর কিছু করার নেই: কল সেন্টার আপনার ক্রেতাকে ফোন করে, আর সে হ্যাঁ বললেই পার্সেল প্যাক হয়।',
      sayHi:
        'हो गया। ऑर्डर का अब अपना एक नंबर है, और इसके बारे में Skydrop को फ़ोन करें तो वही नंबर बताएँगे। आगे आपको कुछ नहीं करना है: call centre आपके ग्राहक को फ़ोन करता है, और उसकी हाँ मिलने पर ही पार्सल पैक होता है।',
    },
    {
      id: 'csv-template',
      say: 'When you have twenty of them, do not type twenty forms. Download the template first: the columns have to be the ones it names, and starting from our file saves you a rejected upload.',
      sayBn:
        'বিশটা অর্ডার থাকলে বিশটা ফর্ম টাইপ করবেন না। আগে Download the template: কলামগুলো ঠিক সেই নামেই থাকতে হবে, আর আমাদের ফাইল থেকে শুরু করলে আপলোড বাতিল হওয়ার ঝামেলা বাঁচে।',
      sayHi:
        'बीस ऑर्डर हों तो बीस फ़ॉर्म न भरें। पहले Download the template: कॉलम ठीक उन्हीं नामों के होने चाहिए, और हमारी फ़ाइल से शुरू करने पर अपलोड ख़ारिज होने का झंझट बच जाता है।',
    },
    {
      id: 'csv-check',
      say: 'Fill it in, drop it here, and check it before anything is placed. One row is one product line, so two rows sharing a reference become one order with two items. It says how many orders the file makes and names any row it will not take.',
      sayBn:
        'ফাইলটা ভরুন, এখানে ছেড়ে দিন, আর কোনো অর্ডার বসার আগেই পরীক্ষা করে নিন। একটা সারি মানে একটা পণ্যের লাইন, তাই একই reference-ওয়ালা দুটো সারি মিলে দুই পণ্যের একটা অর্ডার হয়। ফাইলটা থেকে কতগুলো অর্ডার হবে সেটা দেখায়, আর যে সারি নেবে না সেটার নামও বলে দেয়।',
      sayHi:
        'फ़ाइल भरें, यहाँ छोड़ें, और कोई ऑर्डर डलने से पहले ही उसे जाँच लें। एक row का मतलब एक प्रोडक्ट की लाइन, इसलिए एक ही reference वाली दो row मिलकर दो चीज़ों का एक ऑर्डर बनती हैं। फ़ाइल से कितने ऑर्डर बनेंगे यह दिखाता है, और जिस row को नहीं लेगा उसका नाम भी बता देता है।',
    },
    {
      id: 'csv-import',
      say: 'Then import. Every row becomes one of your orders and goes to the call centre as if you had typed it. A row that fails lands in an error report you can download and fix; nothing else waits for it.',
      sayBn:
        'তারপর Import। প্রতিটা সারি আপনার একটা অর্ডার হয়ে যায় আর কল সেন্টারে চলে যায় — আপনি হাতে লিখলে যেমন হতো, ঠিক তেমন। যে সারি হয় না, সেটা একটা error report-এ গিয়ে পড়ে, যেটা আপনি নামিয়ে ঠিক করতে পারেন; বাকি কিছু তার জন্য অপেক্ষা করে না।',
      sayHi:
        'फिर Import। हर row आपका एक ऑर्डर बन जाती है और call centre तक चली जाती है — जैसे आपने हाथ से लिखा होता, वैसे ही। जो row नहीं बनती, वह एक error report में चली जाती है, जिसे आप उतारकर ठीक कर सकते हैं; बाकी कुछ उसके लिए नहीं रुकता।',
    },
    {
      id: 'my-orders',
      say: 'Here is everything you placed — and only what you placed, not the rest of your store’s. Search by order number, by your own reference, by the customer or by the waybill. Or narrow the list to one status.',
      sayBn:
        'এখানে আপনার দেওয়া সব অর্ডার — আর শুধু আপনার দেওয়াগুলোই, দোকানের বাকিগুলো নয়। অর্ডার নম্বর দিয়ে, আপনার নিজের reference দিয়ে, ক্রেতার নাম দিয়ে, বা waybill দিয়ে খুঁজুন। অথবা তালিকাটা একটা মাত্র status-এ ছোট করে নিন।',
      sayHi:
        'यहाँ आपके दिए सारे ऑर्डर हैं — और सिर्फ़ आपके दिए हुए, दुकान के बाकी नहीं। ऑर्डर नंबर से, अपने reference से, ग्राहक के नाम से, या waybill से ढूँढें। या लिस्ट को किसी एक status तक छोटा कर लें।',
    },
    {
      id: 'one-order',
      say: 'Open one and the whole story is on a page. What is inside, where it is going, what is being collected, and the waybill your customer can track themselves. Underneath, every step in order — the courier’s own scans, not our guesses.',
      sayBn:
        'একটা খুললে পুরো ঘটনাটা এক পৃষ্ঠায় থাকে। ভিতরে কী আছে, কোথায় যাচ্ছে, কত টাকা আদায় হবে, আর যে waybill দিয়ে আপনার ক্রেতা নিজেই খোঁজ নিতে পারে। নিচে প্রতিটা ধাপ পরপর — কুরিয়ারের নিজের স্ক্যান, আমাদের অনুমান নয়।',
      sayHi:
        'कोई एक खोलें तो पूरी कहानी एक पेज पर रहती है। अंदर क्या है, कहाँ जा रहा है, कितना पैसा वसूला जाएगा, और वह waybill जिससे आपका ग्राहक ख़ुद ख़बर ले सकता है। नीचे हर कदम सिलसिले से — कूरियर के अपने स्कैन, हमारे अंदाज़े नहीं।',
    },
    {
      id: 'reattempt',
      say: 'Which is something you can do something about. Ask for another delivery attempt and say what changed — a better landmark, a time they will be in. A person reads that before a van goes anywhere. And the line beside the button says whether it happens now, or waits on your store.',
      sayBn:
        'আর এ নিয়ে আপনার কিছু করার আছে। Try delivering again চেপে আরেকবার ডেলিভারির চেষ্টা চান, আর কী বদলেছে সেটা লিখুন — আরও ভালো একটা ল্যান্ডমার্ক, বা সে কোন সময়ে বাড়িতে থাকবে। কোনো গাড়ি বেরোনোর আগে একজন মানুষ ওটা পড়ে। আর বোতামের পাশের লাইনটা বলে দেয় কাজটা এখনই হবে, নাকি আপনার দোকানের উত্তরের অপেক্ষায় থাকবে।',
      sayHi:
        'और इसके बारे में आप कुछ कर सकते हैं। Try delivering again दबाकर एक बार और डिलीवरी की कोशिश माँगें, और लिखें कि क्या बदला — कोई बेहतर लैंडमार्क, या वह किस वक़्त घर पर रहेगा। कोई गाड़ी निकलने से पहले एक आदमी उसे पढ़ता है। और बटन के पास की लाइन बता देती है कि काम अभी होगा, या आपकी दुकान के जवाब के इंतज़ार में रहेगा।',
    },
    {
      id: 'held',
      say: 'Here, it waits. So the honest thing to tell your customer is that you have asked, not that a van is coming. Nothing happens until somebody at your store answers, and their answer lands on this page.',
      sayBn:
        'এখানে এটা অপেক্ষায় থাকল। তাই ক্রেতাকে সত্যি কথাটাই বলুন — আপনি অনুরোধ করেছেন, গাড়ি আসছে এমন নয়। আপনার দোকান থেকে কেউ উত্তর না দেওয়া পর্যন্ত কিছুই হবে না, আর তাদের উত্তরটা এই পৃষ্ঠাতেই আসবে।',
      sayHi:
        'यहाँ यह इंतज़ार में रह गया। इसलिए ग्राहक से सच वही कहिए — आपने माँग की है, यह नहीं कि गाड़ी आ रही है। आपकी दुकान से कोई जवाब न दे, तब तक कुछ नहीं होगा, और उनका जवाब इसी पेज पर आएगा।',
    },
    {
      id: 'cancel',
      say: 'Calling an order off is the same shape. While nothing has shipped you can cancel: nothing is delivered and nothing is collected. This one went through on the spot, because your store allows it. Read which it is before you promise a customer anything.',
      sayBn:
        'অর্ডার বাতিল করার ব্যাপারটাও একই রকম। যতক্ষণ কিছু পাঠানো হয়নি, ততক্ষণ আপনি বাতিল করতে পারবেন: কিছু ডেলিভারিও হবে না, কোনো টাকাও আদায় হবে না। এটা সঙ্গে সঙ্গেই হয়ে গেছে, কারণ আপনার দোকান সেটা করতে দেয়। ক্রেতাকে কিছু কথা দেওয়ার আগে দেখে নিন আপনার ক্ষেত্রে কোনটা।',
      sayHi:
        'ऑर्डर रद्द करने का तरीका भी ऐसा ही है। जब तक कुछ भेजा नहीं गया, तब तक आप रद्द कर सकते हैं: न कुछ डिलीवर होगा, न कोई पैसा वसूला जाएगा। यह वहीं-के-वहीं हो गया, क्योंकि आपकी दुकान इसकी इजाज़त देती है। ग्राहक से कोई वादा करने से पहले देख लें कि आपके मामले में कौन-सा है।',
    },
    {
      id: 'customers',
      say: 'Everyone you have sold to, how many orders each, and when the last one was. Again, the people you placed an order for, not your store’s whole book. Click a name and you get their orders.',
      sayBn:
        'আপনি যাদের কাছে বিক্রি করেছেন সবাই, কার কতগুলো অর্ডার, আর শেষ অর্ডারটা কবে। এখানেও আপনি যাদের জন্য অর্ডার বসিয়েছেন শুধু তারাই, দোকানের পুরো খাতা নয়। একটা নামে চাপ দিলে তার অর্ডারগুলো দেখতে পাবেন।',
      sayHi:
        'जिन सबको आपने बेचा है, किसके कितने ऑर्डर, और आख़िरी ऑर्डर कब था। यहाँ भी सिर्फ़ वही लोग जिनके लिए आपने ऑर्डर डाला, दुकान का पूरा खाता नहीं। किसी नाम पर दबाएँ तो उसके ऑर्डर मिल जाते हैं।',
    },
    {
      id: 'issue',
      say: 'When something needs a person — a parcel arrived damaged, one has gone quiet, a customer is telling you something the tracking does not — raise an issue. It hangs off one of your orders, so whoever reads it knows which parcel. Skydrop and your store both reply, on one thread.',
      sayBn:
        'কোনো কিছুতে মানুষের দরকার হলে — পার্সেল ভাঙা অবস্থায় পৌঁছেছে, একটা পার্সেল চুপ হয়ে গেছে, বা ক্রেতা এমন কিছু বলছে যা tracking-এ নেই — Raise an issue করুন। এটা আপনার একটা অর্ডারের সঙ্গে জুড়ে থাকে, তাই যে পড়বে সে জানে কোন পার্সেলের কথা হচ্ছে। Skydrop আর আপনার দোকান, দুই পক্ষই একই আলাপে উত্তর দেয়।',
      sayHi:
        'जब किसी बात में आदमी की ज़रूरत हो — पार्सल टूटा हुआ पहुँचा, कोई पार्सल चुप हो गया, या ग्राहक कुछ ऐसा बता रहा है जो tracking में नहीं है — तो Raise an issue करें। यह आपके किसी एक ऑर्डर से जुड़ा रहता है, इसलिए जो पढ़ेगा उसे पता रहेगा कि कौन-से पार्सल की बात है। Skydrop और आपकी दुकान, दोनों एक ही बातचीत में जवाब देते हैं।',
    },
    {
      id: 'digest',
      say: 'And every morning a summary is waiting here: what was delivered yesterday, what came back, and what could not be delivered. Only yours. It comes to this list and not by email.',
      sayBn:
        'আর প্রতিদিন সকালে এখানে একটা সারসংক্ষেপ অপেক্ষা করে: গতকাল কী কী ডেলিভারি হয়েছে, কী কী ফেরত এসেছে, আর কী কী ডেলিভারি করা যায়নি। শুধু আপনার নিজেরগুলো। এটা এই তালিকাতেই আসে, ইমেইলে আসে না।',
      sayHi:
        'और हर सुबह यहाँ एक ख़ुलासा इंतज़ार करता है: कल क्या-क्या डिलीवर हुआ, क्या वापस आया, और क्या डिलीवर नहीं हो सका। सिर्फ़ आपके अपने। यह इसी लिस्ट में आता है, ईमेल पर नहीं।',
    },
    {
      id: 'outro',
      say: 'One last thing, said plainly. You will not see what your store pays for a product, or what it makes on what you sell. That is your store’s arrangement with its supplier, not something kept back from you, and it is why there is no wallet in here. What is yours is what you sell, and how well you sell it — and your store sees that, order by order.',
      sayBn:
        'শেষ একটা কথা, সোজা ভাষায়। আপনার দোকান কোনো পণ্যের জন্য কত দেয়, বা আপনার বিক্রি থেকে তার কত লাভ হয়, সেটা আপনি দেখতে পাবেন না। ওটা আপনার দোকান আর তার সরবরাহকারীর মধ্যের বন্দোবস্ত, আপনার কাছ থেকে লুকিয়ে রাখা কিছু নয় — আর এই কারণেই এখানে কোনো wallet নেই। আপনার জিনিস হলো আপনি কী বিক্রি করছেন আর কত ভালো বিক্রি করছেন — আর আপনার দোকান সেটা অর্ডার ধরে ধরে দেখতে পায়।',
      sayHi:
        'आख़िर में एक बात, सीधी ज़ुबान में। आपकी दुकान किसी प्रोडक्ट के लिए कितना देती है, या आपकी बिक्री पर उसे कितना मिलता है, यह आप नहीं देख पाएँगे। वह आपकी दुकान और उसके सप्लायर के बीच का बंदोबस्त है, आपसे छिपाई गई कोई बात नहीं — और इसी वजह से यहाँ कोई wallet नहीं है। आपका हिस्सा है यह कि आप क्या बेचते हैं और कितना अच्छा बेचते हैं — और आपकी दुकान वह ऑर्डर-दर-ऑर्डर देखती है।',
    },
  ],
};

/* ──────────────────────────────── flow ───────────────────────────── */

/**
 * The helpers are LOCAL COPIES, and that is deliberate.
 *
 * `flows.mjs` has `signIn`, `withRetry` and `signInAndOpen` and exports
 * none of them — and it IMPORTS this module to register the flow, so
 * reaching back into it would close a cycle. The long modules are
 * one-per-video and self-contained on purpose (`long/README.md`); two
 * copies of a six-line wait is the price of four authors not editing
 * one file.
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
 * Reach a page THE WAY THE APP DOES — by clicking its nav link.
 *
 * Never `page.goto` once signed in: a full load drops the in-memory
 * access token (FE-1) and the first render races the refresh. Clicking
 * keeps the SPA alive, so there is no race to lose, and it is what a
 * person does.
 */
async function openFromNav({ page, stage }, href, probe) {
  await stage.clickIt(page.locator(`a[href="${href}"]`).first(), { after: 900 });
  await page.waitForURL((u) => u.pathname === href, { timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  if (probe !== undefined) await withRetry(page, probe);
}

/** One `section.as-section`, found through its own heading text. */
function section(page, heading) {
  return page.locator('section.as-section').filter({ hasText: heading }).first();
}

/** One `.as-notice`, found through its words rather than its tone. */
function notice(page, words) {
  return page.locator('.as-notice').filter({ hasText: words }).first();
}

/**
 * One dialog BY ITS OWN TITLE.
 *
 * The re-attempt flow has TWO dialogs open at once — the form, and the
 * confirm on top of it — and both are `role="dialog"` with a button
 * named "Send it". `.first()` would be DOM order, which is not a fact
 * about which one is in front.
 */
function dialogTitled(page, title) {
  return page.getByRole('dialog').filter({ hasText: title }).first();
}

/** Narrow the orders list to one status and open the first row. */
async function openFirstWithStatus({ page, stage }, status) {
  const filter = page.getByLabel(/^Filter by status\s*\*?$/).first();
  await stage.point(filter, { settle: 500 });
  await filter.selectOption(status);
  await page.waitForTimeout(1500);
  await withRetry(page, page.locator('tbody tr').first().locator('a[href^="/orders/"]').first());
  const row = page.locator('tbody tr').first().locator('a[href^="/orders/"]').first();
  await stage.clickIt(row, { after: 1200 });
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/i, { timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

export const flow = {
  app: 'associate',

  /**
   * The upload PUTs the CSV at whatever `presignPutUrl` handed back,
   * which on a filming stack is a `mock://` string Chromium cannot
   * fetch. The shim is a no-op for every other URL, so arming it costs
   * the rest of the take nothing.
   */
  needsSpacesShim: true,

  /**
   * WHAT THE SEED MUST HAVE MADE.
   *
   * Everything is at ONE reseller store with ONE filming associate. The
   * video places a real order, cancels a real order and files a real
   * re-attempt request, so each take needs the world rebuilt — which is
   * what `seed-demo-data.mjs` does before every take anyway.
   */
  seed: [
    'A reseller store of the demo seller, APPROVED and ACTIVE, with its catalogue enabled and priced for the store (RS-3) — the one the reseller videos already film, so nothing new.',
    'The FILMING ASSOCIATE: a `store_users` row at that store holding the `associate` role ALONE (so `order_scope` resolves to OWN and the invitation/sign-in copy is the portal’s), with its invitation ACCEPTED and a known password. `record.mjs` signs in as `APPS.associate.identity`, which defaults to `ravi@punesilkstudio.test` / `Assoc-Demo-2026` — so that is the row to make.',
    'The filming associate is NOT paused: `store_users.orders_paused_at` is NULL. The video places an order and `orders.create` is pause-gated, so a paused associate makes the take fail at the `place` step. The pause notice is deliberately not filmed.',
    '`associate_prices` rows for the filming associate on AT LEAST THREE sellable variants, every price inside that store variant’s seller retail range (RS-3 `minRetailInr`/`maxRetailInr`) so nothing is flagged out of range.',
    'EXACTLY ONE sellable variant with NO `associate_prices` row for that person — the `unpriced` step films the "Waiting for a price" notice and the flagged row, and both are absent when every product is priced.',
    'Real visible stock on the priced variants: `availableQuantity` of at least 3 on the one the order form picks, so the option is not `disabled` and the line note reads a number rather than "None left".',
    'A PENDING `store_user_invitations` row for a SECOND, never-accepted person at the same store, with the `associate` role ALONE (so `invitationAppUrl` points at the portal), and its token in `out/generated*/associate-everything.json` as `invitationToken` (`store_user_invitations.token` is stored in the clear and is unique, so it reads straight back off the row). The `invitation` step previews that page and never submits it, so the row survives the take and the video can be re-shot.',
    'At least two orders of the filming associate (`orders.placed_by_store_user_id` = them) in `DELIVERY_FAILED`, each with a LIVE shipment carrying a waybill and a real `tracking_events` timeline, so the order page shows scans and the re-attempt section is open (`DELIVERY_ACTION_STATUSES`).',
    'At least one other order of theirs in `PENDING_CONFIRMATION` besides the one the video places — the `cancel` step takes the first row of that filtered list, and it must not depend on the `place` step having already run.',
    'Orders of theirs in a spread of other statuses — CONFIRMED, DISPATCHED, DELIVERED, RTO_RECEIVED — so the `my-orders` list and its status filter have something to show.',
    'NO open `order_delivery_action_requests` row on the DELIVERY_FAILED parcel: a previous take leaves one PENDING and the next gets `DELIVERY_ACTION_ALREADY_OPEN` mid-scene. Clear them the way `unrecordTutorialPayouts` clears its own.',
    '`reseller_store_action_policy` for that store with `reattempt = ASK_SELLER` and `cancel = DIRECT`. The contrast is the teaching point of the `held` and `cancel` steps — ASK_SELLER also means the re-attempt files a request rather than calling a courier, and DIRECT means the cancel visibly completes.',
    'At least two customers of theirs with more than one order each, so the `customers` list is not one row.',
    'One `tickets` row the filming associate raised on one of their own orders, with a reply from Skydrop on it, so the `issue` step opens on a list that is not empty before the video adds to it.',
    'An IN-APP notification for the filming associate on topic `store.daily_digest` (ASSOCIATE_DAILY_DIGEST_TOPIC) with the digest’s own title — "Yesterday: N delivered, N back, N not delivered" — and its body lines. It is IN-APP ONLY by NOTIF-23, so an empty inbox makes the `digest` step unfilmable.',
    `A bulk CSV at ${BULK_CSV}, written by the seed because its rows must name SKUs the store really sells and references nobody has used. SIX rows making FOUR orders (two share a reference, so the preview’s "making four orders" clause renders), ONE row deliberately bad so the "will not import" warning appears, and NO price column — an associate does not set one.`,
  ],

  /**
   * NOTHING SIGNS IN HERE. `record.mjs` opens `/login` before the
   * prologue, and beats two and three are the invitation page and the
   * sign-in — so the prologue only reads the fixture, which is what
   * carries the invitation token.
   */
  async prologue(ctx) {
    ctx.fx = await readFixture(SLUG);
    await ctx.page.waitForLoadState('networkidle').catch(() => {});
    await ctx.page.waitForTimeout(600);
  },

  steps: [
    {
      id: 'intro',
      run: async ({ page, stage }) => {
        await stage.dwellOn(page.locator('.sk-signin__card').first(), 2600);
      },
    },

    {
      id: 'invitation',
      /*
        PREVIEWED, NEVER ACCEPTED. Accepting would create a second
        person — one with no prices and no orders — and would spend the
        row, so the next take would open on "this link has already been
        used". The preview is a POST, so the token never reaches an
        access log; the page draws the store, the role and the email
        before it asks for anything.
      */
      run: async ({ page, stage, baseUrl, fx }) => {
        const token = typeof fx?.invitationToken === 'string' ? fx.invitationToken : '';
        /*
          FAIL-SOFT, and the ONLY step here that is. Nothing after this
          needs the token, so a seed that did not write one should cost
          the shot and not the take — the line still plays truthfully
          over the sign-in card, which is the same screen the invitation
          lands you on once it is accepted. Every other step reaches for
          something the seed guarantees and should fail loudly.
        */
        if (token !== '') {
          await page.goto(`${baseUrl}/auth/accept-invitation?token=${token}`, {
            waitUntil: 'domcontentloaded',
          });
          await withRetry(page, page.locator('.sk-signin__card').first());
          await page.waitForTimeout(1200);
        }
        await stage.dwellOn(page.locator('.sk-signin__card').first(), 3400);
        const pw = page.getByLabel(/password/i).first();
        if ((await pw.count()) > 0) await stage.dwellOn(pw, 2200);
        else await page.waitForTimeout(2200);
      },
    },

    {
      id: 'sign-in',
      /*
        LOGIN IS THROTTLED 5 PER 15 MINUTES per email and IP, so a
        morning of re-takes runs out. `scripts/tutorials/lib/clear-login-throttle.mjs`
        is what clears it between takes.

        The form hard-navigates to `/orders` on success, so the wait is
        on the URL and then on the list's own data — the fresh load has
        no access token yet (FE-1).
      */
      run: async ({ page, stage, baseUrl, seller }) => {
        await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
        await stage.typeIn(page.getByLabel(/email/i).first(), seller.email, { after: 300 });
        await stage.typeIn(page.getByLabel(/password/i).first(), seller.password, {
          delay: 40,
          after: 500,
        });
        await stage.clickIt(page.getByRole('button', { name: /sign in/i }).first(), {
          after: 1400,
        });
        await page.waitForURL((u) => u.pathname === '/orders', { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await withRetry(page, page.getByRole('heading', { name: 'My orders' }).first());
      },
    },

    {
      id: 'nav',
      run: async ({ page, stage }) => {
        // The rail, not one link: the line counts the whole app.
        await stage.dwellOn(page.locator('nav[aria-label="Main"]').first(), 4200);
      },
    },

    {
      id: 'catalogue',
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFromNav(ctx, '/catalogue', page.locator('table tbody tr').first());
        await stage.dwellOn(page.locator('thead tr').first(), 2400);
        await stage.dwellOn(page.locator('tbody tr').first(), 2600);
      },
    },

    {
      id: 'unpriced',
      /*
        BOTH HALVES. The banner says how many and what to do; the row
        itself carries the flag, because this is the screen somebody
        checks one price on and a count at the top is not where they are
        looking. The seed guarantees exactly one unpriced variant, so
        neither reach is optional — if either is missing the world is
        wrong and the failure should be loud.
      */
      run: async ({ page, stage }) => {
        await stage.dwellOn(notice(page, 'Waiting for a price'), 3200);
        const flagged = page.locator('span.as-flag[data-tone="warn"]').first();
        await flagged.scrollIntoViewIfNeeded();
        await stage.dwellOn(flagged, 2600);
      },
    },

    {
      id: 'new-order',
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFromNav(ctx, '/orders/new', page.getByLabel(/^Product\s*\*?$/).first());
        await stage.dwellOn(section(page, 'What they are buying'), 2000);
      },
    },

    {
      id: 'products',
      /*
        A native `<select>`, so `selectOption` is the supported path.
        BY INDEX, not by label: the option text carries the live
        availability ("… — 7 available"), which moves between takes, and
        the picker only ever holds the PRICED variants anyway. An
        out-of-stock option is `disabled`, which is the fact the line
        names.
      */
      run: async ({ page, stage }) => {
        const picker = page.getByLabel(/^Product\s*\*?$/).first();
        await stage.point(picker, { settle: 600 });
        await picker.selectOption({ index: 1 });
        await page.waitForTimeout(1200);
        await stage.typeIn(page.getByLabel(/^Quantity\s*\*?$/).first(), ORDER.quantity, {
          clear: true,
          after: 900,
        });
        await stage.dwellOn(
          page.getByRole('button', { name: 'Add another product' }).first(),
          1400,
        );
        /*
          The LINE NOTE is the second half of this beat: the price and
          the quantity left, under the line, which is where the question
          is actually asked. It was its own scene until the script was
          cut to six minutes — the note renders only once a product is
          chosen, so it belongs with the choosing rather than beside it.
        */
        await stage.dwellOn(page.locator('p.as-line__note').first(), 3200);
      },
    },

    {
      id: 'customer',
      run: async ({ page, stage }) => {
        await stage.typeIn(page.getByLabel(/^Name\s*\*?$/).first(), ORDER.name, {
          after: 400,
        });
        await stage.typeIn(page.getByLabel(/^Phone\s*\*?$/).first(), ORDER.phone, {
          clear: true,
          after: 600,
        });
        await stage.typeIn(page.getByLabel(/^PIN code\s*\*?$/).first(), ORDER.pin, {
          after: 400,
        });
        await stage.typeIn(page.getByLabel(/^Address\s*\*?$/).first(), ORDER.line1, {
          after: 600,
        });
      },
    },

    {
      id: 'landmark',
      run: async ({ page, stage }) => {
        await stage.typeIn(page.getByLabel(/^Landmark\s*\*?$/).first(), ORDER.landmark, {
          after: 1800,
        });
      },
    },

    {
      id: 'payment',
      /*
        The CHOICE is filmed; the order is placed on COD.

        Selecting prepaid for real spends the store's wallet, and a
        balance that cannot cover the goods is refused outright
        (`STORE_BALANCE_INSUFFICIENT`) — a correct refusal, and a failed
        take under a line about placing an order. Same reason the
        reseller video dwells on it rather than choosing it.
      */
      run: async ({ page, stage }) => {
        await stage.glide(300);
        await stage.dwellOn(page.getByText('Cash on delivery', { exact: true }).first(), 2000);
        await stage.dwellOn(page.getByLabel(/Cash to collect/i).first(), 2200);
        await stage.dwellOn(page.getByText('Prepaid', { exact: true }).first(), 1800);
      },
    },

    {
      id: 'place',
      /*
        The page's own submit and the dialog's confirm carry the SAME
        accessible name ("Place order" — the van button's `aria-label`),
        so the second click is scoped to the dialog.
      */
      run: async ({ page, stage }) => {
        await stage.clickIt(
          page.getByRole('button', { name: 'Place order', exact: true }).first(),
          {
            after: 1200,
          },
        );
        const dialog = dialogTitled(page, 'Place this order?');
        await dialog.waitFor({ timeout: 15_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm').first(), 3200);
        await stage.clickIt(
          dialog.getByRole('button', { name: 'Place order', exact: true }).first(),
          { after: 1600 },
        );
      },
    },

    {
      id: 'placed',
      run: async ({ page, stage }) => {
        await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await withRetry(page, page.locator('.sk-ph__title').first());
        // The order's own number, then the status beside it.
        await stage.dwellOn(page.locator('.sk-ph__title').first(), 2600);
        // The status chip beside it — `StatusChip`'s own root class.
        await stage.dwellOn(page.locator('span.sk-chip').first(), 2400);
      },
    },

    {
      id: 'csv-template',
      /*
        A `<button>` that builds a blob and clicks a synthetic anchor,
        so there is no href to read — but a real download event fires,
        which is what proves the file was produced.
      */
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFromNav(
          ctx,
          '/orders/import',
          page.getByRole('heading', { name: 'Upload orders' }).first(),
        );
        const saved = page.waitForEvent('download', { timeout: 15_000 }).catch(() => null);
        await stage.clickIt(page.getByRole('button', { name: 'Download the template' }).first(), {
          after: 1600,
        });
        await saved;
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2400);
      },
    },

    {
      id: 'csv-check',
      run: async ({ page, stage }) => {
        await page.locator('input[type="file"]').first().setInputFiles(BULK_CSV);
        await page.waitForTimeout(1000);
        await stage.clickIt(page.getByRole('button', { name: 'Upload and check' }).first(), {
          after: 1400,
        });
        // Six rows making four orders — the clause only renders when the
        // two numbers differ, which is why the seed shapes the file so.
        await withRetry(page, page.locator('p.as-body').first());
        await stage.dwellOn(page.locator('p.as-body').first(), 2800);
        await stage.dwellOn(notice(page, 'will not import'), 3000);
      },
    },

    {
      id: 'csv-import',
      run: async ({ page, stage }) => {
        const go = page.getByRole('button', { name: /^Import \d+ orders?$/ }).first();
        await stage.clickIt(go, { after: 1200 });
        const dialog = dialogTitled(page, 'Import these orders?');
        await dialog.waitFor({ timeout: 15_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm').first(), 2600);
        await stage.clickIt(dialog.getByRole('button', { name: /^Import \d+ orders?$/ }).first(), {
          after: 1800,
        });
        // The uploads table re-fetches every five seconds while the run
        // is live, so this waits for the row rather than snapshotting.
        await withRetry(
          page,
          page.getByRole('cell', { name: /associate-bulk-orders\.csv/i }).first(),
        );
        await stage.glide(300);
        await stage.dwellOn(section(page, 'Recent uploads'), 3000);
      },
    },

    {
      id: 'my-orders',
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFromNav(ctx, '/orders', page.locator('tbody tr').first());
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2600);
        await stage.dwellOn(page.locator('thead tr').first(), 2400);
      },
    },

    {
      id: 'one-order',
      /*
        Reached THROUGH THE STATUS FILTER rather than by an order number
        from the fixture: it films the filter the line before mentions,
        and it cannot go stale against a reseeded box. The seed
        guarantees at least two DELIVERY_FAILED orders, so the first row
        exists and carries a waybill and a timeline.
      */
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFirstWithStatus(ctx, 'DELIVERY_FAILED');
        await withRetry(page, page.locator('.sk-ph__title').first());
        await stage.dwellOn(section(page, 'What is inside'), 2200);
        await stage.dwellOn(section(page, 'The parcel'), 2600);
        await stage.glide(420);
        await stage.dwellOn(section(page, 'What has happened'), 3000);
      },
    },

    {
      id: 'reattempt',
      run: async ({ page, stage }) => {
        const panel = section(page, 'The delivery did not work?');
        await panel.scrollIntoViewIfNeeded();
        await stage.dwellOn(panel, 2200);
        // The note beside the button is the honest half: it says whether
        // this happens now or waits on the store, BEFORE anybody clicks.
        await stage.dwellOn(page.locator('.as-offer__note').first(), 2800);
        await stage.clickIt(page.getByRole('button', { name: 'Try delivering again' }).first(), {
          after: 1200,
        });
        const form = dialogTitled(page, 'Try delivering again');
        await form.waitFor({ timeout: 15_000 });
        await stage.typeIn(
          form.getByLabel(/^What happened\s*\*?$/).first(),
          'Customer was out when the driver came. She is in after six and the gate is beside the bus depot, not the lane behind it.',
          { delay: 32, after: 1200 },
        );
      },
    },

    {
      id: 'held',
      /*
        SENT FOR REAL, and safe to: the store's policy is ASK_SELLER, so
        this files a request for somebody at the store to answer and
        calls no courier. The toast is the sentence that matters — "we
        have asked them", not "done" — and an associate who believes a
        van is coming will say so to a customer.
      */
      run: async ({ page, stage }) => {
        const form = dialogTitled(page, 'Try delivering again');
        await stage.clickIt(form.getByRole('button', { name: /^Send it$/ }).first(), {
          after: 900,
        });
        const confirm = dialogTitled(page, 'Ask for another delivery attempt?');
        await confirm.waitFor({ timeout: 15_000 });
        await stage.dwellOn(confirm.locator('.sk-confirm').first(), 2600);
        await stage.clickIt(confirm.getByRole('button', { name: /^Send it$/ }).first(), {
          after: 1600,
        });
        const toast = page
          .locator('[role="status"]')
          .filter({ hasText: /approve|asked them/i })
          .first();
        if ((await toast.count()) > 0) await stage.dwellOn(toast, 2600);
        else await page.waitForTimeout(2600);
        // The request joins the parcel's own history, which is where
        // the store's answer lands later.
        await stage.dwellOn(section(page, 'The delivery did not work?'), 2400);
      },
    },

    {
      id: 'cancel',
      /*
        A DIFFERENT ORDER, and a real cancel. The store's policy is
        DIRECT here, so it completes on screen — which is the whole
        contrast with the beat before: the two asks look the same and
        the page tells you which is which.

        PENDING_CONFIRMATION rather than CONFIRMED: `SELLER_CANCELLABLE_STATES`
        closes at confirmation, so the Cancel button is not rendered on
        a confirmed order at all.
      */
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFromNav(ctx, '/orders', page.locator('tbody tr').first());
        await openFirstWithStatus(ctx, 'PENDING_CONFIRMATION');
        await withRetry(page, page.locator('.sk-ph__title').first());
        await stage.clickIt(page.getByRole('button', { name: 'Cancel this order' }).first(), {
          after: 1200,
        });
        const dialog = dialogTitled(page, 'Cancel this order?');
        await dialog.waitFor({ timeout: 15_000 });
        await stage.dwellOn(dialog.locator('.sk-confirm').first(), 2800);
        await stage.typeIn(
          dialog.getByLabel('Why?', { exact: false }).first(),
          'Customer rang back and asked us to hold it until next month.',
          { delay: 32, after: 800 },
        );
        await stage.clickIt(dialog.getByRole('button', { name: 'Cancel the order' }).first(), {
          after: 2000,
        });
      },
    },

    {
      id: 'customers',
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFromNav(ctx, '/customers', page.locator('tbody tr').first());
        await stage.dwellOn(page.locator('.sk-ph__subtitle').first(), 2400);
        await stage.dwellOn(page.locator('tbody tr').first(), 2800);
      },
    },

    {
      id: 'issue',
      /*
        RAISED FOR REAL. It writes a `tickets` row against one of this
        person's own orders, which is a message a human will read — fine
        in a demo world that is rebuilt per take, and the only way to
        film the thread it opens on.
      */
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFromNav(ctx, '/tickets', page.getByRole('heading', { name: 'Issues' }).first());
        await stage.clickIt(
          page.getByRole('link', { name: 'Raise an issue', exact: true }).first(),
          { after: 1200 },
        );
        await page.waitForURL((u) => u.pathname === '/tickets/new', { timeout: 20_000 });
        await withRetry(page, page.getByLabel(/^Which order\?\s*\*?$/).first());
        const which = page.getByLabel(/^Which order\?\s*\*?$/).first();
        await stage.point(which, { settle: 500 });
        await which.selectOption({ index: 1 });
        await page.waitForTimeout(800);
        await stage.typeIn(
          page.getByLabel(/^What is it about\?\s*\*?$/).first(),
          'Customer says the box arrived open',
          { after: 600 },
        );
        await stage.typeIn(
          page.getByLabel('What happened?', { exact: false }).first(),
          'She says the tape was cut and one of the two pieces is missing. She has photographs and will send them to me.',
          { delay: 32, after: 900 },
        );
        await stage.clickIt(page.getByRole('button', { name: /^Raise it$/ }).first(), {
          after: 1600,
        });
        await page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/i, { timeout: 25_000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await withRetry(page, page.locator('.sk-ph__title').first());
        await stage.dwellOn(section(page, 'The conversation'), 2800);
      },
    },

    {
      id: 'digest',
      /*
        The one notification the owner named by hand, and it is IN-APP
        ONLY (NOTIF-23), so this list is the only place it can be read.
        The item is opened — the title is the counts and the BODY is the
        per-parcel detail, which is the half somebody acts on.
      */
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFromNav(
          ctx,
          '/notifications',
          page.getByRole('heading', { name: 'Notifications' }).first(),
        );
        const digest = page
          .locator('li.as-ntf-item')
          .filter({ hasText: /delivered/i })
          .first();
        await digest.scrollIntoViewIfNeeded();
        await stage.dwellOn(digest.locator('.as-ntf-item__title').first(), 2400);
        await stage.clickIt(digest.locator('button.as-ntf-item__open').first(), { after: 1400 });
        await stage.dwellOn(digest, 3000);
      },
    },

    {
      id: 'outro',
      /*
        ENDS ON THE CATALOGUE, not on a dashboard — there is no
        dashboard in this app, for exactly the reason the line gives.
        What a sales person controls is on this screen: the products and
        the prices they sell them at.
      */
      run: async (ctx) => {
        const { page, stage } = ctx;
        await openFromNav(ctx, '/catalogue', page.locator('tbody tr').first());
        await stage.dwellOn(page.getByRole('heading', { name: 'What I sell' }).first(), 3000);
        await stage.dwellOn(page.locator('table').first(), 6000);
      },
    },
  ],
};
