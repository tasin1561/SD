import { defineMessages } from '../define';

/**
 * Copy that the extraction could not lift mechanically: sentences with live
 * nodes inside them, text inside module-level tables, plural words. Each key is
 * prefixed with the screen that owns it, like every other namespace.
 */
export const extra = defineMessages({
  'ordersOrderActionsPanel.failedError': ['failed: {error}', 'ব্যর্থ: {error}'],
  'ordersOrderActionsPanel.unknown': ['unknown', 'অজানা'],
  'callCenterCustomerRiskStrip.returnRate': [
    "{pct} of this customer's parcels came back",
    'এই গ্রাহকের {pct} পার্সেল ফেরত এসেছে',
  ],
  'callCenterCustomerRiskStrip.previousOrders': [
    '{total} previous order{plural}',
    'আগের {total}টি অর্ডার{plural}',
  ],
  'callCenterCustomerRiskStrip.declinedOnACall': [
    ' · declined on a call {n}×',
    ' · কলে {n} বার প্রত্যাখ্যান',
  ],
  'delhiveryWalletImportPanel.skippedN': [', {n} skipped', ', {n}টি বাদ'],
  'warehouseRtoRtoItemRow.mismatchMissingRestock': [
    'A missing unit cannot go back on the shelf — you probably mean Write off.',
    'হারানো ইউনিট শেলফে ফেরত যেতে পারে না — সম্ভবত আপনি “অবলোপন” বোঝাতে চেয়েছেন।',
  ],
  'warehouseRtoRtoItemRow.mismatchDamagedRestock': [
    'A damaged unit put back in stock will be sold to the next customer. Is it really sellable?',
    'ক্ষতিগ্রস্ত ইউনিট স্টকে ফেরত দিলে তা পরের গ্রাহকের কাছে বিক্রি হবে। এটি কি সত্যিই বিক্রয়যোগ্য?',
  ],
  'warehouseRtoRtoItemRow.mismatchGoodHold': [
    'Keeping a good unit aside means it can never be sold. Put it back in stock instead?',
    'ভালো ইউনিট আলাদা করে রাখলে তা কখনো বিক্রি হবে না। বরং স্টকে ফেরত দেবেন?',
  ],
  'warehouseRtoRtoItemRow.mismatchMissingHold': [
    'A missing unit is not here to keep aside — you probably mean Write off.',
    'হারানো ইউনিট এখানে নেই যে আলাদা করে রাখা যাবে — সম্ভবত আপনি “অবলোপন” বোঝাতে চেয়েছেন।',
  ],
  'warehouseRtoRtoItemRow.mismatchGoodWriteOff': [
    'Writing off a good unit removes sellable stock for good. Put it back in stock instead?',
    'ভালো ইউনিট অবলোপন করলে বিক্রয়যোগ্য স্টক চিরতরে সরে যায়। বরং স্টকে ফেরত দেবেন?',
  ],
  'warehouseRtoRtoItemRow.remainingAll': [
    'All {lineQuantity} units have a decision.',
    'সব {lineQuantity}টি ইউনিটের সিদ্ধান্ত হয়েছে।',
  ],
  'warehouseRtoRtoItemRow.remainingSome': [
    '{left} of {lineQuantity} units still need a decision.',
    '{lineQuantity}টি ইউনিটের মধ্যে {left}টির এখনও সিদ্ধান্ত দরকার।',
  ],
  'warehouseRtoRtoItemRow.remainingOver': [
    '{over} more than the {lineQuantity} units on this line.',
    'এই লাইনের {lineQuantity}টি ইউনিটের চেয়ে {over}টি বেশি।',
  ],
  'warehouseRtoRtoStation.unitOne': ['{n} unit', '{n}টি ইউনিট'],
  'warehouseRtoRtoStation.unitOther': ['{n} units', '{n}টি ইউনিট'],
  'warehouseRtoRtoStation.restockOne': ['{units} goes back in stock', '{units} স্টকে ফেরত যায়'],
  'warehouseRtoRtoStation.restockOther': ['{units} go back in stock', '{units} স্টকে ফেরত যায়'],
  'warehouseRtoRtoStation.holdOne': [
    '{units} is kept aside damaged',
    '{units} ক্ষতিগ্রস্ত হিসেবে আলাদা করে রাখা হয়',
  ],
  'warehouseRtoRtoStation.holdOther': [
    '{units} are kept aside damaged',
    '{units} ক্ষতিগ্রস্ত হিসেবে আলাদা করে রাখা হয়',
  ],
  'warehouseRtoRtoStation.writeOffOne': ['{units} is written off', '{units} অবলোপন করা হয়'],
  'warehouseRtoRtoStation.writeOffOther': ['{units} are written off', '{units} অবলোপন করা হয়'],
  'warehouseRtoRtoStation.nothingReady': [
    'Nothing is ready to move — every unit is still waiting on a decision.',
    'সরানোর জন্য কিছু প্রস্তুত নয় — প্রতিটি ইউনিট এখনও সিদ্ধান্তের অপেক্ষায়।',
  ],
  'warehouseRtoRtoStation.listJoin': ['{head} and {last}', '{head} এবং {last}'],
  'warehouseRtoRtoStation.listSeparator': [', ', ', '],
  'warehouseRtoRtoStation.consequenceTail': [
    '{listed} — stock moves now and this cannot be undone.',
    '{listed} — স্টক এখনই সরে এবং এটি ফেরানো যায় না।',
  ],
  'ticketsTicketChips.autoTitle': [
    'Skydrop is raising this with the courier automatically',
    'Skydrop স্বয়ংক্রিয়ভাবে কুরিয়ারের কাছে এটি তুলছে',
  ],
  'ticketsTicketChips.auto': ['Auto', 'স্বয়ংক্রিয়'],
  'ticketsTicketChips.manualTitle': [
    'No automation for this courier, or the automated attempt failed — somebody has to raise this by hand',
    'এই কুরিয়ারের জন্য কোনো অটোমেশন নেই, অথবা স্বয়ংক্রিয় চেষ্টা ব্যর্থ হয়েছে — কাউকে হাতে এটি তুলতে হবে',
  ],
  'ticketsTicketChips.manual': ['Manual', 'ম্যানুয়াল'],
  'callCenterCallCenterStation.outcomeConfirmed': ['Confirmed', 'নিশ্চিত'],
  'callCenterCallCenterStation.outcomeConfirmedHelper': [
    'Customer agreed → reserves stock + advances order',
    'গ্রাহক রাজি → স্টক রিজার্ভ হয় + অর্ডার এগোয়',
  ],
  'callCenterCallCenterStation.outcomeDeclined': ['Declined', 'প্রত্যাখ্যাত'],
  'callCenterCallCenterStation.outcomeDeclinedHelper': [
    'Customer no longer wants the order',
    'গ্রাহক আর অর্ডারটি চান না',
  ],
  'callCenterCallCenterStation.outcomeWrongNumber': ['Wrong number', 'ভুল নম্বর'],
  'callCenterCallCenterStation.outcomeWrongNumberHelper': [
    'Reached someone else',
    'অন্য কাউকে পাওয়া গেছে',
  ],
  'callCenterCallCenterStation.outcomeNoAnswer': ['No answer', 'উত্তর নেই'],
  'callCenterCallCenterStation.outcomeNoAnswerHelper': ['Did not pick up', 'ফোন ধরেননি'],
  'callCenterCallCenterStation.outcomeBusy': ['Busy', 'ব্যস্ত'],
  'callCenterCallCenterStation.outcomeBusyHelper': ['Line was busy', 'লাইন ব্যস্ত ছিল'],
  'callCenterCallCenterStation.outcomeVoicemail': ['Voicemail', 'ভয়েসমেইল'],
  'callCenterCallCenterStation.outcomeVoicemailHelper': [
    'Left a message',
    'বার্তা রেখে দেওয়া হয়েছে',
  ],
  'callCenterCallCenterStation.outcomeCallback': ['Callback requested', 'কলব্যাক চাওয়া হয়েছে'],
  'callCenterCallCenterStation.outcomeCallbackHelper': [
    'Customer asked to call back at a specific time',
    'গ্রাহক নির্দিষ্ট সময়ে আবার কল করতে বলেছেন',
  ],
  'callCenterCallCenterStation.outcomeTechnical': ['Technical failure', 'প্রযুক্তিগত ত্রুটি'],
  'callCenterCallCenterStation.outcomeTechnicalHelper': [
    'Line dropped, system fault — no order transition',
    'লাইন কেটে গেছে, সিস্টেমে ত্রুটি — অর্ডারে কোনো ট্রানজিশন নেই',
  ],
  'callCenterCallCenterStation.outcomeLanguage': ['Language barrier', 'ভাষাগত বাধা'],
  'callCenterCallCenterStation.outcomeLanguageHelper': [
    'Could not communicate — no order transition',
    'যোগাযোগ করা যায়নি — অর্ডারে কোনো ট্রানজিশন নেই',
  ],
  'ordersForceMutationDialog.fieldRecipient': ['Recipient', 'প্রাপক'],
  'ordersForceMutationDialog.fieldPaymentValue': ['Payment + value', 'পেমেন্ট + মূল্য'],
  'ordersForceMutationDialog.fieldPhysical': ['Physical', 'পণ্যের বিবরণ'],
  'ordersForceMutationDialog.fieldNotesCancellation': ['Notes + cancellation', 'নোট + বাতিল'],
  'ordersForceMutationDialog.fieldName': ['Name', 'নাম'],
  'ordersForceMutationDialog.fieldPhoneE164': ['Phone (E.164)', 'ফোন (E.164)'],
  'ordersForceMutationDialog.fieldAltPhoneE164': ['Alt phone (E.164)', 'বিকল্প ফোন (E.164)'],
  'ordersForceMutationDialog.fieldEmail': ['Email', 'ইমেইল'],
  'ordersForceMutationDialog.fieldAddressLine1': ['Address line 1', 'ঠিকানার লাইন 1'],
  'ordersForceMutationDialog.fieldAddressLine2': ['Address line 2', 'ঠিকানার লাইন 2'],
  'ordersForceMutationDialog.fieldLandmark': ['Landmark', 'ল্যান্ডমার্ক'],
  'ordersForceMutationDialog.fieldCity': ['City', 'শহর'],
  'ordersForceMutationDialog.fieldStateProvince': ['State / province', 'রাজ্য / প্রদেশ'],
  'ordersForceMutationDialog.fieldPostalCode': ['Postal code', 'পোস্টাল কোড'],
  'ordersForceMutationDialog.fieldCountryIso': ['Country (ISO)', 'দেশ (ISO)'],
  'ordersForceMutationDialog.fieldPaymentMode': ['Payment mode', 'পেমেন্টের ধরন'],
  'ordersForceMutationDialog.fieldCodAmountInr': ['COD amount (INR)', 'COD পরিমাণ (INR)'],
  'ordersForceMutationDialog.fieldDeclaredValueInr': ['Declared value (INR)', 'ঘোষিত মূল্য (INR)'],
  'ordersForceMutationDialog.fieldTotalWeightG': ['Total weight (g)', 'মোট ওজন (গ্রাম)'],
  'ordersForceMutationDialog.fieldPackageType': ['Package type', 'প্যাকেজের ধরন'],
  'ordersForceMutationDialog.fieldUrgent': ['Urgent', 'জরুরি'],
  'ordersForceMutationDialog.fieldHighRisk': ['High risk', 'উচ্চ ঝুঁকি'],
  'ordersForceMutationDialog.fieldClientNotes': ['Client notes', 'ক্লায়েন্টের নোট'],
  'ordersForceMutationDialog.fieldInternalNotes': ['Internal notes', 'অভ্যন্তরীণ নোট'],
  'ordersForceMutationDialog.fieldCallNotes': ['Call notes', 'কলের নোট'],
  'ordersForceMutationDialog.fieldCancellationReason': ['Cancellation reason', 'বাতিলের কারণ'],
  'warehouseBinsBinNote.storage': ['Storage', 'স্টোরেজ'],
  'warehouseBinsBinNote.picking': ['Picking', 'পিকিং'],
  'warehouseBinsBinNote.receiving': ['Receiving', 'রিসিভিং'],
  'warehouseBinsBinNote.packing': ['Packing', 'প্যাকিং'],
  'warehouseBinsBinNote.returnsHold': ['Returns hold', 'রিটার্ন হোল্ড'],
  'warehouseBinsBinNote.damaged': ['Damaged', 'ক্ষতিগ্রস্ত'],
  'warehouseBinsBinNote.quarantine': ['Quarantine', 'কোয়ারেন্টাইন'],
  'warehouseBinsBinNote.inTransit': ['In transit', 'পথে'],
  'warehouseBinsBinNote.rtoHoldNote': [
    'Returns received but not yet decided — waiting to be inspected, or marked “decide later”. Not sellable. Finalising each return moves it on (back into stock, to the damaged bin, or written off) — {link}.',
    'গৃহীত কিন্তু এখনও সিদ্ধান্তহীন রিটার্ন — পরীক্ষার অপেক্ষায়, অথবা “পরে সিদ্ধান্ত” চিহ্নিত। বিক্রয়ের অযোগ্য। প্রতিটি রিটার্ন চূড়ান্ত করলে তা এগিয়ে যায় (স্টকে ফেরে, Damaged বিনে যায়, অথবা অবলোপিত হয়) — {link}।',
  ],
  'warehouseBinsBinNote.rtoHoldLink': [
    'decide them at the RTO station (On the bench)',
    'RTO স্টেশনে (বেঞ্চে আছে) সেগুলোর সিদ্ধান্ত নিন',
  ],
  'warehouseBinsBinNote.damagedNote': [
    'Held back from sale. Nothing is picked from a damaged bin.',
    'বিক্রয় থেকে আটকে রাখা। Damaged বিন থেকে কিছুই পিক হয় না।',
  ],
  'warehouseBinsBinNote.quarantineNote': [
    'Held back from sale until somebody decides what happens to it.',
    'কেউ সিদ্ধান্ত না নেওয়া পর্যন্ত বিক্রয় থেকে আটকে রাখা।',
  ],
  'warehouseBinsBinNote.transitNote': [
    'On its way from another warehouse. Counted here so neither building’s count finds it missing; sellable once it arrives and is received.',
    'অন্য ওয়্যারহাউস থেকে পথে। এখানে গোনা হয় যাতে কোনো বিল্ডিংয়ের গণনায় এটি হারিয়ে না যায়; পৌঁছে গ্রহণ হলে বিক্রয়যোগ্য হয়।',
  ],
  'warehouseBinsBinIdBinDetail.subtitleLine': [
    '{warehouseCode} — {warehouseName} · zone {zone} · {type} · {pickable}',
    '{warehouseCode} — {warehouseName} · জোন {zone} · {type} · {pickable}',
  ],
  'warehouseBinsBinIdBinDetail.pickable': ['pickable', 'পিক করা যায়'],
  'warehouseBinsBinIdBinDetail.notPickable': ['not pickable', 'পিক করা যায় না'],
  'warehouseBinsBinIdBinDetail.adjustAria': [
    'Adjust {line} in bin {code}',
    'বিন {code}-এ {line} সমন্বয় করুন',
  ],
  'warehouseBinsBinIdBinDetail.thisLine': ['this line', 'এই লাইন'],
  'sellersRestrictionPanel.capOrderCreate': ['Placing new orders', 'নতুন অর্ডার দেওয়া'],
  'sellersRestrictionPanel.capOrderConfirm': ['Confirming orders', 'অর্ডার নিশ্চিত করা'],
  'sellersRestrictionPanel.capConsignmentCreate': [
    'Declaring new inbound stock',
    'নতুন ইনবাউন্ড স্টক ঘোষণা করা',
  ],
  'sellersRestrictionPanel.capWithdrawalRequest': [
    'Requesting withdrawals',
    'উত্তোলনের অনুরোধ করা',
  ],
  'sellersRestrictionPanel.capShipmentDispatch': [
    'Handing their parcels to the courier',
    'তাদের পার্সেল কুরিয়ারকে হস্তান্তর করা',
  ],
  'sellersRestrictionPanel.capTrackingView': [
    'Seeing where their parcels are',
    'তাদের পার্সেল কোথায় আছে দেখা',
  ],
  'sellersRestrictionPanel.capRtoReceive': [
    'Booking their returns back in',
    'তাদের রিটার্ন আবার বইয়ে তোলা',
  ],
  'bankChangesBankChangesIndex.fieldAccountName': ['Account name', 'অ্যাকাউন্টের নাম'],
  'bankChangesBankChangesIndex.fieldAccountNumber': ['Account number', 'অ্যাকাউন্ট নম্বর'],
  'bankChangesBankChangesIndex.fieldBank': ['Bank', 'ব্যাংক'],
  'bankChangesBankChangesIndex.fieldBranch': ['Branch', 'শাখা'],
  'bankChangesBankChangesIndex.fieldRoutingNumber': ['Routing number', 'রাউটিং নম্বর'],
  'bankChangesBankChangesIndex.fieldSwift': ['SWIFT', 'SWIFT'],
  'settingsSettingsIndex.categoryReseller': ['Member stores', 'মেম্বার স্টোর'],
  'freightRecordFreightModal.legBdIntake': ['Bangladesh intake', 'বাংলাদেশ ইনটেক'],
  'freightRecordFreightModal.legInFinal': ['India arrival', 'ভারতে আগমন'],
  'freightRecordFreightModal.legStop': ['stop', 'ধাপ'],
  'barcodeCamera.noHttps': [
    'This page is not served over https, so the browser will not give it a camera.',
    'এই পেজ https-এ পরিবেশিত নয়, তাই ব্রাউজার এটিকে ক্যামেরা দেবে না।',
  ],
  'barcodeCamera.blocked': [
    'The browser blocked the camera. Allow it for this site from the icon in the address bar, then try again.',
    'ব্রাউজার ক্যামেরা আটকে দিয়েছে। অ্যাড্রেস বারের আইকন থেকে এই সাইটের জন্য অনুমতি দিন, তারপর আবার চেষ্টা করুন।',
  ],
  'barcodeCamera.noCamera': [
    'No camera on this machine — nothing to open.',
    'এই মেশিনে কোনো ক্যামেরা নেই — খোলার কিছু নেই।',
  ],
  'barcodeCamera.busy': [
    'Another app is already using the camera. Close it and try again.',
    'আরেকটি অ্যাপ ইতিমধ্যে ক্যামেরা ব্যবহার করছে। সেটি বন্ধ করে আবার চেষ্টা করুন।',
  ],
  'barcodeCamera.failed': ['The camera could not be opened.', 'ক্যামেরা খোলা যায়নি।'],
  'warehouseRtoRtoStation.receivedOrderArrow': [
    'Received — order {orderId} → {orderStatus}.',
    'গ্রহণ করা হয়েছে — অর্ডার {orderId} → {orderStatus}।',
  ],
  'warehouseRtoRtoStation.finalizedSummary': [
    'Finalized — {restocked} unit(s) put back in stock, {held} kept aside damaged, {writtenOff} written off. Order {status}.',
    'চূড়ান্ত — {restocked}টি ইউনিট স্টকে ফেরত, {held}টি ক্ষতিগ্রস্ত হিসেবে আলাদা করে রাখা, {writtenOff}টি অবলোপিত। অর্ডার {status}।',
  ],
  'delhiveryTrackingLookupPanel.unaskedCouriers': [
    '{couriers} could not be asked — no active courier account, so no token. A waybill of theirs will read as unknown whatever its real state.',
    '{couriers}-কে জিজ্ঞেস করা যায়নি — কোনো সক্রিয় কুরিয়ার অ্যাকাউন্ট নেই, তাই কোনো টোকেন নেই। তাদের ওয়েবিলের আসল অবস্থা যা-ই হোক, তা অজানা দেখাবে।',
  ],
  'delhiveryTrackingLookupPanel.knownOfTotal': [
    '{known} of {total} known to the couriers asked.',
    'যে কুরিয়ারদের জিজ্ঞেস করা হয়েছে তাদের কাছে {total}টির মধ্যে {known}টি জানা।',
  ],
  'delhiveryTrackingLookupPanel.stubModeOn': [
    'Stub mode is on — no courier was asked anything. Set the API base URLs.',
    'স্টাব মোড চালু — কোনো কুরিয়ারকে কিছু জিজ্ঞেস করা হয়নি। API বেস URL সেট করুন।',
  ],
  'costSyncShiprocketCostSection.couldNotBeRead': ['Could not be read', 'পড়া যায়নি'],
  'systemIssuesSystemIssuesIndex.closedAgo': ['closed {ago}', 'বন্ধ হয়েছে {ago}'],
  'costSyncShiprocketCostSection.fileAddsUpTo': [
    'its file adds up to ₹{amount}',
    'এর ফাইলের যোগফল ₹{amount}',
  ],
  'costSyncShiprocketCostSection.ordersBilledDifferently': [
    '{count} order(s) billed differently (net ₹{net})',
    '{count}টি অর্ডার ভিন্নভাবে বিল হয়েছে (নিট ₹{net})',
  ],
  'costSyncShiprocketCostSection.unknownService': [
    'unknown service: {services}',
    'অজানা সার্ভিস: {services}',
  ],
  'treasuryReconcileModal.theHoldingFor': ['the holding for {name}', '{name}-এর জন্য ধরে রাখা'],
  'treasuryReconcileModal.theClient': ['the client', 'ক্লায়েন্ট'],
  'treasuryReconcileModal.ours': ['ours', 'আমাদের'],
  'treasuryReconcileModal.heldFor': ['held for {name}', '{name}-এর জন্য ধরে রাখা'],
  'treasuryReconcileModal.them': ['them', 'তাঁরা'],
  'warehouseConsignmentsIdConsignmentPanel.shipmentsCounted': [
    '{done} of {total} shipment(s) counted',
    '{total}টি শিপমেন্টের মধ্যে {done}টি গোনা হয়েছে',
  ],
  'rolesPage.metaTitle': ['Roles · Skydrop admin', 'ভূমিকা · Skydrop অ্যাডমিন'],
});
