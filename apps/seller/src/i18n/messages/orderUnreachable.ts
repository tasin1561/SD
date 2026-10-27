import { defineMessages } from '../define';

/** Copy owned by the "orderUnreachable" feature. */
export const orderUnreachable = defineMessages({
  'orderUnreachable.weCouldNotReach': [
    'We could not reach your customer — this order is waiting on you',
    'আমরা আপনার গ্রাহকের নাগাল পাইনি — এই অর্ডার আপনার সিদ্ধান্তের অপেক্ষায়',
  ],
  'orderUnreachable.ourAgentsRangAnd': [
    'Our agents rang and nobody answered, so nothing more happens to this order until you decide whether we should keep trying.',
    'আমাদের এজেন্টরা ফোন করেছিলেন কিন্তু কেউ ধরেননি, তাই আমরা চেষ্টা চালিয়ে যাব কি না সে বিষয়ে আপনি সিদ্ধান্ত না নেওয়া পর্যন্ত এই অর্ডারে আর কিছু ঘটবে না।',
  ],
  'orderUnreachable.ourAgentsHaveTried': [
    'Our agents have tried {attemptCount} time{plural} without reaching anybody. Nothing more happens to this order until you decide.',
    'আমাদের এজেন্টরা {attemptCount} বার চেষ্টা করেও কাউকে পাননি। আপনি সিদ্ধান্ত না নেওয়া পর্যন্ত এই অর্ডারে আর কিছু ঘটবে না।',
  ],
  'orderUnreachable.raisedIfYouLeave': [
    'Raised {createdAt}. If you leave it, we let the order go for you after a few days.',
    'তোলা হয়েছে {createdAt}। আপনি কিছু না করলে কয়েক দিন পর আমরা আপনার হয়ে অর্ডারটি ছেড়ে দেব।',
  ],
  'orderUnreachable.decide': ['Decide', 'সিদ্ধান্ত নিন'],
  'orderUnreachable.loadingYourDecision': [
    'Loading your decision…',
    'আপনার সিদ্ধান্তের অংশ লোড হচ্ছে…',
  ],
  'orderUnreachable.thereIsNothingHere': [
    'There is nothing here for you to answer — if this order is still paused in a few minutes, open Unreachable customers.',
    'এখানে আপনার উত্তর দেওয়ার মতো কিছু নেই — কয়েক মিনিট পরেও এই অর্ডার থেমে থাকলে “যোগাযোগ করা যায়নি এমন গ্রাহক” পেজটি খুলুন।',
  ],
  'orderUnreachable.somebodyOnYourTeam': [
    'Somebody on your team who manages unreachable customers has to answer this.',
    'আপনার টিমের যিনি যোগাযোগ করা যায়নি এমন গ্রাহকদের দেখেন, তাঁকেই এটির উত্তর দিতে হবে।',
  ],
  'orderUnreachable.triedAndHeldOne': [
    'Our agents have tried {attemptCount} time{plural} without reaching anybody, and {heldQty} unit of your stock is held against this order in the meantime.',
    'আমাদের এজেন্টরা {attemptCount} বার চেষ্টা করেও কাউকে পাননি, আর এই ফাঁকে আপনার স্টকের {heldQty}টি ইউনিট এই অর্ডারের জন্য ধরে রাখা আছে।',
  ],
  'orderUnreachable.triedAndHeldMany': [
    'Our agents have tried {attemptCount} time{plural} without reaching anybody, and {heldQty} units of your stock are held against this order in the meantime.',
    'আমাদের এজেন্টরা {attemptCount} বার চেষ্টা করেও কাউকে পাননি, আর এই ফাঁকে আপনার স্টকের {heldQty}টি ইউনিট এই অর্ডারের জন্য ধরে রাখা আছে।',
  ],
});
