import { defineMessages } from '../define';

export const ordersOps = defineMessages({
  'ordersCourierOpsPanel.cancel': ['Cancel', 'বাতিল'],
  'ordersCourierOpsPanel.placedManuallyWithANon': [
    'Placed manually with a non-integrated courier — arrange any change directly with them.',
    'নন-ইন্টিগ্রেটেড কুরিয়ারের সাথে ম্যানুয়ালি প্লেস করা হয়েছে — কোনো পরিবর্তন দরকার হলে সরাসরি তাদের সাথে ঠিক করুন।',
  ],
  'ordersCourierOpsPanel.noAwbYetCourierActions': [
    'No AWB yet. Courier actions become available once one is issued.',
    'এখনও AWB নেই। AWB ইস্যু হলে কুরিয়ারের অ্যাকশনগুলো পাওয়া যাবে।',
  ],
  'ordersCourierOpsPanel.courierActionsCosts': [
    'Courier actions & costs',
    'কুরিয়ার অ্যাকশন ও খরচ',
  ],
  'ordersCourierOpsPanel.courier': ['Courier', 'কুরিয়ার'],
  'ordersCourierOpsPanel.hide': ['Hide', 'লুকান'],
  'ordersCourierOpsPanel.proofOfDelivery': ['Proof of delivery', 'ডেলিভারির প্রমাণ'],
  'ordersCourierOpsPanel.signature': ['Signature', 'স্বাক্ষর'],
  'ordersCourierOpsPanel.reAttemptUnavailable': [
    'Re-attempt unavailable{value}',
    'পুনরায় চেষ্টা করা যাচ্ছে না{value}',
  ],
  'ordersCourierOpsPanel.correctRecipient': ['Correct recipient', 'প্রাপকের তথ্য সংশোধন'],
  'ordersCourierOpsPanel.cancelWithCourier': ['Cancel with courier', 'কুরিয়ারের কাছে বাতিল করুন'],
  'ordersCourierOpsPanel.voidedWithItsOrderIt': [
    'Voided with its order. It never had a waybill, so there is nothing at the courier.',
    'অর্ডারের সাথেই বাতিল হয়েছে। এর কোনো ওয়েবিল ছিল না, তাই কুরিয়ারের কাছে কিছু নেই।',
  ],
  'ordersCourierOpsPanel.cancelWaybillWithCourier': [
    'Cancel waybill with courier',
    'কুরিয়ারের কাছে ওয়েবিল বাতিল করুন',
  ],
  'ordersCourierOpsPanel.markCancelledOutsideSkydrop': [
    'Mark cancelled outside Skydrop',
    'Skydrop-এর বাইরে বাতিল হয়েছে বলে চিহ্নিত করুন',
  ],
  'ordersCourierOpsPanel.theCourierHoldsNoSuch': [
    'The courier holds no such document for this parcel. They only serve documents they have not archived.',
    'এই পার্সেলের জন্য কুরিয়ারের কাছে এমন কোনো ডকুমেন্ট নেই। তারা শুধু সেই ডকুমেন্টই দেয় যা আর্কাইভ করা হয়নি।',
  ],
  'ordersCourierOpsPanel.requestSubmitted': ['Request submitted.', 'অনুরোধ জমা হয়েছে।'],
  'ordersCourierOpsPanel.requestSubmittedRefDelhiveryConfirms': [
    'Request submitted (ref {uplId}). Delhivery confirms separately.',
    'অনুরোধ জমা হয়েছে (রেফ {uplId})। Delhivery আলাদাভাবে নিশ্চিত করবে।',
  ],
  'ordersCourierOpsPanel.cancellationSentAParcelAlready': [
    'Cancellation sent. A parcel already moving comes back as a return; its scans will move the order.',
    'বাতিলের অনুরোধ পাঠানো হয়েছে। যে পার্সেল ইতিমধ্যে পথে আছে তা রিটার্ন হয়ে ফিরে আসে; তার স্ক্যানই অর্ডারের স্ট্যাটাস বদলাবে।',
  ],
  'ordersCourierOpsPanel.loadingCourierDetails': [
    'Loading courier details',
    'কুরিয়ারের তথ্য লোড হচ্ছে',
  ],
  'ordersCourierOpsPanel.expectedTransit': ['Expected transit', 'আনুমানিক ট্রানজিট সময়'],
  'ordersCourierOpsPanel.courierCost': ['Courier cost', 'কুরিয়ারের খরচ'],
  'ordersCourierOpsPanel.theirZone': ['Their zone', 'তাদের জোন'],
  'ordersCourierOpsPanel.requesting': ['Requesting…', 'অনুরোধ পাঠানো হচ্ছে…'],
  'ordersCourierOpsPanel.requestAnotherDeliveryAttempt': [
    'Request another delivery attempt',
    'আরেকবার ডেলিভারির চেষ্টার অনুরোধ করুন',
  ],
  'ordersCourierOpsPanel.requestAnotherDeliveryAttempt2': [
    'Request another delivery attempt?',
    'আরেকবার ডেলিভারির চেষ্টার অনুরোধ করবেন?',
  ],
  'ordersCourierOpsPanel.theCourierIsAskedTo': [
    'The courier is asked to send its van out to the customer again; it confirms separately, and only its own scans move the order.',
    'কুরিয়ারকে আবার গ্রাহকের কাছে গাড়ি পাঠাতে বলা হবে; তারা আলাদাভাবে নিশ্চিত করবে, আর শুধু তাদের নিজেদের স্ক্যানই অর্ডারের স্ট্যাটাস বদলাবে।',
  ],
  'ordersCourierOpsPanel.requestTheAttempt': ['Request the attempt', 'চেষ্টার অনুরোধ করুন'],
  'ordersCourierOpsPanel.cancelThisParcelWithThe': [
    'Cancel this parcel with the courier?',
    'কুরিয়ারের কাছে এই পার্সেল বাতিল করবেন?',
  ],
  'ordersCourierOpsPanel.aParcelAlreadyInTransit': [
    'A parcel already in transit does not vanish — it becomes a return and comes back to us, at the cost of a return leg. Only a not-yet-collected parcel stops where it is.',
    'পথে থাকা পার্সেল উধাও হয়ে যায় না — সেটি রিটার্ন হয়ে আমাদের কাছে ফিরে আসে, ফেরতের একটি লেগের খরচসহ। শুধু যে পার্সেল এখনও সংগ্রহ করা হয়নি সেটিই যেখানে আছে সেখানে থেমে যায়।',
  ],
  'ordersCourierOpsPanel.theOrderIsNotMoved': [
    "The order is not moved by this action; the courier's own scans will move it.",
    'এই অ্যাকশনে অর্ডারের স্ট্যাটাস বদলায় না; কুরিয়ারের নিজেদের স্ক্যানই তা বদলাবে।',
  ],
  'ordersCourierOpsPanel.cancelParcel': ['Cancel parcel', 'পার্সেল বাতিল করুন'],
  'ordersCourierOpsPanel.cancelling': ['Cancelling…', 'বাতিল হচ্ছে…'],
  'ordersCourierOpsPanel.reason': ['Reason', 'কারণ'],
  'ordersCourierOpsPanel.whyIsThisBeingPulled': [
    'Why is this being pulled?',
    'এটি কেন তুলে নেওয়া হচ্ছে?',
  ],
  'ordersCourierOpsPanel.theCourierAcceptedTheCancellation': [
    'The courier accepted the cancellation. The waybill is closed.',
    'কুরিয়ার বাতিল গ্রহণ করেছে। ওয়েবিল বন্ধ হয়েছে।',
  ],
  'ordersCourierOpsPanel.theCourierDidNotAccept': [
    'The courier did not accept the cancellation.',
    'কুরিয়ার বাতিল গ্রহণ করেনি।',
  ],
  'ordersCourierOpsPanel.recordedAsCancelledOutsideSkydrop': [
    'Recorded as cancelled outside Skydrop.',
    'Skydrop-এর বাইরে বাতিল হয়েছে বলে রেকর্ড করা হয়েছে।',
  ],
  'ordersCourierOpsPanel.recordThisWaybillAsCancelled': [
    'Record this waybill as cancelled outside Skydrop?',
    'এই ওয়েবিল Skydrop-এর বাইরে বাতিল হয়েছে বলে রেকর্ড করবেন?',
  ],
  'ordersCourierOpsPanel.useThisOnlyWhenThe': [
    "Use this only when the waybill was already cancelled in the courier's own portal or by phone. Skydrop does NOT call the courier; it records your word, and the record says so.",
    'শুধু তখনই ব্যবহার করুন যখন ওয়েবিল ইতিমধ্যে কুরিয়ারের নিজস্ব পোর্টালে বা ফোনে বাতিল করা হয়েছে। Skydrop কুরিয়ারকে ফোন করে না; এটি আপনার কথাই রেকর্ড করে, আর রেকর্ডেও সেটাই লেখা থাকে।',
  ],
  'ordersCourierOpsPanel.recordAsCancelled': ['Record as cancelled', 'বাতিল হিসেবে রেকর্ড করুন'],
  'ordersCourierOpsPanel.recording': ['Recording…', 'রেকর্ড হচ্ছে…'],
  'ordersCourierOpsPanel.howWasItCancelled': ['How was it cancelled?', 'কীভাবে বাতিল হয়েছিল?'],
  'ordersCourierOpsPanel.howWasItCancelledE': [
    'How was it cancelled? e.g. cancelled in the Delhivery portal on 12 Sep',
    'কীভাবে বাতিল হয়েছিল? যেমন 12 সেপ্টেম্বর Delhivery পোর্টালে বাতিল করা হয়েছে',
  ],
  'ordersCourierOpsPanel.cancelThisWaybillWithThe': [
    'Cancel this waybill with the courier?',
    'কুরিয়ারের কাছে এই ওয়েবিল বাতিল করবেন?',
  ],
  'ordersCourierOpsPanel.theOrderIsAlreadyCancelled': [
    'The order is already cancelled. This asks the courier to close the waybill it booked, which is what credits the booking charge back. The order does not change.',
    'অর্ডার ইতিমধ্যে বাতিল। এটি কুরিয়ারকে তাদের বুক করা ওয়েবিল বন্ধ করতে বলে, যার ফলে বুকিং চার্জ ফেরত আসে। অর্ডারে কোনো পরিবর্তন হয় না।',
  ],
  'ordersCourierOpsPanel.cancelWaybill': ['Cancel waybill', 'ওয়েবিল বাতিল করুন'],
  'ordersCourierOpsPanel.whyEGOrderCancelled': [
    'Why? e.g. order cancelled before pickup',
    'কেন? যেমন পিকআপের আগে অর্ডার বাতিল হয়েছে',
  ],
  'ordersCourierOpsPanel.correctionSentToTheCourier': [
    'Correction sent to the courier.',
    'সংশোধন কুরিয়ারের কাছে পাঠানো হয়েছে।',
  ],
  'ordersCourierOpsPanel.correctTheRecipient': [
    'Correct the recipient',
    'প্রাপকের তথ্য সংশোধন করুন',
  ],
  'ordersCourierOpsPanel.onlyTheFieldsYouFill': [
    'Only the fields you fill are changed. Delhivery refuses edits on parcels already dispatched or in a terminal state.',
    'শুধু আপনার পূরণ করা ঘরগুলোই বদলাবে। যে পার্সেল ইতিমধ্যে ডিসপ্যাচ হয়েছে বা চূড়ান্ত অবস্থায় আছে, তাতে Delhivery এডিট গ্রহণ করে না।',
  ],
  'ordersCourierOpsPanel.sendCorrection': ['Send correction', 'সংশোধন পাঠান'],
  'ordersCourierOpsPanel.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'ordersCourierOpsPanel.name': ['Name', 'নাম'],
  'ordersCourierOpsPanel.phone': ['Phone', 'ফোন'],
  'ordersCourierOpsPanel.address': ['Address', 'ঠিকানা'],
  'ordersCourierOpsPanel.eWayBillAttached': ['E-way bill attached.', 'ই-ওয়ে বিল সংযুক্ত হয়েছে।'],
  'ordersCourierOpsPanel.attachAnEWayBill': ['Attach an e-way bill', 'ই-ওয়ে বিল সংযুক্ত করুন'],
  'ordersCourierOpsPanel.requiredByLawAbove50': [
    'Required by law above ₹50,000 of goods. Moving them without one risks the consignment being detained and penalised.',
    '₹50,000-এর বেশি মূল্যের পণ্যে আইনত বাধ্যতামূলক। এটি ছাড়া পণ্য পরিবহন করলে চালান আটক ও জরিমানার ঝুঁকি থাকে।',
  ],
  'ordersCourierOpsPanel.attach': ['Attach', 'সংযুক্ত করুন'],
  'ordersCourierOpsPanel.attaching': ['Attaching…', 'সংযুক্ত হচ্ছে…'],
  'ordersCourierOpsPanel.invoiceNumber': ['Invoice number', 'ইনভয়েস নম্বর'],
  'ordersCourierOpsPanel.theInvoiceTheEWay': [
    'The invoice the e-way bill was raised against.',
    'যে ইনভয়েসের বিপরীতে ই-ওয়ে বিল তৈরি হয়েছে।',
  ],
  'ordersCourierOpsPanel.eWayBillNumber': ['E-way bill number', 'ই-ওয়ে বিল নম্বর'],
  'ordersResellerMoneyPanel.when': ['When', 'কখন'],
  'ordersResellerMoneyPanel.amount': ['Amount', 'পরিমাণ'],
  'ordersResellerMoneyPanel.noLinesYet': ['No lines yet.', 'এখনও কোনো লাইন নেই।'],
  'ordersResellerMoneyPanel.party': ['Party', 'পক্ষ'],
  'ordersResellerMoneyPanel.status': ['Status', 'স্ট্যাটাস'],
  'ordersResellerMoneyPanel.gross': ['Gross', 'মোট'],
  'ordersResellerMoneyPanel.transfer': ['Transfer', 'ট্রান্সফার'],
  'ordersResellerMoneyPanel.taxShare': ['Tax share', 'কর অংশ'],
  'ordersResellerMoneyPanel.codFee': ['COD fee', 'COD ফি'],
  'ordersResellerMoneyPanel.instantPay': ['Instant Pay', 'Instant Pay'],
  'ordersResellerMoneyPanel.net': ['Net', 'নিট'],
  'ordersResellerMoneyPanel.notPlannedYetThePlan': [
    'Not planned yet — the plan is made when the order is confirmed.',
    'এখনও পরিকল্পনা করা হয়নি — অর্ডার নিশ্চিত হলে পরিকল্পনা তৈরি হয়।',
  ],
  'ordersResellerMoneyPanel.feeBilled': ['Fee billed', 'বিল করা ফি'],
  'ordersResellerMoneyPanel.store': ['Store', 'স্টোর'],
  'ordersResellerMoneyPanel.client': ['Client', 'ক্লায়েন্ট'],
  'ordersResellerMoneyPanel.total': ['Total', 'সর্বমোট'],
  'ordersResellerMoneyPanel.storeNet': ['Store net:', 'স্টোরের নিট:'],
  'ordersResellerMoneyPanel.clientNet': ['Client net:', 'ক্লায়েন্টের নিট:'],
  'ordersResellerMoneyPanel.memberStoreOrderMoney': [
    'Member store order money',
    'মেম্বার স্টোর অর্ডারের অর্থ',
  ],
  'ordersResellerMoneyPanel.loadingTheMemberStoreSplit': [
    'Loading the member store split…',
    'মেম্বার স্টোরের ভাগ লোড হচ্ছে…',
  ],
  'ordersResellerMoneyPanel.eachPartySCreditAt': [
    "Each party's credit at its own trigger, every Skydrop fee split by the order's snapshot, and both wallets' lines. Skydrop's take is the same as an identical channel order's.",
    'প্রতিটি পক্ষের ক্রেডিট তার নিজস্ব ট্রিগারে, Skydrop-এর প্রতিটি ফি অর্ডারের স্ন্যাপশট অনুযায়ী ভাগ করা, এবং দুই ওয়ালেটেরই লাইনগুলো। Skydrop-এর অংশ অভিন্ন চ্যানেল অর্ডারের মতোই।',
  ],
  'ordersResellerMoneyPanel.payment': ['Payment', 'পেমেন্ট'],
  'ordersResellerMoneyPanel.retailTotal': ['Retail total', 'খুচরা মোট'],
  'ordersResellerMoneyPanel.transferTotal': ['Transfer total', 'ট্রান্সফার মোট'],
  'ordersResellerMoneyPanel.termsVersion': ['Terms version', 'শর্তের সংস্করণ'],
  'ordersResellerMoneyPanel.storePays': ['Store pays', 'স্টোর যা দেবে'],
  'ordersResellerMoneyPanel.creditsByParty': ['Credits by party', 'পক্ষ অনুযায়ী ক্রেডিট'],
  'ordersResellerMoneyPanel.feesBilled': ['Fees billed', 'বিল করা ফি'],
  'ordersResellerMoneyPanel.storeWallet': ['Store wallet', 'স্টোর ওয়ালেট'],
  'ordersResellerMoneyPanel.clientWallet': ['Client wallet', 'ক্লায়েন্ট ওয়ালেট'],
  'ordersManualPlacementPanel.placeWithAnotherCourier': [
    'Place with another courier',
    'অন্য কুরিয়ারে প্লেস করুন',
  ],
  'ordersManualPlacementPanel.cannotBeFulfilled': ['Cannot be fulfilled', 'পূরণ করা সম্ভব নয়'],
  'ordersManualPlacementPanel.alreadyHasAnAwbNothing': [
    'Already has an AWB — nothing further to place.',
    'ইতিমধ্যে AWB আছে — আর কিছু প্লেস করার নেই।',
  ],
  'ordersManualPlacementPanel.cancel': ['Cancel', 'বাতিল'],
  'ordersManualPlacementPanel.youHaveBookedThisParcel': [
    'You have booked this parcel with a courier outside Skydrop, so record the waybill once it is really with them. A parcel that has already been picked and packed goes out; one that has not goes to the warehouse floor to be picked first. The result says which.',
    'আপনি এই পার্সেল Skydrop-এর বাইরে কোনো কুরিয়ারে বুক করেছেন, তাই সেটি সত্যিই তাদের কাছে পৌঁছালে ওয়েবিলটি রেকর্ড করুন। যে পার্সেল ইতিমধ্যে পিক ও প্যাক করা হয়েছে সেটি বেরিয়ে যায়; যেটি হয়নি সেটি আগে পিক করার জন্য ওয়্যারহাউস ফ্লোরে যায়। ফলাফলে বলা থাকে কোনটি হলো।',
  ],
  'ordersManualPlacementPanel.keepTheOrder': ['Keep the order', 'অর্ডার রেখে দিন'],
  'ordersManualPlacementPanel.noCourierWillCarryThis': [
    'No courier will carry this parcel. Cancelling releases the stock back to inventory and voids the shipment. The client sees a cancelled order, so say why in terms they would recognise.',
    'কোনো কুরিয়ারই এই পার্সেল নেবে না। বাতিল করলে স্টক ইনভেন্টরিতে ফিরে যায় এবং শিপমেন্ট বাতিল হয়। ক্লায়েন্ট বাতিল অর্ডার দেখবেন, তাই এমনভাবে কারণ লিখুন যা তাঁরা বুঝবেন।',
  ],
  'ordersManualPlacementPanel.awbRecordedOrderIsNow': [
    'AWB {awbNumber} recorded. Order is now {orderStatus}.',
    'AWB {awbNumber} রেকর্ড হয়েছে। অর্ডার এখন {orderStatus}।',
  ],
  'ordersManualPlacementPanel.orderCancelledAndStockReleased': [
    'Order cancelled and stock released.',
    'অর্ডার বাতিল হয়েছে এবং স্টক ছেড়ে দেওয়া হয়েছে।',
  ],
  'ordersManualPlacementPanel.recordAwbAndDispatch': [
    'Record AWB and dispatch',
    'AWB রেকর্ড করে ডিসপ্যাচ করুন',
  ],
  'ordersManualPlacementPanel.recording': ['Recording…', 'রেকর্ড হচ্ছে…'],
  'ordersManualPlacementPanel.awbNumber': ['AWB number', 'AWB নম্বর'],
  'ordersManualPlacementPanel.asPrintedOnTheirLabel': [
    'As printed on their label',
    'তাদের লেবেলে যেমন ছাপা আছে',
  ],
  'ordersManualPlacementPanel.courier': ['Courier', 'কুরিয়ার'],
  'ordersManualPlacementPanel.bluedartDtdcWhoeverHasIt': [
    'Bluedart, DTDC, whoever has it. The client and the customer both see this name on their tracking — leave it blank and they are told their parcel is with a courier called “manual”.',
    'Bluedart, DTDC, যাদের কাছেই থাকুক। ক্লায়েন্ট ও গ্রাহক দুজনেই ট্র্যাকিংয়ে এই নাম দেখেন — ফাঁকা রাখলে তাঁদের জানানো হবে পার্সেলটি “manual” নামের একটি কুরিয়ারের কাছে আছে।',
  ],
  'ordersManualPlacementPanel.serviceType': ['Service type', 'সার্ভিসের ধরন'],
  'ordersManualPlacementPanel.theirServiceTierIfIt': [
    'Their service tier, if it matters later. Optional.',
    'তাদের সার্ভিস টিয়ার, পরে দরকার হলে। ঐচ্ছিক।',
  ],
  'ordersManualPlacementPanel.cancelTheOrder': ['Cancel the order', 'অর্ডার বাতিল করুন'],
  'ordersManualPlacementPanel.cancelling': ['Cancelling…', 'বাতিল হচ্ছে…'],
  'ordersManualPlacementPanel.reason': ['Reason', 'কারণ'],
  'ordersManualPlacementPanel.atLeast10CharactersIt': [
    'At least 10 characters — it is kept on the order.',
    'কমপক্ষে 10টি অক্ষর — এটি অর্ডারে সংরক্ষিত থাকে।',
  ],
  'ordersManualPlacementPanel.eGNoCourierServes': [
    'e.g. No courier serves this PIN; customer contacted and agrees to cancel.',
    'যেমন কোনো কুরিয়ার এই PIN-এ সেবা দেয় না; গ্রাহকের সাথে কথা হয়েছে এবং তিনি বাতিলে রাজি।',
  ],
  'ordersStuckOrderRecovery.retryStockHasArrived': [
    'Retry — stock has arrived',
    'আবার চেষ্টা করুন — স্টক এসেছে',
  ],
  'ordersStuckOrderRecovery.sendBackToThePick': [
    'Send back to the pick floor',
    'পিক ফ্লোরে ফেরত পাঠান',
  ],
  'ordersStuckOrderRecovery.stillNothingToReserveThe': [
    'Still nothing to reserve — the order stays out of stock.',
    'রিজার্ভ করার মতো এখনও কিছু নেই — অর্ডার স্টক-আউটই থাকছে।',
  ],
  'ordersStuckOrderRecovery.stockReservedOrderIsNow': [
    'Stock reserved. Order is now {status}.',
    'স্টক রিজার্ভ হয়েছে। অর্ডার এখন {status}।',
  ],
  'ordersStuckOrderRecovery.backOnThePickFloor': [
    'Back on the pick floor — order is now {status}.',
    'পিক ফ্লোরে ফেরত গেছে — অর্ডার এখন {status}।',
  ],
  'ordersStuckOrderRecovery.waitingOnStock': ['Waiting on stock', 'স্টকের অপেক্ষায়'],
  'ordersStuckOrderRecovery.stuckAtManualPlacement': [
    'Stuck at manual placement',
    'ম্যানুয়াল প্লেসমেন্টে আটকে আছে',
  ],
  'ordersStuckOrderRecovery.theCallWasConfirmedBut': [
    'The call was confirmed but there was nothing to reserve. Retry once the stock has landed — if there is still none, the order simply stays here.',
    'কল নিশ্চিত হয়েছিল কিন্তু রিজার্ভ করার মতো কিছু ছিল না। স্টক এসে পৌঁছালে আবার চেষ্টা করুন — তবুও না থাকলে অর্ডারটি এখানেই থেকে যাবে।',
  ],
  'ordersStuckOrderRecovery.ifThisOrderWasNever': [
    'If this order was never picked, manual placement will refuse it. Send it back to the pick floor and it can be picked normally.',
    'এই অর্ডার কখনো পিক না হয়ে থাকলে ম্যানুয়াল প্লেসমেন্ট এটি গ্রহণ করবে না। এটি পিক ফ্লোরে ফেরত পাঠান, তাহলে স্বাভাবিকভাবে পিক করা যাবে।',
  ],
  'ordersStuckOrderRecovery.retryTheStockReservation': [
    'Retry the stock reservation?',
    'স্টক রিজার্ভেশন আবার চেষ্টা করবেন?',
  ],
  'ordersStuckOrderRecovery.theOrderIsSentBack': [
    'The order is sent back to confirmed and stock is reserved for it if any has landed; if there is still none, it stays out of stock.',
    'অর্ডারটি আবার নিশ্চিত অবস্থায় ফেরত যায় এবং স্টক এসে থাকলে তার জন্য রিজার্ভ হয়; তবুও না থাকলে অর্ডার স্টক-আউটই থাকে।',
  ],
  'ordersStuckOrderRecovery.sendThisOrderBackTo': [
    'Send this order back to the pick floor?',
    'এই অর্ডার পিক ফ্লোরে ফেরত পাঠাবেন?',
  ],
  'ordersStuckOrderRecovery.theOrderLeavesManualPlacement': [
    'The order leaves manual placement and goes back to pending pick, so the warehouse picks it again.',
    'অর্ডারটি ম্যানুয়াল প্লেসমেন্ট ছেড়ে পিকের অপেক্ষায় ফিরে যায়, ফলে ওয়্যারহাউস আবার এটি পিক করে।',
  ],
  'ordersShipmentCostPanel.recordCourierCost': [
    'Record courier cost',
    'কুরিয়ারের খরচ রেকর্ড করুন',
  ],
  'ordersShipmentCostPanel.cancel': ['Cancel', 'বাতিল'],
  'ordersShipmentCostPanel.save': ['Save', 'সংরক্ষণ করুন'],
  'ordersShipmentCostPanel.delivery': ['Delivery', 'ডেলিভারি'],
  'ordersShipmentCostPanel.return': ['Return', 'রিটার্ন'],
  'ordersShipmentCostPanel.enterAtLeastOneFigure': [
    'Enter at least one figure',
    'কমপক্ষে একটি অঙ্ক লিখুন',
  ],
  'ordersShipmentCostPanel.thisParcel': ['This parcel', 'এই পার্সেল'],
  'ordersShipmentCostPanel.whatDidThisParcelCost': [
    'What did this parcel cost us?',
    'এই পার্সেলে আমাদের কত খরচ হয়েছে?',
  ],
  'ordersShipmentCostPanel.fromTheCourierSInvoice': [
    "From the courier's invoice. Feeds the delivery and returns margins; changes nothing the client was billed.",
    'কুরিয়ারের ইনভয়েস থেকে। এটি ডেলিভারি ও রিটার্নের মার্জিনে যায়; ক্লায়েন্টকে যা বিল করা হয়েছে তাতে কিছু বদলায় না।',
  ],
  'ordersShipmentCostPanel.deliveryCostInr': ['Delivery cost (INR)', 'ডেলিভারির খরচ (INR)'],
  'ordersShipmentCostPanel.whatTheyChargedToTake': [
    'What they charged to take it out',
    'পার্সেল পাঠাতে তারা যা নিয়েছে',
  ],
  'ordersShipmentCostPanel.returnCostInr': ['Return cost (INR)', 'রিটার্নের খরচ (INR)'],
  'ordersShipmentCostPanel.whatTheyChargedToBring': [
    'What they charged to bring it back. The delivery deduction is refunded on a return, so this is the whole cost of the parcel.',
    'পার্সেল ফেরত আনতে তারা যা নিয়েছে। রিটার্নে ডেলিভারির কর্তন ফেরত দেওয়া হয়, তাই এটিই পার্সেলের পুরো খরচ।',
  ],
  'ordersShipmentCostPanel.onlyIfItCameBack': [
    'Only if it came back. Leave blank otherwise.',
    'শুধু ফেরত এলে। না হলে ফাঁকা রাখুন।',
  ],
  'ordersShipmentCostPanel.recordThisCourierCost': [
    'Record this courier cost?',
    'এই কুরিয়ারের খরচ রেকর্ড করবেন?',
  ],
  'ordersShipmentCostPanel.thePLReadsThis': [
    'The P&L reads this cost as what the parcel cost us to carry; nothing the client was billed changes.',
    'P&L এই খরচকে পার্সেল বহনে আমাদের খরচ হিসেবে ধরে; ক্লায়েন্টকে যা বিল করা হয়েছে তাতে কিছু বদলায় না।',
  ],
  'ordersShipmentCostPanel.saveTheCost': ['Save the cost', 'খরচ সংরক্ষণ করুন'],
  'ordersOrderCharges.computePersistCharges': [
    'Compute & persist charges',
    'চার্জ হিসাব করে সংরক্ষণ করুন',
  ],
  'ordersOrderCharges.charge': ['Charge', 'চার্জ'],
  'ordersOrderCharges.visibility': ['Visibility', 'দৃশ্যমানতা'],
  'ordersOrderCharges.amountInr': ['Amount (INR)', 'পরিমাণ (INR)'],
  'ordersOrderCharges.total': ['Total', 'মোট'],
  'ordersOrderCharges.chargesComputedAndSaved': [
    'Charges computed and saved.',
    'চার্জ হিসাব করে সংরক্ষণ করা হয়েছে।',
  ],
  'ordersOrderCharges.computeFailed': ['Compute failed.', 'হিসাব ব্যর্থ হয়েছে।'],
  'ordersOrderCharges.loadingCharges': ['Loading charges…', 'চার্জ লোড হচ্ছে…'],
  'ordersOrderCharges.failedToLoadCharges': ['Failed to load charges.', 'চার্জ লোড করা যায়নি।'],
  'ordersOrderCharges.noCharges': ['No charges', 'কোনো চার্জ নেই'],
  'ordersOrderCharges.noChargesPersistedYet': [
    'No charges persisted yet',
    'এখনও কোনো চার্জ সংরক্ষিত হয়নি',
  ],
  'ordersOrderCharges.clickComputePersistChargesTo': [
    "Click 'Compute & persist charges' to evaluate via the M15 pricing engine.",
    'M15 প্রাইসিং ইঞ্জিন দিয়ে হিসাব করতে ‘চার্জ হিসাব করে সংরক্ষণ করুন’ চাপুন।',
  ],
  'ordersOrderCharges.charges': ['Charges', 'চার্জ'],
  'ordersOrderCharges.computeAndSaveThisOrder': [
    "Compute and save this order's charges?",
    'এই অর্ডারের চার্জ হিসাব করে সংরক্ষণ করবেন?',
  ],
  'ordersOrderCharges.thePricingEngineEvaluatesThis': [
    'The pricing engine evaluates this order and writes its charge lines; they cannot be computed again once saved.',
    'প্রাইসিং ইঞ্জিন এই অর্ডার মূল্যায়ন করে এর চার্জ লাইনগুলো লেখে; একবার সংরক্ষিত হলে এগুলো আর নতুন করে হিসাব করা যায় না।',
  ],
  'ordersOrderCharges.clientVisible': ['Client-visible', 'ক্লায়েন্টের দৃশ্যমান'],
  'ordersOrderCharges.internal': ['Internal', 'অভ্যন্তরীণ'],
  'ordersOrderShipmentsSection.supersede': ['· supersede', '· প্রতিস্থাপিত'],
  'ordersOrderShipmentsSection.publicTracking': ['Public tracking', 'পাবলিক ট্র্যাকিং'],
  'ordersOrderShipmentsSection.loadingShipments': ['Loading shipments…', 'শিপমেন্ট লোড হচ্ছে…'],
  'ordersOrderShipmentsSection.failedToLoadShipments': [
    'Failed to load shipments.',
    'শিপমেন্ট লোড করা যায়নি।',
  ],
  'ordersOrderShipmentsSection.noShipmentsYet': ['No shipments yet', 'এখনও কোনো শিপমেন্ট নেই'],
  'ordersOrderShipmentsSection.noShipmentsYetAShipment': [
    'No shipments yet. A shipment is provisioned when the order is confirmed.',
    'এখনও কোনো শিপমেন্ট নেই। অর্ডার নিশ্চিত হলে শিপমেন্ট তৈরি হয়।',
  ],
  'ordersOrderShipmentsSection.via': [' · via {carrierName}', ' · {carrierName} মারফত'],
  'ordersOrderShipmentsSection.placedByHand': [' (placed by hand)', ' (হাতে প্লেস করা)'],
  'ordersResellerOrderPanel.line': ['Line', 'লাইন'],
  'ordersResellerOrderPanel.qty': ['Qty', 'পরিমাণ'],
  'ordersResellerOrderPanel.transferPrice': ['Transfer price', 'ট্রান্সফার মূল্য'],
  'ordersResellerOrderPanel.retail': ['Retail', 'খুচরা'],
  'ordersResellerOrderPanel.range': ['Range', 'সীমা'],
  'ordersResellerOrderPanel.stock': ['Stock', 'স্টক'],
  'ordersResellerOrderPanel.memberStore': ['Member store', 'মেম্বার স্টোর'],
  'ordersResellerOrderPanel.placedByAMemberStore': [
    'Placed by a member store under the terms below — snapshotted when it was placed, so later edits never re-price it.',
    'নিচের শর্তে একটি মেম্বার স্টোর এটি প্লেস করেছে — প্লেস করার সময়কার স্ন্যাপশট, তাই পরে শর্ত বদলালেও এর দাম বদলায় না।',
  ],
  'ordersResellerOrderPanel.store': ['Store', 'স্টোর'],
  'ordersResellerOrderPanel.termsVersion': ['Terms version', 'শর্তের সংস্করণ'],
  'ordersResellerOrderPanel.version': [
    'Version {resellerTermsVersionNumber}',
    'সংস্করণ {resellerTermsVersionNumber}',
  ],
  'ordersResellerOrderPanel.storePays': ['{label} — store pays', '{label} — স্টোর যা দেয়'],
  'ordersResellerOrderPanel.storeCredited': ['Store credited', 'স্টোরকে ক্রেডিট দেওয়া হয়েছে'],
  'ordersResellerOrderPanel.clientCredited': [
    'Client credited',
    'ক্লায়েন্টকে ক্রেডিট দেওয়া হয়েছে',
  ],
  'ordersResellerOrderPanel.memberStoreLines': ['Member store lines', 'মেম্বার স্টোরের লাইন'],
  'ordersResellerOrderPanel.anyPrice': ['Any price', 'যেকোনো দাম'],
  'ordersResellerOrderPanel.noMinimum': ['no minimum', 'সর্বনিম্ন সীমা নেই'],
  'ordersResellerOrderPanel.noMaximum': ['no maximum', 'সর্বোচ্চ সীমা নেই'],
  'ordersResellerOrderPanel.setAside': ['Set aside', 'আলাদা করে রাখা'],
  'ordersResellerOrderPanel.shared': ['Shared', 'ভাগাভাগি'],
  'ordersManualScanPanel.recordAScanManually': [
    'Record a scan manually',
    'ম্যানুয়ালি স্ক্যান রেকর্ড করুন',
  ],
  'ordersManualScanPanel.notStated': ['Not stated', 'উল্লেখ নেই'],
  'ordersManualScanPanel.scanRecordedAndTheOrder': [
    'Scan recorded and the order moved forward.',
    'স্ক্যান রেকর্ড হয়েছে এবং অর্ডার এগিয়েছে।',
  ],
  'ordersManualScanPanel.scanRecordedOnTheTimeline': [
    'Scan recorded on the timeline. The order did not move{value}. That is normal when it is already at or past this point.',
    'স্ক্যান টাইমলাইনে রেকর্ড হয়েছে। অর্ডার এগোয়নি{value}। অর্ডার ইতিমধ্যে এই ধাপে বা তার পরে থাকলে এটাই স্বাভাবিক।',
  ],
  'ordersManualScanPanel.recordACourierScan': [
    'Record a courier scan',
    'কুরিয়ারের স্ক্যান রেকর্ড করুন',
  ],
  'ordersManualScanPanel.forWhenTheCourierS': [
    "For when the courier's webhook never reached us. This drives the order exactly as a real scan would.",
    'কুরিয়ারের ওয়েবহুক আমাদের কাছে না পৌঁছালে এটি ব্যবহার করুন। এটি আসল স্ক্যানের মতোই অর্ডারকে এগিয়ে নেয়।',
  ],
  'ordersManualScanPanel.cancel': ['Cancel', 'বাতিল'],
  'ordersManualScanPanel.done': ['Done', 'সম্পন্ন'],
  'ordersManualScanPanel.recordScan': ['Record scan', 'স্ক্যান রেকর্ড করুন'],
  'ordersManualScanPanel.recording': ['Recording…', 'রেকর্ড হচ্ছে…'],
  'ordersManualScanPanel.whatHappened': ['What happened', 'কী ঘটেছে'],
  'ordersManualScanPanel.onlyScansACourierCan': [
    'Only scans a courier can report are listed. RTO received is a warehouse action, not a scan.',
    'শুধু সেই স্ক্যানগুলোই দেখানো হয়েছে যা কুরিয়ার জানাতে পারে। RTO গ্রহণ ওয়্যারহাউসের অ্যাকশন, স্ক্যান নয়।',
  ],
  'ordersManualScanPanel.whenItHappened': ['When it happened', 'কখন ঘটেছে'],
  'ordersManualScanPanel.theTimeOfTheScan': [
    "The time of the SCAN, not now. Backdating puts it in the right place in the customer's timeline.",
    'স্ক্যানের সময়, এখনকার সময় নয়। পিছনের সময় দিলে এটি গ্রাহকের টাইমলাইনে সঠিক জায়গায় বসে।',
  ],
  'ordersManualScanPanel.city': ['City', 'শহর'],
  'ordersManualScanPanel.optionalShownToTheCustomer': [
    'Optional. Shown to the customer.',
    'ঐচ্ছিক। গ্রাহককে দেখানো হয়।',
  ],
  'ordersManualScanPanel.whyDeliveryFailed': ['Why delivery failed', 'ডেলিভারি কেন ব্যর্থ হলো'],
  'ordersManualScanPanel.recordedAsTheNdrReason': [
    "Recorded as the NDR reason. The courier's own categories.",
    'NDR-এর কারণ হিসেবে রেকর্ড হয়। কুরিয়ারের নিজস্ব ক্যাটাগরি।',
  ],
  'ordersManualScanPanel.description': ['Description', 'বিবরণ'],
  'ordersManualScanPanel.optionalWhatTheCourierS': [
    "Optional. What the courier's panel said, so the next person can check it.",
    'ঐচ্ছিক। কুরিয়ারের প্যানেলে যা লেখা ছিল, যাতে পরের জন যাচাই করতে পারেন।',
  ],
  'ordersOrderActionsPanel.lifecycleActions': ['Lifecycle actions', 'লাইফসাইকেল অ্যাকশন'],
  'ordersOrderActionsPanel.stateMachineGuardedTransitionsThe': [
    "State-machine-guarded transitions. The server enforces legal moves; the UI shows the action and surfaces the server's verdict.",
    'স্টেট-মেশিন দ্বারা সুরক্ষিত ট্রানজিশন। বৈধ পদক্ষেপ সার্ভার নিশ্চিত করে; UI শুধু অ্যাকশন দেখায় এবং সার্ভারের সিদ্ধান্ত তুলে ধরে।',
  ],
  'ordersOrderActionsPanel.saneActions': ['Sane actions', 'স্বাভাবিক অ্যাকশন'],
  'ordersOrderActionsPanel.cancelOrder': ['Cancel order', 'অর্ডার বাতিল করুন'],
  'ordersOrderActionsPanel.requestReturn': ['Request return', 'রিটার্নের অনুরোধ করুন'],
  'ordersOrderActionsPanel.thisOrderIsInA': [
    "This order is in a terminal state; further sane lifecycle actions aren't available. God-mode override below is the extraordinary-correction path.",
    'এই অর্ডার চূড়ান্ত অবস্থায় আছে; আর কোনো স্বাভাবিক লাইফসাইকেল অ্যাকশন পাওয়া যাবে না। নিচের God-mode ওভাররাইড ব্যতিক্রমী সংশোধনের পথ।',
  ],
  'ordersOrderActionsPanel.godModeOrd2': ['God-mode (ORD-2)', 'God-mode (ORD-2)'],
  'ordersOrderActionsPanel.forceMutate': ['Force-mutate…', 'জোর করে বদলান…'],
  'ordersOrderActionsPanel.releaseReservations': ['Release reservations…', 'রিজার্ভেশন ছেড়ে দিন…'],
  'ordersOrderActionsPanel.restoreStockClaim': [
    'Restore stock claim…',
    'স্টকের দাবি ফিরিয়ে আনুন…',
  ],
  'ordersOrderActionsPanel.yourRoleDoesNotInclude': [
    'Your role does not include the god-mode override permission. Ask a super admin if an extraordinary correction is required.',
    'আপনার ভূমিকায় god-mode ওভাররাইডের অনুমতি নেই। ব্যতিক্রমী সংশোধন দরকার হলে সুপার অ্যাডমিনকে বলুন।',
  ],
  'ordersOrderActionsPanel.ifADeliveryFeeHas': [
    "If a delivery fee has already been charged for this order and the parcel has not been dispatched, it is credited back to the client's wallet automatically. Once dispatched, the fee stands — the courier already has the parcel.",
    'এই অর্ডারের জন্য ডেলিভারি ফি ইতিমধ্যে কাটা হয়ে থাকলে এবং পার্সেল ডিসপ্যাচ না হয়ে থাকলে তা স্বয়ংক্রিয়ভাবে ক্লায়েন্টের ওয়ালেটে ফেরত যায়। ডিসপ্যাচ হয়ে গেলে ফি থেকে যায় — কুরিয়ার ইতিমধ্যে পার্সেল নিয়ে নিয়েছে।',
  ],
  'ordersOrderActionsPanel.forceMutationApplied': [
    'Force-mutation applied',
    'জোর করে বদল প্রয়োগ হয়েছে',
  ],
  'ordersOrderActionsPanel.dismiss': ['Dismiss', 'বন্ধ করুন'],
  'ordersOrderActionsPanel.truePermanent': ['true (permanent)', 'true (স্থায়ী)'],
  'ordersOrderActionsPanel.theMoneyOnThisMember': [
    'The money on this member store order did NOT follow the change',
    'এই মেম্বার স্টোর অর্ডারের অর্থ পরিবর্তনের সাথে সাথে বদলায়নি',
  ],
  'ordersOrderActionsPanel.thisIsOpenOnSystem': [
    'This is open on /system-issues (MONEY, HIGH) and the store and client staff have been told. Settle the difference on the order’s ticket, or call the order off and place it again.',
    'এটি /system-issues-এ খোলা আছে (MONEY, HIGH) এবং স্টোর ও ক্লায়েন্টের স্টাফকে জানানো হয়েছে। পার্থক্যটি অর্ডারের টিকিটে মিটিয়ে নিন, অথবা অর্ডার বাতিল করে আবার প্লেস করুন।',
  ],
  'ordersOrderActionsPanel.reserveAttemptsAttemptedNotBlocking': [
    'Reserve attempts (attempted, NOT blocking)',
    'রিজার্ভের চেষ্টা (চেষ্টা করা হয়েছে, ব্লকিং নয়)',
  ],
  'ordersOrderActionsPanel.someAttemptsMayHaveFailed': [
    'Some attempts may have failed (e.g., insufficient stock); the saga did NOT block or compensate. Use the release-reservations action above if cleanup is needed.',
    'কিছু চেষ্টা ব্যর্থ হয়ে থাকতে পারে (যেমন স্টক অপর্যাপ্ত); স্যাগা ব্লকও করেনি, ক্ষতিপূরণও করেনি। পরিষ্কার করা দরকার হলে ওপরের রিজার্ভেশন-ছাড়ার অ্যাকশন ব্যবহার করুন।',
  ],
  'ordersOrderActionsPanel.reservationsReleased': [
    'Reservations released',
    'রিজার্ভেশন ছাড়া হয়েছে',
  ],
  'ordersOrderActionsPanel.alreadyInactive': ['(already inactive)', '(ইতিমধ্যে নিষ্ক্রিয়)'],
  'ordersOrderActionsPanel.failedToCancelOrder': [
    'Failed to cancel order.',
    'অর্ডার বাতিল করা যায়নি।',
  ],
  'ordersOrderActionsPanel.alreadyInATerminalState': [
    'Already in a terminal state ({value})',
    'ইতিমধ্যে চূড়ান্ত অবস্থায় আছে ({value})',
  ],
  'ordersOrderActionsPanel.cancelViaTheMatrixReleases': [
    'Cancel via the matrix (releases stock if reserved)',
    'ম্যাট্রিক্স অনুযায়ী বাতিল করুন (রিজার্ভ থাকলে স্টক ছেড়ে দেয়)',
  ],
  'ordersOrderActionsPanel.theCustomerWantsToSend': [
    'The customer wants to send it back — charged to the client as a second delivery',
    'গ্রাহক এটি ফেরত পাঠাতে চান — ক্লায়েন্টের কাছ থেকে দ্বিতীয় ডেলিভারি হিসেবে চার্জ করা হয়',
  ],
  'ordersOrderActionsPanel.requiresTheGodModeOverride': [
    'Requires the god-mode override permission',
    'god-mode ওভাররাইডের অনুমতি লাগে',
  ],
  'ordersOrderActionsPanel.releaseEveryActiveReservationCleanup': [
    'Release every ACTIVE reservation (cleanup after a god-mode move). Idempotent.',
    'প্রতিটি সক্রিয় রিজার্ভেশন ছেড়ে দিন (god-mode পরিবর্তনের পর পরিষ্কার করা)। বারবার চালালেও একই ফল।',
  ],
  'ordersOrderActionsPanel.requiresSuperAdminRole': [
    'Requires SUPER_ADMIN role',
    'SUPER_ADMIN ভূমিকা লাগে',
  ],
  'ordersOrderActionsPanel.reReserveStockForAn': [
    'Re-reserve stock for an order that lost its claim to an expired reservation. Refused if it already holds one.',
    'যে অর্ডার মেয়াদোত্তীর্ণ রিজার্ভেশনের কারণে স্টকের দাবি হারিয়েছে তার জন্য আবার স্টক রিজার্ভ করুন। ইতিমধ্যে দাবি থাকলে প্রত্যাখ্যাত হয়।',
  ],
  'ordersOrderActionsPanel.cancelThisOrder': ['Cancel this order?', 'এই অর্ডার বাতিল করবেন?'],
  'ordersOrderActionsPanel.saneAdminCancelDrivesThe': [
    'Sane admin cancel — drives the order through the state machine to CANCELLED_BY_ADMIN. Any active stock reservation will be released by the saga.',
    'স্বাভাবিক অ্যাডমিন বাতিল — অর্ডারকে স্টেট মেশিনের মধ্য দিয়ে CANCELLED_BY_ADMIN-এ নিয়ে যায়। সক্রিয় স্টক রিজার্ভেশন থাকলে স্যাগা তা ছেড়ে দেবে।',
  ],
  'ordersOrderActionsPanel.confirmCancel': ['Confirm cancel', 'বাতিল নিশ্চিত করুন'],
  'ordersOrderActionsPanel.keepOrder': ['Keep order', 'অর্ডার রেখে দিন'],
  'ordersOrderActionsPanel.cancellationReason': ['Cancellation reason', 'বাতিলের কারণ'],
  'ordersOrderActionsPanel.internalNoteOptional': [
    'Internal note (optional)',
    'অভ্যন্তরীণ নোট (ঐচ্ছিক)',
  ],
  'ordersOrderActionsPanel.recordedInTheOrderEvent': [
    'Recorded in the order event + audit log; not visible to the client.',
    'অর্ডার ইভেন্ট ও অডিট লগে রেকর্ড হয়; ক্লায়েন্ট দেখতে পান না।',
  ],
  'ordersOrderActionsPanel.reservedLineSAgainCan': [
    'Reserved {reservedCount} line(s) again — {orderNumber} can be picked.',
    '{reservedCount}টি লাইন আবার রিজার্ভ হয়েছে — {orderNumber} পিক করা যাবে।',
  ],
  'ordersOrderActionsPanel.nothingReserved': [
    'Nothing reserved: {shortfall}',
    'কিছুই রিজার্ভ হয়নি: {shortfall}',
  ],
  'ordersOrderActionsPanel.status': ['Status', 'স্ট্যাটাস'],
  'ordersOrderActionsPanel.unchanged': ['unchanged ({status})', 'অপরিবর্তিত ({status})'],
  'ordersOrderActionsPanel.fieldsApplied': ['Fields applied', 'প্রয়োগ করা ঘর'],
  'ordersOrderActionsPanel.aCreditOnThisOrder': [
    'A credit on this order had already been paid, so it could not be worked out again. The order now says one figure and the wallets say another.',
    'এই অর্ডারের একটি ক্রেডিট ইতিমধ্যে পরিশোধিত হয়ে গেছে, তাই এটি আর নতুন করে হিসাব করা যায়নি। এখন অর্ডারে এক অঙ্ক আর ওয়ালেটে আরেক অঙ্ক দেখাচ্ছে।',
  ],
  'ordersOrderActionsPanel.rePricingThisOrderFailed': [
    'Re-pricing this order failed. The stale figures are what would be paid until it succeeds.',
    'এই অর্ডারের রি-প্রাইসিং ব্যর্থ হয়েছে। সফল না হওয়া পর্যন্ত পুরোনো অঙ্কই পরিশোধ হবে।',
  ],
  'ordersOrderActionsPanel.reserved': ['Reserved', 'রিজার্ভ হয়েছে'],
  'ordersOrderActionsPanel.failed': ['Failed', 'ব্যর্থ'],
  'ordersOrderActionsPanel.reserved2': ['reserved ({value}…)', 'রিজার্ভ হয়েছে ({value}…)'],
  'ordersForceMutationDialog.cancel': ['Cancel', 'বাতিল'],
  'ordersForceMutationDialog.continueConfirmation': [
    'Continue → confirmation',
    'চালিয়ে যান → নিশ্চিতকরণ',
  ],
  'ordersForceMutationDialog.back': ['← Back', '← ফিরে যান'],
  'ordersForceMutationDialog.forceMutateThisOrder': [
    'Force-mutate this order',
    'এই অর্ডার জোর করে বদলান',
  ],
  'ordersForceMutationDialog.min': [
    '{reasonLen} / {minReasonLen} min',
    '{reasonLen} / {minReasonLen} ন্যূনতম',
  ],
  'ordersForceMutationDialog.confirmed': ['→ CONFIRMED', '→ CONFIRMED'],
  'ordersForceMutationDialog.hasadminoverrideTrue': [
    'hasAdminOverride: true',
    'hasAdminOverride: true',
  ],
  'ordersForceMutationDialog.thisIsADeliberateBypass': [
    'This is a deliberate bypass.',
    'এটি ইচ্ছাকৃত বাইপাস।',
  ],
  'ordersForceMutationDialog.changeS': ['{enabledCount} change(s)', '{enabledCount}টি পরিবর্তন'],
  'ordersForceMutationDialog.was': ['was: {value}', 'আগে ছিল: {value}'],
  'ordersForceMutationDialog.forceMutationFailed': [
    'Force mutation failed.',
    'জোর করে বদলানো ব্যর্থ হয়েছে।',
  ],
  'ordersForceMutationDialog.reasonMustBeAtLeast': [
    'Reason must be at least {minReasonLen} characters',
    'কারণ কমপক্ষে {minReasonLen} অক্ষরের হতে হবে',
  ],
  'ordersForceMutationDialog.youMustAcknowledgeTheData': [
    'You must acknowledge the data-integrity risk',
    'ডেটা-অখণ্ডতার ঝুঁকি আপনাকে স্বীকার করতে হবে',
  ],
  'ordersForceMutationDialog.eitherChangeAFieldOr': [
    'Either change a field or change the status (or both)',
    'হয় কোনো ঘর বদলান, নয়তো স্ট্যাটাস বদলান (অথবা দুটোই)',
  ],
  'ordersForceMutationDialog.godModeOverride': ['God-mode override', 'God-mode ওভাররাইড'],
  'ordersForceMutationDialog.ord2BypassesTheState': [
    'ORD-2. Bypasses the state machine and the standard edit rules. Audited CRITICAL. Marks the order with hasAdminOverride permanently.',
    'ORD-2। স্টেট মেশিন ও সাধারণ এডিট নিয়ম এড়িয়ে যায়। CRITICAL হিসেবে অডিট হয়। অর্ডারে স্থায়ীভাবে hasAdminOverride চিহ্ন বসে।',
  ],
  'ordersForceMutationDialog.forceOrderStatus': [
    'Force order status',
    'অর্ডারের স্ট্যাটাস জোর করে বদলান',
  ],
  'ordersForceMutationDialog.targetStatus': ['Target status', 'লক্ষ্য স্ট্যাটাস'],
  'ordersForceMutationDialog.justification': ['Justification', 'যুক্তি'],
  'ordersForceMutationDialog.explainWhyTheStateMachine': [
    'Explain why the state machine + edit rules must be bypassed. Be specific — this is the only audit-time record of intent.',
    'কেন স্টেট মেশিন ও এডিট নিয়ম এড়াতে হবে তা ব্যাখ্যা করুন। নির্দিষ্ট করে লিখুন — অডিটের সময় উদ্দেশ্যের এটিই একমাত্র রেকর্ড।',
  ],
  'ordersForceMutationDialog.recordedInTheAuditLog': [
    'Recorded in the audit log + order event. Visible forever.',
    'অডিট লগ ও অর্ডার ইভেন্টে রেকর্ড হয়। চিরকাল দেখা যাবে।',
  ],
  'ordersForceMutationDialog.new': ['New {value}', 'নতুন {value}'],
  'ordersForceMutationDialog.youAreAboutTo': ['You are about to:', 'আপনি যা করতে চলেছেন:'],
  'ordersForceMutationDialog.modifyFieldS': [
    'Modify {fieldChangeCount} field(s): {value}',
    '{fieldChangeCount}টি ঘর বদলানো: {value}',
  ],
  'ordersForceMutationDialog.forceStatus': [
    'Force status: {from} → {to}',
    'জোর করে স্ট্যাটাস বদল: {from} → {to}',
  ],
  'ordersForceMutationDialog.typeToConfirm': [
    'Type {typedConfirm} to confirm',
    'নিশ্চিত করতে {typedConfirm} টাইপ করুন',
  ],
  'ordersReleaseReservationsDialog.failedToReleaseReservations': [
    'Failed to release reservations.',
    'রিজার্ভেশন ছাড়া যায়নি।',
  ],
  'ordersReleaseReservationsDialog.releaseOrderReservations': [
    'Release order reservations',
    'অর্ডারের রিজার্ভেশন ছেড়ে দিন',
  ],
  'ordersReleaseReservationsDialog.godModeCleanupEveryActive': [
    'God-mode cleanup: every ACTIVE reservation tied to this order is released. Idempotent — safe to retry.',
    'God-mode পরিষ্কার: এই অর্ডারের সাথে যুক্ত প্রতিটি সক্রিয় রিজার্ভেশন ছেড়ে দেওয়া হয়। বারবার চালালেও একই ফল — নিরাপদে আবার চেষ্টা করা যায়।',
  ],
  'ordersReleaseReservationsDialog.releaseReservations': [
    'Release reservations',
    'রিজার্ভেশন ছেড়ে দিন',
  ],
  'ordersReleaseReservationsDialog.reasonOptional': ['Reason (optional)', 'কারণ (ঐচ্ছিক)'],
  'ordersReleaseReservationsDialog.recordedInTheAuditLog': [
    'Recorded in the audit log + order event. Audited HIGH.',
    'অডিট লগ ও অর্ডার ইভেন্টে রেকর্ড হয়। HIGH হিসেবে অডিট হয়।',
  ],
  'ordersReleaseReservationsDialog.eGCleanupAfterForce': [
    'e.g., Cleanup after force-mutation away from CONFIRMED.',
    'যেমন CONFIRMED থেকে জোর করে সরানোর পর পরিষ্কার করা।',
  ],
  'ordersRestoreReservationsDialog.failedToRestoreReservations': [
    'Failed to restore reservations.',
    'রিজার্ভেশন ফিরিয়ে আনা যায়নি।',
  ],
  'ordersRestoreReservationsDialog.restoreThisOrderSStock': [
    'Restore this order’s stock claim',
    'এই অর্ডারের স্টকের দাবি ফিরিয়ে আনুন',
  ],
  'ordersRestoreReservationsDialog.stockIsReReservedFor': [
    'Stock is re-reserved for an order that lost its claim to an expired reservation — refused if it already holds one or is past packing; all or nothing on a shortfall.',
    'যে অর্ডার মেয়াদোত্তীর্ণ রিজার্ভেশনের কারণে স্টকের দাবি হারিয়েছে তার জন্য আবার স্টক রিজার্ভ করা হয় — ইতিমধ্যে দাবি থাকলে বা প্যাকিং পেরিয়ে গেলে প্রত্যাখ্যাত; ঘাটতি থাকলে হয় সবটা, নয়তো কিছুই না।',
  ],
  'ordersRestoreReservationsDialog.restoreStockClaim': [
    'Restore stock claim',
    'স্টকের দাবি ফিরিয়ে আনুন',
  ],
  'ordersRestoreReservationsDialog.reasonOptional': ['Reason (optional)', 'কারণ (ঐচ্ছিক)'],
  'ordersRestoreReservationsDialog.recordedInTheAuditLog': [
    'Recorded in the audit log + order event. Audited HIGH.',
    'অডিট লগ ও অর্ডার ইভেন্টে রেকর্ড হয়। HIGH হিসেবে অডিট হয়।',
  ],
  'ordersRestoreReservationsDialog.eGReservationExpiredBy': [
    'e.g., Reservation expired by the TTL sweep before the fix; order still needs picking.',
    'যেমন সংশোধনের আগে TTL সুইপে রিজার্ভেশনের মেয়াদ শেষ হয়ে গেছে; অর্ডার এখনও পিক করতে হবে।',
  ],
  'ordersAdminRequestReturnDialog.cancel': ['Cancel', 'বাতিল'],
  'ordersAdminRequestReturnDialog.requestReturn': ['Request return', 'রিটার্নের অনুরোধ করুন'],
  'ordersAdminRequestReturnDialog.theClientIsCharged200': [
    'the client is charged ₹200',
    'ক্লায়েন্টের কাছ থেকে ₹200 নেওয়া হবে',
  ],
  'ordersAdminRequestReturnDialog.wasAlreadyComingBack': [
    '{orderNumber} was already coming back.',
    '{orderNumber} ইতিমধ্যে ফেরত আসছিল।',
  ],
  'ordersAdminRequestReturnDialog.whyIsItComingBack': [
    'Why is it coming back?',
    'এটি কেন ফেরত আসছে?',
  ],
  'ordersAdminRequestReturnDialog.theWarehouseReadsThisOn': [
    'The warehouse reads this on arrival; it decides whether the stock can be resold.',
    'ওয়্যারহাউস পৌঁছানোর পর এটি পড়ে; এর ভিত্তিতেই ঠিক হয় স্টক আবার বিক্রি করা যাবে কি না।',
  ],
  'ordersConsigneePanel.theCourierDidNotTake': [
    'the courier did not take it',
    'কুরিয়ার এটি গ্রহণ করেনি',
  ],
  'ordersConsigneePanel.sentConfirming': ['sent — confirming', 'পাঠানো হয়েছে — নিশ্চিত করা হচ্ছে'],
  'ordersConsigneePanel.confirmedOnTheirSystem': [
    'confirmed on their system',
    'তাদের সিস্টেমে নিশ্চিত হয়েছে',
  ],
  'ordersConsigneePanel.theirSystemStillShowsThe': [
    'their system still shows the old value — we are on it',
    'তাদের সিস্টেমে এখনও পুরোনো মান দেখাচ্ছে — আমরা দেখছি',
  ],
  'ordersConsigneePanel.toChaseItAnywayOpen': [
    'To chase it anyway, open a courier conversation on a ticket for this order.',
    'তবুও পিছু নিতে চাইলে এই অর্ডারের একটি টিকিটে কুরিয়ারের সাথে কথোপকথন খুলুন।',
  ],
  'ordersConsigneePanel.changesMade': ['Changes made', 'পরিবর্তনগুলো'],
  'ordersConsigneePanel.sentToTheCourierWe': [
    'Sent to the courier. We confirm it on their system shortly.',
    'কুরিয়ারের কাছে পাঠানো হয়েছে। কিছুক্ষণের মধ্যেই তাদের সিস্টেমে নিশ্চিত করা হবে।',
  ],
  'ordersConsigneePanel.theCourierWouldNotTake': [
    'The courier would not take the change.',
    'কুরিয়ার পরিবর্তনটি গ্রহণ করেনি।',
  ],
  'ordersConsigneePanel.name': [
    'name: {nameBefore} → {nameAfter}',
    'নাম: {nameBefore} → {nameAfter}',
  ],
  'ordersConsigneePanel.phone': [
    'phone: {phoneBefore} → {phoneAfter}',
    'ফোন: {phoneBefore} → {phoneAfter}',
  ],
  'ordersConsigneePanel.address': [
    'address: {addressBefore} → {addressAfter}',
    'ঠিকানা: {addressBefore} → {addressAfter}',
  ],
  'ordersConsigneePanel.customerDetails': ['Customer details', 'গ্রাহকের তথ্য'],
  'ordersConsigneePanel.theseCanNoLongerBe': [
    'These can no longer be changed through the courier',
    'কুরিয়ারের মাধ্যমে এগুলো আর বদলানো যায় না',
  ],
  'ordersConsigneePanel.name2': ['Name', 'নাম'],
  'ordersConsigneePanel.phone2': ['Phone', 'ফোন'],
  'ordersConsigneePanel.address2': ['Address', 'ঠিকানা'],
  'ordersConsigneePanel.theStreetAddressOnlySee': [
    'The street address only — see below for why the rest cannot move.',
    'শুধু রাস্তার ঠিকানা — বাকিগুলো কেন বদলানো যায় না তা নিচে দেখুন।',
  ],
  'ordersConsigneePanel.sendToTheCourier': ['Send to the courier', 'কুরিয়ারের কাছে পাঠান'],
  'ordersConsigneePanel.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'ordersConsigneePanel.sent': ['Sent', 'পাঠানো হয়েছে'],
  'ordersConsigneePanel.notTakenTryAgain': [
    'Not taken, try again',
    'গ্রহণ হয়নি, আবার চেষ্টা করুন',
  ],
});
