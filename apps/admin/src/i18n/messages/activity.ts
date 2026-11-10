import { defineMessages } from '../define';

/**
 * The parcel activity trail ("who did what") and the live holds board
 * ("who has what right now").
 *
 * Its own namespace rather than a growth of `wh`: these two screens read
 * the same vocabulary — an actor, a step, a hold, a clock time — and
 * keeping that vocabulary in one file is what stops "Free to take"
 * meaning one thing on the board and another on the order page.
 */
export const activity = defineMessages({
  // ── Who ────────────────────────────────────────────────────────────
  // A staff name is DATA and is never translated. These are the five
  // honest answers for when there is no name to show.
  'activity.actor.removed': ['{name} (has left)', '{name} (চলে গেছেন)', '{name} (जा चुके हैं)'],
  'activity.actor.system': ['Skydrop system', 'স্কাইড্রপ সিস্টেম', 'स्काईड्रॉप सिस्टम'],
  'activity.actor.unrecorded': ['Not recorded', 'লেখা হয়নি', 'दर्ज नहीं है'],
  'activity.actor.unknown': [
    'Staff member not found',
    'কর্মীকে পাওয়া যায়নি',
    'कर्मचारी नहीं मिला',
  ],
  'activity.actor.seller': ['The client', 'ক্লায়েন্ট', 'क्लाइंट'],
  'activity.actor.store': ['The member store', 'মেম্বার স্টোর', 'मेंबर स्टोर'],
  'activity.actor.staffAsClient': [
    'Our staff, inside the client account',
    'আমাদের কর্মী, ক্লায়েন্টের অ্যাকাউন্টের ভিতরে',
    'हमारा कर्मचारी, क्लाइंट खाते के भीतर',
  ],
  'activity.actor.api': ['An API key', 'একটি API কী', 'एक API की'],
  'activity.actor.courier': ['The courier', 'কুরিয়ার', 'कूरियर'],

  // ── What happened ──────────────────────────────────────────────────
  'activity.step.LABEL_GENERATED': [
    'Shipping label created',
    'শিপিং লেবেল তৈরি',
    'शिपिंग लेबल बना',
  ],
  'activity.step.LABEL_PRINTED': [
    'Shipping label printed',
    'শিপিং লেবেল প্রিন্ট',
    'शिपिंग लेबल प्रिंट',
  ],
  'activity.step.PICK_BATCH_CREATED': ['Picking sheet made', 'পিকিং শিট তৈরি', 'पिकिंग शीट बनी'],
  'activity.step.PICK_BATCH_PRINTED': [
    'Picking sheet printed',
    'পিকিং শিট প্রিন্ট',
    'पिकिंग शीट प्रिंट',
  ],
  'activity.step.PICK_CLAIMED': ['Picking started', 'পিকিং শুরু', 'पिकिंग शुरू'],
  'activity.step.PICKED_SHORT': [
    'Picked short — shelf had fewer',
    'কম পাওয়া গেছে — শেলফে কম ছিল',
    'कम मिला — शेल्फ़ पर कम था',
  ],
  'activity.step.PICKED': ['Picked from the shelf', 'শেলফ থেকে নেওয়া', 'शेल्फ़ से लिया'],
  'activity.step.PACK_BOX_OPENED': ['Box opened', 'বক্স খোলা', 'बॉक्स खुला'],
  'activity.step.PACK_BOX_CLOSED': ['Box closed', 'বক্স বন্ধ', 'बॉक्स बंद'],
  'activity.step.PACK_BOX_CANCELLED': ['Box cancelled', 'বক্স বাতিল', 'बॉक्स रद्द'],
  'activity.step.PACKED': ['Packed', 'প্যাক হয়েছে', 'पैक हुआ'],
  'activity.step.COURIER_CHOSEN': ['Courier chosen', 'কুরিয়ার বাছাই', 'कूरियर चुना'],
  'activity.step.MANIFEST_CLOSED': ['Manifest closed', 'ম্যানিফেস্ট বন্ধ', 'मैनिफ़ेस्ट बंद'],
  'activity.step.MANIFEST_HANDOFF_CONFIRMED': [
    'Handover confirmed',
    'হ্যান্ডওভার নিশ্চিত',
    'हैंडओवर पक्का',
  ],
  'activity.step.HANDOVER_SCANNED': [
    'Scanned at handover',
    'হ্যান্ডওভারে স্ক্যান',
    'हैंडओवर पर स्कैन',
  ],
  'activity.step.COURIER_PICKED_UP': [
    'Collected by the courier',
    'কুরিয়ার নিয়ে গেছে',
    'कूरियर ले गया',
  ],
  'activity.step.RTO_RECEIVED': ['Return received', 'রিটার্ন গ্রহণ', 'रिटर्न मिला'],
  'activity.step.RTO_INSPECTED': ['Return inspected', 'রিটার্ন পরীক্ষা', 'रिटर्न जाँचा'],

  // ── The trail panel ────────────────────────────────────────────────
  'activity.trail.title': ['Who did what', 'কে কী করেছে', 'किसने क्या किया'],
  'activity.trail.subtitle': [
    "Every warehouse action on this order's parcels, oldest first",
    'এই অর্ডারের পার্সেলে ওয়্যারহাউসের প্রতিটি কাজ, পুরোনো আগে',
    'इस ऑर्डर के पार्सल पर गोदाम का हर काम, पुराना पहले',
  ],
  'activity.trail.loading': ['Reading the trail…', 'ট্রেইল পড়া হচ্ছে…', 'ट्रेल पढ़ा जा रहा है…'],
  'activity.trail.empty': [
    'Nothing has been done to this parcel yet.',
    'এই পার্সেলে এখনো কিছু করা হয়নি।',
    'इस पार्सल पर अभी कुछ नहीं हुआ है।',
  ],
  'activity.trail.about': ['about {time}', 'প্রায় {time}', 'लगभग {time}'],
  'activity.trail.approxNote': [
    'The person is recorded; the exact time is not.',
    'কে করেছে লেখা আছে; সময়টা হুবহু নয়।',
    'किसने किया दर्ज है; सही समय नहीं।',
  ],
  'activity.trail.parcel': ['Parcel {number}', 'পার্সেল {number}', 'पार्सल {number}'],
  'activity.trail.superseded': [
    'Replaced by a later parcel',
    'পরের পার্সেল দিয়ে বদল',
    'बाद के पार्सल से बदला',
  ],
  'activity.trail.lastTouch': [
    'Last touched by {who} · {time}',
    'শেষ হাত দিয়েছে {who} · {time}',
    'अंतिम बार {who} · {time}',
  ],
  'activity.trail.steps': ['{count} steps', '{count} ধাপ', '{count} चरण'],

  // ── Details beside a step ──────────────────────────────────────────
  'activity.detail.sheets': ['{count} sheets', '{count} শিট', '{count} शीट'],
  'activity.detail.batch': ['Sheet {value}', 'শিট {value}', 'शीट {value}'],
  'activity.detail.manifest': ['Manifest {value}', 'ম্যানিফেস্ট {value}', 'मैनिफ़ेस्ट {value}'],
  'activity.detail.version': ['Label v{value}', 'লেবেল v{value}', 'लेबल v{value}'],
  'activity.detail.shortOf': [
    '{found} of {expected} found',
    '{expected}টির মধ্যে {found}টি পাওয়া গেছে',
    '{expected} में से {found} मिले',
  ],
  'activity.detail.lines': ['{count} lines', '{count} লাইন', '{count} लाइन'],
  'activity.detail.scanned': ['{count} scanned in', '{count} স্ক্যান হয়েছে', '{count} स्कैन हुए'],
  'activity.detail.printed': ['printed {count}x', '{count}x প্রিন্ট', '{count}x प्रिंट'],

  // ── The live holds board ───────────────────────────────────────────
  'holds.title': ['Who has what', 'কার কাছে কী আছে', 'किसके पास क्या है'],
  'holds.subtitle': [
    'Live holds on the floor — what is claimed, by whom, and until when',
    'ফ্লোরে চলমান হোল্ড — কী নেওয়া আছে, কে নিয়েছে, কত সময় পর্যন্ত',
    'फ़्लोर पर चालू होल्ड — क्या लिया है, किसने लिया, कब तक',
  ],
  'holds.navSubtitle': [
    'Who is holding a parcel, a box or a picking sheet right now',
    'এখন কার কাছে পার্সেল, বক্স বা পিকিং শিট আছে',
    'अभी किसके पास पार्सल, बॉक्स या पिकिंग शीट है',
  ],
  'holds.asOf': ['Read at {time}', '{time}-এ পড়া', '{time} पर पढ़ा'],
  'holds.refresh': ['Read again', 'আবার পড়ুন', 'दोबारा पढ़ें'],
  'holds.loading': ['Reading the floor…', 'ফ্লোর পড়া হচ্ছে…', 'फ़्लोर पढ़ा जा रहा है…'],
  'holds.empty': [
    'Nobody is holding anything right now.',
    'এখন কারো কাছে কিছু নেই।',
    'अभी किसी के पास कुछ नहीं है।',
  ],
  'holds.kind.PICK': ['Picking this parcel', 'এই পার্সেল পিক করছে', 'यह पार्सल पिक कर रहे हैं'],
  'holds.kind.PACK_CLAIM': [
    'Given this parcel to pack',
    'প্যাক করতে এই পার্সেল দেওয়া',
    'पैक करने के लिए यह पार्सल दिया',
  ],
  'holds.kind.PACK_BOX': [
    'Box open on this parcel',
    'এই পার্সেলে বক্স খোলা',
    'इस पार्सल पर बॉक्स खुला',
  ],
  'holds.kind.PICK_BATCH': [
    'Holding a printed picking sheet',
    'প্রিন্ট করা পিকিং শিট হাতে',
    'प्रिंट की पिकिंग शीट हाथ में',
  ],
  'holds.since': ['Taken {time}', 'নেওয়া {time}', 'लिया {time}'],
  'holds.noStart': ['Start time not recorded', 'শুরুর সময় লেখা হয়নি', 'शुरू का समय दर्ज नहीं'],
  'holds.until': ['Theirs until {time}', '{time} পর্যন্ত তাদের', '{time} तक उनका'],
  'holds.noWindow': ['Until the walk is done', 'পিকিং শেষ হওয়া পর্যন্ত', 'पिकिंग पूरी होने तक'],
  'holds.free': ['Free to take', 'নেওয়া যাবে', 'ले सकते हैं'],
  'holds.lapsed': ['Lapsed at {time}', '{time}-এ শেষ হয়েছে', '{time} पर खत्म हुआ'],
  'holds.stuck': ['Stuck — go and ask', 'আটকে আছে — জিজ্ঞেস করুন', 'अटका है — पूछ लें'],
  'holds.stuckNote': [
    'Nothing has moved for more than {minutes} minutes after the hold lapsed.',
    'হোল্ড শেষ হওয়ার {minutes} মিনিট পরেও কিছু নড়েনি।',
    'होल्ड खत्म होने के {minutes} मिनट बाद भी कुछ नहीं हिला।',
  ],
  'holds.progress': [
    '{unpicked} of {of} still to pick',
    '{of}-এর মধ্যে {unpicked} বাকি',
    '{of} में से {unpicked} बाकी',
  ],
  'holds.counts': [
    '{held} held · {free} free · {stuck} stuck',
    '{held} ধরা · {free} খালি · {stuck} আটকে',
    '{held} पकड़े · {free} खाली · {stuck} अटके',
  ],
  'holds.openOrder': ['Open the order', 'অর্ডার খুলুন', 'ऑर्डर खोलें'],

  // ── Reprints: a signal, not a hold ─────────────────────────────────
  'holds.reprints.title': [
    'Labels printed more than once',
    'একাধিকবার প্রিন্ট হওয়া লেবেল',
    'एक से ज़्यादा बार प्रिंट हुए लेबल',
  ],
  'holds.reprints.note': [
    'A label is printed, not held. Two sheets for one parcel in the building is worth a look.',
    'লেবেল প্রিন্ট হয়, কেউ ধরে রাখে না। এক পার্সেলের দুটি শিট ভবনে থাকলে দেখা দরকার।',
    'लेबल प्रिंट होता है, कोई पकड़ कर नहीं रखता। एक पार्सल की दो शीट होना देखने लायक है।',
  ],
  'holds.reprints.sheets': [
    '{count} sheets printed',
    '{count} শিট প্রিন্ট হয়েছে',
    '{count} शीट प्रिंट हुईं',
  ],
  'holds.reprints.lastBy': [
    'Last printed by {who} · {time}',
    'শেষ প্রিন্ট করেছে {who} · {time}',
    'अंतिम प्रिंट {who} · {time}',
  ],
  'holds.reprints.lastByUnknown': [
    'Last printed by {who}',
    'শেষ প্রিন্ট করেছে {who}',
    'अंतिम प्रिंट {who}',
  ],
  'holds.reprints.versions': [
    '{count} label versions',
    '{count} লেবেল ভার্সন',
    '{count} लेबल वर्शन',
  ],
  'holds.reprints.empty': [
    'No label has come off the printer twice.',
    'কোনো লেবেল দুবার প্রিন্ট হয়নি।',
    'कोई लेबल दो बार प्रिंट नहीं हुआ।',
  ],
});
