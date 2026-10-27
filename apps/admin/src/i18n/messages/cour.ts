import { defineMessages } from '../define';

export const cour = defineMessages({
  'courierAccountsCourierAccountsIndex.addAccount': ['Add account', 'অ্যাকাউন্ট যোগ করুন'],
  'courierAccountsCourierAccountsIndex.apiCredentialsAreEncryptedAt': [
    'API credentials are encrypted at rest with a key held in the environment, never in the database. They are never returned by any endpoint — to change one, add a new account and deactivate the old.',
    'API ক্রেডেনশিয়াল এনভায়রনমেন্টে রাখা কী দিয়ে এনক্রিপ্ট করে সংরক্ষিত থাকে, ডেটাবেসে কখনো নয়। কোনো এন্ডপয়েন্ট এগুলো কখনো ফেরত দেয় না — বদলাতে হলে নতুন অ্যাকাউন্ট যোগ করে পুরোনোটি নিষ্ক্রিয় করুন।',
  ],
  'courierAccountsCourierAccountsIndex.label': ['Label', 'লেবেল'],
  'courierAccountsCourierAccountsIndex.courier': ['Courier', 'কুরিয়ার'],
  'courierAccountsCourierAccountsIndex.environment': ['Environment', 'এনভায়রনমেন্ট'],
  'courierAccountsCourierAccountsIndex.pickupLocation': ['Pickup location', 'পিকআপ লোকেশন'],
  'courierAccountsCourierAccountsIndex.state': ['State', 'অবস্থা'],
  'courierAccountsCourierAccountsIndex.actions': ['Actions', 'অ্যাকশন'],
  'courierAccountsCourierAccountsIndex.production': ['Production', 'প্রোডাকশন'],
  'courierAccountsCourierAccountsIndex.sandbox': ['Sandbox', 'স্যান্ডবক্স'],
  'courierAccountsCourierAccountsIndex.globalSetting': ['global setting', 'গ্লোবাল সেটিং'],
  'courierAccountsCourierAccountsIndex.makeDefault': ['Make default', 'ডিফল্ট করুন'],
  'courierAccountsCourierAccountsIndex.edit': ['Edit', 'সম্পাদনা'],
  'courierAccountsCourierAccountsIndex.portalLogin': ['Portal login', 'পোর্টাল লগইন'],
  'courierAccountsCourierAccountsIndex.network': ['Network', 'নেটওয়ার্ক'],
  'courierAccountsCourierAccountsIndex.courierAccounts': [
    'Courier accounts',
    'কুরিয়ার অ্যাকাউন্ট',
  ],
  'courierAccountsCourierAccountsIndex.multipleAccountsPerCourierRoute': [
    "Multiple accounts per courier. Route a client to specific accounts, by weight, from that client's page; every shipment records the account that carried it.",
    'প্রতিটি কুরিয়ারের একাধিক অ্যাকাউন্ট থাকতে পারে। ক্লায়েন্টের পেজ থেকে ওজন অনুযায়ী ক্লায়েন্টকে নির্দিষ্ট অ্যাকাউন্টে রুট করুন; প্রতিটি শিপমেন্টে যে অ্যাকাউন্ট বহন করেছে তা রেকর্ড হয়।',
  ],
  'courierAccountsCourierAccountsIndex.failedToLoadCourierAccounts': [
    'Failed to load courier accounts.',
    'কুরিয়ার অ্যাকাউন্ট লোড করা যায়নি।',
  ],
  'courierAccountsCourierAccountsIndex.loadingCourierAccounts': [
    'Loading courier accounts',
    'কুরিয়ার অ্যাকাউন্ট লোড হচ্ছে',
  ],
  'courierAccountsCourierAccountsIndex.noCourierAccountsYet': [
    'No courier accounts yet',
    'এখনও কোনো কুরিয়ার অ্যাকাউন্ট নেই',
  ],
  'courierAccountsCourierAccountsIndex.addTheDelhiveryAccountWhose': [
    'Add the Delhivery account whose credentials should be used for AWB generation. The first account for a courier becomes its default.',
    'AWB তৈরিতে যে Delhivery অ্যাকাউন্টের ক্রেডেনশিয়াল ব্যবহার হবে সেটি যোগ করুন। কুরিয়ারের প্রথম অ্যাকাউন্টটি তার ডিফল্ট হয়ে যায়।',
  ],
  'courierAccountsCourierAccountsIndex.active': ['Active', 'সক্রিয়'],
  'courierAccountsCourierAccountsIndex.inactive': ['Inactive', 'নিষ্ক্রিয়'],
  'courierAccountsCourierAccountsIndex.default': ['Default', 'ডিফল্ট'],
  'courierAccountsCourierAccountsIndex.deactivate': ['Deactivate', 'নিষ্ক্রিয় করুন'],
  'courierAccountsCourierAccountsIndex.reactivate': ['Reactivate', 'আবার সক্রিয় করুন'],
  'courierAccountsCourierAccountsIndex.makeThisTheDefaultAccount': [
    'Make this the default account?',
    'এটিকে ডিফল্ট অ্যাকাউন্ট করবেন?',
  ],
  'courierAccountsCourierAccountsIndex.deactivateThisCourierAccount': [
    'Deactivate this courier account?',
    'এই কুরিয়ার অ্যাকাউন্ট নিষ্ক্রিয় করবেন?',
  ],
  'courierAccountsCourierAccountsIndex.everyClientWithNoExplicit': [
    'Every client with no explicit link to this courier routes their new parcels through this account from now on.',
    'এই কুরিয়ারের সাথে যে ক্লায়েন্টের স্পষ্ট কোনো লিংক নেই, এখন থেকে তাদের নতুন পার্সেল এই অ্যাকাউন্টের মাধ্যমে যাবে।',
  ],
  'courierAccountsCourierAccountsIndex.noNewParcelIsBooked': [
    'No new parcel is booked on this account; parcels it already carried keep their record of it.',
    'এই অ্যাকাউন্টে আর কোনো নতুন পার্সেল বুক হবে না; যেগুলো ইতিমধ্যে এটি বহন করেছে তাদের রেকর্ড থেকে যাবে।',
  ],
  'courierAccountsCourierAccountsIndex.isNowTheDefault': [
    '{label} is now the default.',
    '{label} এখন ডিফল্ট।',
  ],
  'courierAccountsCourierMasterSwitches.noCouriersAreConfigured': [
    'No couriers are configured.',
    'কোনো কুরিয়ার কনফিগার করা নেই।',
  ],
  'courierAccountsCourierMasterSwitches.off': ['off', 'বন্ধ'],
  'courierAccountsCourierMasterSwitches.on': ['on', 'চালু'],
  'courierAccountsCourierMasterSwitches.wasAlready': [
    '{name} was already {value}.',
    '{name} ইতিমধ্যে {value} ছিল।',
  ],
  'courierAccountsCourierMasterSwitches.startSendingNewParcelsTo': [
    'start sending new parcels to',
    'নতুন পার্সেল পাঠানো শুরু করুন',
  ],
  'courierAccountsCourierMasterSwitches.stopSendingNewParcelsTo': [
    'stop sending new parcels to',
    'নতুন পার্সেল পাঠানো বন্ধ করুন',
  ],
  'courierAccountsCourierMasterSwitches.couriers': ['Couriers', 'কুরিয়ার'],
  'courierAccountsCourierMasterSwitches.whetherEachCourierReceivesNew': [
    'Whether each courier receives new parcels. Turning one off diverts new orders to the others; parcels already with them keep being tracked, and can still be cancelled or re-attempted.',
    'প্রতিটি কুরিয়ার নতুন পার্সেল পায় কি না। একটি বন্ধ করলে নতুন অর্ডার অন্যগুলোতে চলে যায়; যে পার্সেল ইতিমধ্যে তাদের কাছে আছে সেগুলোর ট্র্যাকিং চলতে থাকে এবং বাতিল বা রি-অ্যাটেম্পটও করা যায়।',
  ],
  'courierAccountsCourierMasterSwitches.loadingCouriers': [
    'Loading couriers',
    'কুরিয়ার লোড হচ্ছে',
  ],
  'courierAccountsCourierMasterSwitches.takingParcels': ['Taking parcels', 'পার্সেল নিচ্ছে'],
  'courierAccountsCourierMasterSwitches.offForNewParcels': [
    'Off for new parcels',
    'নতুন পার্সেলের জন্য বন্ধ',
  ],
  'courierAccountsCourierMasterSwitches.turnOff': ['Turn off', 'বন্ধ করুন'],
  'courierAccountsCourierMasterSwitches.turnOn': ['Turn on', 'চালু করুন'],
  'courierAccountsCourierMasterSwitches.changeThisCourier': [
    'Change this courier?',
    'এই কুরিয়ার বদলাবেন?',
  ],
  'courierAccountsCourierMasterSwitches.why': ['Why {verb} {name}?', 'কেন {name} {verb}?'],
  'courierAccountsCourierMasterSwitches.newOrdersWillBeginRouting': [
    'New orders will begin routing here immediately.',
    'নতুন অর্ডার সঙ্গে সঙ্গেই এখানে রুট হতে শুরু করবে।',
  ],
  'courierAccountsCourierMasterSwitches.parcelsTheyAlreadyHoldKeep': [
    'Parcels they already hold keep being tracked and can still be cancelled or re-attempted. Only new bookings stop.',
    'তাদের কাছে থাকা পার্সেলের ট্র্যাকিং চলতে থাকে এবং বাতিল বা রি-অ্যাটেম্পট করা যায়। শুধু নতুন বুকিং বন্ধ হয়।',
  ],
  'courierAccountsCourierMasterSwitches.reason': ['Reason', 'কারণ'],
  'courierAccountsCreateCourierAccountModal.cancel': ['Cancel', 'বাতিল'],
  'courierAccountsCreateCourierAccountModal.addAccount': ['Add account', 'অ্যাকাউন্ট যোগ করুন'],
  'courierAccountsCreateCourierAccountModal.aManualCourierHasNo': [
    'A manual courier has no API, so there is nothing to authenticate — this account exists so its payouts can be recorded and settled like any other.',
    'ম্যানুয়াল কুরিয়ারের কোনো API নেই, তাই যাচাই করার কিছু নেই — অ্যাকাউন্টটি আছে যাতে অন্য সবগুলোর মতো এর পেআউট রেকর্ড ও নিষ্পত্তি করা যায়।',
  ],
  'courierAccountsCreateCourierAccountModal.credentials': ['Credentials', 'ক্রেডেনশিয়াল'],
  'courierAccountsCreateCourierAccountModal.addField': ['Add field', 'ঘর যোগ করুন'],
  'courierAccountsCreateCourierAccountModal.courierAccountAdded': [
    'Courier account added.',
    'কুরিয়ার অ্যাকাউন্ট যোগ হয়েছে।',
  ],
  'courierAccountsCreateCourierAccountModal.addACourierAccount': [
    'Add a courier account',
    'একটি কুরিয়ার অ্যাকাউন্ট যোগ করুন',
  ],
  'courierAccountsCreateCourierAccountModal.credentialsAreEncryptedAtRest': [
    'Credentials are encrypted at rest with a key held in the environment. They are never returned by any endpoint, so keep your own copy.',
    'ক্রেডেনশিয়াল এনভায়রনমেন্টে রাখা কী দিয়ে এনক্রিপ্ট করে সংরক্ষিত থাকে। কোনো এন্ডপয়েন্ট এগুলো কখনো ফেরত দেয় না, তাই নিজের একটি কপি রাখুন।',
  ],
  'courierAccountsCreateCourierAccountModal.courierCode': ['Courier code', 'কুরিয়ার কোড'],
  'courierAccountsCreateCourierAccountModal.environment': ['Environment', 'এনভায়রনমেন্ট'],
  'courierAccountsCreateCourierAccountModal.label': ['Label', 'লেবেল'],
  'courierAccountsCreateCourierAccountModal.howAnOperatorWillTell': [
    'How an operator will tell this account apart from the others.',
    'একজন অপারেটর কীভাবে এই অ্যাকাউন্টকে অন্যগুলো থেকে আলাদা করবেন।',
  ],
  'courierAccountsCreateCourierAccountModal.delhiveryPrimary': [
    'Delhivery — primary',
    'Delhivery — প্রাইমারি',
  ],
  'courierAccountsCreateCourierAccountModal.fieldName': ['Field name', 'ঘরের নাম'],
  'courierAccountsCreateCourierAccountModal.credentialFieldName': [
    'Credential field name',
    'ক্রেডেনশিয়ালের ঘরের নাম',
  ],
  'courierAccountsCreateCourierAccountModal.value': ['Value', 'মান'],
  'courierAccountsCreateCourierAccountModal.credentialValue': [
    'Credential value',
    'ক্রেডেনশিয়ালের মান',
  ],
  'courierAccountsCreateCourierAccountModal.removeThisCredentialField': [
    'Remove this credential field',
    'এই ক্রেডেনশিয়ালের ঘর সরান',
  ],
  'courierAccountsCreateCourierAccountModal.makeThisTheDefaultFor': [
    'Make this the default for its courier and environment',
    'এটিকে তার কুরিয়ার ও এনভায়রনমেন্টের ডিফল্ট করুন',
  ],
  'courierAccountsCreateCourierAccountModal.clientsWithNoExplicitLink': [
    'Clients with no explicit link route here. At most one default per pair.',
    'স্পষ্ট লিংক নেই এমন ক্লায়েন্টরা এখানে রুট হয়। প্রতি জোড়ায় সর্বোচ্চ একটি ডিফল্ট।',
  ],
  'courierAccountsCreateCourierAccountModal.pickupLocationName': [
    'Pickup location name',
    'পিকআপ লোকেশনের নাম',
  ],
  'courierAccountsCreateCourierAccountModal.theWarehouseNameRegisteredWith': [
    'The warehouse name registered with THIS account at Delhivery. Blank uses the global setting — fine for one account, wrong as soon as there are two.',
    'Delhivery-তে এই অ্যাকাউন্টের কাছে নিবন্ধিত ওয়্যারহাউসের নাম। ফাঁকা রাখলে গ্লোবাল সেটিং ব্যবহার হয় — একটি অ্যাকাউন্টের জন্য ঠিক, দুটি হলেই ভুল।',
  ],
  'courierAccountsCreateCourierAccountModal.leadingOrTrailingSpaceDelhivery': [
    'Leading or trailing space. Delhivery matches this exactly, so this would not match the registration.',
    'শুরুতে বা শেষে স্পেস আছে। Delhivery এটি হুবহু মেলায়, তাই এটি আপনার নিবন্ধনের সাথে মিলবে না।',
  ],
  'courierAccountsCreateCourierAccountModal.notes': ['Notes', 'নোট'],
  'courierAccountsCreateCourierAccountModal.optional': ['Optional.', 'ঐচ্ছিক।'],
  'courierAccountsCreateCourierAccountModal.notAdded': ['Not added', 'যোগ হয়নি'],
  'courierAccountsEditCourierAccountModal.cancel': ['Cancel', 'বাতিল'],
  'courierAccountsEditCourierAccountModal.saveChanges': ['Save changes', 'পরিবর্তন সংরক্ষণ করুন'],
  'courierAccountsEditCourierAccountModal.noAccountLinkedYet': [
    'No account linked yet',
    'এখনও কোনো অ্যাকাউন্ট লিংক করা নেই',
  ],
  'courierAccountsEditCourierAccountModal.thisNameHasLeadingOr': [
    'This name has leading or trailing spaces. Delhivery matches it exactly — that will not match your registration unless the spaces are really there.',
    'এই নামের শুরুতে বা শেষে স্পেস আছে। Delhivery এটি হুবহু মেলায় — স্পেসগুলো সত্যিই না থাকলে এটি আপনার নিবন্ধনের সাথে মিলবে না।',
  ],
  'courierAccountsEditCourierAccountModal.accountUpdated': [
    'Account updated.',
    'অ্যাকাউন্ট হালনাগাদ হয়েছে।',
  ],
  'courierAccountsEditCourierAccountModal.editCourierAccount': [
    'Edit courier account',
    'কুরিয়ার অ্যাকাউন্ট সম্পাদনা',
  ],
  'courierAccountsEditCourierAccountModal.theApiCredentialCannotBe': [
    'The API credential cannot be edited — it is never readable once saved. To change a token, add an account and deactivate this one.',
    'API ক্রেডেনশিয়াল সম্পাদনা করা যায় না — একবার সংরক্ষিত হলে এটি আর পড়া যায় না। টোকেন বদলাতে হলে একটি অ্যাকাউন্ট যোগ করে এটি নিষ্ক্রিয় করুন।',
  ],
  'courierAccountsEditCourierAccountModal.label': ['Label', 'লেবেল'],
  'courierAccountsEditCourierAccountModal.howAnOperatorTellsThis': [
    'How an operator tells this account apart.',
    'একজন অপারেটর কীভাবে এই অ্যাকাউন্টকে আলাদা করে চেনেন।',
  ],
  'courierAccountsEditCourierAccountModal.pickupLocationName': [
    'Pickup location name',
    'পিকআপ লোকেশনের নাম',
  ],
  'courierAccountsEditCourierAccountModal.theWarehouseNameRegisteredWith': [
    'The warehouse name registered with THIS account at Delhivery, matched byte-for-byte. Leave blank to use the global setting — right for a single account, wrong as soon as there are two.',
    'Delhivery-তে এই অ্যাকাউন্টের কাছে নিবন্ধিত ওয়্যারহাউসের নাম, বাইট-বাই-বাইট মেলানো হয়। গ্লোবাল সেটিং ব্যবহার করতে ফাঁকা রাখুন — একটি অ্যাকাউন্টের জন্য ঠিক, দুটি হলেই ভুল।',
  ],
  'courierAccountsEditCourierAccountModal.blankGlobalSetting': [
    'Blank = global setting',
    'ফাঁকা = গ্লোবাল সেটিং',
  ],
  'courierAccountsEditCourierAccountModal.codPayoutsLandIn': [
    'COD payouts land in',
    'COD পেআউট জমা হয়',
  ],
  'courierAccountsEditCourierAccountModal.oneOfOurBankAccounts': [
    'One of our bank accounts. Required before a settlement for this courier can be recorded. Several couriers can share one account.',
    'আমাদের একটি ব্যাংক অ্যাকাউন্ট। এই কুরিয়ারের সেটেলমেন্ট রেকর্ড করার আগে এটি লাগবে। একাধিক কুরিয়ার একটি অ্যাকাউন্ট ভাগ করতে পারে।',
  ],
  'courierAccountsEditCourierAccountModal.notes': ['Notes', 'নোট'],
  'courierAccountsEditCourierAccountModal.notSaved': ['Not saved', 'সংরক্ষণ হয়নি'],
  'courierAccountsPortalLoginModal.cancel': ['Cancel', 'বাতিল'],
  'courierAccountsPortalLoginModal.saveLogin': ['Save login', 'লগইন সংরক্ষণ করুন'],
  'courierAccountsPortalLoginModal.theApiTokenOnThis': [
    'The API token on this account is left exactly as it is — this adds to the credential rather than replacing it.',
    'এই অ্যাকাউন্টের API টোকেন যেমন আছে তেমনই থাকে — এটি ক্রেডেনশিয়ালে যোগ করে, বদলায় না।',
  ],
  'courierAccountsPortalLoginModal.portalLoginSavedAdded': [
    'Portal login saved — added {value}',
    'পোর্টাল লগইন সংরক্ষিত — যোগ হয়েছে {value}',
  ],
  'courierAccountsPortalLoginModal.portalLoginReplaced': [
    'Portal login replaced',
    'পোর্টাল লগইন বদলানো হয়েছে',
  ],
  'courierAccountsPortalLoginModal.portalLogin': [
    'Portal login — {accountLabel}',
    'পোর্টাল লগইন — {accountLabel}',
  ],
  'courierAccountsPortalLoginModal.delhiveryHasNoBillingApi': [
    'Delhivery has no billing API, so the nightly cost sync signs into their panel. Stored encrypted; never shown again.',
    'Delhivery-র কোনো বিলিং API নেই, তাই রাতের খরচ সিঙ্ক তাদের প্যানেলে সাইন ইন করে। এনক্রিপ্ট করে রাখা হয়; আর কখনো দেখানো হয় না।',
  ],
  'courierAccountsPortalLoginModal.shiprocketHasNoApiFor': [
    'Shiprocket has no API for its passbook, ledger or recharges, so the automation signs into app.shiprocket.in through the Bangalore tunnel. Stored encrypted; never shown again.',
    'Shiprocket-এর পাসবুক, লেজার বা রিচার্জের কোনো API নেই, তাই অটোমেশন ব্যাঙ্গালোর টানেল দিয়ে app.shiprocket.in-এ সাইন ইন করে। এনক্রিপ্ট করে রাখা হয়; আর কখনো দেখানো হয় না।',
  ],
  'courierAccountsPortalLoginModal.email': ['Email', 'ইমেইল'],
  'courierAccountsPortalLoginModal.theAddressYouUseAt': [
    'The address you use at one.delhivery.com.',
    'one.delhivery.com-এ আপনি যে ঠিকানা ব্যবহার করেন।',
  ],
  'courierAccountsPortalLoginModal.theAddressYouUseAt2': [
    'The address you use at app.shiprocket.in — the website login, not the API user.',
    'app.shiprocket.in-এ আপনি যে ঠিকানা ব্যবহার করেন — ওয়েবসাইটের লগইন, API ইউজার নয়।',
  ],
  'courierAccountsPortalLoginModal.password': ['Password', 'পাসওয়ার্ড'],
  'courierAccountsPortalLoginModal.company': ['Company', 'কোম্পানি'],
  'courierAccountsPortalLoginModal.exactlyAsItAppearsIn': [
    'Exactly as it appears in their login dropdown — e.g. MS EXPORTS. One login reaches several companies and each has its own wallet, so this decides which one is read.',
    'তাদের লগইন ড্রপডাউনে যেমন দেখায় ঠিক তেমন — যেমন MS EXPORTS। একটি লগইন একাধিক কোম্পানিতে পৌঁছায় এবং প্রতিটির নিজস্ব ওয়ালেট আছে, তাই এটিই ঠিক করে কোনটি পড়া হবে।',
  ],
  'courierAccountsPortalLoginModal.notSaved': ['Not saved', 'সংরক্ষণ হয়নি'],
  'courierDecisionsCourierDecisionIndex.kg': ['{value} kg', '{value} কেজি'],
  'courierDecisionsCourierDecisionIndex.noCarriersWereRecordedFor': [
    'No carriers were recorded for this parcel. Booking it will let the aggregator choose.',
    'এই পার্সেলের জন্য কোনো ক্যারিয়ার রেকর্ড করা হয়নি। বুক করলে অ্যাগ্রিগেটর বেছে নেবে।',
  ],
  'courierDecisionsCourierDecisionIndex.order': ['Order', 'অর্ডার'],
  'courierDecisionsCourierDecisionIndex.destination': ['Destination', 'গন্তব্য'],
  'courierDecisionsCourierDecisionIndex.parcel': ['Parcel', 'পার্সেল'],
  'courierDecisionsCourierDecisionIndex.waiting': ['Waiting', 'অপেক্ষায়'],
  'courierDecisionsCourierDecisionIndex.pickACarrier': [
    'Pick a carrier',
    'একটি ক্যারিয়ার বেছে নিন',
  ],
  'courierDecisionsCourierDecisionIndex.noEstimateGiven': [
    'no estimate given',
    'কোনো আনুমানিক সময় দেওয়া হয়নি',
  ],
  'courierDecisionsCourierDecisionIndex.cheapest': [' · cheapest', ' · সবচেয়ে সস্তা'],
  'courierDecisionsCourierDecisionIndex.fastest': [' · fastest', ' · সবচেয়ে দ্রুত'],
  'courierDecisionsCourierDecisionIndex.justNow': ['just now', 'এইমাত্র'],
  'courierDecisionsCourierDecisionIndex.courierDecisions': [
    'Courier decisions',
    'কুরিয়ারের সিদ্ধান্ত',
  ],
  'courierDecisionsCourierDecisionIndex.confirmedParcelsWaitingForSomebody': [
    'Confirmed parcels waiting for somebody to pick which carrier ships them. Their stock is already reserved and their customers have been told they are coming, so the wait is real — if nobody chooses, the cheapest option is booked automatically and an issue is raised saying so.',
    'নিশ্চিত পার্সেল যেগুলো কোন ক্যারিয়ার পাঠাবে তা কেউ বেছে নেওয়ার অপেক্ষায় আছে। এদের স্টক ইতিমধ্যে রিজার্ভ করা আর গ্রাহকদের জানানো হয়েছে যে এগুলো আসছে, তাই অপেক্ষাটা আসল — কেউ না বাছলে সবচেয়ে সস্তা বিকল্পটি স্বয়ংক্রিয়ভাবে বুক হয় এবং সেটি জানিয়ে একটি ইস্যু তোলা হয়।',
  ],
  'courierDecisionsCourierDecisionIndex.waitingForACarrier': [
    'Waiting for a carrier',
    'ক্যারিয়ারের অপেক্ষায়',
  ],
  'courierDecisionsCourierDecisionIndex.loadingTheQueue': ['Loading the queue…', 'কিউ লোড হচ্ছে…'],
  'courierDecisionsCourierDecisionIndex.couldNotLoadTheQueue': [
    'Could not load the queue.',
    'কিউ লোড করা যায়নি।',
  ],
  'courierDecisionsCourierDecisionIndex.nothingWaitingOnADecision': [
    'Nothing waiting on a decision',
    'সিদ্ধান্তের অপেক্ষায় কিছু নেই',
  ],
  'courierDecisionsCourierDecisionIndex.ordersAppearHereOnlyFor': [
    'Orders appear here only for clients whose courier policy is set to Manual, and only when the aggregator offered more than one carrier.',
    'অর্ডার এখানে শুধু সেই ক্লায়েন্টদের জন্য আসে যাদের কুরিয়ার নীতি ম্যানুয়াল, এবং শুধু তখনই যখন অ্যাগ্রিগেটর একাধিক ক্যারিয়ার দিয়েছে।',
  ],
  'courierDecisionsCourierDecisionIndex.parcelsWaitingForACarrier': [
    'Parcels waiting for a carrier',
    'ক্যারিয়ারের অপেক্ষায় থাকা পার্সেল',
  ],
  'courierDecisionsPage.courierDecisionsSkydropAdmin': [
    'Courier decisions · Skydrop Admin',
    'কুরিয়ারের সিদ্ধান্ত · Skydrop অ্যাডমিন',
  ],
  'courierEscalationCourierEscalationIndex.mcpIsReadOnlyAnd': [
    'MCP is read-only and their notification emails do not accept replies, so nothing here can be posted through an API — whatever the write mode says.',
    'MCP শুধু-পঠনযোগ্য এবং তাদের নোটিফিকেশন ইমেইল উত্তর গ্রহণ করে না, তাই রাইট মোড যা-ই বলুক, এখান থেকে কোনো API দিয়ে কিছু পোস্ট করা যায় না।',
  ],
  'courierEscalationCourierEscalationIndex.portalWorker': ['Portal worker', 'পোর্টাল ওয়ার্কার'],
  'courierEscalationCourierEscalationIndex.mode': ['Mode', 'মোড'],
  'courierEscalationCourierEscalationIndex.health': ['Health', 'স্বাস্থ্য'],
  'courierEscalationCourierEscalationIndex.autoCategories': [
    'Auto categories',
    'স্বয়ংক্রিয় ক্যাটাগরি',
  ],
  'courierEscalationCourierEscalationIndex.listedForWhenAWrite': [
    'Listed for when a write channel exists. None of it is acting today.',
    'রাইট চ্যানেল থাকলে কাজে লাগবে বলে তালিকাভুক্ত। আজ এর কোনোটিই কাজ করছে না।',
  ],
  'courierEscalationCourierEscalationIndex.resume': ['Resume', 'আবার চালু করুন'],
  'courierEscalationCourierEscalationIndex.pause': ['Pause', 'বিরতি দিন'],
  'courierEscalationCourierEscalationIndex.pausedBecause': [
    'Paused because: {pauseReason}',
    'বিরতির কারণ: {pauseReason}',
  ],
  'courierEscalationCourierEscalationIndex.humanOnlyAlways': [
    'Human-only, always:',
    'সবসময় শুধু মানুষের জন্য:',
  ],
  'courierEscalationCourierEscalationIndex.parcel': ['Parcel', 'পার্সেল'],
  'courierEscalationCourierEscalationIndex.message': ['Message', 'বার্তা'],
  'courierEscalationCourierEscalationIndex.status': ['Status', 'স্ট্যাটাস'],
  'courierEscalationCourierEscalationIndex.actions': ['Actions', 'অ্যাকশন'],
  'courierEscalationCourierEscalationIndex.support': [
    '{courierName} support',
    '{courierName} সাপোর্ট',
  ],
  'courierEscalationCourierEscalationIndex.copy': ['Copy', 'কপি'],
  'courierEscalationCourierEscalationIndex.viewOnly': ['View only', 'শুধু দেখা'],
  'courierEscalationCourierEscalationIndex.changeTheWriteMode': [
    'Change the write mode',
    'রাইট মোড বদলান',
  ],
  'courierEscalationCourierEscalationIndex.manualEverythingToThisQueue': [
    'MANUAL — everything to this queue',
    'MANUAL — সবকিছু এই কিউতে',
  ],
  'courierEscalationCourierEscalationIndex.supervisedPreparedHeldForApproval': [
    'SUPERVISED — prepared, held for approval',
    'SUPERVISED — প্রস্তুত করা, অনুমোদনের জন্য আটকে রাখা',
  ],
  'courierEscalationCourierEscalationIndex.autoUnattendedExceptLockedCategories': [
    'AUTO — unattended, except locked categories',
    'AUTO — তদারকি ছাড়া, লক করা ক্যাটাগরি বাদে',
  ],
  'courierEscalationCourierEscalationIndex.whichCategoriesMayGoUnattended': [
    'Which categories may go unattended',
    'কোন ক্যাটাগরি তদারকি ছাড়া যেতে পারবে',
  ],
  'courierEscalationCourierEscalationIndex.anythingNotTickedStillGoes': [
    'Anything not ticked still goes to the queue for a person, even in AUTO.',
    'টিক না দেওয়া কিছুই AUTO-তেও একজন মানুষের জন্য কিউতে যায়।',
  ],
  'courierEscalationCourierEscalationIndex.aSixDigitCodeWas': [
    'A six-digit code was emailed to you. It expires in 10 minutes.',
    'আপনার ইমেইলে ছয় অঙ্কের একটি কোড পাঠানো হয়েছে। এটি 10 মিনিটে মেয়াদ শেষ হয়।',
  ],
  'courierEscalationCourierEscalationIndex.cancel': ['Cancel', 'বাতিল'],
  'courierEscalationCourierEscalationIndex.couldNotReadStateBack': [
    'Could not read state back from Delhivery, so nothing could be confirmed either way.',
    'Delhivery থেকে অবস্থা পড়া যায়নি, তাই কোনোভাবেই নিশ্চিত করা যায়নি।',
  ],
  'courierEscalationCourierEscalationIndex.examinedConfirmedBackInThe': [
    'Examined {examined}: {confirmed} confirmed, {returnedToQueue} back in the queue, {stillUnknown} still unknown.',
    '{examined}টি পরীক্ষা: {confirmed}টি নিশ্চিত, {returnedToQueue}টি কিউতে ফেরত, {stillUnknown}টি এখনও অজানা।',
  ],
  'courierEscalationCourierEscalationIndex.copied': ['Copied', 'কপি হয়েছে'],
  'courierEscalationCourierEscalationIndex.channelResumed': [
    'Channel resumed',
    'চ্যানেল আবার চালু হয়েছে',
  ],
  'courierEscalationCourierEscalationIndex.pausedFromTheConsole': [
    'Paused from the console',
    'কনসোল থেকে বিরতি দেওয়া হয়েছে',
  ],
  'courierEscalationCourierEscalationIndex.channelPausedFor60Minutes': [
    'Channel paused for 60 minutes',
    'চ্যানেলে 60 মিনিটের বিরতি দেওয়া হয়েছে',
  ],
  'courierEscalationCourierEscalationIndex.network': ['Network', 'নেটওয়ার্ক'],
  'courierEscalationCourierEscalationIndex.courierEscalation': [
    'Courier escalation',
    'কুরিয়ার এসকেলেশন',
  ],
  'courierEscalationCourierEscalationIndex.messagesWaitingToReachDelhivery': [
    'Messages waiting to reach Delhivery, and the switch that decides who sends them.',
    'Delhivery-তে পৌঁছানোর অপেক্ষায় থাকা বার্তা, আর কে পাঠাবে তা ঠিক করার সুইচ।',
  ],
  'courierEscalationCourierEscalationIndex.delhiveryHasNoTicketWrite': [
    'Delhivery has no ticket write API.',
    'Delhivery-র কোনো টিকিট রাইট API নেই।',
  ],
  'courierEscalationCourierEscalationIndex.today': ['Today', 'আজ'],
  'courierEscalationCourierEscalationIndex.reconcileNow': ['Reconcile now', 'এখনই মেলান'],
  'courierEscalationCourierEscalationIndex.reconciling': ['Reconciling…', 'মেলানো হচ্ছে…'],
  'courierEscalationCourierEscalationIndex.reconciled': ['Reconciled', 'মেলানো হয়েছে'],
  'courierEscalationCourierEscalationIndex.notReconciled': ['Not reconciled', 'মেলানো হয়নি'],
  'courierEscalationCourierEscalationIndex.loadingTodaySCounts': [
    "Loading today's counts",
    'আজকের সংখ্যা লোড হচ্ছে',
  ],
  'courierEscalationCourierEscalationIndex.waiting': ['Waiting', 'অপেক্ষায়'],
  'courierEscalationCourierEscalationIndex.inHand': ['In hand', 'হাতে'],
  'courierEscalationCourierEscalationIndex.unconfirmed': ['Unconfirmed', 'অনিশ্চিত'],
  'courierEscalationCourierEscalationIndex.confirmedToday': ['Confirmed today', 'আজ নিশ্চিত'],
  'courierEscalationCourierEscalationIndex.failedToday': ['Failed today', 'আজ ব্যর্থ'],
  'courierEscalationCourierEscalationIndex.writeChannel': ['Write channel', 'রাইট চ্যানেল'],
  'courierEscalationCourierEscalationIndex.whatTheOperatorChoseAnd': [
    'What the operator chose, and what the system currently thinks of its own health. Two different things.',
    'অপারেটর কী বেছেছেন, আর সিস্টেম এখন নিজের স্বাস্থ্য সম্পর্কে কী ভাবছে। দুটি আলাদা জিনিস।',
  ],
  'courierEscalationCourierEscalationIndex.paused': ['Paused', 'বিরতিতে'],
  'courierEscalationCourierEscalationIndex.running': ['Running', 'চলছে'],
  'courierEscalationCourierEscalationIndex.nothingCanSend': [
    'Nothing can send',
    'কিছুই পাঠানো যাচ্ছে না',
  ],
  'courierEscalationCourierEscalationIndex.noneNothingIsActionedUnattended': [
    'None — nothing is actioned unattended',
    'কিছু নেই — তদারকি ছাড়া কিছুই করা হয় না',
  ],
  'courierEscalationCourierEscalationIndex.queue': ['Queue', 'কিউ'],
  'courierEscalationCourierEscalationIndex.oldestFirstClaimAnItem': [
    'Oldest first. Claim an item to hold it for ten minutes.',
    'পুরোনোটি আগে। একটি আইটেম দাবি করুন, দশ মিনিটের জন্য আপনার হাতে থাকবে।',
  ],
  'courierEscalationCourierEscalationIndex.loadingTheSendQueue': [
    'Loading the send queue',
    'পাঠানোর কিউ লোড হচ্ছে',
  ],
  'courierEscalationCourierEscalationIndex.nothingWaiting': [
    'Nothing waiting',
    'অপেক্ষায় কিছু নেই',
  ],
  'courierEscalationCourierEscalationIndex.messagesArriveHereWhenA': [
    'Messages arrive here when a client raises an issue or an NDR re-attempt could not be confirmed.',
    'ক্লায়েন্ট কোনো ইস্যু তুললে বা NDR রি-অ্যাটেম্পট নিশ্চিত করা না গেলে বার্তা এখানে আসে।',
  ],
  'courierEscalationCourierEscalationIndex.noAwb': ['No AWB', 'AWB নেই'],
  'courierEscalationCourierEscalationIndex.raiseATicket': ['Raise a ticket', 'টিকিট তুলুন'],
  'courierEscalationCourierEscalationIndex.ticket': [
    'Ticket {externalTicketId}',
    'টিকিট {externalTicketId}',
  ],
  'courierEscalationCourierEscalationIndex.noSupportEmailSet': [
    'No support email — set {supportEmailSettingKey}',
    'সাপোর্ট ইমেইল নেই — {supportEmailSettingKey} সেট করুন',
  ],
  'courierEscalationCourierEscalationIndex.claim': ['Claim', 'দাবি করুন'],
  'courierEscalationCourierEscalationIndex.claiming': ['Claiming…', 'দাবি করা হচ্ছে…'],
  'courierEscalationCourierEscalationIndex.claimed': ['Claimed', 'দাবি করা হয়েছে'],
  'courierEscalationCourierEscalationIndex.claimedFor10Minutes': [
    'Claimed for 10 minutes',
    '10 মিনিটের জন্য দাবি করা হয়েছে',
  ],
  'courierEscalationCourierEscalationIndex.ticketId': ['Ticket ID', 'টিকিট আইডি'],
  'courierEscalationCourierEscalationIndex.ticketIdPasteItHere': [
    'Ticket ID (paste it here)',
    'টিকিট আইডি (এখানে পেস্ট করুন)',
  ],
  'courierEscalationCourierEscalationIndex.markSent': ['Mark sent', 'পাঠানো হয়েছে চিহ্নিত করুন'],
  'courierEscalationCourierEscalationIndex.recording': ['Recording…', 'রেকর্ড হচ্ছে…'],
  'courierEscalationCourierEscalationIndex.recorded': ['Recorded', 'রেকর্ড হয়েছে'],
  'courierEscalationCourierEscalationIndex.recordedAsSentAwaitingRead': [
    'Recorded as sent — awaiting read-back',
    'পাঠানো হয়েছে বলে রেকর্ড হয়েছে — রিড-ব্যাকের অপেক্ষায়',
  ],
  'courierEscalationCourierEscalationIndex.giveBack': ['Give back', 'ফেরত দিন'],
  'courierEscalationCourierEscalationIndex.returning': ['Returning…', 'ফেরত দেওয়া হচ্ছে…'],
  'courierEscalationCourierEscalationIndex.returned': ['Returned', 'ফেরত দেওয়া হয়েছে'],
  'courierEscalationCourierEscalationIndex.returnedToTheQueue': [
    'Returned to the queue',
    'কিউতে ফেরত দেওয়া হয়েছে',
  ],
  'courierEscalationCourierEscalationIndex.resumeTheWriteChannel': [
    'Resume the write channel?',
    'রাইট চ্যানেল আবার চালু করবেন?',
  ],
  'courierEscalationCourierEscalationIndex.pauseTheWriteChannel': [
    'Pause the write channel?',
    'রাইট চ্যানেলে বিরতি দেবেন?',
  ],
  'courierEscalationCourierEscalationIndex.courierEscalationWriteChannel': [
    'Courier escalation write channel',
    'কুরিয়ার এসকেলেশন রাইট চ্যানেল',
  ],
  'courierEscalationCourierEscalationIndex.messagesCanLeaveTheQueue': [
    'Messages can leave the queue by the write mode again at once, without a person where the mode allows it.',
    'রাইট মোড যেখানে অনুমতি দেয় সেখানে মানুষ ছাড়াই বার্তা আবার সঙ্গে সঙ্গে কিউ থেকে বেরোতে পারবে।',
  ],
  'courierEscalationCourierEscalationIndex.forTheNext60Minutes': [
    'For the next 60 minutes nothing leaves the queue on its own; every message waits for a person.',
    'পরের 60 মিনিট কিছুই নিজে থেকে কিউ ছেড়ে যায় না; প্রতিটি বার্তা একজন মানুষের জন্য অপেক্ষা করে।',
  ],
  'courierEscalationCourierEscalationIndex.pauseFor60Minutes': [
    'Pause for 60 minutes',
    '60 মিনিটের বিরতি দিন',
  ],
  'courierEscalationCourierEscalationIndex.codeSentToYourEmail': [
    'Code sent to your email',
    'আপনার ইমেইলে কোড পাঠানো হয়েছে',
  ],
  'courierEscalationCourierEscalationIndex.writeModeChanged': [
    'Write mode changed',
    'রাইট মোড বদলেছে',
  ],
  'courierEscalationCourierEscalationIndex.writeMode': ['Write mode', 'রাইট মোড'],
  'courierEscalationCourierEscalationIndex.why': ['Why', 'কেন'],
  'courierEscalationCourierEscalationIndex.whyAtLeast30Characters': [
    'Why (at least 30 characters — this goes in the audit log)',
    'কেন (কমপক্ষে 30 অক্ষর — এটি অডিট লগে যায়)',
  ],
  'courierEscalationCourierEscalationIndex.sendConfirmationCode': [
    'Send confirmation code',
    'নিশ্চিতকরণ কোড পাঠান',
  ],
  'courierEscalationCourierEscalationIndex.sending': ['Sending…', 'পাঠানো হচ্ছে…'],
  'courierEscalationCourierEscalationIndex.codeSent': ['Code sent', 'কোড পাঠানো হয়েছে'],
  'courierEscalationCourierEscalationIndex.notSent': ['Not sent', 'পাঠানো হয়নি'],
  'courierEscalationCourierEscalationIndex.sixDigitCode': ['Six-digit code', 'ছয় অঙ্কের কোড'],
  'courierEscalationCourierEscalationIndex.confirm': ['Confirm', 'নিশ্চিত করুন'],
  'courierEscalationCourierEscalationIndex.confirming': ['Confirming…', 'নিশ্চিত হচ্ছে…'],
  'courierEscalationCourierEscalationIndex.changed': ['Changed', 'বদলেছে'],
  'courierEscalationCourierEscalationIndex.refused': ['Refused', 'প্রত্যাখ্যাত'],
  'courierEscalationEscalationTabs.sendQueue': ['Send queue', 'পাঠানোর কিউ'],
  'courierEscalationEscalationTabs.conversations': ['Conversations', 'কথোপকথন'],
  'courierEscalationEscalationTabs.patterns': ['Patterns', 'প্যাটার্ন'],
  'courierEscalationEscalationTabs.portalWorker': ['Portal worker', 'পোর্টাল ওয়ার্কার'],
  'courierEscalationEscalationTabs.escalationViews': ['Escalation views', 'এসকেলেশন ভিউ'],
  'courierEscalationPortalPortalIndex.when': ['When', 'কখন'],
  'courierEscalationPortalPortalIndex.doing': ['Doing', 'কী করছে'],
  'courierEscalationPortalPortalIndex.mode': ['Mode', 'মোড'],
  'courierEscalationPortalPortalIndex.outcome': ['Outcome', 'ফলাফল'],
  'courierEscalationPortalPortalIndex.detail': ['Detail', 'বিবরণ'],
  'courierEscalationPortalPortalIndex.thisIsWhyUnattendedAction': [
    "This is why unattended action is refused: with no category IDs on file, none can be checked against the locked list, so the safe answer to “may the worker file this?” is no. The list fills on the worker's first successful visit.",
    'তদারকি ছাড়া কাজ এ কারণেই প্রত্যাখ্যাত: ফাইলে কোনো ক্যাটাগরি আইডি না থাকলে লক করা তালিকার সাথে কিছু মেলানো যায় না, তাই “ওয়ার্কার কি এটি ফাইল করতে পারে?” প্রশ্নের নিরাপদ উত্তর হলো না। ওয়ার্কারের প্রথম সফল ভিজিটে তালিকাটি ভরে ওঠে।',
  ],
  'courierEscalationPortalPortalIndex.theirId': ['Their ID', 'তাদের আইডি'],
  'courierEscalationPortalPortalIndex.category': ['Category', 'ক্যাটাগরি'],
  'courierEscalationPortalPortalIndex.unattended': ['Unattended', 'তদারকি ছাড়া'],
  'courierEscalationPortalPortalIndex.lastSeen': ['Last seen', 'সর্বশেষ দেখা'],
  'courierEscalationPortalPortalIndex.humanOnly': ['human only', 'শুধু মানুষ'],
  'courierEscalationPortalPortalIndex.allowedIfListed': [
    'allowed if listed',
    'তালিকায় থাকলে অনুমোদিত',
  ],
  'courierEscalationPortalPortalIndex.browserChannel': [
    'Browser channel: {value}',
    'ব্রাউজার চ্যানেল: {value}',
  ],
  'courierEscalationPortalPortalIndex.stopBackToShadow': [
    'Stop — back to SHADOW',
    'থামান — SHADOW-তে ফিরে যান',
  ],
  'courierEscalationPortalPortalIndex.turnItOff': ['Turn it OFF', 'বন্ধ করুন (OFF)'],
  'courierEscalationPortalPortalIndex.goLive': ['Go LIVE', 'LIVE করুন'],
  'courierEscalationPortalPortalIndex.backToShadow': ['Back to SHADOW', 'SHADOW-তে ফিরে যান'],
  'courierEscalationPortalPortalIndex.reasonRecorded': [
    'Reason recorded: {value}',
    'কারণ রেকর্ড হয়েছে: {value}',
  ],
  'courierEscalationPortalPortalIndex.network': ['Network', 'নেটওয়ার্ক'],
  'courierEscalationPortalPortalIndex.courierEscalation': [
    'Courier escalation',
    'কুরিয়ার এসকেলেশন',
  ],
  'courierEscalationPortalPortalIndex.portalWorker': ['Portal worker', 'পোর্টাল ওয়ার্কার'],
  'courierEscalationPortalPortalIndex.theBrowserTierItRuns': [
    'The browser tier. It runs in a separate process from the API, and in SHADOW it reads and decides without writing anything.',
    'ব্রাউজার স্তর। এটি API থেকে আলাদা প্রসেসে চলে, আর SHADOW-তে এটি কিছু না লিখে শুধু পড়ে ও সিদ্ধান্ত নেয়।',
  ],
  'courierEscalationPortalPortalIndex.portalMode': ['Portal mode', 'পোর্টাল মোড'],
  'courierEscalationPortalPortalIndex.shadowReadsAndDecidesBut': [
    'SHADOW reads and decides but never writes. Separate from the send-queue write mode.',
    'SHADOW পড়ে ও সিদ্ধান্ত নেয় কিন্তু কখনো লেখে না। পাঠানোর কিউয়ের রাইট মোড থেকে আলাদা।',
  ],
  'courierEscalationPortalPortalIndex.shadowRunsRecorded': [
    'Shadow runs recorded',
    'রেকর্ড করা শ্যাডো রান',
  ],
  'courierEscalationPortalPortalIndex.loading': ['Loading', 'লোড হচ্ছে'],
  'courierEscalationPortalPortalIndex.eachOneIsADecision': [
    'Each one is a decision that was made and deliberately not acted on.',
    'প্রতিটি একটি সিদ্ধান্ত যা নেওয়া হয়েছিল কিন্তু ইচ্ছা করেই কার্যকর করা হয়নি।',
  ],
  'courierEscalationPortalPortalIndex.failedOrChallenged': [
    'Failed or challenged',
    'ব্যর্থ বা চ্যালেঞ্জ করা',
  ],
  'courierEscalationPortalPortalIndex.aChallengeFreezesTheWorker': [
    "A challenge freezes the worker rather than retrying — a login loop against a courier's portal is how an account gets locked.",
    'চ্যালেঞ্জ এলে ওয়ার্কার আবার চেষ্টা না করে থেমে যায় — কুরিয়ারের পোর্টালে লগইন লুপ হলেই অ্যাকাউন্ট লক হয়।',
  ],
  'courierEscalationPortalPortalIndex.recentRuns': ['Recent runs', 'সাম্প্রতিক রান'],
  'courierEscalationPortalPortalIndex.newestFirstARunIs': [
    'Newest first. A run is one visit with one purpose; the detail is what it saw or what it would have written.',
    'নতুনটি আগে। একটি রান মানে একটি উদ্দেশ্যে একটি ভিজিট; বিবরণে থাকে সে কী দেখেছে বা কী লিখত।',
  ],
  'courierEscalationPortalPortalIndex.loadingRuns': ['Loading runs', 'রান লোড হচ্ছে'],
  'courierEscalationPortalPortalIndex.theWorkerHasNotRun': [
    'The worker has not run',
    'ওয়ার্কার এখনও চলেনি',
  ],
  'courierEscalationPortalPortalIndex.expectedItIsDeployedInert': [
    'Expected: it is deployed inert and the nightly canary only runs once the portal credential exists. Nothing here is a fault yet.',
    'প্রত্যাশিত: এটি নিষ্ক্রিয় অবস্থায় ডিপ্লয় হয়েছে এবং পোর্টালের ক্রেডেনশিয়াল না থাকলে রাতের ক্যানারি চলে না। এখানে এখনও কিছু ত্রুটি নয়।',
  ],
  'courierEscalationPortalPortalIndex.delhiverySCategories': [
    "Delhivery's categories",
    'Delhivery-র ক্যাটাগরি',
  ],
  'courierEscalationPortalPortalIndex.fetchedFromTheirPortalAnd': [
    'Fetched from their portal and kept by their own IDs. Two are locked to humans permanently — a claim and a paid-protection case are money, and no mode unlocks them.',
    'তাদের পোর্টাল থেকে আনা এবং তাদের নিজস্ব আইডিতে রাখা। দুটি স্থায়ীভাবে মানুষের জন্য লক — দাবি (claim) এবং paid-protection কেস অর্থসংক্রান্ত, আর কোনো মোডই এগুলো খুলে দেয় না।',
  ],
  'courierEscalationPortalPortalIndex.loadingCategories': [
    'Loading categories',
    'ক্যাটাগরি লোড হচ্ছে',
  ],
  'courierEscalationPortalPortalIndex.notFetchedYet': ['Not fetched yet', 'এখনও আনা হয়নি'],
  'courierEscalationPortalPortalIndex.portalIsLive': ['Portal is LIVE', 'পোর্টাল LIVE'],
  'courierEscalationPortalPortalIndex.portalAutomationIsOffNothing': [
    'Portal automation is OFF — nothing will open a browser',
    'পোর্টাল অটোমেশন বন্ধ — কিছুই ব্রাউজার খুলবে না',
  ],
  'courierEscalationPortalPortalIndex.portalIsBackInShadow': [
    'Portal is back in SHADOW',
    'পোর্টাল আবার SHADOW-তে',
  ],
  'courierEscalationPortalPortalIndex.softwareIsRaisingTicketsOn': [
    'Software is raising tickets on the courier’s portal in our name.',
    'সফটওয়্যার আমাদের নামে কুরিয়ারের পোর্টালে টিকিট তুলছে।',
  ],
  'courierEscalationPortalPortalIndex.noBrowserIsOpenedAnd': [
    'No browser is opened and no session is established. Escalations are handled by hand on the courier’s own site and recorded here afterwards.',
    'কোনো ব্রাউজার খোলা হয় না, কোনো সেশনও তৈরি হয় না। এসকেলেশন কুরিয়ারের নিজস্ব সাইটে হাতে সামলানো হয় এবং পরে এখানে রেকর্ড করা হয়।',
  ],
  'courierEscalationPortalPortalIndex.everythingUpToTheClick': [
    'Everything up to the click happens and is recorded. Nothing reaches the courier.',
    'ক্লিক পর্যন্ত সবকিছু হয় এবং রেকর্ড হয়। কুরিয়ারের কাছে কিছুই পৌঁছায় না।',
  ],
  'courierEscalationPortalPortalIndex.stoppingTheBrowserChannelFrom': [
    'Stopping the browser channel from the portal page',
    'পোর্টাল পেজ থেকে ব্রাউজার চ্যানেল থামানো হচ্ছে',
  ],
  'courierEscalationPortalPortalIndex.standingThePortalAutomationDown': [
    'Standing the portal automation down from the portal page',
    'পোর্টাল পেজ থেকে পোর্টাল অটোমেশন বন্ধ করা হচ্ছে',
  ],
  'courierEscalationPortalPortalIndex.reason': ['Reason', 'কারণ'],
  'courierEscalationPortalPortalIndex.why10Chars': ['Why (10+ chars)', 'কেন (10+ অক্ষর)'],
  'courierEscalationPortalPortalIndex.reasonForGoingLive': [
    'Reason for going live',
    'LIVE করার কারণ',
  ],
  'courierEscalationPortalPortalIndex.letTheBrowserChannelClick': [
    'Let the browser channel click?',
    'ব্রাউজার চ্যানেলকে ক্লিক করতে দেবেন?',
  ],
  'courierEscalationPortalPortalIndex.courierPortalWorker': [
    'Courier portal worker',
    'কুরিয়ার পোর্টাল ওয়ার্কার',
  ],
  'courierEscalationPortalPortalIndex.fromTheNextRunSoftware': [
    "From the next run, software raises tickets on the courier's own portal in our name; Stop — back to SHADOW undoes it with one click.",
    'পরের রান থেকে সফটওয়্যার আমাদের নামে কুরিয়ারের নিজস্ব পোর্টালে টিকিট তুলবে; “থামান — SHADOW-তে ফিরে যান” এক ক্লিকে এটি ফিরিয়ে দেয়।',
  ],
  'courierEscalationTemplatesTemplatesIndex.order': ['Order', 'ক্রম'],
  'courierEscalationTemplatesTemplatesIndex.code': ['Code', 'কোড'],
  'courierEscalationTemplatesTemplatesIndex.pattern': ['Pattern', 'প্যাটার্ন'],
  'courierEscalationTemplatesTemplatesIndex.means': ['Means', 'অর্থ'],
  'courierEscalationTemplatesTemplatesIndex.action': ['Action', 'অ্যাকশন'],
  'courierEscalationTemplatesTemplatesIndex.live': ['Live', 'লাইভ'],
  'courierEscalationTemplatesTemplatesIndex.message': ['Message', 'বার্তা'],
  'courierEscalationTemplatesTemplatesIndex.seen': ['Seen', 'দেখা গেছে'],
  'courierEscalationTemplatesTemplatesIndex.outcome': ['Outcome', 'ফলাফল'],
  'courierEscalationTemplatesTemplatesIndex.times': ['times', 'বার'],
  'courierEscalationTemplatesTemplatesIndex.time': ['time', 'বার'],
  'courierEscalationTemplatesTemplatesIndex.seen2': [
    'seen {seenCount} {value}',
    '{value} দেখা গেছে {seenCount} বার',
  ],
  'courierEscalationTemplatesTemplatesIndex.firstLast': [
    'first {value}, last {value2}',
    'প্রথম {value}, শেষ {value2}',
  ],
  'courierEscalationTemplatesTemplatesIndex.cancel': ['Cancel', 'বাতিল'],
  'courierEscalationTemplatesTemplatesIndex.writeAPattern': [
    'Write a pattern',
    'একটি প্যাটার্ন লিখুন',
  ],
  'courierEscalationTemplatesTemplatesIndex.network': ['Network', 'নেটওয়ার্ক'],
  'courierEscalationTemplatesTemplatesIndex.courierEscalation': [
    'Courier escalation',
    'কুরিয়ার এসকেলেশন',
  ],
  'courierEscalationTemplatesTemplatesIndex.messagePatterns': [
    'Message patterns',
    'বার্তার প্যাটার্ন',
  ],
  'courierEscalationTemplatesTemplatesIndex.courierMessagesTheLibraryCould': [
    'Courier messages the library could not classify, and the live patterns it matches with. A pattern decides what a client is told a message means.',
    'কুরিয়ারের যে বার্তাগুলো লাইব্রেরি শ্রেণিবদ্ধ করতে পারেনি, এবং যে লাইভ প্যাটার্নগুলো দিয়ে এটি মেলায়। একটি প্যাটার্ন ঠিক করে একটি বার্তার অর্থ ক্লায়েন্টকে কী বলা হবে।',
  ],
  'courierEscalationTemplatesTemplatesIndex.awaitingReview': [
    'Awaiting review',
    'পর্যালোচনার অপেক্ষায়',
  ],
  'courierEscalationTemplatesTemplatesIndex.mostRepeatedFirstThePattern': [
    'Most-repeated first — the pattern worth writing next is at the top.',
    'সবচেয়ে বেশি পুনরাবৃত্ত আগে — যে প্যাটার্ন পরে লেখা উচিত সেটি ওপরে।',
  ],
  'courierEscalationTemplatesTemplatesIndex.loadingCandidates': [
    'Loading candidates',
    'প্রার্থী লোড হচ্ছে',
  ],
  'courierEscalationTemplatesTemplatesIndex.nothingUnmatched': [
    'Nothing unmatched',
    'কিছু অমিল নেই',
  ],
  'courierEscalationTemplatesTemplatesIndex.eitherEveryMessageSoFar': [
    'Either every message so far matched a pattern, or none have arrived yet. Both are fine; this queue fills itself.',
    'হয় এখন পর্যন্ত প্রতিটি বার্তা একটি প্যাটার্নে মিলেছে, নয়তো এখনও কিছু আসেনি। দুটিই ঠিক আছে; এই কিউ নিজে থেকে ভরে ওঠে।',
  ],
  'courierEscalationTemplatesTemplatesIndex.theLiveLibrary': ['The live library', 'লাইভ লাইব্রেরি'],
  'courierEscalationTemplatesTemplatesIndex.checkedInThisOrderThe': [
    'Checked in this order — the first match wins, so a broad pattern with a low number can shadow a precise one below it.',
    'এই ক্রমে মেলানো হয় — প্রথম মিলই জেতে, তাই কম সংখ্যার একটি বিস্তৃত প্যাটার্ন নিচের একটি নির্দিষ্ট প্যাটার্নকে ঢেকে দিতে পারে।',
  ],
  'courierEscalationTemplatesTemplatesIndex.loadingPatterns': [
    'Loading patterns',
    'প্যাটার্ন লোড হচ্ছে',
  ],
  'courierEscalationTemplatesTemplatesIndex.alreadyDecided': [
    'Already decided',
    'ইতিমধ্যে সিদ্ধান্ত হয়েছে',
  ],
  'courierEscalationTemplatesTemplatesIndex.keptRatherThanDeletedThe': [
    'Kept rather than deleted: the body is the evidence for why a pattern exists, and a pattern whose origin was thrown away is one nobody can safely change later.',
    'মুছে না ফেলে রাখা হয়েছে: বার্তাটিই প্রমাণ কেন একটি প্যাটার্ন আছে, আর যে প্যাটার্নের উৎস ফেলে দেওয়া হয়েছে তা পরে কেউ নিরাপদে বদলাতে পারে না।',
  ],
  'courierEscalationTemplatesTemplatesIndex.patternIsLive': ['Pattern is live', 'প্যাটার্ন লাইভ'],
  'courierEscalationTemplatesTemplatesIndex.leftOutOfTheLibrary': [
    'Left out of the library',
    'লাইব্রেরি থেকে বাদ দেওয়া হয়েছে',
  ],
  'courierEscalationTemplatesTemplatesIndex.stableEGNdrAck': [
    'Stable, e.g. NDR_ACK_24_48.',
    'স্থির, যেমন NDR_ACK_24_48।',
  ],
  'courierEscalationTemplatesTemplatesIndex.theStateThisImpliesE': [
    'The state this implies, e.g. ACKNOWLEDGED.',
    'এটি যে অবস্থা বোঝায়, যেমন ACKNOWLEDGED।',
  ],
  'courierEscalationTemplatesTemplatesIndex.optionalEGAskSeller': [
    'Optional, e.g. ASK_SELLER_ALT_PHONE.',
    'ঐচ্ছিক, যেমন ASK_SELLER_ALT_PHONE।',
  ],
  'courierEscalationTemplatesTemplatesIndex.lowerIsCheckedFirst': [
    'Lower is checked first.',
    'কম সংখ্যাটি আগে মেলানো হয়।',
  ],
  'courierEscalationTemplatesTemplatesIndex.aRegularExpressionWithoutDelimiters': [
    'A regular expression without delimiters, matched case-insensitively. The server refuses one that does not match the message above.',
    'ডেলিমিটার ছাড়া একটি রেগুলার এক্সপ্রেশন, বড়-ছোট হাতের অক্ষর নির্বিশেষে মেলানো হয়। ওপরের বার্তার সাথে না মিললে সার্ভার তা প্রত্যাখ্যান করে।',
  ],
  'courierEscalationTemplatesTemplatesIndex.makeItLive': ['Make it live', 'লাইভ করুন'],
  'courierEscalationTemplatesTemplatesIndex.promoting': ['Promoting…', 'পদোন্নতি হচ্ছে…'],
  'courierEscalationTemplatesTemplatesIndex.refused': ['Refused', 'প্রত্যাখ্যাত'],
  'courierEscalationTemplatesTemplatesIndex.notWorthOne': ['Not worth one', 'একটির যোগ্য নয়'],
  'courierEscalationTemplatesTemplatesIndex.leavingOut': ['Leaving out…', 'বাদ দেওয়া হচ্ছে…'],
  'courierEscalationTemplatesTemplatesIndex.leftOut': ['Left out', 'বাদ দেওয়া হয়েছে'],
  'courierEscalationThreadsThreadsIndex.client': ['Client', 'ক্লায়েন্ট'],
  'courierEscalationThreadsThreadsIndex.theirTicket': ['Their ticket', 'তাদের টিকিট'],
  'courierEscalationThreadsThreadsIndex.state': ['State', 'অবস্থা'],
  'courierEscalationThreadsThreadsIndex.messages': ['Messages', 'বার্তা'],
  'courierEscalationThreadsThreadsIndex.lastHeard': ['Last heard', 'সর্বশেষ শোনা'],
  'courierEscalationThreadsThreadsIndex.notYetRaised': ['not yet raised', 'এখনও তোলা হয়নি'],
  'courierEscalationThreadsThreadsIndex.thread': ['Thread', 'থ্রেড'],
  'courierEscalationThreadsThreadsIndex.theTicketThisHangsOff': [
    'the ticket this hangs off',
    'যে টিকিটের সাথে এটি যুক্ত',
  ],
  'courierEscalationThreadsThreadsIndex.awaitingDeliveryToTheCourier': [
    '{pendingOutbound} awaiting delivery to the courier',
    '{pendingOutbound}টি কুরিয়ারে পৌঁছানোর অপেক্ষায়',
  ],
  'courierEscalationThreadsThreadsIndex.openNothingSaidYet': [
    'Open, nothing said yet.',
    'খোলা, এখনও কিছু বলা হয়নি।',
  ],
  'courierEscalationThreadsThreadsIndex.goesToTheSendQueue': [
    'Goes to the send queue. Nothing reaches Delhivery until it is delivered from there.',
    'পাঠানোর কিউতে যায়। সেখান থেকে ডেলিভারি না হওয়া পর্যন্ত Delhivery-র কাছে কিছুই পৌঁছায় না।',
  ],
  'courierEscalationThreadsThreadsIndex.shownToTheClientOn': [
    'Shown to the client on their ticket. Sends nothing.',
    'ক্লায়েন্টকে তাদের টিকিটে দেখানো হয়। কিছুই পাঠায় না।',
  ],
  'courierEscalationThreadsThreadsIndex.lowConfidence': ['low confidence', 'কম নিশ্চয়তা'],
  'courierEscalationThreadsThreadsIndex.network': ['Network', 'নেটওয়ার্ক'],
  'courierEscalationThreadsThreadsIndex.courierEscalation': [
    'Courier escalation',
    'কুরিয়ার এসকেলেশন',
  ],
  'courierEscalationThreadsThreadsIndex.courierConversations': [
    'Courier conversations',
    'কুরিয়ার কথোপকথন',
  ],
  'courierEscalationThreadsThreadsIndex.whatEachCourierHasTold': [
    'What each courier has told us, per parcel, in their words. Replies you send here queue for a person to send — no courier has a reply API.',
    'প্রতিটি কুরিয়ার প্রতি পার্সেলে আমাদের কী বলেছে, তাদের নিজেদের কথায়। এখানে আপনার পাঠানো উত্তর পাঠানোর জন্য একজন মানুষের কিউতে যায় — কোনো কুরিয়ারের রিপ্লাই API নেই।',
  ],
  'courierEscalationThreadsThreadsIndex.loadingConversations': [
    'Loading conversations',
    'কথোপকথন লোড হচ্ছে',
  ],
  'courierEscalationThreadsThreadsIndex.noConversationsYet': [
    'No conversations yet',
    'এখনও কোনো কথোপকথন নেই',
  ],
  'courierEscalationThreadsThreadsIndex.oneOpensWhenATicket': [
    'One opens when a ticket needs the courier — either a client raises an issue, or a failed re-attempt request escalates one automatically.',
    'কোনো টিকিটে কুরিয়ারের দরকার হলে একটি খোলে — হয় ক্লায়েন্ট একটি ইস্যু তোলেন, নয়তো একটি ব্যর্থ রি-অ্যাটেম্পট অনুরোধ স্বয়ংক্রিয়ভাবে একটি এসকেলেট করে।',
  ],
  'courierEscalationThreadsThreadsIndex.aMessageHereWasClassified': [
    'A message here was classified with low confidence.',
    'এখানকার একটি বার্তা কম নিশ্চয়তায় শ্রেণিবদ্ধ হয়েছে।',
  ],
  'courierEscalationThreadsThreadsIndex.close': ['Close', 'বন্ধ'],
  'courierEscalationThreadsThreadsIndex.open': ['Open', 'খোলা'],
  'courierEscalationThreadsThreadsIndex.loadingTheThread': [
    'Loading the thread',
    'থ্রেড লোড হচ্ছে',
  ],
  'courierEscalationThreadsThreadsIndex.queuedInTheSendQueue': [
    'Queued in the send queue',
    'পাঠানোর কিউতে রাখা হয়েছে',
  ],
  'courierEscalationThreadsThreadsIndex.recordedTheClientCanSee': [
    'Recorded — the client can see it now',
    'রেকর্ড হয়েছে — ক্লায়েন্ট এখন দেখতে পাচ্ছেন',
  ],
  'courierEscalationThreadsThreadsIndex.replyToTheCourier': [
    'Reply to the courier',
    'কুরিয়ারকে উত্তর দিন',
  ],
  'courierEscalationThreadsThreadsIndex.storedAndSentExactlyAs': [
    'Stored and sent exactly as typed — never rewritten or translated.',
    'যেমন টাইপ করা হয়েছে তেমনই সংরক্ষিত ও পাঠানো হয় — কখনো পুনর্লিখিত বা অনূদিত হয় না।',
  ],
  'courierEscalationThreadsThreadsIndex.queueReply': ['Queue reply', 'উত্তর কিউতে দিন'],
  'courierEscalationThreadsThreadsIndex.queueing': ['Queueing…', 'কিউতে দেওয়া হচ্ছে…'],
  'courierEscalationThreadsThreadsIndex.queued': ['Queued', 'কিউতে দেওয়া হয়েছে'],
  'courierEscalationThreadsThreadsIndex.notQueued': ['Not queued', 'কিউতে দেওয়া হয়নি'],
  'courierEscalationThreadsThreadsIndex.recordWhatTheCourierTold': [
    'Record what the courier told us',
    'কুরিয়ার আমাদের যা বলেছে তা রেকর্ড করুন',
  ],
  'courierEscalationThreadsThreadsIndex.pasteTheirReplyRatherThan': [
    "Paste their reply rather than paraphrasing — the client reads this as the courier's own words.",
    'নিজের ভাষায় না লিখে তাদের উত্তর পেস্ট করুন — ক্লায়েন্ট এটি কুরিয়ারের নিজের কথা হিসেবে পড়েন।',
  ],
  'courierEscalationThreadsThreadsIndex.saveTheirReply': [
    'Save their reply',
    'তাদের উত্তর সংরক্ষণ করুন',
  ],
  'courierEscalationThreadsThreadsIndex.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'courierEscalationThreadsThreadsIndex.recorded': ['Recorded', 'রেকর্ড হয়েছে'],
  'courierEscalationThreadsThreadsIndex.notSaved': ['Not saved', 'সংরক্ষণ হয়নি'],
  'courierEscalationThreadsThreadsIndex.delhivery': ['Delhivery', 'Delhivery'],
  'courierEscalationThreadsThreadsIndex.skydrop': ['Skydrop', 'Skydrop'],
  'delhiveryAccountSetupPanel.reachability': ['Reachability', 'পৌঁছানোর যোগ্যতা'],
  'delhiveryAccountSetupPanel.oneLiveServiceabilityLookupUsing': [
    'One live serviceability lookup using the stored credential. Creates nothing. In stub mode it reports that it did not reach anything — a cached answer would look exactly like proof.',
    'সংরক্ষিত ক্রেডেনশিয়াল দিয়ে একটি লাইভ সার্ভিসেবিলিটি লুকআপ। কিছু তৈরি করে না। স্টাব মোডে এটি জানায় যে কিছুতেই পৌঁছায়নি — ক্যাশ করা উত্তর ঠিক প্রমাণের মতো দেখাত।',
  ],
  'delhiveryAccountSetupPanel.checkConnection': ['Check connection', 'সংযোগ পরীক্ষা করুন'],
  'delhiveryAccountSetupPanel.stubModeTheCallNever': [
    'Stub mode: the call never left the box. This says nothing about the real account.',
    'স্টাব মোড: কলটি বাক্সের বাইরে যায়নি। আসল অ্যাকাউন্ট সম্পর্কে এটি কিছুই বলে না।',
  ],
  'delhiveryAccountSetupPanel.notServiceable': ['not serviceable', 'সার্ভিসযোগ্য নয়'],
  'delhiveryAccountSetupPanel.serviceable': ['serviceable', 'সার্ভিসযোগ্য'],
  'delhiveryAccountSetupPanel.reachedTheLiveApi': [
    'Reached the live API. {pincode} — {value}{value2}.',
    'লাইভ API-তে পৌঁছেছে। {pincode} — {value}{value2}।',
  ],
  'delhiveryAccountSetupPanel.pickupLocation': ['Pickup location', 'পিকআপ লোকেশন'],
  'delhiveryAccountSetupPanel.everyShipmentSendsThisWarehouse': [
    "Every shipment sends this warehouse's name and Delhivery matches it exactly — case and spaces included. A warehouse that is not registered, or whose name differs by one character, fails every AWB. Delhivery offers no way to list what is already registered, so this cannot show you; the audit log is the record.",
    'প্রতিটি শিপমেন্ট এই ওয়্যারহাউসের নাম পাঠায় এবং Delhivery হুবহু মেলায় — বড়-ছোট হাতের অক্ষর ও স্পেসসহ। নিবন্ধিত নয় এমন ওয়্যারহাউস, বা এক অক্ষরেও ভিন্ন নাম, প্রতিটি AWB ব্যর্থ করে। Delhivery ইতিমধ্যে নিবন্ধিত তালিকা দেখার কোনো উপায় দেয় না, তাই এটি দেখাতে পারে না; অডিট লগই রেকর্ড।',
  ],
  'delhiveryAccountSetupPanel.registerAWarehouse': [
    'Register a warehouse',
    'একটি ওয়্যারহাউস নিবন্ধন করুন',
  ],
  'delhiveryAccountSetupPanel.updateARegisteredOne': [
    'Update a registered one',
    'নিবন্ধিত একটি হালনাগাদ করুন',
  ],
  'delhiveryAccountSetupPanel.registeringNeedsTheCourierAccounts': [
    'Registering needs the courier-accounts permission.',
    'নিবন্ধনের জন্য courier-accounts অনুমতি লাগে।',
  ],
  'delhiveryAccountSetupPanel.cancel': ['Cancel', 'বাতিল'],
  'delhiveryAccountSetupPanel.didNotReachTheLive': [
    'Did not reach the live API.',
    'লাইভ API-তে পৌঁছায়নি।',
  ],
  'delhiveryAccountSetupPanel.registeredEveryShipmentFromThis': [
    'Registered "{name}". Every shipment from this warehouse must send exactly that name.',
    '“{name}” নিবন্ধিত হয়েছে। এই ওয়্যারহাউস থেকে প্রতিটি শিপমেন্টকে ঠিক এই নামই পাঠাতে হবে।',
  ],
  'delhiveryAccountSetupPanel.updated': ['Updated "{name}".', '“{name}” হালনাগাদ হয়েছে।'],
  'delhiveryAccountSetupPanel.delhiveryDeclinedTheRequestWithout': [
    'Delhivery declined the request without saying why.',
    'Delhivery কারণ না বলেই অনুরোধ প্রত্যাখ্যান করেছে।',
  ],
  'delhiveryAccountSetupPanel.accountSetup': ['Account setup', 'অ্যাকাউন্ট সেটআপ'],
  'delhiveryAccountSetupPanel.whatHasToBeTrue': [
    'What has to be true before a real parcel can move. Neither of these creates a shipment.',
    'একটি আসল পার্সেল চলার আগে কী কী সত্য হতে হবে। এর কোনোটিই শিপমেন্ট তৈরি করে না।',
  ],
  'delhiveryAccountSetupPanel.refused': ['Refused', 'প্রত্যাখ্যাত'],
  'delhiveryAccountSetupPanel.pincode': ['Pincode', 'পিনকোড'],
  'delhiveryAccountSetupPanel.blankUsesOurOwnDispatch': [
    'Blank uses our own dispatch origin.',
    'ফাঁকা রাখলে আমাদের নিজস্ব ডিসপ্যাচ অরিজিন ব্যবহার হয়।',
  ],
  'delhiveryAccountSetupPanel.registerAPickupLocation': [
    'Register a pickup location',
    'একটি পিকআপ লোকেশন নিবন্ধন করুন',
  ],
  'delhiveryAccountSetupPanel.updateAPickupLocation': [
    'Update a pickup location',
    'একটি পিকআপ লোকেশন হালনাগাদ করুন',
  ],
  'delhiveryAccountSetupPanel.theNameCannotBeChanged': [
    'The name cannot be changed afterwards, and it is what every shipment is matched on. Everything else can be corrected later.',
    'নামটি পরে বদলানো যায় না, এবং প্রতিটি শিপমেন্ট এটি দিয়েই মেলানো হয়। বাকি সবকিছু পরে সংশোধন করা যায়।',
  ],
  'delhiveryAccountSetupPanel.theNameIdentifiesWhichLocation': [
    'The name identifies which location to change, so it must match what was registered exactly. Everything else here replaces what is stored.',
    'নামটি ঠিক করে কোন লোকেশন বদলাবে, তাই এটি যা নিবন্ধিত হয়েছিল ঠিক তাই হতে হবে। এখানকার বাকি সবকিছু সংরক্ষিতটির জায়গা নেয়।',
  ],
  'delhiveryAccountSetupPanel.registerPermanently': [
    'Register permanently',
    'স্থায়ীভাবে নিবন্ধন করুন',
  ],
  'delhiveryAccountSetupPanel.update': ['Update', 'হালনাগাদ'],
  'delhiveryAccountSetupPanel.warehouseName': ['Warehouse name', 'ওয়্যারহাউসের নাম'],
  'delhiveryAccountSetupPanel.exactlyAsItWillBe': [
    'Exactly as it will be sent on every shipment.',
    'প্রতিটি শিপমেন্টে যেমন পাঠানো হবে ঠিক তেমন।',
  ],
  'delhiveryAccountSetupPanel.thisHasALeadingOr': [
    'This has a leading or trailing space. Delhivery would treat it as a different name — and it cannot be corrected.',
    'শুরুতে বা শেষে স্পেস আছে। Delhivery এটিকে ভিন্ন নাম হিসেবে ধরবে — এবং তা সংশোধন করা যায় না।',
  ],
  'delhiveryAccountSetupPanel.typeTheNameAgain': ['Type the name again', 'নামটি আবার টাইপ করুন'],
  'delhiveryAccountSetupPanel.itIsTheOneField': [
    'It is the one field nobody can fix later.',
    'এটিই একমাত্র ঘর যা পরে কেউ ঠিক করতে পারে না।',
  ],
  'delhiveryAccountSetupPanel.phone': ['Phone', 'ফোন'],
  'delhiveryAccountSetupPanel.sixDigits': ['Six digits.', 'ছয় অঙ্ক।'],
  'delhiveryAccountSetupPanel.address': ['Address', 'ঠিকানা'],
  'delhiveryAccountSetupPanel.city': ['City', 'শহর'],
  'delhiveryAccountSetupPanel.email': ['Email', 'ইমেইল'],
  'delhiveryAccountSetupPanel.returnAddress': ['Return address', 'ফেরতের ঠিকানা'],
  'delhiveryAccountSetupPanel.whereUndeliveredParcelsComeBack': [
    'Where undelivered parcels come back to. May be the same address.',
    'যেখানে ডেলিভারি না হওয়া পার্সেল ফিরে আসে। একই ঠিকানা হতে পারে।',
  ],
  'delhiveryAccountSetupPanel.returnCity': ['Return city', 'ফেরতের শহর'],
  'delhiveryAccountSetupPanel.returnPincode': ['Return pincode', 'ফেরতের পিনকোড'],
  'delhiveryAccountSetupPanel.returnState': ['Return state', 'ফেরতের রাজ্য'],
  'delhiveryDelhiveryOpsIndex.refillWaybillPool': ['Refill waybill pool', 'ওয়েবিল পুল আবার ভরুন'],
  'delhiveryDelhiveryOpsIndex.liveWritesEnabled': ['Live writes enabled', 'লাইভ রাইট চালু'],
  'delhiveryDelhiveryOpsIndex.liveWritesBlocked': ['Live writes blocked', 'লাইভ রাইট বন্ধ'],
  'delhiveryDelhiveryOpsIndex.changeInSystemSettings': [
    'Change in system settings →',
    'সিস্টেম সেটিংসে বদলান →',
  ],
  'delhiveryDelhiveryOpsIndex.noUsableWaybillsManifestClosure': [
    'No usable waybills. Manifest closure will fail until the pool is refilled. In live mode the refill itself needs the write guard on.',
    'ব্যবহারযোগ্য ওয়েবিল নেই। পুল আবার না ভরা পর্যন্ত ম্যানিফেস্ট বন্ধ ব্যর্থ হবে। লাইভ মোডে রিফিল করতেও রাইট গার্ড চালু থাকতে হয়।',
  ],
  'delhiveryDelhiveryOpsIndex.endpoint': ['Endpoint', 'এন্ডপয়েন্ট'],
  'delhiveryDelhiveryOpsIndex.remaining': ['Remaining', 'বাকি'],
  'delhiveryDelhiveryOpsIndex.budget': ['Budget', 'বাজেট'],
  'delhiveryDelhiveryOpsIndex.headroom': ['Headroom', 'হেডরুম'],
  'delhiveryDelhiveryOpsIndex.fivePerFiveMinutesThe': [
    'five per five minutes — the tight one',
    'পাঁচ মিনিটে পাঁচটি — সবচেয়ে কঠিন সীমা',
  ],
  'delhiveryDelhiveryOpsIndex.poolIsAlreadyAboveIts': [
    'Pool is already above its watermark ({poolAfter} held).',
    'পুল ইতিমধ্যে তার ওয়াটারমার্কের ওপরে ({poolAfter}টি ধরা আছে)।',
  ],
  'delhiveryDelhiveryOpsIndex.fetchedPoolNow': [
    'Fetched {fetched}. Pool now {poolAfter}.',
    '{fetched}টি আনা হয়েছে। পুল এখন {poolAfter}।',
  ],
  'delhiveryDelhiveryOpsIndex.network': ['Network', 'নেটওয়ার্ক'],
  'delhiveryDelhiveryOpsIndex.delhivery': ['Delhivery', 'Delhivery'],
  'delhiveryDelhiveryOpsIndex.waybillPoolDepthTheLive': [
    'Waybill pool depth, the live-write guard, and remaining rate budget. Refreshes every 30 seconds.',
    'ওয়েবিল পুলের গভীরতা, লাইভ-রাইট গার্ড এবং অবশিষ্ট রেট বাজেট। প্রতি 30 সেকেন্ডে হালনাগাদ হয়।',
  ],
  'delhiveryDelhiveryOpsIndex.couldNotReadDelhiveryStatus': [
    'Could not read Delhivery status.',
    'Delhivery-র অবস্থা পড়া যায়নি।',
  ],
  'delhiveryDelhiveryOpsIndex.connection': ['Connection', 'সংযোগ'],
  'delhiveryDelhiveryOpsIndex.stubModeMeansNoNetwork': [
    'Stub mode means no network call ever leaves this process. The write guard is a second, independent gate on operations with a physical or billable effect.',
    'স্টাব মোড মানে এই প্রসেস থেকে কোনো নেটওয়ার্ক কল বের হয় না। রাইট গার্ড হলো শারীরিক বা বিলযোগ্য প্রভাবযুক্ত অপারেশনের ওপর দ্বিতীয়, স্বাধীন গেট।',
  ],
  'delhiveryDelhiveryOpsIndex.liveApi': ['Live API', 'লাইভ API'],
  'delhiveryDelhiveryOpsIndex.stubMode': ['Stub mode', 'স্টাব মোড'],
  'delhiveryDelhiveryOpsIndex.callsGoToTheReal': [
    'Calls go to the real Delhivery API. There is no sandbox on this account, so every request counts against production.',
    'কল আসল Delhivery API-তে যায়। এই অ্যাকাউন্টে কোনো স্যান্ডবক্স নেই, তাই প্রতিটি অনুরোধ প্রোডাকশনের বিপরীতে গোনা হয়।',
  ],
  'delhiveryDelhiveryOpsIndex.noBaseUrlConfiguredSo': [
    'No base URL configured, so the adapter answers from deterministic stubs. Safe to exercise any flow.',
    'কোনো বেস URL কনফিগার করা নেই, তাই অ্যাডাপ্টার নির্ধারিত স্টাব থেকে উত্তর দেয়। যেকোনো ফ্লো নিরাপদে চালিয়ে দেখা যায়।',
  ],
  'delhiveryDelhiveryOpsIndex.manifestingPickupsCancelsAndNdr': [
    'Manifesting, pickups, cancels and NDR actions will reach the real account. Turn this off again once the intended operation is done.',
    'ম্যানিফেস্টিং, পিকআপ, বাতিল ও NDR অ্যাকশন আসল অ্যাকাউন্টে পৌঁছাবে। উদ্দিষ্ট অপারেশন শেষ হলে এটি আবার বন্ধ করুন।',
  ],
  'delhiveryDelhiveryOpsIndex.manifestingPickupsCancelsAndNdr2': [
    'Manifesting, pickups, cancels and NDR actions are refused with DELHIVERY_LIVE_WRITES_DISABLED. This is the default and the safe state.',
    'ম্যানিফেস্টিং, পিকআপ, বাতিল ও NDR অ্যাকশন DELHIVERY_LIVE_WRITES_DISABLED দিয়ে প্রত্যাখ্যাত হয়। এটিই ডিফল্ট ও নিরাপদ অবস্থা।',
  ],
  'delhiveryDelhiveryOpsIndex.waybillPool': ['Waybill pool', 'ওয়েবিল পুল'],
  'delhiveryDelhiveryOpsIndex.awbsAreFetchedInBulk': [
    'AWBs are fetched in bulk ahead of time because Delhivery allows only five bulk requests per five minutes. An empty pool stops manifests.',
    'AWB আগে থেকে বাল্কে আনা হয় কারণ Delhivery পাঁচ মিনিটে মাত্র পাঁচটি বাল্ক অনুরোধ অনুমোদন করে। খালি পুল ম্যানিফেস্ট থামিয়ে দেয়।',
  ],
  'delhiveryDelhiveryOpsIndex.usableNow': ['Usable now', 'এখন ব্যবহারযোগ্য'],
  'delhiveryDelhiveryOpsIndex.pastTheirSettleDelay': [
    'Past their settle delay',
    'তাদের নিষ্পত্তি-বিলম্ব পেরিয়েছে',
  ],
  'delhiveryDelhiveryOpsIndex.available': ['Available', 'উপলব্ধ'],
  'delhiveryDelhiveryOpsIndex.includesNotYetSettled': [
    'Includes not-yet-settled',
    'এখনও নিষ্পত্তি না হওয়াগুলো সহ',
  ],
  'delhiveryDelhiveryOpsIndex.assigned': ['Assigned', 'বরাদ্দ'],
  'delhiveryDelhiveryOpsIndex.used': ['Used', 'ব্যবহৃত'],
  'delhiveryDelhiveryOpsIndex.void': ['Void', 'বাতিল'],
  'delhiveryDelhiveryOpsIndex.rateBudget': ['Rate budget', 'রেট বাজেট'],
  'delhiveryDelhiveryOpsIndex.budgetedTo80OfDelhivery': [
    "Budgeted to 80% of Delhivery's documented limits, per five-minute window, shared across every API instance. Exhausting one returns a WAF 403 that blocks our whole egress IP.",
    'প্রতি পাঁচ মিনিটের উইন্ডোতে Delhivery-র প্রকাশিত সীমার 80%-এ বাজেট করা, প্রতিটি API ইনস্ট্যান্সের মধ্যে ভাগ করা। একটি শেষ হয়ে গেলে WAF 403 ফেরত আসে, যা আমাদের পুরো এগ্রেস IP আটকে দেয়।',
  ],
  'delhiveryDelhiveryOpsIndex.refillTheWaybillPool': [
    'Refill the waybill pool?',
    'ওয়েবিল পুল আবার ভরবেন?',
  ],
  'delhiveryDelhiveryOpsIndex.delhiveryWaybillPool': [
    'Delhivery waybill pool',
    'Delhivery ওয়েবিল পুল',
  ],
  'delhiveryDelhiveryOpsIndex.thisAsksDelhiveryForA': [
    "This asks Delhivery for a bulk batch of real AWBs from the account's allocation and uses one of the five bulk requests allowed per five minutes.",
    'এটি অ্যাকাউন্টের বরাদ্দ থেকে আসল AWB-র একটি বাল্ক ব্যাচ Delhivery-র কাছে চায় এবং পাঁচ মিনিটে অনুমোদিত পাঁচটি বাল্ক অনুরোধের একটি ব্যবহার করে।',
  ],
  'delhiveryTrackingLookupPanel.notOneOfOurs': ['not one of ours', 'আমাদের নয়'],
  'delhiveryTrackingLookupPanel.weHoldThisShipment': [
    'we hold this shipment',
    'এই শিপমেন্ট আমাদের কাছে আছে',
  ],
  'delhiveryTrackingLookupPanel.courierTimeTheirs': [
    'Courier time (theirs)',
    'কুরিয়ারের সময় (তাদের)',
  ],
  'delhiveryTrackingLookupPanel.storedAsUtc': ['Stored as (UTC)', 'সংরক্ষিত (UTC)'],
  'delhiveryTrackingLookupPanel.leg': ['Leg', 'লেগ'],
  'delhiveryTrackingLookupPanel.status': ['Status', 'স্ট্যাটাস'],
  'delhiveryTrackingLookupPanel.weReadItAs': ['We read it as', 'আমরা এটি পড়ি'],
  'delhiveryTrackingLookupPanel.theRestReturnedNoScans': [
    ' The rest returned no scans.',
    ' বাকিগুলো কোনো স্ক্যান ফেরত দেয়নি।',
  ],
  'delhiveryTrackingLookupPanel.lookUpAWaybill': ['Look up a waybill', 'একটি ওয়েবিল খুঁজুন'],
  'delhiveryTrackingLookupPanel.whatOurCouriersKnowAbout': [
    'What our couriers know about an AWB, and what our mapping makes of it. Every integrated courier is asked — Delhivery with the estate credential, Shiprocket with the account that booked the parcel. Reads only — no tracking event is written and no order moves.',
    'আমাদের কুরিয়াররা একটি AWB সম্পর্কে কী জানে, এবং আমাদের ম্যাপিং তা থেকে কী বোঝে। প্রতিটি ইন্টিগ্রেটেড কুরিয়ারকে জিজ্ঞেস করা হয় — Delhivery-কে এস্টেটের ক্রেডেনশিয়াল দিয়ে, Shiprocket-কে যে অ্যাকাউন্ট পার্সেল বুক করেছে তা দিয়ে। শুধু পড়া — কোনো ট্র্যাকিং ইভেন্ট লেখা হয় না, কোনো অর্ডারও এগোয় না।',
  ],
  'delhiveryTrackingLookupPanel.awbNumbers': ['AWB numbers', 'AWB নম্বর'],
  'delhiveryTrackingLookupPanel.onePerLineOrComma': [
    'One per line or comma-separated. Up to 50 — their cap per call.',
    'প্রতি লাইনে একটি বা কমা দিয়ে আলাদা। সর্বোচ্চ 50টি — প্রতি কলে তাদের সীমা।',
  ],
  'delhiveryTrackingLookupPanel.lookUp': ['Look up', 'খুঁজুন'],
  'delhiveryTrackingLookupPanel.askingDelhivery': [
    'Asking Delhivery…',
    'Delhivery-কে জিজ্ঞেস করা হচ্ছে…',
  ],
  'delhiveryTrackingLookupPanel.lookedUp': ['Looked up', 'খোঁজা হয়েছে'],
  'delhiveryTrackingLookupPanel.lookupFailed': ['Lookup failed', 'খোঁজা ব্যর্থ হয়েছে'],
  'delhiveryTrackingLookupPanel.delhiveryHasNoScans': [
    'Delhivery has no scans',
    'Delhivery-র কোনো স্ক্যান নেই',
  ],
  'delhiveryTrackingPollPanel.ordersWillNotReachDelivered': [
    'Orders will not reach delivered while this is stopped, which also means COD is not being credited. Run a cycle below, then check the API process is up and that the Delhivery base URL is still set.',
    'এটি বন্ধ থাকলে অর্ডার ডেলিভারড হবে না, যার মানে COD ক্রেডিটও হচ্ছে না। নিচে একটি সাইকেল চালান, তারপর দেখুন API প্রসেস চালু আছে কি না এবং Delhivery বেস URL এখনও সেট করা আছে কি না।',
  ],
  'delhiveryTrackingPollPanel.cycleRanInStubMode': [
    'Cycle ran in STUB MODE — no call left this process. Tracking is not actually running; check the API base URL.',
    'সাইকেল চলেছে স্টাব মোডে — এই প্রসেস থেকে কোনো কল বের হয়নি। ট্র্যাকিং আসলে চলছে না; API বেস URL দেখুন।',
  ],
  'delhiveryTrackingPollPanel.checkedParcelsAppliedNewScans': [
    'Checked {shipmentsExamined} parcels, applied {scansApplied} new scans, moved {transitions} orders.',
    '{shipmentsExamined}টি পার্সেল পরীক্ষা করা হয়েছে, {scansApplied}টি নতুন স্ক্যান প্রয়োগ হয়েছে, {transitions}টি অর্ডার এগিয়েছে।',
  ],
  'delhiveryTrackingPollPanel.tracking': ['Tracking', 'ট্র্যাকিং'],
  'delhiveryTrackingPollPanel.delhiverySendsUsNoWebhooks': [
    'Delhivery sends us no webhooks, so a scheduled poll is what moves every order to delivered. If this stops, nothing else fails — parcels simply stop updating.',
    'Delhivery আমাদের কোনো ওয়েবহুক পাঠায় না, তাই নির্ধারিত পোল-ই প্রতিটি অর্ডারকে ডেলিভারড-এ নিয়ে যায়। এটি থেমে গেলে আর কিছু ব্যর্থ হয় না — পার্সেল শুধু হালনাগাদ হওয়া বন্ধ করে।',
  ],
  'delhiveryTrackingPollPanel.couldNotReadTrackingHealth': [
    'Could not read tracking health.',
    'ট্র্যাকিংয়ের স্বাস্থ্য পড়া যায়নি।',
  ],
  'delhiveryTrackingPollPanel.notRunning': ['Not running', 'চলছে না'],
  'delhiveryTrackingPollPanel.running': ['Running', 'চলছে'],
  'delhiveryTrackingPollPanel.noCycleHasEverCompleted': [
    'No cycle has ever completed. Either the poller has not run since this was added, or it is not running at all.',
    'কোনো সাইকেল কখনো সম্পন্ন হয়নি। হয় এটি যোগ হওয়ার পর পোলার চলেনি, নয়তো এটি একেবারেই চলছে না।',
  ],
  'delhiveryTrackingPollPanel.runACycleNow': ['Run a cycle now', 'এখনই একটি সাইকেল চালান'],
  'delhiveryTrackingPollPanel.running2': ['Running…', 'চলছে…'],
  'delhiveryTrackingPollPanel.cycleRan': ['Cycle ran', 'সাইকেল চলেছে'],
  'delhiveryTrackingPollPanel.didNotRun': ['Did not run', 'চলেনি'],
  'delhiveryWalletImportPanel.checkFirst': ['Check first', 'আগে পরীক্ষা করুন'],
  'delhiveryWalletImportPanel.import': ['Import', 'ইম্পোর্ট'],
  'delhiveryWalletImportPanel.rows': ['Rows', 'সারি'],
  'delhiveryWalletImportPanel.read': ['{rowsRead} read{value}', '{rowsRead}টি পড়া হয়েছে{value}'],
  'delhiveryWalletImportPanel.costsSet': ['Costs set', 'খরচ সেট হয়েছে'],
  'delhiveryWalletImportPanel.deliveryReturn': [
    '{forwardWritten} delivery, {rtoWritten} return',
    '{forwardWritten}টি ডেলিভারি, {rtoWritten}টি রিটার্ন',
  ],
  'delhiveryWalletImportPanel.revised': ['Revised', 'সংশোধিত'],
  'delhiveryWalletImportPanel.unchanged': ['Unchanged', 'অপরিবর্তিত'],
  'delhiveryWalletImportPanel.notOurs': ['Not ours', 'আমাদের নয়'],
  'delhiveryWalletImportPanel.awbsInTheFileWe': [
    '{unknownAwbs} AWBs in the file we have no shipment for',
    'ফাইলে {unknownAwbs}টি AWB যার জন্য আমাদের কোনো শিপমেন্ট নেই',
  ],
  'delhiveryWalletImportPanel.total': ['Total', 'মোট'],
  'delhiveryWalletImportPanel.matchesTheFileSOwn': [
    '· matches the file’s own total',
    '· ফাইলের নিজস্ব মোটের সাথে মেলে',
  ],
  'delhiveryWalletImportPanel.theRowsDoNotAdd': [
    'The rows do not add up to the total the file states. Something was mis-read — re-download the export rather than trusting these figures.',
    'সারিগুলো ফাইলে বলা মোটের সাথে মেলে না। কিছু ভুল পড়া হয়েছে — এই অঙ্কগুলো বিশ্বাস না করে এক্সপোর্টটি আবার ডাউনলোড করুন।',
  ],
  'delhiveryWalletImportPanel.whatDelhiveryCharged': [
    'What Delhivery charged',
    'Delhivery যা চার্জ করেছে',
  ],
  'delhiveryWalletImportPanel.financesDownloadLedgerThenDrop': [
    'Finances → Download Ledger, then drop the .xlsx here. Export a month at a time.',
    'Finances → Download Ledger, তারপর .xlsx এখানে ফেলুন। এক মাস করে এক্সপোর্ট করুন।',
  ],
  'delhiveryWalletImportPanel.dropTheLedgerExportHere': [
    'Drop the ledger export here',
    'লেজার এক্সপোর্ট এখানে ফেলুন',
  ],
  'delhiveryWalletImportPanel.chooseTheXlsx': ['Choose the .xlsx', '.xlsx বেছে নিন'],
  'delhiveryWalletImportPanel.theWalletLedgerAsDelhivery': [
    'The wallet ledger, as Delhivery exports it.',
    'ওয়ালেট লেজার, যেমন Delhivery এক্সপোর্ট করে।',
  ],
  'delhiveryWalletImportPanel.notImported': ['Not imported', 'ইম্পোর্ট হয়নি'],
  'delhiveryWalletImportPanel.nothingWasWrittenThisIs': [
    'Nothing was written — this is what would change.',
    'কিছু লেখা হয়নি — এটিই বদলাত।',
  ],
  'delhiveryWalletImportPanel.imported': ['Imported.', 'ইম্পোর্ট হয়েছে।'],
  'deliveryActionsDeliveryActionsIndex.order': ['Order', 'অর্ডার'],
  'deliveryActionsDeliveryActionsIndex.client': ['Client', 'ক্লায়েন্ট'],
  'deliveryActionsDeliveryActionsIndex.askedFor': ['Asked for', 'যা চাওয়া হয়েছে'],
  'deliveryActionsDeliveryActionsIndex.why': ['Why', 'কেন'],
  'deliveryActionsDeliveryActionsIndex.state': ['State', 'অবস্থা'],
  'deliveryActionsDeliveryActionsIndex.decide': ['Decide', 'সিদ্ধান্ত'],
  'deliveryActionsDeliveryActionsIndex.memberStore': [
    'Member store: {value}',
    'মেম্বার স্টোর: {value}',
  ],
  'deliveryActionsDeliveryActionsIndex.noCourierInvolved': [
    'No courier involved',
    'কোনো কুরিয়ার জড়িত নয়',
  ],
  'deliveryActionsDeliveryActionsIndex.waitingOnClientStaff': [
    'Waiting on client staff',
    'ক্লায়েন্টের স্টাফের অপেক্ষায়',
  ],
  'deliveryActionsDeliveryActionsIndex.approve': ['Approve', 'অনুমোদন করুন'],
  'deliveryActionsDeliveryActionsIndex.decline': ['Decline', 'প্রত্যাখ্যান করুন'],
  'deliveryActionsDeliveryActionsIndex.cancel': ['Cancel', 'বাতিল'],
  'deliveryActionsDeliveryActionsIndex.delhiveryAnswersAsynchronouslyThisReturns': [
    'Delhivery answers asynchronously — this returns a reference, not an outcome. The real result arrives on the next scan.',
    'Delhivery অ্যাসিঙ্ক্রোনাসভাবে উত্তর দেয় — এটি একটি রেফারেন্স ফেরত দেয়, ফলাফল নয়। আসল ফলাফল আসে পরের স্ক্যানে।',
  ],
  'deliveryActionsDeliveryActionsIndex.sayWhyTheClientSees': [
    'Say why — the client sees this, and an unexplained no comes straight back',
    'কারণ লিখুন — ক্লায়েন্ট এটি দেখেন, আর ব্যাখ্যাহীন ‘না’ সরাসরি ফিরে আসে',
  ],
  'deliveryActionsDeliveryActionsIndex.failedDeliveries': ['Failed deliveries', 'ব্যর্থ ডেলিভারি'],
  'deliveryActionsDeliveryActionsIndex.whatClientsHaveAskedUs': [
    "What clients have asked us to do about parcels the courier could not hand over. A Member store's ask that its client chose to approve is shown for reference only — Client staff decide it, not Skydrop admin.",
    'কুরিয়ার যে পার্সেল হস্তান্তর করতে পারেনি সে ব্যাপারে ক্লায়েন্টরা আমাদের কী করতে বলেছে। মেম্বার স্টোরের যে অনুরোধ তার ক্লায়েন্ট অনুমোদন করেছেন তা শুধু রেফারেন্সের জন্য দেখানো — এটি ক্লায়েন্টের স্টাফ ঠিক করেন, Skydrop অ্যাডমিন নয়।',
  ],
  'deliveryActionsDeliveryActionsIndex.showDecidedRequestsToo': [
    'Show decided requests too',
    'সিদ্ধান্ত হয়ে যাওয়া অনুরোধও দেখান',
  ],
  'deliveryActionsDeliveryActionsIndex.approvingAReAttemptSends': [
    'Approving a re-attempt sends a van; approving a return ends the sale. A recall only queues one of our agents to phone the customer.',
    'রি-অ্যাটেম্পট অনুমোদন করলে ভ্যান যায়; রিটার্ন অনুমোদন করলে বিক্রি শেষ হয়। রিকল শুধু আমাদের একজন এজেন্টকে গ্রাহককে ফোন করার জন্য কিউতে দেয়।',
  ],
  'deliveryActionsDeliveryActionsIndex.allRequests': ['All requests', 'সব অনুরোধ'],
  'deliveryActionsDeliveryActionsIndex.waitingOnADecision': [
    'Waiting on a decision',
    'সিদ্ধান্তের অপেক্ষায়',
  ],
  'deliveryActionsDeliveryActionsIndex.loadingTheQueue': ['Loading the queue…', 'কিউ লোড হচ্ছে…'],
  'deliveryActionsDeliveryActionsIndex.couldNotReadTheQueue': [
    'Could not read the queue.',
    'কিউ পড়া যায়নি।',
  ],
  'deliveryActionsDeliveryActionsIndex.noRequestsYet': ['No requests yet', 'এখনও কোনো অনুরোধ নেই'],
  'deliveryActionsDeliveryActionsIndex.nothingWaiting': ['Nothing waiting', 'অপেক্ষায় কিছু নেই'],
  'deliveryActionsDeliveryActionsIndex.noClientHasAskedFor': [
    'No client has asked for anything yet.',
    'কোনো ক্লায়েন্ট এখনও কিছু চাননি।',
  ],
  'deliveryActionsDeliveryActionsIndex.nothingWaitingFailedDeliveriesAppear': [
    'Nothing waiting. Failed deliveries appear here when a client asks us to act.',
    'অপেক্ষায় কিছু নেই। ক্লায়েন্ট আমাদের কিছু করতে বললে ব্যর্থ ডেলিভারি এখানে আসে।',
  ],
  'deliveryActionsDeliveryActionsIndex.failedDeliveryRequests': [
    'Failed-delivery requests',
    'ব্যর্থ-ডেলিভারির অনুরোধ',
  ],
  'deliveryActionsDeliveryActionsIndex.asked': ['Asked {value}', 'চাওয়া হয়েছে {value}'],
  'deliveryActionsDeliveryActionsIndex.approve2': ['Approve: {value}', 'অনুমোদন: {value}'],
  'deliveryActionsDeliveryActionsIndex.declineThisRequest': [
    'Decline this request',
    'এই অনুরোধ প্রত্যাখ্যান করুন',
  ],
  'deliveryActionsDeliveryActionsIndex.queuesTheOrderForOne': [
    'Queues the order for one of our agents to phone the customer. Nothing reaches the courier.',
    'অর্ডারটি আমাদের একজন এজেন্টের গ্রাহককে ফোন করার জন্য কিউতে দেয়। কুরিয়ারের কাছে কিছুই পৌঁছায় না।',
  ],
  'deliveryActionsDeliveryActionsIndex.thisReachesDelhiveryARe': [
    'This reaches Delhivery. A re-attempt dispatches a van; a return ends the sale.',
    'এটি Delhivery-তে পৌঁছায়। রি-অ্যাটেম্পট ভ্যান পাঠায়; রিটার্ন বিক্রি শেষ করে।',
  ],
  'deliveryActionsDeliveryActionsIndex.theClientSeesYourReason': [
    'The client sees your reason.',
    'ক্লায়েন্ট আপনার কারণ দেখেন।',
  ],
  'deliveryActionsDeliveryActionsIndex.approveAndAct': [
    'Approve and act',
    'অনুমোদন করে কার্যকর করুন',
  ],
  'deliveryActionsDeliveryActionsIndex.working': ['Working…', 'কাজ চলছে…'],
  'deliveryActionsDeliveryActionsIndex.note': ['Note', 'নোট'],
  'deliveryActionsDeliveryActionsIndex.optionalNoteForTheClient': [
    'Optional note for the client',
    'ক্লায়েন্টের জন্য ঐচ্ছিক নোট',
  ],
  'deliveryActionsDeliveryActionsIndex.eGTwoAttemptsAlready': [
    'e.g. Two attempts already made — a third is unlikely to land',
    'যেমন ইতিমধ্যে দুবার চেষ্টা হয়েছে — তৃতীয়বার সফল হওয়ার সম্ভাবনা কম',
  ],
  'deliveryActionsPage.failedDeliveriesSkydropAdmin': [
    'Failed deliveries · Skydrop Admin',
    'ব্যর্থ ডেলিভারি · Skydrop অ্যাডমিন',
  ],
  'manualPlacementManualPlacementIndex.order': ['Order', 'অর্ডার'],
  'manualPlacementManualPlacementIndex.destination': ['Destination', 'গন্তব্য'],
  'manualPlacementManualPlacementIndex.whyItIsHere': ['Why it is here', 'এটি কেন এখানে'],
  'manualPlacementManualPlacementIndex.afterTheWaybill': ['After the waybill', 'ওয়েবিলের পর'],
  'manualPlacementManualPlacementIndex.waiting': ['Waiting', 'অপেক্ষায়'],
  'manualPlacementManualPlacementIndex.placeIt': ['Place it', 'প্লেস করুন'],
  'manualPlacementManualPlacementIndex.needsPicking': ['Needs picking', 'পিক করতে হবে'],
  'manualPlacementManualPlacementIndex.readyToGo': ['Ready to go', 'যাওয়ার জন্য প্রস্তুত'],
  'manualPlacementManualPlacementIndex.justNow': ['just now', 'এইমাত্র'],
  'manualPlacementManualPlacementIndex.manualPlacement': [
    'Manual placement',
    'ম্যানুয়াল প্লেসমেন্ট',
  ],
  'manualPlacementManualPlacementIndex.parcelsNoIntegratedCourierWould': [
    'Parcels no integrated courier would carry. Each one is waiting on a person to arrange carriage and type the waybill back in — nothing here moves on its own.',
    'যে পার্সেল কোনো ইন্টিগ্রেটেড কুরিয়ার নেবে না। প্রতিটি একজন মানুষের অপেক্ষায় আছে বহনের ব্যবস্থা করে ওয়েবিল ফিরিয়ে টাইপ করার জন্য — এখানে কিছুই নিজে থেকে এগোয় না।',
  ],
  'manualPlacementManualPlacementIndex.waitingForAWaybill': [
    'Waiting for a waybill',
    'ওয়েবিলের অপেক্ষায়',
  ],
  'manualPlacementManualPlacementIndex.loadingTheWorklist': [
    'Loading the worklist…',
    'কাজের তালিকা লোড হচ্ছে…',
  ],
  'manualPlacementManualPlacementIndex.couldNotLoadTheWorklist': [
    'Could not load the worklist.',
    'কাজের তালিকা লোড করা যায়নি।',
  ],
  'manualPlacementManualPlacementIndex.nothingWaitingOnManualPlacement': [
    'Nothing waiting on manual placement',
    'ম্যানুয়াল প্লেসমেন্টে অপেক্ষায় কিছু নেই',
  ],
  'manualPlacementManualPlacementIndex.everyConfirmedParcelHasA': [
    'Every confirmed parcel has a courier. Orders appear here when one refuses to carry them.',
    'প্রতিটি নিশ্চিত পার্সেলের একটি কুরিয়ার আছে। কোনো কুরিয়ার নিতে অস্বীকার করলে অর্ডার এখানে আসে।',
  ],
  'manualPlacementManualPlacementIndex.parcelsWaitingOnManualPlacement': [
    'Parcels waiting on manual placement',
    'ম্যানুয়াল প্লেসমেন্টের অপেক্ষায় থাকা পার্সেল',
  ],
  'manualPlacementPage.manualPlacementSkydropAdmin': [
    'Manual placement · Skydrop Admin',
    'ম্যানুয়াল প্লেসমেন্ট · Skydrop অ্যাডমিন',
  ],
  'reattemptRequestsReattemptRequestsIndex.waitingForADecision': [
    'Waiting for a decision',
    'সিদ্ধান্তের অপেক্ষায়',
  ],
  'reattemptRequestsReattemptRequestsIndex.approved': ['Approved', 'অনুমোদিত'],
  'reattemptRequestsReattemptRequestsIndex.declined': ['Declined', 'প্রত্যাখ্যাত'],
  'reattemptRequestsReattemptRequestsIndex.all': ['All', 'সব'],
  'reattemptRequestsReattemptRequestsIndex.asked': ['asked {value}', 'চাওয়া হয়েছে {value}'],
  'reattemptRequestsReattemptRequestsIndex.granted': ['Granted:', 'মঞ্জুর:'],
  'reattemptRequestsReattemptRequestsIndex.decisionNote': ['Decision note:', 'সিদ্ধান্তের নোট:'],
  'reattemptRequestsReattemptRequestsIndex.approveCallAgain': [
    'Approve — call again',
    'অনুমোদন — আবার কল করুন',
  ],
  'reattemptRequestsReattemptRequestsIndex.decline': ['Decline', 'প্রত্যাখ্যান করুন'],
  'reattemptRequestsReattemptRequestsIndex.cancel': ['Cancel', 'বাতিল'],
  'reattemptRequestsReattemptRequestsIndex.askedByTheClient': [
    'asked by the client',
    'ক্লায়েন্ট চেয়েছেন',
  ],
  'reattemptRequestsReattemptRequestsIndex.calls': ['calls', 'কল'],
  'reattemptRequestsReattemptRequestsIndex.call': ['call', 'কল'],
  'reattemptRequestsReattemptRequestsIndex.more': ['{n} more {value}', 'আরও {n}টি {value}'],
  'reattemptRequestsReattemptRequestsIndex.reAttemptRequests': [
    'Re-attempt requests',
    'রি-অ্যাটেম্পট অনুরোধ',
  ],
  'reattemptRequestsReattemptRequestsIndex.clientsAskingUsToCall': [
    'Clients asking us to call a customer who declined. Read the reason before approving — the customer already said no once.',
    'ক্লায়েন্টরা এমন গ্রাহককে ফোন করতে বলছেন যিনি প্রত্যাখ্যান করেছিলেন। অনুমোদনের আগে কারণটি পড়ুন — গ্রাহক একবার ‘না’ বলে দিয়েছেন।',
  ],
  'reattemptRequestsReattemptRequestsIndex.status': ['Status', 'অবস্থা'],
  'reattemptRequestsReattemptRequestsIndex.loadingRequests': [
    'Loading requests…',
    'অনুরোধ লোড হচ্ছে…',
  ],
  'reattemptRequestsReattemptRequestsIndex.nothingWaiting': [
    'Nothing waiting',
    'অপেক্ষায় কিছু নেই',
  ],
  'reattemptRequestsReattemptRequestsIndex.whenAClientAsksUs': [
    'When a client asks us to call a customer who declined, it lands here.',
    'কোনো ক্লায়েন্ট প্রত্যাখ্যানকারী গ্রাহককে ফোন করতে বললে তা এখানে আসে।',
  ],
  'reattemptRequestsReattemptRequestsIndex.whenTheClientAsked': [
    'When the client asked',
    'ক্লায়েন্ট যখন চেয়েছিলেন',
  ],
  'reattemptRequestsReattemptRequestsIndex.putThisOrderBackIn': [
    'Put this order back in the call queue?',
    'এই অর্ডার আবার কল কিউতে ফেরত দেবেন?',
  ],
  'reattemptRequestsReattemptRequestsIndex.declineThisRequest': [
    'Decline this request?',
    'এই অনুরোধ প্রত্যাখ্যান করবেন?',
  ],
  'reattemptRequestsReattemptRequestsIndex.theOrderReturnsToPending': [
    'The order returns to PENDING_CONFIRMATION and is queued for calling. Its attempt count is unchanged; choose how many extra calls to allow, or it comes back already at its cap.',
    'অর্ডার PENDING_CONFIRMATION-এ ফিরে যায় এবং কলের জন্য কিউতে বসে। চেষ্টার সংখ্যা অপরিবর্তিত থাকে; কত অতিরিক্ত কল দেবেন তা বেছে নিন, নইলে এটি ইতিমধ্যে সীমায় পৌঁছানো অবস্থায় ফিরে আসে।',
  ],
  'reattemptRequestsReattemptRequestsIndex.theOrderStaysRejectedThe': [
    'The order stays rejected. The client can ask again if something changes.',
    'অর্ডার প্রত্যাখ্যাতই থাকে। কিছু বদলালে ক্লায়েন্ট আবার চাইতে পারেন।',
  ],
  'reattemptRequestsReattemptRequestsIndex.approve': ['Approve', 'অনুমোদন'],
  'reattemptRequestsReattemptRequestsIndex.declineRequest': [
    'Decline request',
    'অনুরোধ প্রত্যাখ্যান করুন',
  ],
  'reattemptRequestsReattemptRequestsIndex.saving': ['Saving…', 'সংরক্ষণ হচ্ছে…'],
  'reattemptRequestsReattemptRequestsIndex.extraCallsToAllow': [
    'Extra calls to allow',
    'অতিরিক্ত কলের অনুমতি',
  ],
  'reattemptRequestsReattemptRequestsIndex.onTopOfTheClient': [
    "On top of the client's normal cap. One is usually right — an approval that grants none puts the order back already out of chances, so the first unanswered ring rejects it again.",
    'ক্লায়েন্টের স্বাভাবিক সীমার ওপরে। সাধারণত একটিই ঠিক — কোনোটিই না দিয়ে অনুমোদন করলে অর্ডার আগে থেকেই সুযোগ ফুরানো অবস্থায় ফেরে, ফলে প্রথম উত্তর-না-পাওয়া রিংয়েই আবার প্রত্যাখ্যাত হয়।',
  ],
  'reattemptRequestsReattemptRequestsIndex.note': ['Note', 'নোট'],
  'reattemptRequestsReattemptRequestsIndex.optionalRecordedWithTheDecision': [
    'Optional — recorded with the decision.',
    'ঐচ্ছিক — সিদ্ধান্তের সাথে রেকর্ড হয়।',
  ],
  'shiprocketShiprocketOpsIndex.liveWritesEnabled': ['Live writes enabled', 'লাইভ রাইট চালু'],
  'shiprocketShiprocketOpsIndex.liveWritesBlocked': ['Live writes blocked', 'লাইভ রাইট বন্ধ'],
  'shiprocketShiprocketOpsIndex.changeInSystemSettings': [
    'Change in system settings →',
    'সিস্টেম সেটিংসে বদলান →',
  ],
  'shiprocketShiprocketOpsIndex.changeOnCourierAccounts': [
    'Change on courier accounts →',
    'কুরিয়ার অ্যাকাউন্টে বদলান →',
  ],
  'shiprocketShiprocketOpsIndex.account': ['Account', 'অ্যাকাউন্ট'],
  'shiprocketShiprocketOpsIndex.pickupLocation': ['Pickup location', 'পিকআপ লোকেশন'],
  'shiprocketShiprocketOpsIndex.wallet': ['Wallet', 'ওয়ালেট'],
  'shiprocketShiprocketOpsIndex.read': ['Read', 'পড়া'],
  'shiprocketShiprocketOpsIndex.noShiprocketAccountIsConfigured': [
    'No Shiprocket account is configured.',
    'কোনো Shiprocket অ্যাকাউন্ট কনফিগার করা নেই।',
  ],
  'shiprocketShiprocketOpsIndex.notSetBookingsRefuse': [
    'not set — bookings refuse',
    'সেট করা নেই — বুকিং প্রত্যাখ্যাত হয়',
  ],
  'shiprocketShiprocketOpsIndex.lastWalletSync': ['Last wallet sync', 'সর্বশেষ ওয়ালেট সিঙ্ক'],
  'shiprocketShiprocketOpsIndex.lastInvoiceCheck': [
    'Last invoice check',
    'সর্বশেষ ইনভয়েস পরীক্ষা',
  ],
  'shiprocketShiprocketOpsIndex.everyRunInDetail': [
    'Every run, in detail →',
    'প্রতিটি রান, বিস্তারিত →',
  ],
  'shiprocketShiprocketOpsIndex.returnAddress': ['Return address', 'ফেরতের ঠিকানা'],
  'shiprocketShiprocketOpsIndex.notSet': ['Not set', 'সেট করা নেই'],
  'shiprocketShiprocketOpsIndex.theirReturnBookingSpellsOut': [
    'Their return booking spells out BOTH ends, so a customer collection needs the address it comes back to. Without it, returns are refused by name.',
    'তাদের রিটার্ন বুকিং দুই প্রান্তই লিখে দেয়, তাই গ্রাহকের কাছ থেকে সংগ্রহের জন্য সেটি যে ঠিকানায় ফিরবে তা লাগে। এটি ছাড়া রিটার্ন নাম ধরে প্রত্যাখ্যাত হয়।',
  ],
  'shiprocketShiprocketOpsIndex.carrierQuoted': [
    'carrier{value} quoted',
    '{value}টি ক্যারিয়ার কোট করেছে',
  ],
  'shiprocketShiprocketOpsIndex.cheapest': [', cheapest', ', সবচেয়ে সস্তা'],
  'shiprocketShiprocketOpsIndex.parcel': ['Parcel', 'পার্সেল'],
  'shiprocketShiprocketOpsIndex.waybill': ['Waybill', 'ওয়েবিল'],
  'shiprocketShiprocketOpsIndex.carrier': ['Carrier', 'ক্যারিয়ার'],
  'shiprocketShiprocketOpsIndex.status': ['Status', 'অবস্থা'],
  'shiprocketShiprocketOpsIndex.booked': ['Booked', 'বুক হয়েছে'],
  'shiprocketShiprocketOpsIndex.noShiprocketParcelsYet': [
    'No Shiprocket parcels yet.',
    'এখনও কোনো Shiprocket পার্সেল নেই।',
  ],
  'shiprocketShiprocketOpsIndex.network': ['Network', 'নেটওয়ার্ক'],
  'shiprocketShiprocketOpsIndex.shiprocket': ['Shiprocket', 'Shiprocket'],
  'shiprocketShiprocketOpsIndex.whetherThisCourierIsAnswering': [
    'Whether this courier is answering from its live API or from a stub, whether writes are armed, and what it has booked. Refreshes every 30 seconds.',
    'এই কুরিয়ার তার লাইভ API থেকে উত্তর দিচ্ছে নাকি স্টাব থেকে, রাইট সক্রিয় কি না, এবং কী বুক করেছে। প্রতি 30 সেকেন্ডে হালনাগাদ হয়।',
  ],
  'shiprocketShiprocketOpsIndex.couldNotReadShiprocketStatus': [
    'Could not read Shiprocket status.',
    'Shiprocket-এর অবস্থা পড়া যায়নি।',
  ],
  'shiprocketShiprocketOpsIndex.connection': ['Connection', 'সংযোগ'],
  'shiprocketShiprocketOpsIndex.stubModeMeansNoNetwork': [
    'Stub mode means no network call ever leaves this process. The write guard and the intake switch are two further, independent gates.',
    'স্টাব মোড মানে এই প্রসেস থেকে কোনো নেটওয়ার্ক কল বের হয় না। রাইট গার্ড ও ইনটেক সুইচ আরও দুটি স্বাধীন গেট।',
  ],
  'shiprocketShiprocketOpsIndex.liveApi': ['Live API', 'লাইভ API'],
  'shiprocketShiprocketOpsIndex.stubMode': ['Stub mode', 'স্টাব মোড'],
  'shiprocketShiprocketOpsIndex.callsGoToTheReal': [
    'Calls go to the real Shiprocket API. There is no sandbox, so every request counts against production.',
    'কল আসল Shiprocket API-তে যায়। কোনো স্যান্ডবক্স নেই, তাই প্রতিটি অনুরোধ প্রোডাকশনের বিপরীতে গোনা হয়।',
  ],
  'shiprocketShiprocketOpsIndex.noBaseUrlConfiguredSo': [
    'No base URL configured, so the adapter answers from deterministic stubs — including a FABRICATED waybill on a booking. Safe alone; dangerous beside a live courier.',
    'কোনো বেস URL কনফিগার করা নেই, তাই অ্যাডাপ্টার নির্ধারিত স্টাব থেকে উত্তর দেয় — বুকিংয়ে একটি বানোয়াট ওয়েবিলসহ। একা নিরাপদ; লাইভ কুরিয়ারের পাশে বিপজ্জনক।',
  ],
  'shiprocketShiprocketOpsIndex.bookingsReturnsPickupsCancelsAnd': [
    'Bookings, returns, pickups, cancels and NDR actions reach the real account.',
    'বুকিং, রিটার্ন, পিকআপ, বাতিল ও NDR অ্যাকশন আসল অ্যাকাউন্টে পৌঁছায়।',
  ],
  'shiprocketShiprocketOpsIndex.bookingsReturnsPickupsCancelsAnd2': [
    'Bookings, returns, pickups, cancels and NDR actions are refused. This is the safe state.',
    'বুকিং, রিটার্ন, পিকআপ, বাতিল ও NDR অ্যাকশন প্রত্যাখ্যাত হয়। এটিই নিরাপদ অবস্থা।',
  ],
  'shiprocketShiprocketOpsIndex.takingNewParcels': ['Taking new parcels', 'নতুন পার্সেল নিচ্ছে'],
  'shiprocketShiprocketOpsIndex.noNewParcels': ['No new parcels', 'নতুন পার্সেল নয়'],
  'shiprocketShiprocketOpsIndex.newParcelsCanBeBooked': [
    'New parcels can be booked here, including by failover from another courier.',
    'এখানে নতুন পার্সেল বুক করা যায়, অন্য কুরিয়ার থেকে ফেইলওভারসহ।',
  ],
  'shiprocketShiprocketOpsIndex.noNewParcelsInFlight': [
    'No NEW parcels — in-flight ones are still tracked, cancelled and costed (CUR-16).',
    'কোনো নতুন পার্সেল নয় — চলমানগুলো এখনও ট্র্যাক, বাতিল ও খরচ-গণনা করা হয় (CUR-16)।',
  ],
  'shiprocketShiprocketOpsIndex.accounts': ['Accounts', 'অ্যাকাউন্ট'],
  'shiprocketShiprocketOpsIndex.thePickupLocationNameIs': [
    'The pickup location name is matched byte for byte on every booking; without one, bookings are refused. The balance is what the nightly wallet sync last read.',
    'পিকআপ লোকেশনের নাম প্রতিটি বুকিংয়ে বাইট ধরে মেলানো হয়; এটি ছাড়া বুকিং প্রত্যাখ্যাত হয়। ব্যালান্স হলো রাতের ওয়ালেট সিঙ্ক সর্বশেষ যা পড়েছে।',
  ],
  'shiprocketShiprocketOpsIndex.set': ['Set', 'সেট'],
  'shiprocketShiprocketOpsIndex.reachability': ['Reachability', 'পৌঁছানোর যোগ্যতা'],
  'shiprocketShiprocketOpsIndex.oneServiceabilityLookupOnA': [
    'One serviceability lookup on a lane. It creates nothing, and it is the only way to prove the stored credential still works without booking a parcel.',
    'একটি লেনে একটি সার্ভিসেবিলিটি লুকআপ। এটি কিছু তৈরি করে না, এবং পার্সেল বুক না করে সংরক্ষিত ক্রেডেনশিয়াল এখনও কাজ করে কি না প্রমাণ করার এটিই একমাত্র উপায়।',
  ],
  'shiprocketShiprocketOpsIndex.fromPincode': ['From pincode', 'যে পিনকোড থেকে'],
  'shiprocketShiprocketOpsIndex.toPincode': ['To pincode', 'যে পিনকোডে'],
  'shiprocketShiprocketOpsIndex.check': ['Check', 'পরীক্ষা'],
  'shiprocketShiprocketOpsIndex.checking': ['Checking…', 'পরীক্ষা হচ্ছে…'],
  'shiprocketShiprocketOpsIndex.checked': ['Checked', 'পরীক্ষা হয়েছে'],
  'shiprocketShiprocketOpsIndex.failed': ['Failed', 'ব্যর্থ'],
  'shiprocketShiprocketOpsIndex.reachedTheLiveApi': [
    'Reached the live API.',
    'লাইভ API-তে পৌঁছেছে।',
  ],
  'shiprocketShiprocketOpsIndex.answeredWithoutReachingThemStub': [
    'Answered WITHOUT reaching them (stub mode) — this proves nothing about the credential.',
    'তাদের কাছে না পৌঁছেই উত্তর এসেছে (স্টাব মোড) — ক্রেডেনশিয়াল সম্পর্কে এটি কিছুই প্রমাণ করে না।',
  ],
  'shiprocketShiprocketOpsIndex.recentParcels': ['Recent parcels', 'সাম্প্রতিক পার্সেল'],
  'shiprocketShiprocketOpsIndex.theTwentyMostRecentShiprocket': [
    'The twenty most recent Shiprocket shipments. A row with no waybill never got one — the AWB-less sweep chases those.',
    'সবচেয়ে সাম্প্রতিক কুড়িটি Shiprocket শিপমেন্ট। ওয়েবিলহীন সারি কখনো ওয়েবিল পায়নি — AWB-less সুইপ সেগুলোর পিছু নেয়।',
  ],
});
