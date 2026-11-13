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
});
