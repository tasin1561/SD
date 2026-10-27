import { defineMessages } from '../define';

/** Copy owned by the "orderDelivery" feature. */
export const orderDelivery = defineMessages({
  'orderDelivery.aReturnFeeApplies': ['a return fee applies', 'রিটার্ন ফি প্রযোজ্য হয়'],
  'orderDelivery.theReturnFeeIs': [
    'the return fee is {primary}, charged in rupees at the rate on the day',
    'রিটার্ন ফি {primary}, সেদিনের রেটে রুপিতে কাটা হয়',
  ],
  'orderDelivery.weAskTheCourier': [
    'We ask the courier for another attempt. Best when you know the customer will be there.',
    'আমরা কুরিয়ারকে আরেকবার চেষ্টা করতে বলি। গ্রাহক নিশ্চিতভাবে থাকবেন জানলে এটিই ভালো।',
  ],
  'orderDelivery.oneOfOurAgents': [
    'One of our agents phones them and reports back. Nothing moves until you know more.',
    'আমাদের একজন এজেন্ট তাদের ফোন করে ফলাফল জানান। আপনি আরও না জানা পর্যন্ত কিছুই এগোয় না।',
  ],
  'orderDelivery.tellUsWhatYou': [
    'Tell us what you know — an operator reads this before deciding',
    'আপনি যা জানেন তা আমাদের বলুন — সিদ্ধান্তের আগে একজন অপারেটর এটি পড়বেন',
  ],
  'orderDelivery.theCourierCouldNot': [
    'The courier could not hand this over. We have queued a call to your customer to find out why — you can also tell us what to do below.',
    'কুরিয়ার এটি হস্তান্তর করতে পারেনি। কারণ জানতে আমরা আপনার গ্রাহকের জন্য একটি কল কিউতে রেখেছি — নিচে কী করতে হবে তাও আপনি আমাদের জানাতে পারেন।',
  ],
  'orderDelivery.whatWeDiscussedWith': [
    'What we discussed with your customer',
    'আপনার গ্রাহকের সাথে আমাদের যা আলোচনা হয়েছে',
  ],
  'orderDelivery.customerGaveADifferent': [
    'Customer gave a different address: {customerSaidAddress}',
    'গ্রাহক অন্য ঠিকানা দিয়েছেন: {customerSaidAddress}',
  ],
  'orderDelivery.askedUsToCall': [
    'Asked us to call back {rescheduledFor}',
    'আমাদের {rescheduledFor} ফিরতি কল করতে বলেছেন',
  ],
  'orderDelivery.whatYouAskedFor': ['What you asked for', 'আপনি যা চেয়েছিলেন'],
  'orderDelivery.ourReply': ['Our reply: {decisionNote}', 'আমাদের উত্তর: {decisionNote}'],
  'orderDelivery.couldNotBeCarried': [
    'Could not be carried out: {executionError}',
    'কার্যকর করা যায়নি: {executionError}',
  ],
  'orderDelivery.whatShouldWeDo': ['What should we do?', 'আমরা কী করব?'],
  'orderDelivery.returningYourOwnParcel': [
    'Returning your own parcel is your decision, so this reaches the courier immediately.',
    'নিজের পার্সেল ফেরত আনা আপনার সিদ্ধান্ত, তাই এটি সঙ্গে সঙ্গে কুরিয়ারের কাছে পৌঁছায়।',
  ],
  'orderDelivery.anOperatorReadsThis': [
    'An operator reads this and acts on it — nothing reaches the courier automatically.',
    'একজন অপারেটর এটি পড়ে ব্যবস্থা নেন — কুরিয়ারের কাছে নিজে থেকে কিছু পৌঁছায় না।',
  ],
  'orderDelivery.cancel': ['Cancel', 'বাতিল'],
  'orderDelivery.sendItBackNow': ['Send it back now', 'এখনই ফেরত পাঠান'],
  'orderDelivery.sendRequest': ['Send request', 'অনুরোধ পাঠান'],
  'orderDelivery.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'orderDelivery.whatWouldYouLike': ['What would you like', 'আপনি কী চান'],
  'orderDelivery.whatDoYouKnow': ['What do you know', 'আপনি কী জানেন'],
  'orderDelivery.anythingThatHelpsThe': [
    "Anything that helps — the customer called you, they'll be home Saturday, the address was wrong.",
    'যা কাজে লাগে — গ্রাহক আপনাকে ফোন করেছেন, শনিবার বাসায় থাকবেন, ঠিকানা ভুল ছিল।',
  ],
  'orderDelivery.sendThisParcelBack': [
    'Send this parcel back now?',
    'এই পার্সেল এখনই ফেরত পাঠাবেন?',
  ],
  'orderDelivery.deliveryDidNotSucceed': ['Delivery did not succeed', 'ডেলিভারি সফল হয়নি'],
  'orderDelivery.outForDelivery': ['Out for delivery', 'ডেলিভারির জন্য বের হয়েছে'],
  'orderDelivery.whatHappenedWithThisDelivery': [
    'What happened with this delivery',
    'এই ডেলিভারিতে কী ঘটেছে',
  ],
  'orderDelivery.tryDeliveringAgain': ['Try delivering again', 'আবার ডেলিভারির চেষ্টা করুন'],
  'orderDelivery.callTheCustomerForMe': ['Call the customer for me', 'আমার হয়ে গ্রাহককে ফোন করুন'],
  'orderDelivery.sendItBack': ['Send it back', 'ফেরত পাঠান'],
  'orderDelivery.costPriced': ['the return fee is {primary}', 'রিটার্ন ফি {primary}'],
  'orderDelivery.costPricedAgreed': [
    'the return fee is {primary} (agreed as {agreed})',
    'রিটার্ন ফি {primary} ({agreed} হিসেবে নির্ধারিত)',
  ],
  'orderDelivery.rtoHint': [
    'Your call, so this goes to the courier straight away — there is no operator step and it cannot be undone. The parcel returns to our warehouse, the sale ends, and {cost}.',
    'সিদ্ধান্তটি আপনার, তাই এটি সরাসরি কুরিয়ারের কাছে যায় — মাঝে কোনো অপারেটর ধাপ নেই এবং এটি আর ফেরানো যায় না। পার্সেল আমাদের ওয়্যারহাউসে ফিরে আসে, বিক্রি শেষ হয় এবং {cost}।',
  ],
  'orderDelivery.thisOrder': ['This order', 'এই অর্ডার'],
  'orderDelivery.rtoConsequenceNone': [
    'The courier is told straight away and it cannot be undone. The parcel returns to our warehouse, the sale ends, and a return fee applies.',
    'কুরিয়ারকে সঙ্গে সঙ্গে জানানো হয় এবং এটি আর ফেরানো যায় না। পার্সেল আমাদের ওয়্যারহাউসে ফিরে আসে, বিক্রি শেষ হয় এবং রিটার্ন ফি প্রযোজ্য হয়।',
  ],
  'orderDelivery.rtoConsequencePriced': [
    'The courier is told straight away and it cannot be undone. The parcel returns to our warehouse, the sale ends, and you are charged a return fee of {primary}.',
    'কুরিয়ারকে সঙ্গে সঙ্গে জানানো হয় এবং এটি আর ফেরানো যায় না। পার্সেল আমাদের ওয়্যারহাউসে ফিরে আসে, বিক্রি শেষ হয় এবং আপনার কাছ থেকে {primary} রিটার্ন ফি কাটা হয়।',
  ],
  'orderDelivery.rtoConsequenceUnpriced': [
    'The courier is told straight away and it cannot be undone. The parcel returns to our warehouse, the sale ends, and you are charged a return fee of {primary}, in rupees at the rate on the day.',
    'কুরিয়ারকে সঙ্গে সঙ্গে জানানো হয় এবং এটি আর ফেরানো যায় না। পার্সেল আমাদের ওয়্যারহাউসে ফিরে আসে, বিক্রি শেষ হয় এবং আপনার কাছ থেকে {primary} রিটার্ন ফি কাটা হয়, সেদিনের রেটে রুপিতে।',
  ],
});
