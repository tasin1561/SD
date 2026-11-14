import { defineMessages } from '../define';

/**
 * The "easy pages" pieces: the "i" info button and the plain-words
 * explanations that moved off the page into a bubble. `[en, bn, hi]`.
 */
export const easy = defineMessages({
  'easy.close': ['Close', 'বন্ধ করুন', 'बंद करें'],
  'easy.guideTrigger': [
    'What does each choice do?',
    'কোনটা বাছলে কী হয়?',
    'हर विकल्प चुनने पर क्या होता है?',
  ],
  'easy.guideChosen': ['Chosen', 'বাছাই করা', 'चुना गया'],
  'easy.about': ['About: {title}', '{title} সম্পর্কে', '{title} के बारे में'],

  // ── Needs a person (/system-issues) ───────────────────────────────────
  'ezIssues.show': ['Show', 'দেখান', 'दिखाएँ'],
  'ezIssues.countsTitle': ['What the numbers mean', 'সংখ্যাগুলোর মানে', 'इन संख्याओं का मतलब'],
  'ezIssues.countsText': [
    'Open: problems that are still there.\nNobody on it: no one has pressed “I’m on it” yet.\nUrgent: high or critical problems. Do these first.\n\nPress a number to see only those.',
    'খোলা: যে সমস্যাগুলো এখনো আছে।\nকেউ দেখছে না: কেউ এখনো “আমি দেখছি” চাপেনি।\nজরুরি: বড় বা গুরুতর সমস্যা। এগুলো আগে করুন।\n\nশুধু সেগুলো দেখতে সংখ্যায় চাপ দিন।',
    'खुले: जो समस्याएँ अभी भी हैं।\nकोई नहीं देख रहा: अभी तक किसी ने “मैं देख रहा हूँ” नहीं दबाया।\nज़रूरी: बड़ी या गंभीर समस्याएँ। इन्हें पहले करें।\n\nसिर्फ़ वही देखने के लिए संख्या दबाएँ।',
  ],
  'ezIssues.onItTitle': ['“I’m on it”', '“আমি দেখছি”', '“मैं देख रहा हूँ”'],
  'ezIssues.onItText': [
    'Tells the team you are looking at this, so two people do not chase the same problem.\n\nIt does not close the problem. Some problems close by themselves when the job works again.',
    'টিমকে জানায় যে আপনি এটা দেখছেন, যাতে দুজন একই সমস্যার পেছনে না ছোটে।\n\nএতে সমস্যা বন্ধ হয় না। কাজটা আবার ঠিকমতো চললে কিছু সমস্যা নিজে থেকেই বন্ধ হয়ে যায়।',
    'टीम को बताता है कि आप इसे देख रहे हैं, ताकि दो लोग एक ही समस्या के पीछे न लगें।\n\nइससे समस्या बंद नहीं होती। काम फिर से ठीक चलने पर कुछ समस्याएँ अपने आप बंद हो जाती हैं।',
  ],
  'ezIssues.details': [
    'More about this problem',
    'এই সমস্যা সম্পর্কে আরও',
    'इस समस्या के बारे में और',
  ],
  'ezIssues.cameFrom': ['Came from', 'কোথা থেকে এসেছে', 'कहाँ से आई'],
  'ezIssues.firstSeenLabel': ['First seen', 'প্রথম দেখা', 'पहली बार दिखी'],
  'ezIssues.lastSeenLabel': ['Last seen', 'শেষ দেখা', 'आख़िरी बार दिखी'],
  'ezIssues.timesLabel': ['Happened', 'কতবার হয়েছে', 'कितनी बार हुई'],
  'ezIssues.sevCritical': ['Critical', 'গুরুতর', 'गंभीर'],
  'ezIssues.sevHigh': ['High', 'বড়', 'बड़ी'],
  'ezIssues.sevMedium': ['Medium', 'মাঝারি', 'मध्यम'],
  'ezIssues.sevLow': ['Low', 'ছোট', 'छोटी'],
  'ezIssues.closedLabel': ['Closed', 'বন্ধ', 'बंद'],
  'ezIssues.noneInFilter': [
    'None of these right now.',
    'এই মুহূর্তে এমন কিছু নেই।',
    'अभी ऐसी कोई नहीं है।',
  ],
  'ezIssues.showAllOpen': ['Show all open', 'সব খোলা দেখান', 'सभी खुली दिखाएँ'],

  // ── Call outcomes: what each one does, for the choice guide ──────────
  // Mirrors CallOutcomeMappingService (CC-2). If a rule changes there,
  // change the sentence here.
  'ezCall.jump': ['Go to outcome', 'ফলাফলে যান', 'नतीजे पर जाएँ'],
  'ezCall.guideConfirmed': [
    'Pick this when the customer says yes, they want the order.\nThe order is confirmed and goes to the warehouse to be packed.',
    'গ্রাহক হ্যাঁ বললে, অর্ডারটি চাইলে এটি বাছুন।\nঅর্ডার কনফার্ম হয় এবং প্যাক করার জন্য ওয়্যারহাউসে যায়।',
    'जब ग्राहक हाँ कहे कि उसे ऑर्डर चाहिए, तब यह चुनें।\nऑर्डर पक्का हो जाता है और पैक होने के लिए गोदाम जाता है।',
  ],
  'ezCall.guideDeclined': [
    'Pick this when the customer says they do not want it.\nThe order is cancelled. We do not call again.',
    'গ্রাহক না চাইলে এটি বাছুন।\nঅর্ডার বাতিল হয়। আমরা আর ফোন করি না।',
    'जब ग्राहक कहे कि उसे नहीं चाहिए, तब यह चुनें।\nऑर्डर रद्द हो जाता है। हम दोबारा फ़ोन नहीं करते।',
  ],
  'ezCall.guideWrongNumber': [
    'Pick this when the person who answered is not the customer.\nThe order is cancelled. We do not call again.',
    'যিনি ফোন ধরেছেন তিনি গ্রাহক না হলে এটি বাছুন।\nঅর্ডার বাতিল হয়। আমরা আর ফোন করি না।',
    'जब फ़ोन उठाने वाला ग्राहक न हो, तब यह चुनें।\nऑर्डर रद्द हो जाता है। हम दोबारा फ़ोन नहीं करते।',
  ],
  'ezCall.guideNoAnswer': [
    'Pick this when the phone rang and nobody picked up.\nWe call again later. After the last allowed try, the order is stopped or the client decides.',
    'ফোন বেজেছে কিন্তু কেউ ধরেনি, তখন এটি বাছুন।\nআমরা পরে আবার ফোন করি। শেষ সুযোগের পরে অর্ডার থেমে যায় অথবা ক্লায়েন্ট সিদ্ধান্ত নেন।',
    'जब घंटी बजी पर किसी ने फ़ोन नहीं उठाया, तब यह चुनें।\nहम बाद में फिर फ़ोन करते हैं। आख़िरी कोशिश के बाद ऑर्डर रुक जाता है या क्लाइंट तय करता है।',
  ],
  'ezCall.guideBusy': [
    'Pick this when the line was busy.\nWe call again a little later. After the last allowed try, the order is stopped or the client decides.',
    'লাইন ব্যস্ত থাকলে এটি বাছুন।\nআমরা একটু পরে আবার ফোন করি। শেষ সুযোগের পরে অর্ডার থেমে যায় অথবা ক্লায়েন্ট সিদ্ধান্ত নেন।',
    'जब लाइन व्यस्त हो, तब यह चुनें।\nहम थोड़ी देर बाद फिर फ़ोन करते हैं। आख़िरी कोशिश के बाद ऑर्डर रुक जाता है या क्लाइंट तय करता है।',
  ],
  'ezCall.guideVoicemail': [
    'Pick this when you left a voice message.\nWe call again later. After the last allowed try, the order is stopped or the client decides.',
    'আপনি ভয়েস মেসেজ রেখে এলে এটি বাছুন।\nআমরা পরে আবার ফোন করি। শেষ সুযোগের পরে অর্ডার থেমে যায় অথবা ক্লায়েন্ট সিদ্ধান্ত নেন।',
    'जब आपने वॉइस संदेश छोड़ा हो, तब यह चुनें।\nहम बाद में फिर फ़ोन करते हैं। आख़िरी कोशिश के बाद ऑर्डर रुक जाता है या क्लाइंट तय करता है।',
  ],
  'ezCall.guideCallback': [
    'Pick this when the customer asks you to call at another time. Set that time below.\nWe call again then. This does not use up a try.',
    'গ্রাহক অন্য সময়ে ফোন করতে বললে এটি বাছুন। নিচে সেই সময় দিন।\nআমরা তখন আবার ফোন করি। এতে কোনো সুযোগ খরচ হয় না।',
    'जब ग्राहक किसी और समय फ़ोन करने को कहे, तब यह चुनें। नीचे वह समय डालें।\nहम तब फिर फ़ोन करते हैं। इसमें कोई कोशिश ख़र्च नहीं होती।',
  ],
  'ezCall.guideTechnical': [
    'Pick this when the call dropped or the phone system failed.\nThe order goes straight back into the queue. This does not use up a try.',
    'কল কেটে গেলে বা ফোন সিস্টেমে সমস্যা হলে এটি বাছুন।\nঅর্ডার সরাসরি আবার কিউতে ফিরে যায়। এতে কোনো সুযোগ খরচ হয় না।',
    'जब कॉल कट जाए या फ़ोन सिस्टम में ख़राबी हो, तब यह चुनें।\nऑर्डर सीधे फिर कतार में चला जाता है। इसमें कोई कोशिश ख़र्च नहीं होती।',
  ],
  'ezCall.guideLanguage': [
    'Pick this when you and the customer could not understand each other.\nThe order goes back into the queue for another agent. This does not use up a try.',
    'আপনি আর গ্রাহক একে অপরের ভাষা বুঝতে না পারলে এটি বাছুন।\nঅর্ডার অন্য এজেন্টের জন্য আবার কিউতে ফিরে যায়। এতে কোনো সুযোগ খরচ হয় না।',
    'जब आप और ग्राहक एक-दूसरे की भाषा न समझ सकें, तब यह चुनें।\nऑर्डर दूसरे एजेंट के लिए फिर कतार में चला जाता है। इसमें कोई कोशिश ख़र्च नहीं होती।',
  ],
  'ezCall.guideSpoke': [
    'Pick this after you have phoned the customer. Write what they said in the box below.\nThe order itself does not change.',
    'গ্রাহককে ফোন করার পরে এটি বাছুন। তিনি কী বললেন তা নিচের ঘরে লিখুন।\nঅর্ডারে কোনো পরিবর্তন হয় না।',
    'ग्राहक को फ़ोन करने के बाद यह चुनें। उन्होंने क्या कहा, नीचे के खाने में लिखें।\nऑर्डर में कोई बदलाव नहीं होता।',
  ],

  // ── Call queue ────────────────────────────────────────────────────────
  'ezQueue.open': ['Open', 'খোলা', 'खुली'],
  'ezQueue.waiting': ['Waiting', 'অপেক্ষায়', 'इंतज़ार में'],
  'ezQueue.withAgent': ['With an agent', 'এজেন্টের কাছে', 'एजेंट के पास'],
  'ezQueue.finished': ['Finished', 'শেষ হয়েছে', 'पूरी हुई'],
  'ezQueue.expired': ['Timed out', 'সময় শেষ', 'समय निकल गया'],
  'ezQueue.all': ['All', 'সব', 'सभी'],
  'ezQueue.statusInfo': [
    'Open: every call still to be made, waiting or with an agent.\nWaiting: nobody has picked it up yet.\nWith an agent: an agent is holding it now.\nFinished: the call was made and an outcome was recorded.\nTimed out: an agent held it too long without calling, so it went back to waiting.\nAll: everything, finished ones included.',
    'খোলা: যে কলগুলো এখনো করা বাকি, অপেক্ষায় বা এজেন্টের কাছে।\nঅপেক্ষায়: এখনো কেউ নেয়নি।\nএজেন্টের কাছে: একজন এজেন্ট এখন এটি ধরে আছেন।\nশেষ হয়েছে: কল করা হয়েছে এবং ফলাফল লেখা হয়েছে।\nসময় শেষ: এজেন্ট কল না করে অনেকক্ষণ ধরে রেখেছিলেন, তাই এটি আবার অপেক্ষায় ফিরে গেছে।\nসব: সবকিছু, শেষ হওয়াগুলোসহ।',
    'खुली: वे सभी कॉल जो अभी करनी बाकी हैं, इंतज़ार में या एजेंट के पास।\nइंतज़ार में: अभी किसी ने नहीं ली।\nएजेंट के पास: एक एजेंट अभी इसे पकड़े हुए है।\nपूरी हुई: कॉल हो गई और नतीजा दर्ज हो गया।\nसमय निकल गया: एजेंट ने बिना कॉल किए बहुत देर रखी, इसलिए यह फिर इंतज़ार में चली गई।\nसभी: सब कुछ, पूरी हुई कॉल समेत।',
  ],

  // ── Awaiting confirmation ─────────────────────────────────────────────
  'ezAwaiting.sendInfo': [
    'Puts the chosen orders into the call queue.\nAn agent phones each customer, and the order is confirmed only if the customer says yes.',
    'বাছাই করা অর্ডারগুলো কল কিউতে যায়।\nএকজন এজেন্ট প্রতিটি গ্রাহককে ফোন করেন, এবং গ্রাহক হ্যাঁ বললে তবেই অর্ডার কনফার্ম হয়।',
    'चुने हुए ऑर्डर कॉल कतार में जाते हैं।\nएक एजेंट हर ग्राहक को फ़ोन करता है, और ग्राहक के हाँ कहने पर ही ऑर्डर पक्का होता है।',
  ],

  // ── Handover bench ────────────────────────────────────────────────────
  'ezHandover.countLabel': [
    'scanned this session',
    'এই সেশনে স্ক্যান হয়েছে',
    'इस सत्र में स्कैन हुए',
  ],
  'ezHandover.lastScan': ['Last scan', 'শেষ স্ক্যান', 'पिछला स्कैन'],
  'ezHandover.scanned': ['Scanned', 'স্ক্যান হয়েছে', 'स्कैन हुआ'],
  'ezHandover.dispatched': ['Dispatched', 'ডিসপ্যাচ হয়েছে', 'रवाना हुआ'],

  // ── Small shared labels ───────────────────────────────────────────────
  'easy.hours': ['{n}h', '{n} ঘণ্টা', '{n} घंटे'],
  'easy.cod': ['COD', 'সিওডি', 'सीओडी'],
  'easy.waitingCount': ['{n} waiting', '{n}টি অপেক্ষায়', '{n} प्रतीक्षा में'],

  'easy.aboutThisList': ['About this list', 'এই তালিকা সম্পর্কে', 'इस सूची के बारे में'],
  'easy.yes': ['Yes', 'হ্যাঁ', 'हाँ'],
  'easy.no': ['No', 'না', 'नहीं'],
  'ezReceive.details': ['Receipt details', 'রিসিটের বিবরণ', 'रसीद का विवरण'],
  'easy.selectedCount': ['{n} selected', '{n}টি নির্বাচিত', '{n} चुने गए'],
  'easy.selectAll': ['Select all {n}', 'সব {n}টি নির্বাচন করুন', 'सभी {n} चुनें'],
  'easy.clearSelection': ['Clear selection', 'নির্বাচন মুছুন', 'चयन हटाएँ'],
  'easy.awb': ['AWB', 'এডব্লিউবি', 'एडब्ल्यूबी'],

  // ── Needs attention (/nsa) ────────────────────────────────────────────
  'ezNsa.night1': ['1st night', '1ম রাত', 'पहली रात'],
  'ezNsa.night2': ['2nd night', '2য় রাত', 'दूसरी रात'],
  'ezNsa.night3': ['3rd night or more', '3য় রাত বা বেশি', 'तीसरी रात या ज़्यादा'],
  'ezNsa.call': ['Call {phone}', '{phone} নম্বরে কল করুন', '{phone} पर कॉल करें'],
  'ezNsa.nightInfo': [
    'How many evenings the parcel has been out for delivery without being delivered.\n\n1st night: it went out today and did not arrive.\n2nd night: still out a day later.\n3rd night or more: chase these first.',
    'পার্সেলটি ডেলিভারির জন্য বেরিয়ে কত সন্ধ্যা ধরে পৌঁছায়নি।\n\n1ম রাত: আজ বেরিয়েছে, পৌঁছায়নি।\n2য় রাত: এক দিন পরও বাইরে।\n3য় রাত বা বেশি: এগুলো আগে দেখুন।',
    'पार्सल डिलीवरी के लिए निकलकर कितनी शामों से नहीं पहुँचा।\n\nपहली रात: आज निकला, नहीं पहुँचा।\nदूसरी रात: एक दिन बाद भी बाहर।\nतीसरी रात या ज़्यादा: इन्हें पहले देखें।',
  ],

  // ── Failed deliveries (/delivery-actions) ─────────────────────────────
  'ezDelivery.shown': ['{n} shown', '{n}টি দেখানো হচ্ছে', '{n} दिख रहे हैं'],
  'ezDelivery.stPending': ['Waiting', 'অপেক্ষায়', 'प्रतीक्षा में'],
  'ezDelivery.stApproved': ['Approved', 'অনুমোদিত', 'स्वीकृत'],
  'ezDelivery.stExecuted': ['Sent', 'পাঠানো হয়েছে', 'भेजा गया'],
  'ezDelivery.stFailed': ['Failed', 'ব্যর্থ', 'विफल'],
  'ezDelivery.stRejected': ['Declined', 'প্রত্যাখ্যাত', 'अस्वीकृत'],
  'ezDelivery.stExpired': ['Timed out', 'সময় শেষ', 'समय निकल गया'],
  'ezDelivery.isPending': [
    'Nobody has decided yet.',
    'এখনো কেউ সিদ্ধান্ত নেননি।',
    'अभी किसी ने फ़ैसला नहीं किया।',
  ],
  'ezDelivery.isApproved': [
    'Approved. The action has not finished yet.',
    'অনুমোদিত। কাজটি এখনো শেষ হয়নি।',
    'स्वीकृत। काम अभी पूरा नहीं हुआ।',
  ],
  'ezDelivery.isExecuted': [
    'Approved and sent: it reached the courier, or the call queue.',
    'অনুমোদিত এবং পাঠানো হয়েছে: এটি কুরিয়ার বা কল কিউতে পৌঁছেছে।',
    'स्वीकृत और भेजा गया: यह कूरियर या कॉल कतार तक पहुँच गया।',
  ],
  'ezDelivery.isFailed': [
    'Approved, but the courier refused it. The reason is shown in red.',
    'অনুমোদিত, কিন্তু কুরিয়ার তা নেয়নি। কারণ লাল রঙে দেখানো আছে।',
    'स्वीकृत, पर कूरियर ने मना कर दिया। कारण लाल रंग में दिखता है।',
  ],
  'ezDelivery.isRejected': [
    'Declined. The client sees the reason.',
    'প্রত্যাখ্যাত। ক্লায়েন্ট কারণটি দেখতে পান।',
    'अस्वीकृत। क्लाइंट को कारण दिखता है।',
  ],
  'ezDelivery.isExpired': [
    'The client did not decide in time, so the request closed by itself.',
    'ক্লায়েন্ট সময়মতো সিদ্ধান্ত নেননি, তাই অনুরোধটি নিজে থেকেই বন্ধ হয়েছে।',
    'क्लाइंट ने समय पर फ़ैसला नहीं किया, इसलिए अनुरोध अपने आप बंद हो गया।',
  ],
  'ezDelivery.doReattempt': [
    'Reaches the courier. A van goes out to try the delivery again.',
    'কুরিয়ারের কাছে যায়। ডেলিভারির জন্য আবার একটি ভ্যান বের হয়।',
    'कूरियर तक जाता है। डिलीवरी के लिए फिर से एक वैन निकलती है।',
  ],
  'ezDelivery.doReturn': [
    'Reaches the courier. The parcel comes back to us and the sale ends.',
    'কুরিয়ারের কাছে যায়। পার্সেলটি আমাদের কাছে ফিরে আসে এবং বিক্রি শেষ হয়।',
    'कूरियर तक जाता है। पार्सल हमारे पास लौटता है और बिक्री समाप्त हो जाती है।',
  ],

  // ── Warehouse hub (/warehouse) ────────────────────────────────────────
  'ezWh.returns': ['Returns (RTO)', 'রিটার্ন (RTO)', 'वापसी (RTO)'],

  // ── Tickets (/tickets/[id]) ───────────────────────────────────────────
  'ezTicket.helpRefund': [
    'We agree with the client and pay them back. You type the amount, and it is added to the client’s wallet when you save the decision.',
    'আমরা ক্লায়েন্টের সঙ্গে একমত এবং টাকা ফেরত দিই। আপনি পরিমাণ লিখবেন, এবং সিদ্ধান্ত সেভ করলে তা ক্লায়েন্টের ওয়ালেটে যোগ হবে।',
    'हम क्लाइंट से सहमत हैं और पैसे लौटाते हैं। आप रकम लिखते हैं, और फ़ैसला सेव करने पर वह क्लाइंट के वॉलेट में जुड़ जाती है।',
  ],
  'ezTicket.helpReturned': [
    'The goods were sent back to the client. No money is paid.',
    'পণ্য ক্লায়েন্টের কাছে ফেরত পাঠানো হয়েছে। কোনো টাকা দেওয়া হয় না।',
    'सामान क्लाइंट को वापस भेज दिया गया। कोई पैसा नहीं दिया जाता।',
  ],
  'ezTicket.helpWriteOff': [
    'The client agreed to take the loss. No money is paid and nothing goes back.',
    'ক্লায়েন্ট ক্ষতি মেনে নিয়েছেন। কোনো টাকা দেওয়া হয় না এবং কিছু ফেরত যায় না।',
    'क्लाइंट ने नुकसान मान लिया। कोई पैसा नहीं दिया जाता और कुछ वापस नहीं जाता।',
  ],
  'ezTicket.helpRejected': [
    'We do not agree with the claim. The ticket closes with no refund.',
    'আমরা দাবিটির সঙ্গে একমত নই। টিকিটটি কোনো রিফান্ড ছাড়াই বন্ধ হয়।',
    'हम दावे से सहमत नहीं हैं। टिकट बिना रिफ़ंड के बंद होता है।',
  ],

  // ── Stock adjustments (/inventory/adjustments) ────────────────────────
  'ezAdjust.reason.COUNTING_ERROR': ['Counting error', 'গণনার ভুল', 'गिनती की गलती'],
  'ezAdjust.reason.DAMAGED_IN_WAREHOUSE': [
    'Damaged in the warehouse',
    'ওয়্যারহাউসে নষ্ট হয়েছে',
    'वेयरहाउस में खराब हुआ',
  ],
  'ezAdjust.reason.DAMAGED_ON_ARRIVAL': [
    'Damaged on arrival',
    'পৌঁছানোর সময় নষ্ট ছিল',
    'पहुँचने पर खराब था',
  ],
  'ezAdjust.reason.LOST': ['Lost', 'হারিয়ে গেছে', 'खो गया'],
  'ezAdjust.reason.FOUND_EXTRA': ['Found extra', 'বাড়তি পাওয়া গেছে', 'अतिरिक्त मिला'],
  'ezAdjust.reason.EXPIRED': ['Expired', 'মেয়াদ শেষ', 'समय-सीमा समाप्त'],
  'ezAdjust.reason.RECALLED': ['Recalled', 'ফেরত ডাকা হয়েছে', 'वापस बुलाया गया'],
  'ezAdjust.reason.RETURNED_TO_SELLER': [
    'Returned to the client',
    'ক্লায়েন্টকে ফেরত দেওয়া হয়েছে',
    'क्लाइंट को लौटाया गया',
  ],
  'ezAdjust.reason.OTHER': ['Other', 'অন্যান্য', 'अन्य'],

  // ── Capacity (/system/capacity) ───────────────────────────────────────
  'ezCapacity.of': ['of {n} {unit}', '{n} {unit}-এর মধ্যে', '{n} {unit} में से'],

  // ── Withdrawals (/withdrawals) ────────────────────────────────────────
  'ezWithdraw.helpPaid': [
    'Use this after the money has been sent and the remittance is recorded. It only links this request to that remittance and closes it. No money moves here.',
    'টাকা পাঠানো এবং রেমিট্যান্স রেকর্ড করার পরে এটি ব্যবহার করুন। এটি শুধু এই অনুরোধকে সেই রেমিট্যান্সের সঙ্গে যুক্ত করে বন্ধ করে। এখানে কোনো টাকা সরে না।',
    'पैसे भेजने और रेमिटेंस दर्ज करने के बाद इसे इस्तेमाल करें। यह केवल इस अनुरोध को उस रेमिटेंस से जोड़कर बंद करता है। यहाँ कोई पैसा नहीं चलता।',
  ],
  'ezWithdraw.helpReject': [
    'The request is closed without paying. The client sees your reason, and the amount is free in their wallet again.',
    'টাকা না দিয়েই অনুরোধটি বন্ধ হয়। ক্লায়েন্ট আপনার কারণটি দেখতে পান, এবং পরিমাণটি তাদের ওয়ালেটে আবার মুক্ত হয়।',
    'अनुरोध बिना भुगतान के बंद होता है। क्लाइंट को आपका कारण दिखता है, और रकम उनके वॉलेट में फिर से उपलब्ध हो जाती है।',
  ],

  // ── Money screens ─────────────────────────────────────────────────────
  'ezMoney.account': ['{n} account', '{n}টি অ্যাকাউন্ট', '{n} खाता'],
  'ezMoney.accounts': ['{n} accounts', '{n}টি অ্যাকাউন্ট', '{n} खाते'],

  // ── Manual placement (/manual-placement) ──────────────────────────────
  'ezPlacement.whyInfo': [
    'Why no connected courier took this parcel. The courier’s own words, when there are any, are shown under the reason.',
    'কোনো সংযুক্ত কুরিয়ার কেন এই পার্সেল নেয়নি। কুরিয়ারের নিজের কথা থাকলে কারণের নিচে দেখানো হয়।',
    'किसी जुड़े हुए कूरियर ने यह पार्सल क्यों नहीं लिया। कूरियर के अपने शब्द, अगर हों, कारण के नीचे दिखते हैं।',
  ],
  'ezPlacement.whyNotServed': [
    'The courier does not deliver to this address or PIN code.',
    'কুরিয়ার এই ঠিকানা বা পিন কোডে ডেলিভারি দেয় না।',
    'कूरियर इस पते या पिन कोड पर डिलीवरी नहीं करता।',
  ],
  'ezPlacement.whyRefused': [
    'The courier said no when the waybill was asked for. Read its message.',
    'ওয়েবিল চাওয়ার সময় কুরিয়ার না বলেছে। তার বার্তাটি পড়ুন।',
    'वेबिल माँगने पर कूरियर ने मना कर दिया। उसका संदेश पढ़ें।',
  ],
  'ezPlacement.whyUnreachable': [
    'The courier’s system did not answer.',
    'কুরিয়ারের সিস্টেম সাড়া দেয়নি।',
    'कूरियर के सिस्टम ने जवाब नहीं दिया।',
  ],
  'ezPlacement.whyByHand': [
    'A staff member took it off its courier so it can be placed again.',
    'একজন কর্মী এটিকে তার কুরিয়ার থেকে সরিয়েছেন যাতে আবার দেওয়া যায়।',
    'एक कर्मचारी ने इसे इसके कूरियर से हटाया ताकि इसे फिर से रखा जा सके।',
  ],
  'ezPlacement.afterNeedsPicking': [
    'The products are not picked yet. After you add the waybill, the parcel still has to be picked and packed.',
    'পণ্য এখনো পিক করা হয়নি। ওয়েবিল যোগ করার পরও পার্সেলটি পিক ও প্যাক করতে হবে।',
    'सामान अभी उठाया नहीं गया है। वेबिल जोड़ने के बाद भी पार्सल को पिक और पैक करना होगा।',
  ],
  'ezPlacement.afterReady': [
    'The parcel is already packed and waiting. After you add the waybill it can go out.',
    'পার্সেলটি আগেই প্যাক করা আছে। ওয়েবিল যোগ করার পর এটি বের হতে পারে।',
    'पार्सल पहले से पैक है। वेबिल जोड़ने के बाद यह निकल सकता है।',
  ],

  // ── Courier decisions (/courier-decisions) ────────────────────────────
  'ezCourier.day': ['{n} day', '{n} দিন', '{n} दिन'],
  'ezCourier.days': ['{n} days', '{n} দিন', '{n} दिन'],
  'ezCourier.hours': ['{n}h', '{n} ঘণ্টা', '{n} घंटे'],
  'ezCourier.cod': ['COD', 'সিওডি', 'सीओडी'],
  'ezCourier.waitingCount': ['{n} waiting', '{n}টি অপেক্ষায়', '{n} प्रतीक्षा में'],
  'ezCourier.pickInfo': [
    'Press a carrier to book the parcel with it.\n\nIt is booked straight away. There is no second step, so check the row first.\n\nThe price is on the right. The delivery days are under the name. The cheapest and the fastest are marked.',
    'পার্সেলটি বুক করতে একটি ক্যারিয়ারে চাপ দিন।\n\nসঙ্গে সঙ্গে বুক হয়ে যায়। দ্বিতীয় কোনো ধাপ নেই, তাই আগে সারিটি দেখে নিন।\n\nদাম ডান পাশে। ডেলিভারির দিন নামের নিচে। সবচেয়ে সস্তা ও সবচেয়ে দ্রুতটি চিহ্নিত আছে।',
    'पार्सल बुक करने के लिए किसी कैरियर को दबाएँ।\n\nयह तुरंत बुक हो जाता है। कोई दूसरा चरण नहीं है, इसलिए पहले पंक्ति देख लें।\n\nकीमत दाईं ओर है। डिलीवरी के दिन नाम के नीचे हैं। सबसे सस्ता और सबसे तेज़ चिह्नित हैं।',
  ],

  // ── Re-attempt requests (/reattempt-requests) ─────────────────────────
  'ezReattempt.reasonLabel': [
    'Why the client is asking',
    'ক্লায়েন্ট কেন চাইছেন',
    'क्लाइंट क्यों कह रहे हैं',
  ],
  'ezReattempt.approveInfo': [
    'The order goes back into the call queue and an agent phones the customer again.\n\nYou choose how many extra calls to allow.\n\nThe customer already said no once, so read the client’s reason first.',
    'অর্ডারটি আবার কল কিউতে যায় এবং একজন এজেন্ট গ্রাহককে আবার ফোন করেন।\n\nকতগুলো অতিরিক্ত কল দেওয়া হবে তা আপনি ঠিক করেন।\n\nগ্রাহক একবার না বলেছেন, তাই আগে ক্লায়েন্টের কারণটি পড়ুন।',
    'ऑर्डर फिर से कॉल कतार में जाता है और एक एजेंट ग्राहक को दोबारा फ़ोन करता है।\n\nकितनी अतिरिक्त कॉल दी जाएँ, यह आप चुनते हैं।\n\nग्राहक एक बार मना कर चुका है, इसलिए पहले क्लाइंट का कारण पढ़ें।',
  ],

  // ── Pick by name instead of typing an id (stock forms) ────────────────
  'ezPick.client': ['Client', 'ক্লায়েন্ট', 'क्लाइंट'],
  'ezPick.product': ['Product', 'পণ্য', 'उत्पाद'],
  'ezPick.bin': ['Shelf (bin)', 'তাক (বিন)', 'शेल्फ़ (बिन)'],
  'ezPick.warehouse': ['Warehouse', 'গুদাম', 'गोदाम'],
  'ezPick.warehouseHint': [
    'Only used to list its shelves.',
    'শুধু এর তাকগুলো দেখাতে লাগে।',
    'केवल इसकी शेल्फ़ दिखाने के लिए।',
  ],
  'ezPick.choose': ['Choose…', 'বেছে নিন…', 'चुनें…'],
  'ezPick.typed': ['Typed by hand', 'হাতে লেখা', 'हाथ से लिखा गया'],
  'ezPick.byHand': ['Type the id instead', 'এর বদলে আইডি লিখুন', 'इसके बजाय आईडी लिखें'],
  'ezPick.warehouseFirst': [
    'Choose the warehouse first.',
    'আগে গুদাম বেছে নিন।',
    'पहले गोदाम चुनें।',
  ],
  'ezPick.findProduct': ['Find the product', 'পণ্য খুঁজুন', 'उत्पाद खोजें'],
  'ezPick.findHint': [
    'Type a name, SKU or barcode.',
    'নাম, SKU বা বারকোড লিখুন।',
    'नाम, SKU या बारकोड लिखें।',
  ],
  'ezPick.searching': ['Searching…', 'খোঁজা হচ্ছে…', 'खोज रहे हैं…'],
  'ezPick.noMatch': ['Nothing matches.', 'কিছু মেলেনি।', 'कुछ नहीं मिला।'],
  'ezPick.change': ['Change', 'বদলান', 'बदलें'],
  'ezPick.batch': ['Batch', 'ব্যাচ', 'बैच'],
  'ezPick.staff': ['Staff member', 'স্টাফ সদস্য', 'स्टाफ़ सदस्य'],
  'ezPick.store': ['Member store', 'মেম্বার স্টোর', 'मेंबर स्टोर'],
  'ezPick.shelfFirst': ['Choose the shelf first.', 'আগে তাক বেছে নিন।', 'पहले शेल्फ़ चुनें।'],
  'ezPick.noBatchHere': [
    'Nothing of this product is on that shelf. Type the batch id below.',
    'ওই তাকে এই পণ্যের কিছু নেই। নিচে ব্যাচ আইডি লিখুন।',
    'उस शेल्फ़ पर इस उत्पाद का कुछ नहीं है। नीचे बैच आईडी लिखें।',
  ],
  'ezPick.onShelf': ['{n} on the shelf', 'তাকে {n}টি', 'शेल्फ़ पर {n}'],
});
