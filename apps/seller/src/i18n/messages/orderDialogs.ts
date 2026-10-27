import { defineMessages } from '../define';

/** Copy owned by the "orderDialogs" feature. */
export const orderDialogs = defineMessages({
  'orderDialogs.itLeavesTheCall': [
    'It leaves the call queue — nobody will phone this customer about it.',
    'এটি কল কিউ থেকে বেরিয়ে যাবে — এ বিষয়ে কেউ এই গ্রাহককে ফোন করবে না।',
  ],
  'orderDialogs.noCourierHasBeen': [
    'No courier has been booked for it yet, and the stock held for it goes back to available straight away.',
    'এর জন্য এখনো কোনো কুরিয়ার বুক করা হয়নি, আর এর জন্য ধরে রাখা স্টক সঙ্গে সঙ্গে ফিরে আসে।',
  ],
  'orderDialogs.theStockHeldFor': [
    'The stock held for this order goes back to available straight away.',
    'এই অর্ডারের জন্য ধরে রাখা স্টক সঙ্গে সঙ্গে ব্যবহারযোগ্য হয়ে যায়।',
  ],
  'orderDialogs.itComesOutOf': [
    'It comes out of the pick queue and the stock held for it is released.',
    'এটি পিক কিউ থেকে বেরিয়ে যায় এবং এর জন্য ধরে রাখা স্টক ছেড়ে দেওয়া হয়।',
  ],
  'orderDialogs.theGoodsHaveAlready': [
    'The goods have already been picked, so someone has to put them back on the shelf. Cancel only if you are sure.',
    'পণ্য ইতিমধ্যে পিক করা হয়েছে, তাই কাউকে সেগুলো আবার তাকে রাখতে হবে। নিশ্চিত হলেই বাতিল করুন।',
  ],
  'orderDialogs.itComesOutOf2': [
    'It comes out of the manual-placement queue and the stock held for it is released.',
    'এটি ম্যানুয়াল-প্লেসমেন্ট কিউ থেকে বেরিয়ে যায় এবং এর জন্য ধরে রাখা স্টক ছেড়ে দেওয়া হয়।',
  ],
  'orderDialogs.cancelled': ['{orderNumber} cancelled', '{orderNumber} বাতিল হয়েছে'],
  'orderDialogs.cancel': ['Cancel {orderNumber}?', '{orderNumber} বাতিল করবেন?'],
  'orderDialogs.keepIt': ['Keep it', 'রেখে দিন'],
  'orderDialogs.cancelThisOrder': ['Cancel this order', 'এই অর্ডার বাতিল করুন'],
  'orderDialogs.cancelling': ['Cancelling…', 'বাতিল হচ্ছে…'],
  'orderDialogs.thisCannotBeUndone': [
    'This cannot be undone. To ship to this customer afterwards you would place a new order.',
    'এটি আর ফেরানো যাবে না। পরে এই গ্রাহকের কাছে পাঠাতে চাইলে নতুন অর্ডার দিতে হবে।',
  ],
  'orderDialogs.theDeliveryFeeOf': [
    'The delivery fee of {span} already charged for this order goes back to your wallet.',
    'এই অর্ডারের জন্য আগে কেটে নেওয়া {span} ডেলিভারি ফি আপনার ওয়ালেটে ফিরে যাবে।',
  ],
  'orderDialogs.reasonOptional': ['Reason (optional)', 'কারণ (ঐচ্ছিক)'],
  'orderDialogs.keptOnTheOrder': [
    "Kept on the order's history — useful when you look back at why.",
    'অর্ডারের ইতিহাসে রাখা হয় — পরে কারণ খুঁজতে কাজে লাগে।',
  ],
  'orderDialogs.customerChangedTheirMind': ['Customer changed their mind', 'গ্রাহক মত বদলেছেন'],
  'orderDialogs.askUsToCall': [
    'Ask us to call this customer again',
    'এই গ্রাহককে আবার কল করতে বলুন',
  ],
  'orderDialogs.theCustomerDeclinedThis': [
    'The customer declined this order, so it will not be called again on its own. Tell us why another call is worth making and we will review it.',
    'গ্রাহক এই অর্ডার প্রত্যাখ্যান করেছেন, তাই এটি নিজে থেকে আর কল করা হবে না। আরেকবার কল করা কেন দরকার তা জানান, আমরা পর্যালোচনা করব।',
  ],
  'orderDialogs.cancel2': ['Cancel', 'বাতিল'],
  'orderDialogs.sendRequest': ['Send request', 'অনুরোধ পাঠান'],
  'orderDialogs.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'orderDialogs.requestSentWeWill': [
    'Request sent — we will review it and let you know.',
    'অনুরোধ পাঠানো হয়েছে — আমরা পর্যালোচনা করে আপনাকে জানাব।',
  ],
  'orderDialogs.whyShouldWeCall': ['Why should we call again?', 'আমরা কেন আবার কল করব?'],
  'orderDialogs.atLeastCharactersE': [
    'At least {minReason} characters — e.g. the customer messaged us afterwards saying the agent quoted the wrong price, and they still want the order.',
    'কমপক্ষে {minReason}টি অক্ষর — যেমন, পরে গ্রাহক বার্তা পাঠিয়ে জানিয়েছেন এজেন্ট ভুল দাম বলেছিলেন এবং তিনি এখনো অর্ডারটি চান।',
  ],
  'orderDialogs.isMarkedAsReturning': [
    '{orderNumber} is marked as returning, but we could not book the collection yet: {collectionBookingFailed} We are on it — you do not need to do anything.',
    '{orderNumber} ফেরত আসছে হিসেবে চিহ্নিত করা হয়েছে, কিন্তু এখনো পিকআপ বুক করা যায়নি: {collectionBookingFailed} আমরা বিষয়টি দেখছি — আপনাকে কিছু করতে হবে না।',
  ],
  'orderDialogs.wasAlreadyComingBack': [
    '{orderNumber} was already coming back.',
    '{orderNumber} আগে থেকেই ফেরত আসছিল।',
  ],
  'orderDialogs.bringThisParcelBack': ['Bring this parcel back?', 'এই পার্সেল ফেরত আনবেন?'],
  'orderDialogs.requestReturn': ['Request return', 'রিটার্নের অনুরোধ'],
  'orderDialogs.requesting': ['Requesting…', 'অনুরোধ হচ্ছে…'],
  'orderDialogs.agreedAs': [' (agreed as {agreed})', ' ({agreed} হিসেবে নির্ধারিত)'],
  'orderDialogs.thatIsTheFigure': [
    'That is the figure we agreed with you. What leaves your wallet is its value in rupees on the day the parcel arrives.',
    'এটিই আপনার সাথে আমাদের ঠিক করা অঙ্ক। পার্সেল যেদিন পৌঁছাবে সেদিনের রুপির মূল্য অনুযায়ী আপনার ওয়ালেট থেকে টাকা কাটা হবে।',
  ],
  'orderDialogs.stockGoesBackOn': [
    'Stock goes back on the shelf once the warehouse has checked it. If it comes back damaged it is written off instead, and you will see that on the order.',
    'ওয়্যারহাউস যাচাই করার পর স্টক আবার তাকে ফিরে যায়। ক্ষতিগ্রস্ত অবস্থায় ফিরলে সেটি বাতিল খাতে লেখা হয়, এবং আপনি অর্ডারে তা দেখতে পাবেন।',
  ],
  'orderDialogs.whyIsItComing': ['Why is it coming back?', 'কেন ফেরত আসছে?'],
  'orderDialogs.theWarehouseReadsThis': [
    'The warehouse reads this when it arrives — it decides whether the stock can be resold.',
    'পার্সেল পৌঁছালে ওয়্যারহাউস এটি পড়ে — এর ভিত্তিতে ঠিক হয় স্টক আবার বিক্রি করা যাবে কি না।',
  ],
  'orderDialogs.damagedProductQualityNot': [
    'Damaged product / quality not as expected / customer changed their mind…',
    'পণ্য ক্ষতিগ্রস্ত / মান প্রত্যাশামতো নয় / গ্রাহক মত বদলেছেন…',
  ],
  'orderDialogs.whatDoYouKnow': [
    'What do you know that the last call did not? A wrong price quoted, the wrong item described, a message from the customer since.',
    'শেষ কলে যা জানা যায়নি, আপনি তা কী জানেন? ভুল দাম বলা হয়েছিল, ভুল পণ্যের বর্ণনা, কিংবা এর পরে গ্রাহকের পাঠানো কোনো বার্তা।',
  ],
  'orderDialogs.moreCharacterNeeded': [
    '{remaining} more character needed.',
    'আরও {remaining}টি অক্ষর দরকার।',
  ],
  'orderDialogs.moreCharactersNeeded': [
    '{remaining} more characters needed.',
    'আরও {remaining}টি অক্ষর দরকার।',
  ],
  'orderDialogs.typedCharacters': ['{typed} characters.', '{typed}টি অক্ষর।'],
  'orderDialogs.collectionBooked': [
    'Collection booked for {orderNumber}{awb}.',
    '{orderNumber}{awb}-এর জন্য পিকআপ বুক করা হয়েছে।',
  ],
  'orderDialogs.returnExplainNoFee': [
    'The courier collects it from your customer and brings it to our warehouse. It travels the same distance again, so it is charged as a second delivery on top of the delivery you already paid. Nothing is charged until the parcel actually arrives.',
    'কুরিয়ার এটি আপনার গ্রাহকের কাছ থেকে নিয়ে আমাদের ওয়্যারহাউসে আনে। এটি আবার একই দূরত্ব পাড়ি দেয়, তাই আপনি আগে যে ডেলিভারির টাকা দিয়েছেন তার ওপর দ্বিতীয় ডেলিভারি হিসেবে চার্জ হয়। পার্সেল আসলে পৌঁছানোর আগে কোনো টাকা কাটা হয় না।',
  ],
  'orderDialogs.returnExplainFee': [
    'The courier collects it from your customer and brings it to our warehouse. It travels the same distance again, so it is charged as a second delivery — {fee}{agreed} on top of the delivery you already paid. Nothing is charged until the parcel actually arrives.',
    'কুরিয়ার এটি আপনার গ্রাহকের কাছ থেকে নিয়ে আমাদের ওয়্যারহাউসে আনে। এটি আবার একই দূরত্ব পাড়ি দেয়, তাই আপনি আগে যে ডেলিভারির টাকা দিয়েছেন তার ওপর দ্বিতীয় ডেলিভারি হিসেবে {fee}{agreed} চার্জ হয়। পার্সেল আসলে পৌঁছানোর আগে কোনো টাকা কাটা হয় না।',
  ],
});
