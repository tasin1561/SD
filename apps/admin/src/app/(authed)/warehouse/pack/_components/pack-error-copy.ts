/**
 * Friendly, three-language copy for every refusal the pack bench can get.
 *
 * ── WHY THIS IS NOT `t()` (DO NOT "FIX" IT BACK TO ONE LANGUAGE) ─────
 * Everything else on this screen goes through `t()` in the locale the
 * person picked. The error dialog deliberately shows ENGLISH, BANGLA AND
 * HINDI AT THE SAME TIME, one under the other. The reason is the user:
 * warehouse packers who are amateurs, often barely literate, and who may
 * read none of the three. They cannot necessarily change the console's
 * language setting, and the person called over to help them may read a
 * different one than they do. Showing all three costs a few lines of a
 * dialog and removes the failure mode where the one language on screen is
 * the one nobody in the room reads.
 *
 * That is why the strings live here, as `[en, bn, hi]` triples, instead of
 * in `src/i18n/messages` — the catalogue's whole job is to serve ONE
 * locale, and a key read three ways at once does not belong in it.
 *
 * ── FE-2 IS NOT WAIVED ───────────────────────────────────────────────
 * This copy is keyed off the server's error CODE and sits ABOVE the
 * server's `[CODE] message`, which the dialog still renders VERBATIM. The
 * friendly sentence is for the packer; the verbatim verdict is for
 * whoever is called over. Never hide it, never contradict it, and never
 * decide here what the server would have refused.
 *
 * ── WRITING RULES ────────────────────────────────────────────────────
 * One sentence per language, for someone who reads slowly: what they did
 * wrong, then what to do next. No jargon, no code names, no conditionals.
 * Numerals stay Western (0-9) in every language — the same rule the
 * message catalogue's spec enforces.
 *
 * An unknown code is NOT a blank dialog: `FALLBACK` carries a generic
 * three-language "something went wrong, call your supervisor" and the
 * dialog still shows the raw server message beneath it.
 *
 * ── A SENTENCE CAN CARRY A VALUE (2026-11-10, owner) ─────────────────
 * "You scanned the wrong parcel" is only half an instruction; the useful
 * half is WHICH parcel to scan. So the server now sends a `details`
 * object beside its code (`{ awb, otherAwb, item, state, who, when }`)
 * and these sentences can interpolate it.
 *
 * What a refusal may NAME, and what it may not: a staff colleague (same
 * warehouse, same employer) and a parcel in this building, yes. Another
 * CLIENT's company name or product name, no — not even to a packer
 * holding their goods. The scanned code is echoed instead; it is already
 * in the packer's hand, so it discloses nothing.
 *
 * Two bits of syntax, both deliberate:
 *
 *   `{awb}`      the value, substituted.
 *   `[[ … ]]`    an OPTIONAL segment: kept when every `{placeholder}`
 *                inside it has a value, dropped WHOLE when one does not.
 *
 * The segment exists because a refusal must never show a packer the
 * literal text `{awb}`, and because a sentence with the value bolted
 * mid-clause cannot be dropped cleanly. Each language puts the segment
 * where ITS word order wants it — this is translation, not substitution
 * into English grammar. A spec asserts every placeholder sits inside a
 * segment, so a missing value can only ever cost a clause.
 */

/**
 * The SHAPE of the problem, which the dialog turns into an icon and a
 * colour. Colour is never the only signal — the icon and the words carry
 * it too, for a colour-blind packer (and because the project's
 * accessibility rule forbids colour alone).
 */
export type PackErrorKind =
  /** Wrong thing in hand: set it down, move on. */
  | 'wrongItem'
  /** Already done: nothing is broken, just go forward. */
  | 'duplicate'
  /** A counting problem: the list on screen is the answer. */
  | 'count'
  /** Not this parcel's turn, or not this bench's. */
  | 'notReady'
  /** Nothing arrived: scan again. */
  | 'empty'
  /** Hands off and fetch a human. */
  | 'stop';

/** One sentence in all three. */
export interface PackErrorTriple {
  readonly en: string;
  readonly bn: string;
  readonly hi: string;
}

/**
 * ── FOUR FACTS, NOT ONE (2026-11-10, owner) ──────────────────────────
 * "show them the real error that the error actually is, and what is the
 * scenario, and for whom this blunder has appeared, and what is the
 * solution, so that they can easily fix this between them."
 *
 * With four benches running, most refusals here are not "you did
 * something stupid" — they are "somebody else got there first", and two
 * colleagues standing at a screen that says only WHAT is wrong cannot
 * settle it without fetching a supervisor. So a refusal can carry:
 *
 *   the three sentences    WHAT happened (always)
 *   `why`                  the scenario, one short line — why this
 *                          happens when several people work at once
 *   `fix`                  the concrete action, naming who does it
 *   `{who}` / `{when}`     the colleague and the clock time, from the
 *                          server's `details`, interpolated into `fix`
 *                          and shown as a language-free fact row
 *
 * `why` and `fix` are OPTIONAL on purpose: a new code (the concurrency
 * audit may add some) drops in with just its three sentences and gains
 * the other two when somebody has something true to write. Nothing is
 * hardcoded per code anywhere but this table.
 */
export interface PackErrorCopy extends PackErrorTriple {
  readonly kind: PackErrorKind;
  /** Why this happens with several people on the floor. */
  readonly why?: PackErrorTriple;
  /** What to do about it, and who does it. */
  readonly fix?: PackErrorTriple;
}

/** Shown for any code this table does not know. Never a blank dialog. */
export const FALLBACK: PackErrorCopy = {
  kind: 'stop',
  en: 'Something went wrong. Call your supervisor and show them this screen.',
  bn: 'কিছু একটা ভুল হয়েছে। সুপারভাইজারকে ডাকুন এবং এই স্ক্রিনটি দেখান।',
  hi: 'कुछ गलत हुआ है। सुपरवाइज़र को बुलाएं और उन्हें यह स्क्रीन दिखाएं।',
};

/**
 * Every code the pack bench can produce, from `warehouse-pack`'s two
 * services plus the two the scan block raises. Grepped, not guessed.
 */
export const PACK_ERROR_COPY: Readonly<Record<string, PackErrorCopy>> = {
  PACK_CODE_UNKNOWN: {
    kind: 'wrongItem',
    en: 'This barcode is not known. Put the item aside and scan the next one.',
    bn: 'এই বারকোড চেনা যাচ্ছে না। জিনিসটি সরিয়ে রাখুন, পরেরটি স্ক্যান করুন।',
    hi: 'यह बारकोड पहचाना नहीं गया। सामान अलग रखें और अगला स्कैन करें।',
    why: {
      en: 'A sticker can be torn, printed wrong, or never printed at all.',
      bn: 'স্টিকার ছিঁড়ে যেতে পারে, ভুল ছাপা হতে পারে, বা কখনো ছাপাই হয়নি।',
      hi: 'स्टिकर फट सकता है, गलत छप सकता है, या कभी छपा ही नहीं।',
    },
    fix: {
      en: 'Look for a second sticker on the item; if there is none, ask the stock team to label it.',
      bn: 'জিনিসটিতে দ্বিতীয় কোনো স্টিকার আছে কিনা দেখুন; না থাকলে স্টক টিমকে লেবেল লাগাতে বলুন।',
      hi: 'सामान पर दूसरा स्टिकर देखें; न हो तो स्टॉक टीम से लेबल लगवाएं।',
    },
  },
  // The headline fix (2026-11-10, owner): "here it should show that you
  // have scanned a wrong parcel. please scan this awb parcel". It used to
  // arrive as PACK_CODE_UNKNOWN — a label that is perfectly well known,
  // just not this one's.
  PACK_WRONG_PARCEL_LABEL: {
    kind: 'wrongItem',
    en: 'This is a different parcel’s label. Put that parcel aside.[[ Scan {awb} — that is the box open on your bench.]]',
    bn: 'এটি অন্য একটি পার্সেলের লেবেল। সেই পার্সেলটি সরিয়ে রাখুন।[[ আপনার বেঞ্চে খোলা বাক্সটির লেবেল {awb} — সেটি স্ক্যান করুন।]]',
    hi: 'यह दूसरे पार्सल का लेबल है। उस पार्सल को अलग रखें।[[ आपकी बेंच पर खुले डिब्बे का लेबल {awb} है — वही स्कैन करें।]]',
    why: {
      en: 'Two parcels on one bench have two labels; a box stays with the label it was opened with.',
      bn: 'এক বেঞ্চে দুটি পার্সেল থাকলে দুটি লেবেল থাকে; বাক্সটি যে লেবেল দিয়ে খোলা হয়েছিল তার সাথেই থাকে।',
      hi: 'एक बेंच पर दो पार्सल हों तो दो लेबल होते हैं; डिब्बा उसी लेबल के साथ रहता है जिससे खोला गया।',
    },
    fix: {
      en: 'Keep that parcel for later[[ and scan {awb}]]. Nothing was added to the box.',
      bn: 'সেই পার্সেলটি পরে করার জন্য রাখুন[[ এবং {awb} স্ক্যান করুন]]। বাক্সে কিছুই যোগ হয়নি।',
      hi: 'उस पार्सल को बाद के लिए रखें[[ और {awb} स्कैन करें]]। डिब्बे में कुछ नहीं जोड़ा गया।',
    },
  },
  // Also used to be PACK_CODE_UNKNOWN. The seller-scoped lookup (LBL-2)
  // fails closed on purpose; it was failing closed on the WRONG reason.
  PACK_PRODUCT_OTHER_CLIENT: {
    kind: 'wrongItem',
    en: 'This item is another client’s stock[[, {client}’s]]. Put it back on their shelf; it cannot go in this box.',
    bn: 'এই জিনিসটি অন্য একজন ক্লায়েন্টের স্টকের[[ — {client}-এর]]। এটি তাদের তাকে ফেরত রাখুন, এই বাক্সে দেওয়া যাবে না।',
    hi: 'यह सामान दूसरे क्लाइंट के स्टॉक का है[[ — {client} का]]। इसे उनकी शेल्फ पर वापस रखें, यह इस डिब्बे में नहीं जाएगा।',
    why: {
      en: 'Every client’s stock is kept apart; one shelf’s item cannot go in another’s parcel.',
      bn: 'প্রত্যেক ক্লায়েন্টের স্টক আলাদা রাখা হয়; এক তাকের জিনিস অন্যের পার্সেলে যাবে না।',
      hi: 'हर क्लाइंट का स्टॉक अलग रखा जाता है; एक शेल्फ का सामान दूसरे के पार्सल में नहीं जाएगा।',
    },
    fix: {
      en: 'Hand it to the stock team[[ with the code {item}]] and scan the next item on the list.',
      bn: 'এটি স্টক টিমকে দিয়ে দিন[[ — কোড {item}]] এবং তালিকার পরের জিনিসটি স্ক্যান করুন।',
      hi: 'इसे स्टॉक टीम को दें[[ — कोड {item}]] और सूची का अगला सामान स्कैन करें।',
    },
  },
  // The box's own label, scanned into the product field. The bench
  // normally reads that as "close the box", so this is the hand-typed or
  // whitespace-mangled case — and it is a counting problem, not a wrong
  // item: the list on screen is the answer.
  PACK_OWN_LABEL_NOT_A_PRODUCT: {
    kind: 'count',
    en: 'That is this box’s own label, not a product. Scan the products on the list first[[, then scan {awb} again to finish]].',
    bn: 'এটি এই বাক্সেরই লেবেল, কোনো পণ্য নয়। আগে তালিকার পণ্যগুলো স্ক্যান করুন[[, তারপর শেষ করতে আবার {awb} স্ক্যান করুন]]।',
    hi: 'यह इसी डिब्बे का लेबल है, कोई सामान नहीं। पहले सूची के सामान स्कैन करें[[, फिर पूरा करने के लिए {awb} दोबारा स्कैन करें]]।',
  },
  // A serial we know, in a state the acceptance lookup skips. It fell
  // through to "unknown barcode" before, which sent a packer looking for
  // a label problem that was never there.
  PACK_UNIT_NOT_PICKED: {
    kind: 'notReady',
    en: 'This piece is on this order but it was not picked onto the bench[[ — the stock list has it as {state}]]. Put it aside and tell your supervisor.',
    bn: 'এই পিসটি এই অর্ডারের, কিন্তু এটি বেঞ্চে পিক করা হয়নি[[ — স্টক তালিকায় এটি {state} অবস্থায় আছে]]। সরিয়ে রাখুন এবং সুপারভাইজারকে বলুন।',
    hi: 'यह टुकड़ा इस ऑर्डर का है, लेकिन इसे बेंच पर पिक नहीं किया गया[[ — स्टॉक सूची में यह {state} है]]। अलग रखें और सुपरवाइज़र को बताएं।',
    why: {
      en: 'Picking is what puts a piece on a parcel; this one has not been through that step.',
      bn: 'পিকিংই একটি পিসকে পার্সেলের সাথে জোড়ে; এটি সেই ধাপ পার হয়নি।',
      hi: 'पिकिंग ही टुकड़े को पार्सल से जोड़ती है; यह उस चरण से नहीं गुज़रा।',
    },
    fix: {
      en: 'Give the piece to the picking desk and scan the pieces already on your bench.',
      bn: 'পিসটি পিকিং ডেস্কে দিয়ে দিন এবং বেঞ্চে থাকা পিসগুলো স্ক্যান করুন।',
      hi: 'टुकड़ा पिकिंग डेस्क को दें और बेंच पर रखे टुकड़े स्कैन करें।',
    },
  },
  PACK_PRODUCT_NOT_IN_ORDER: {
    kind: 'wrongItem',
    en: 'This product is not for this box[[ — {item} is not on this parcel]]. Put it aside and scan the next one.',
    bn: 'এই পণ্যটি এই বাক্সের নয়[[ — {item} এই পার্সেলে নেই]]। সরিয়ে রাখুন, পরেরটি স্ক্যান করুন।',
    hi: 'यह सामान इस डिब्बे का नहीं है[[ — {item} इस पार्सल में नहीं है]]। अलग रखें और अगला स्कैन करें।',
    why: {
      en: 'Items for several parcels sit on one bench; only what the screen lists goes in this box.',
      bn: 'এক বেঞ্চে কয়েক পার্সেলের জিনিস থাকে; স্ক্রিনে যা আছে কেবল তাই এই বাক্সে যাবে।',
      hi: 'एक बेंच पर कई पार्सल का सामान रहता है; स्क्रीन पर जो है वही इस डिब्बे में जाएगा।',
    },
    fix: {
      en: 'Put it back with the other parcel’s items and scan what the list still shows as missing.',
      bn: 'এটি অন্য পার্সেলের জিনিসের সাথে রেখে দিন এবং তালিকায় যা বাকি আছে তা স্ক্যান করুন।',
      hi: 'इसे दूसरे पार्सल के सामान के साथ रखें और सूची में जो बाकी है वह स्कैन करें।',
    },
  },
  PACK_QUANTITY_EXCEEDED: {
    kind: 'count',
    en: 'This box already has enough of this product. Do not put in another one.',
    bn: 'এই পণ্য এই বাক্সে যত দরকার তত হয়ে গেছে। আর একটি দেবেন না।',
    hi: 'इस डिब्बे में यह सामान पूरा हो गया है। एक और मत डालें।',
    why: {
      en: 'The box needs exactly what the order asked for — one more would short the next parcel.',
      bn: 'অর্ডারে যা চাওয়া হয়েছে ঠিক ততটাই বাক্সে যাবে — একটি বেশি দিলে পরের পার্সেলে কম পড়বে।',
      hi: 'ऑर्डर में जितना माँगा गया, उतना ही डिब्बे में जाएगा — एक ज़्यादा देने से अगले पार्सल में कम पड़ेगा।',
    },
    fix: {
      en: 'Leave the extra piece on the bench and scan whatever the list still shows as missing.',
      bn: 'বাড়তি পিসটি বেঞ্চে রেখে দিন এবং তালিকায় যা বাকি আছে তা স্ক্যান করুন।',
      hi: 'अतिरिक्त टुकड़ा बेंच पर रखें और सूची में जो बाकी है वह स्कैन करें।',
    },
  },
  PACK_UNIT_ALREADY_SCANNED: {
    kind: 'duplicate',
    en: 'You already scanned this exact piece. Take the next piece.',
    bn: 'এই একই পিসটি আগেই স্ক্যান করা হয়েছে। পরের পিসটি নিন।',
    hi: 'यही टुकड़ा पहले स्कैन हो चुका है। अगला टुकड़ा लें।',
    why: {
      en: 'A scanner sometimes fires twice; the box counted the piece the first time.',
      bn: 'স্ক্যানার মাঝে মাঝে দুবার পড়ে নেয়; বাক্স প্রথমবারেই পিসটি গুনে নিয়েছে।',
      hi: 'स्कैनर कभी दो बार पढ़ लेता है; डिब्बे ने पहली बार में टुकड़ा गिन लिया था।',
    },
    fix: {
      en: 'Nothing is wrong. Put that piece in the box and take the next one.',
      bn: 'কোনো সমস্যা নেই। পিসটি বাক্সে রাখুন এবং পরেরটি নিন।',
      hi: 'कुछ गलत नहीं है। टुकड़ा डिब्बे में रखें और अगला लें।',
    },
  },
  PACK_UNIT_WRONG_PARCEL: {
    kind: 'wrongItem',
    en: 'This piece belongs to another parcel. Put it aside and tell your supervisor.[[ The box on your bench is {awb}.]]',
    bn: 'এই পিসটি অন্য পার্সেলের। সরিয়ে রাখুন এবং সুপারভাইজারকে বলুন।[[ আপনার বেঞ্চে খোলা বাক্সটি {awb}।]]',
    hi: 'यह टुकड़ा दूसरे पार्सल का है। अलग रखें और सुपरवाइज़र को बताएं।[[ आपकी बेंच पर खुला डिब्बा {awb} है।]]',
    why: {
      en: 'Each piece is scanned onto one parcel at picking; it can only go in that box.',
      bn: 'পিকিংয়ের সময় প্রতিটি পিস একটি পার্সেলের জন্য স্ক্যান হয়; সেটি কেবল সেই বাক্সেই যাবে।',
      hi: 'पिकिंग के समय हर टुकड़ा एक ही पार्सल के लिए स्कैन होता है; वह उसी डिब्बे में जाएगा।',
    },
    fix: {
      en: 'Put that piece back in the picking tray and tell your supervisor which parcel you are on.',
      bn: 'পিসটি পিকিং ট্রেতে ফেরত রাখুন এবং আপনি কোন পার্সেলে আছেন সুপারভাইজারকে বলুন।',
      hi: 'टुकड़ा पिकिंग ट्रे में वापस रखें और सुपरवाइज़र को बताएं कि आप कौन-सा पार्सल कर रहे हैं।',
    },
  },
  PACK_LABEL_MISMATCH: {
    kind: 'wrongItem',
    en: 'This is another parcel’s label. Scan the label this box was opened with[[: {awb}]].',
    bn: 'এটি অন্য পার্সেলের লেবেল। যে লেবেল দিয়ে বাক্সটি খোলা হয়েছিল সেটি স্ক্যান করুন[[: {awb}]]।',
    hi: 'यह दूसरे पार्सल का लेबल है। जिस लेबल से डिब्बा खोला था वही स्कैन करें[[: {awb}]]।',
    why: {
      en: 'The closing scan proves the box in front of you is the box you opened.',
      bn: 'বন্ধ করার স্ক্যানটি প্রমাণ করে সামনের বাক্সটিই আপনি খুলেছিলেন।',
      hi: 'बंद करने का स्कैन साबित करता है कि सामने वाला डिब्बा वही है जो आपने खोला था।',
    },
    fix: {
      en: 'Find the sticker on the box you have been filling[[ — {awb} —]] and scan that one.',
      bn: 'যে বাক্সটি ভরছিলেন তার স্টিকারটি খুঁজুন[[ — {awb} —]] এবং সেটিই স্ক্যান করুন।',
      hi: 'जिस डिब्बे को भर रहे थे उसका स्टिकर ढूँढें[[ — {awb} —]] और वही स्कैन करें।',
    },
  },
  PACK_CONTENTS_MISMATCH: {
    kind: 'count',
    en: 'The box is not complete yet. Look at the list and scan what is still missing.',
    bn: 'বাক্সটি এখনো পুরো হয়নি। তালিকা দেখুন এবং যা বাকি আছে তা স্ক্যান করুন।',
    hi: 'डिब्बा अभी पूरा नहीं है। सूची देखें और जो बाकी है वह स्कैन करें।',
    why: {
      en: 'The box is checked item by item, not by total — two of one and none of another would pass a count.',
      bn: 'বাক্সটি মোট সংখ্যায় নয়, জিনিস ধরে ধরে মেলানো হয় — একটির দুটি আর অন্যটির শূন্য হলেও মোট মিলে যেতে পারে।',
      hi: 'डिब्बा कुल गिनती से नहीं, सामान देखकर जाँचा जाता है — एक के दो और दूसरे के शून्य से भी गिनती मिल सकती है।',
    },
    fix: {
      en: 'Scan whatever the list still shows as missing, then scan the label again to close the box.',
      bn: 'তালিকায় যা বাকি আছে তা স্ক্যান করুন, তারপর বাক্স বন্ধ করতে লেবেলটি আবার স্ক্যান করুন।',
      hi: 'सूची में जो बाकी है वह स्कैन करें, फिर डिब्बा बंद करने के लिए लेबल दोबारा स्कैन करें।',
    },
  },
  // A SUPERSEDED label (2026-11-10). It used to arrive as
  // PACK_AWB_NOT_FOUND, which an amateur reads as a broken scanner — so
  // the whole pile of old stickers gets re-scanned one at a time.
  PACK_LABEL_SUPERSEDED: {
    kind: 'notReady',
    en: 'This label was replaced and a new one was printed. Throw this sticker away.',
    bn: 'এই লেবেলটি বদলে গেছে এবং নতুন একটি ছাপা হয়েছে। এই স্টিকারটি ফেলে দিন।',
    hi: 'यह लेबल बदल गया है और नया छप चुका है। यह स्टिकर फेंक दें।',
    why: {
      en: 'A parcel re-booked with the courier gets a fresh waybill; the old sticker stops working the moment it does.',
      bn: 'কুরিয়ারে আবার বুক করা পার্সেল নতুন ওয়েবিল পায়; তখনই পুরনো স্টিকারটি আর কাজ করে না।',
      hi: 'कूरियर में दोबारा बुक हुए पार्सल को नया वेबिल मिलता है; तभी पुराना स्टिकर काम करना बंद कर देता है।',
    },
    fix: {
      en: 'Find the newest sticker on the box and scan that one[[ — {awb}]]. The scanner is fine.',
      bn: 'বাক্সের সবচেয়ে নতুন স্টিকারটি খুঁজে সেটিই স্ক্যান করুন[[ — {awb}]]। স্ক্যানারের কোনো সমস্যা নেই।',
      hi: 'डिब्बे पर सबसे नया स्टिकर ढूँढकर वही स्कैन करें[[ — {awb}]]। स्कैनर ठीक है।',
    },
  },
  PACK_AWB_NOT_FOUND: {
    kind: 'wrongItem',
    en: 'No parcel matches this label. Check that you scanned the right sticker.',
    bn: 'এই লেবেলের কোনো পার্সেল পাওয়া যাচ্ছে না। ঠিক স্টিকারটি স্ক্যান করেছেন কিনা দেখুন।',
    hi: 'इस लेबल का कोई पार्सल नहीं मिला। देखें कि आपने सही स्टिकर स्कैन किया है।',
    why: {
      en: 'A product sticker, an old print, or another warehouse’s label will match no parcel here.',
      bn: 'পণ্যের স্টিকার, পুরনো প্রিন্ট, বা অন্য গুদামের লেবেল এখানে কোনো পার্সেলের সাথে মিলবে না।',
      hi: 'सामान का स्टिकर, पुराना प्रिंट, या दूसरे गोदाम का लेबल यहाँ किसी पार्सल से नहीं मिलेगा।',
    },
    fix: {
      en: 'Scan the big parcel sticker, not the product one. If it still fails, tell your supervisor.',
      bn: 'পণ্যের স্টিকার নয়, পার্সেলের বড় স্টিকারটি স্ক্যান করুন। তাতেও না হলে সুপারভাইজারকে বলুন।',
      hi: 'सामान का नहीं, पार्सल का बड़ा स्टिकर स्कैन करें। फिर भी न हो तो सुपरवाइज़र को बताएं।',
    },
  },
  PACK_SCAN_EMPTY: {
    kind: 'empty',
    en: 'Nothing was scanned. Hold the scanner over the barcode and try again.',
    bn: 'কিছুই স্ক্যান হয়নি। স্ক্যানারটি বারকোডের উপর ধরে আবার চেষ্টা করুন।',
    hi: 'कुछ भी स्कैन नहीं हुआ। स्कैनर को बारकोड पर रखें और फिर करें।',
  },
  PACK_BOX_HELD_BY_OTHER: {
    kind: 'notReady',
    en: 'Another packer has this parcel open[[ — {awb}]]. Leave it and take the next parcel.',
    bn: 'এই পার্সেলটি অন্য একজন প্যাকারের কাছে খোলা আছে[[ — {awb}]]। এটি রেখে পরের পার্সেলটি নিন।',
    hi: 'यह पार्सल दूसरे पैकर के पास खुला है[[ — {awb}]]। इसे छोड़ें और अगला पार्सल लें।',
    why: {
      en: 'Two packers can reach for the same parcel; only the first one keeps it.',
      bn: 'দুজন প্যাকার একই পার্সেল ধরতে পারেন; প্রথমজনই সেটি রাখেন।',
      hi: 'दो पैकर एक ही पार्सल उठा सकते हैं; पहला ही उसे रखता है।',
    },
    fix: {
      en: 'Ask the packer who has it[[, {who},]] to close or cancel that box, then take the next parcel.[[ It frees itself at {when}.]]',
      bn: 'যার কাছে এটি খোলা আছে[[ — {who} —]] তাকে বাক্সটি বন্ধ বা বাতিল করতে বলুন, তারপর পরের পার্সেলটি নিন।[[ {when}-এ এটি নিজেই ছেড়ে যাবে।]]',
      hi: 'जिसके पास यह खुला है[[ — {who} —]] उससे डिब्बा बंद या रद्द करने को कहें, फिर अगला पार्सल लें।[[ {when} पर यह अपने आप छूट जाएगा।]]',
    },
  },
  PACK_BOX_ALREADY_OPEN: {
    kind: 'notReady',
    en: 'You already have a box open[[ — parcel {awb}]]. Finish or cancel it before starting another.',
    bn: 'আপনার একটি বাক্স আগেই খোলা আছে[[ — পার্সেল {awb}]]। নতুন শুরু করার আগে সেটি শেষ করুন বা বাতিল করুন।',
    hi: 'आपका एक डिब्बा पहले से खुला है[[ — पार्सल {awb}]]। नया शुरू करने से पहले उसे पूरा या रद्द करें।',
    why: {
      en: 'One packer can have only one box open, so nothing gets mixed between two parcels.',
      bn: 'একজন প্যাকারের একসাথে একটিই বাক্স খোলা থাকতে পারে, যাতে দুই পার্সেলের জিনিস মিশে না যায়।',
      hi: 'एक पैकर के पास एक ही डिब्बा खुला रह सकता है, ताकि दो पार्सल की चीज़ें न मिलें।',
    },
    fix: {
      en: 'Go back to your open box[[ — parcel {awb} —]] and finish or cancel it.[[ It frees itself at {when}.]]',
      bn: 'আপনার খোলা বাক্সে ফিরে যান[[ — পার্সেল {awb} —]] এবং সেটি শেষ করুন বা বাতিল করুন।[[ {when}-এ এটি নিজেই ছেড়ে যাবে।]]',
      hi: 'अपने खुले डिब्बे पर लौटें[[ — पार्सल {awb} —]] और उसे पूरा या रद्द करें।[[ {when} पर यह अपने आप छूट जाएगा।]]',
    },
  },
  PACK_BOX_NOT_FOUND: {
    kind: 'stop',
    en: 'This box is no longer on the screen. Scan the shipping label again to start over.',
    bn: 'এই বাক্সটি আর স্ক্রিনে নেই। আবার শুরু করতে শিপিং লেবেলটি নতুন করে স্ক্যান করুন।',
    hi: 'यह डिब्बा अब स्क्रीन पर नहीं है। फिर से शुरू करने के लिए शिपिंग लेबल दोबारा स्कैन करें।',
  },
  PACK_BOX_NOT_OPEN: {
    kind: 'notReady',
    en: 'This box is not open any more. Scan the shipping label again to start over.',
    bn: 'এই বাক্সটি আর খোলা নেই। আবার শুরু করতে শিপিং লেবেলটি নতুন করে স্ক্যান করুন।',
    hi: 'यह डिब्बा अब खुला नहीं है। फिर से शुरू करने के लिए शिपिंग लेबल दोबारा स्कैन करें।',
    why: {
      en: 'A box that is closed or cancelled is finished with; nothing more can go into it.',
      bn: 'বন্ধ বা বাতিল হওয়া বাক্সের কাজ শেষ; তাতে আর কিছু দেওয়া যায় না।',
      hi: 'बंद या रद्द हुआ डिब्बा खत्म हो चुका है; उसमें कुछ और नहीं जा सकता।',
    },
    fix: {
      en: 'Scan the shipping label again; if the parcel is still in the queue you will get a fresh box.',
      bn: 'শিপিং লেবেলটি আবার স্ক্যান করুন; পার্সেলটি কিউতে থাকলে নতুন একটি বাক্স পাবেন।',
      hi: 'शिपिंग लेबल दोबारा स्कैन करें; पार्सल कतार में हो तो नया डिब्बा मिलेगा।',
    },
  },
  // The packer who stepped away and came back (owner, 2026-11-10). The
  // box frees itself after a few minutes with NO SCANNING, so this is the
  // one refusal whose whole job is to say "nothing was lost".
  PACK_BOX_EXPIRED: {
    kind: 'notReady',
    en: 'This box was left open too long, so the parcel went back to the queue. Nothing was lost.',
    bn: 'এই বাক্সটি অনেকক্ষণ খোলা পড়ে ছিল, তাই পার্সেলটি কিউতে ফেরত গেছে। কিছুই হারায়নি।',
    hi: 'यह डिब्बा बहुत देर खुला पड़ा रहा, इसलिए पार्सल कतार में वापस चला गया। कुछ नहीं खोया।',
    why: {
      en: 'A box with no scanning for a few minutes frees itself, so a parcel is never stuck on an empty bench.',
      bn: 'কয়েক মিনিট কোনো স্ক্যান না হলে বাক্স নিজেই ছেড়ে যায়, যাতে পার্সেল খালি বেঞ্চে আটকে না থাকে।',
      hi: 'कुछ मिनट कोई स्कैन न हो तो डिब्बा अपने आप छूट जाता है, ताकि पार्सल खाली बेंच पर अटका न रहे।',
    },
    fix: {
      en: 'Scan the shipping label again[[ — {awb} —]] and scan the products back in. Nothing was packed.',
      bn: 'শিপিং লেবেলটি আবার স্ক্যান করুন[[ — {awb} —]] এবং পণ্যগুলো আবার স্ক্যান করুন। কিছুই প্যাক হয়নি।',
      hi: 'शिपिंग लेबल दोबारा स्कैन करें[[ — {awb} —]] और सामान फिर से स्कैन करें। कुछ पैक नहीं हुआ।',
    },
  },
  PACK_PARCEL_PACKED_BY_OTHER: {
    kind: 'duplicate',
    en: 'Somebody else packed this parcel while your box stood open. It is finished.',
    bn: 'আপনার বাক্স খোলা পড়ে থাকার সময় অন্য একজন এই পার্সেলটি প্যাক করে ফেলেছেন। এটি শেষ।',
    hi: 'आपका डिब्बा खुला पड़ा रहने के दौरान किसी और ने यह पार्सल पैक कर दिया। यह पूरा हो गया।',
    why: {
      en: 'When a box frees itself the parcel goes back to the queue, and the next free packer takes it.',
      bn: 'বাক্স নিজে ছেড়ে গেলে পার্সেলটি কিউতে ফিরে যায়, আর পরের খালি প্যাকার সেটি নিয়ে নেন।',
      hi: 'डिब्बा छूटने पर पार्सल कतार में लौट जाता है, और अगला खाली पैकर उसे ले लेता है।',
    },
    fix: {
      en: 'Nothing is lost — take the next parcel.[[ {who} finished this one.]][[ That was at {when}.]]',
      bn: 'কিছু হারায়নি — পরের পার্সেলটি নিন।[[ {who} এটি শেষ করেছেন।]][[ সময় ছিল {when}।]]',
      hi: 'कुछ नहीं खोया — अगला पार्सल लें।[[ {who} ने इसे पूरा किया।]][[ वह {when} पर था।]]',
    },
  },
  PACK_BOX_ALREADY_MOVED: {
    kind: 'duplicate',
    en: 'This box was already closed or cancelled. Take the next parcel.',
    bn: 'এই বাক্সটি আগেই বন্ধ বা বাতিল হয়েছে। পরের পার্সেলটি নিন।',
    hi: 'यह डिब्बा पहले ही बंद या रद्द हो चुका है। अगला पार्सल लें।',
    why: {
      en: 'A box closes or cancels once; this one already did — the sweep, or a second press.',
      bn: 'একটি বাক্স একবারই বন্ধ বা বাতিল হয়; এটি আগেই হয়ে গেছে — সময় শেষ হয়ে, বা দুবার চাপ পড়ে।',
      hi: 'डिब्बा एक ही बार बंद या रद्द होता है; यह पहले ही हो गया — समय खत्म होने से, या दो बार दबने से।',
    },
    fix: {
      en: 'Nothing is lost. Scan the shipping label again; if the parcel has left the queue it is already packed.',
      bn: 'কিছু হারায়নি। শিপিং লেবেলটি আবার স্ক্যান করুন; কিউতে পার্সেলটি না থাকলে সেটি আগেই প্যাক হয়ে গেছে।',
      hi: 'कुछ नहीं खोया। शिपिंग लेबल दोबारा स्कैन करें; कतार में पार्सल न हो तो वह पहले ही पैक है।',
    },
  },
  PACK_NOT_AVAILABLE: {
    kind: 'notReady',
    en: 'This parcel cannot be packed right now. Put it aside and tell your supervisor.',
    bn: 'এই পার্সেলটি এখন প্যাক করা যাবে না। সরিয়ে রাখুন এবং সুপারভাইজারকে বলুন।',
    hi: 'यह पार्सल अभी पैक नहीं हो सकता। अलग रखें और सुपरवाइज़र को बताएं।',
    why: {
      en: 'A parcel is packed once; this one has already moved past the bench.',
      bn: 'একটি পার্সেল একবারই প্যাক হয়; এটি আগেই বেঞ্চ পার হয়ে গেছে।',
      hi: 'एक पार्सल एक ही बार पैक होता है; यह पहले ही बेंच से आगे निकल चुका है।',
    },
    fix: {
      en: 'Put it on the dispatch side and take the next parcel.[[ {who} had already done it.]][[ That was at {when}.]]',
      bn: 'এটি ডিসপ্যাচের দিকে রাখুন এবং পরের পার্সেলটি নিন।[[ {who} আগেই এটি করে ফেলেছেন।]][[ সময় ছিল {when}।]]',
      hi: 'इसे डिस्पैच की तरफ रखें और अगला पार्सल लें।[[ {who} ने यह पहले ही कर लिया था।]][[ वह {when} पर था।]]',
    },
  },
  ORDER_NOT_PACKABLE: {
    kind: 'notReady',
    en: 'This order is not ready to pack yet. Put it aside and tell your supervisor.',
    bn: 'এই অর্ডারটি এখনো প্যাক করার জন্য তৈরি নয়। সরিয়ে রাখুন এবং সুপারভাইজারকে বলুন।',
    hi: 'यह ऑर्डर अभी पैक करने के लिए तैयार नहीं है। अलग रखें और सुपरवाइज़र को बताएं।',
    why: {
      en: 'An order is packed only after the call centre confirms it and the picker walks it.',
      bn: 'কল সেন্টার নিশ্চিত করার এবং পিকার পণ্য তুলে আনার পরেই অর্ডার প্যাক হয়।',
      hi: 'कॉल सेंटर की पुष्टि और पिकर के सामान लाने के बाद ही ऑर्डर पैक होता है।',
    },
    fix: {
      en: 'Put the parcel back in the queue and tell your supervisor; nobody can pack it yet.',
      bn: 'পার্সেলটি কিউতে ফেরত রাখুন এবং সুপারভাইজারকে বলুন; এখনো কেউ এটি প্যাক করতে পারবে না।',
      hi: 'पार्सल कतार में वापस रखें और सुपरवाइज़र को बताएं; अभी कोई इसे पैक नहीं कर सकता।',
    },
  },
  ORDER_NOT_FOUND: {
    kind: 'stop',
    en: 'The order for this parcel cannot be found. Put it aside and call your supervisor.',
    bn: 'এই পার্সেলের অর্ডার পাওয়া যাচ্ছে না। সরিয়ে রাখুন এবং সুপারভাইজারকে ডাকুন।',
    hi: 'इस पार्सल का ऑर्डर नहीं मिल रहा। अलग रखें और सुपरवाइज़र को बुलाएं।',
  },
  ORDER_SHIPMENT_MISSING: {
    kind: 'stop',
    en: 'This parcel is not joined to an order. Put it aside and call your supervisor.',
    bn: 'এই পার্সেলটি কোনো অর্ডারের সাথে জোড়া নেই। সরিয়ে রাখুন এবং সুপারভাইজারকে ডাকুন।',
    hi: 'यह पार्सल किसी ऑर्डर से जुड़ा नहीं है। अलग रखें और सुपरवाइज़र को बुलाएं।',
  },
  PACK_ORDER_MISSING: {
    kind: 'stop',
    en: 'There is no order behind this box. Put it aside and call your supervisor.',
    bn: 'এই বাক্সের পিছনে কোনো অর্ডার নেই। সরিয়ে রাখুন এবং সুপারভাইজারকে ডাকুন।',
    hi: 'इस डिब्बे के पीछे कोई ऑर्डर नहीं है। अलग रखें और सुपरवाइज़र को बुलाएं।',
  },
  SHIPMENT_NOT_FOUND: {
    kind: 'stop',
    en: 'This parcel cannot be found. Put it aside and call your supervisor.',
    bn: 'এই পার্সেলটি পাওয়া যাচ্ছে না। সরিয়ে রাখুন এবং সুপারভাইজারকে ডাকুন।',
    hi: 'यह पार्सल नहीं मिल रहा। अलग रखें और सुपरवाइज़र को बुलाएं।',
  },
  SHIPMENT_NOT_PACKABLE: {
    kind: 'notReady',
    en: 'This parcel is already past the packing step. Take the next parcel.',
    bn: 'এই পার্সেলটি প্যাকিং ধাপ পার হয়ে গেছে। পরের পার্সেলটি নিন।',
    hi: 'यह पार्सल पैकिंग के चरण से आगे निकल चुका है। अगला पार्सल लें।',
    why: {
      en: 'Another packer may finish a parcel while it is still on your bench.',
      bn: 'আপনার বেঞ্চে থাকতেই অন্য একজন প্যাকার পার্সেলটি শেষ করে ফেলতে পারেন।',
      hi: 'आपकी बेंच पर रहते हुए दूसरा पैकर पार्सल पूरा कर सकता है।',
    },
    fix: {
      en: 'Check the queue: if the parcel has gone from it, it is packed. Take the next one.',
      bn: 'কিউ দেখুন: পার্সেলটি না থাকলে সেটি প্যাক হয়ে গেছে। পরেরটি নিন।',
      hi: 'कतार देखें: पार्सल न हो तो वह पैक हो गया। अगला लें।',
    },
  },
  PACK_VERIFICATION_REQUIRED: {
    kind: 'count',
    en: 'Scan every product into the box first, then scan the label to close it.',
    bn: 'আগে প্রতিটি পণ্য বাক্সে স্ক্যান করুন, তারপর বন্ধ করতে লেবেলটি স্ক্যান করুন।',
    hi: 'पहले हर सामान डिब्बे में स्कैन करें, फिर बंद करने के लिए लेबल स्कैन करें।',
  },
  UNIT_SCAN_REQUIRED: {
    kind: 'count',
    en: 'Every piece in this parcel needs its own serial scanned. Scan them one by one.',
    bn: 'এই পার্সেলের প্রতিটি পিসের নিজের সিরিয়াল স্ক্যান করতে হবে। একটি একটি করে স্ক্যান করুন।',
    hi: 'इस पार्सल के हर टुकड़े का अपना सीरियल स्कैन करना है। एक-एक करके स्कैन करें।',
  },
  DUPLICATE_SCAN: {
    kind: 'stop',
    en: 'This box was packed once already. Stop, put the whole pile aside and call your supervisor.',
    bn: 'এই বাক্সটি একবার প্যাক হয়ে গেছে। থামুন, পুরো স্তূপটি সরিয়ে রাখুন এবং সুপারভাইজারকে ডাকুন।',
    hi: 'यह डिब्बा एक बार पैक हो चुका है। रुकें, पूरा ढेर अलग रखें और सुपरवाइज़र को बुलाएं।',
    why: {
      en: 'A parcel scanned twice can mean two boxes carry one label — one of them reaches nobody.',
      bn: 'একই পার্সেল দুবার স্ক্যান হলে বোঝা যায় দুটি বাক্সে একটিই লেবেল — একটি কারো কাছেই পৌঁছাবে না।',
      hi: 'एक पार्सल दो बार स्कैन होने का मतलब दो डिब्बों पर एक लेबल — एक किसी तक नहीं पहुँचेगा।',
    },
    fix: {
      en: 'Stop scanning. Keep the whole pile aside and call your supervisor to clear it.',
      bn: 'স্ক্যান বন্ধ করুন। পুরো স্তূপটি সরিয়ে রাখুন এবং এটি ছাড়াতে সুপারভাইজারকে ডাকুন।',
      hi: 'स्कैन बंद करें। पूरा ढेर अलग रखें और इसे खुलवाने के लिए सुपरवाइज़र को बुलाएं।',
    },
  },
  /**
   * The HANDOVER bench's duplicate, drop-in copy from the concurrency
   * work (2026-11-10). It is written here because this table is where
   * bench refusal copy lives and the words would otherwise be lost —
   * but note that `handover-queue.tsx` does not read this map yet: it
   * renders the server verdict only. Wiring it is one import of
   * `packErrorCopy` plus the `RefusalBody` block, and nothing here has
   * to change when somebody does it.
   *
   * Its values arrive as `{staff}` / `{time}` rather than `{who}` /
   * `{when}` because that is what that bench's server sends;
   * `RefusalBody` reads either pair.
   */
  HANDOVER_ALREADY_SCANNED: {
    kind: 'duplicate',
    en: 'This parcel was already scanned[[ by {staff}]][[ at {time}]]. It is counted — take the next box.',
    bn: 'এই পার্সেলটি আগেই স্ক্যান করা হয়েছে[[ — {staff}]][[, {time}-এ]]। এটি গোনা হয়ে গেছে — পরের বাক্সটি নিন।',
    hi: 'यह पार्सल पहले ही स्कैन हो चुका है[[ — {staff}]][[, {time} बजे]]। यह गिना जा चुका है — अगला डिब्बा लें।',
    why: {
      en: 'Two people loading one van can both reach for the same box; the first scan is the one that counts.',
      bn: 'এক ভ্যানে দুজন মাল তুললে দুজনেই একই বাক্স ধরতে পারেন; প্রথম স্ক্যানটিই গণ্য হয়।',
      hi: 'एक वैन भरते दो लोग एक ही डिब्बा उठा सकते हैं; पहला स्कैन ही गिना जाता है।',
    },
    fix: {
      en: 'Nothing to redo — put it in the van and scan the next box.',
      bn: 'আবার কিছু করার নেই — এটি ভ্যানে তুলে দিন এবং পরের বাক্সটি স্ক্যান করুন।',
      hi: 'दोबारा कुछ नहीं करना — इसे वैन में रखें और अगला डिब्बा स्कैन करें।',
    },
  },
  SCAN_BLOCKED: {
    kind: 'stop',
    en: 'Your scanning is stopped. Call your supervisor before you scan anything else.',
    bn: 'আপনার স্ক্যান বন্ধ করা হয়েছে। আর কিছু স্ক্যান করার আগে সুপারভাইজারকে ডাকুন।',
    hi: 'आपका स्कैन रोक दिया गया है। कुछ और स्कैन करने से पहले सुपरवाइज़र को बुलाएं।',
  },
};

/**
 * The values a sentence can carry, as the server sent them (`details`).
 * Anything not a non-empty string is treated as absent.
 */
export type PackErrorVars = Readonly<Record<string, string>>;

const SEGMENT = /\[\[([^\]]*)\]\]/g;
const PLACEHOLDER = /\{(\w+)\}/g;

function substitute(text: string, vars: PackErrorVars): string {
  return text.replace(PLACEHOLDER, (_m, key: string) => vars[key] ?? '');
}

/**
 * Resolve one sentence: optional segments in or out, then the values.
 *
 * A segment survives only when EVERY placeholder in it has a value, so a
 * server that sends a code without its detail loses a clause and never
 * puts `{awb}` in front of a packer.
 */
export function fillPackErrorLine(template: string, vars: PackErrorVars): string {
  const resolved = template.replace(SEGMENT, (_m, segment: string) => {
    const keys = [...segment.matchAll(PLACEHOLDER)].map((m) => m[1] ?? '');
    const complete = keys.every((k) => (vars[k] ?? '').trim() !== '');
    return complete ? substitute(segment, vars) : '';
  });
  // A dropped segment can leave a double space behind it; nothing else
  // here is whitespace-sensitive.
  return substitute(resolved, vars)
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Never returns undefined: an unknown code gets the generic triple.
 *
 * `vars` are the server's own `details` — the AWB to scan, the client a
 * product belongs to. Pass them and the three sentences name them; leave
 * them out and the three sentences still read as sentences.
 */
export function packErrorCopy(code: string | null, vars: PackErrorVars = {}): PackErrorCopy {
  const copy = code === null ? FALLBACK : (PACK_ERROR_COPY[code] ?? FALLBACK);
  const triple = (t: PackErrorTriple | undefined): PackErrorTriple | undefined => {
    if (t === undefined) return undefined;
    const filled = {
      en: fillPackErrorLine(t.en, vars),
      bn: fillPackErrorLine(t.bn, vars),
      hi: fillPackErrorLine(t.hi, vars),
    };
    // A line that is nothing but a dropped segment is left out whole —
    // never an empty paragraph where an instruction should be.
    return filled.en === '' ? undefined : filled;
  };
  const why = triple(copy.why);
  const fix = triple(copy.fix);
  return {
    kind: copy.kind,
    en: fillPackErrorLine(copy.en, vars),
    bn: fillPackErrorLine(copy.bn, vars),
    hi: fillPackErrorLine(copy.hi, vars),
    ...(why === undefined ? {} : { why }),
    ...(fix === undefined ? {} : { fix }),
  };
}

/**
 * The dismiss button, in all three. Its ACCESSIBLE name stays the
 * translated one (`aria-label`) so screen readers and tests still see a
 * stable control; the three languages are what the eye reads.
 */
export const DISMISS_TRIPLE: readonly [en: string, bn: string, hi: string] = [
  'I have fixed it',
  'আমি ঠিক করেছি',
  'मैंने ठीक कर लिया',
];
