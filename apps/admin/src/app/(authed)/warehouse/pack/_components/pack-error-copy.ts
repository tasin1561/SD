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

export interface PackErrorCopy {
  readonly kind: PackErrorKind;
  readonly en: string;
  readonly bn: string;
  readonly hi: string;
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
  },
  PACK_PRODUCT_NOT_IN_ORDER: {
    kind: 'wrongItem',
    en: 'This product is not for this box. Put it aside and scan the next one.',
    bn: 'এই পণ্যটি এই বাক্সের নয়। সরিয়ে রাখুন, পরেরটি স্ক্যান করুন।',
    hi: 'यह सामान इस डिब्बे का नहीं है। अलग रखें और अगला स्कैन करें।',
  },
  PACK_QUANTITY_EXCEEDED: {
    kind: 'count',
    en: 'This box already has enough of this product. Do not put in another one.',
    bn: 'এই পণ্য এই বাক্সে যত দরকার তত হয়ে গেছে। আর একটি দেবেন না।',
    hi: 'इस डिब्बे में यह सामान पूरा हो गया है। एक और मत डालें।',
  },
  PACK_UNIT_ALREADY_SCANNED: {
    kind: 'duplicate',
    en: 'You already scanned this exact piece. Take the next piece.',
    bn: 'এই একই পিসটি আগেই স্ক্যান করা হয়েছে। পরের পিসটি নিন।',
    hi: 'यही टुकड़ा पहले स्कैन हो चुका है। अगला टुकड़ा लें।',
  },
  PACK_UNIT_WRONG_PARCEL: {
    kind: 'wrongItem',
    en: 'This piece belongs to another parcel. Put it aside and tell your supervisor.',
    bn: 'এই পিসটি অন্য পার্সেলের। সরিয়ে রাখুন এবং সুপারভাইজারকে বলুন।',
    hi: 'यह टुकड़ा दूसरे पार्सल का है। अलग रखें और सुपरवाइज़र को बताएं।',
  },
  PACK_LABEL_MISMATCH: {
    kind: 'wrongItem',
    en: 'This is another parcel’s label. Scan the label this box was opened with.',
    bn: 'এটি অন্য পার্সেলের লেবেল। যে লেবেল দিয়ে বাক্সটি খোলা হয়েছিল সেটি স্ক্যান করুন।',
    hi: 'यह दूसरे पार्सल का लेबल है। जिस लेबल से डिब्बा खोला था वही स्कैन करें।',
  },
  PACK_CONTENTS_MISMATCH: {
    kind: 'count',
    en: 'The box is not complete yet. Look at the list and scan what is still missing.',
    bn: 'বাক্সটি এখনো পুরো হয়নি। তালিকা দেখুন এবং যা বাকি আছে তা স্ক্যান করুন।',
    hi: 'डिब्बा अभी पूरा नहीं है। सूची देखें और जो बाकी है वह स्कैन करें।',
  },
  PACK_AWB_NOT_FOUND: {
    kind: 'wrongItem',
    en: 'No parcel matches this label. Check that you scanned the right sticker.',
    bn: 'এই লেবেলের কোনো পার্সেল পাওয়া যাচ্ছে না। ঠিক স্টিকারটি স্ক্যান করেছেন কিনা দেখুন।',
    hi: 'इस लेबल का कोई पार्सल नहीं मिला। देखें कि आपने सही स्टिकर स्कैन किया है।',
  },
  PACK_SCAN_EMPTY: {
    kind: 'empty',
    en: 'Nothing was scanned. Hold the scanner over the barcode and try again.',
    bn: 'কিছুই স্ক্যান হয়নি। স্ক্যানারটি বারকোডের উপর ধরে আবার চেষ্টা করুন।',
    hi: 'कुछ भी स्कैन नहीं हुआ। स्कैनर को बारकोड पर रखें और फिर करें।',
  },
  PACK_BOX_HELD_BY_OTHER: {
    kind: 'notReady',
    en: 'Another packer has this parcel open. Leave it and take the next parcel.',
    bn: 'এই পার্সেলটি অন্য একজন প্যাকারের কাছে খোলা আছে। এটি রেখে পরের পার্সেলটি নিন।',
    hi: 'यह पार्सल दूसरे पैकर के पास खुला है। इसे छोड़ें और अगला पार्सल लें।',
  },
  PACK_BOX_ALREADY_OPEN: {
    kind: 'notReady',
    en: 'You already have a box open. Finish or cancel it before starting another.',
    bn: 'আপনার একটি বাক্স আগেই খোলা আছে। নতুন শুরু করার আগে সেটি শেষ করুন বা বাতিল করুন।',
    hi: 'आपका एक डिब्बा पहले से खुला है। नया शुरू करने से पहले उसे पूरा या रद्द करें।',
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
  },
  PACK_BOX_ALREADY_MOVED: {
    kind: 'duplicate',
    en: 'This box was already closed or cancelled. Take the next parcel.',
    bn: 'এই বাক্সটি আগেই বন্ধ বা বাতিল হয়েছে। পরের পার্সেলটি নিন।',
    hi: 'यह डिब्बा पहले ही बंद या रद्द हो चुका है। अगला पार्सल लें।',
  },
  PACK_NOT_AVAILABLE: {
    kind: 'notReady',
    en: 'This parcel cannot be packed right now. Put it aside and tell your supervisor.',
    bn: 'এই পার্সেলটি এখন প্যাক করা যাবে না। সরিয়ে রাখুন এবং সুপারভাইজারকে বলুন।',
    hi: 'यह पार्सल अभी पैक नहीं हो सकता। अलग रखें और सुपरवाइज़र को बताएं।',
  },
  ORDER_NOT_PACKABLE: {
    kind: 'notReady',
    en: 'This order is not ready to pack yet. Put it aside and tell your supervisor.',
    bn: 'এই অর্ডারটি এখনো প্যাক করার জন্য তৈরি নয়। সরিয়ে রাখুন এবং সুপারভাইজারকে বলুন।',
    hi: 'यह ऑर्डर अभी पैक करने के लिए तैयार नहीं है। अलग रखें और सुपरवाइज़र को बताएं।',
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
  },
  SCAN_BLOCKED: {
    kind: 'stop',
    en: 'Your scanning is stopped. Call your supervisor before you scan anything else.',
    bn: 'আপনার স্ক্যান বন্ধ করা হয়েছে। আর কিছু স্ক্যান করার আগে সুপারভাইজারকে ডাকুন।',
    hi: 'आपका स्कैन रोक दिया गया है। कुछ और स्कैन करने से पहले सुपरवाइज़र को बुलाएं।',
  },
};

/** Never returns undefined: an unknown code gets the generic triple. */
export function packErrorCopy(code: string | null): PackErrorCopy {
  if (code === null) return FALLBACK;
  return PACK_ERROR_COPY[code] ?? FALLBACK;
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
