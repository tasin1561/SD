import { defineMessages } from '../define';

/**
 * The "easy pages" pieces: the "i" info button and the plain-words
 * explanations that moved off the page into a bubble. `[en, bn, hi]`.
 */
export const easy = defineMessages({
  'easy.close': ['Close', 'বন্ধ করুন', 'बंद करें'],
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
});
