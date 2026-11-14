'use client';

import type { ReactElement } from 'react';
import type { Locale } from '@skydrop/ui/app/i18n';
import { useLocale } from '@/i18n/client';

/**
 * Plain words for the status codes the API sends.
 *
 * Many screens printed the raw code lower-cased ("in_progress" became
 * "in progress"), which stays English whatever language the console is in
 * and is not always a word a person would use. This is ONE table of the
 * codes those screens show, in English, Bangla and Hindi.
 *
 * A code that is not in the table falls back to its English words with a
 * capital letter, so a new code added on the server is still readable and
 * never blank. Add it here when you meet one.
 *
 * Display only: nothing reads these labels back.
 */
type Row = readonly [en: string, bn: string, hi: string];

const CODES: Readonly<Record<string, Row>> = {
  // ── shared states ──
  NEW: ['New', 'নতুন', 'नया'],
  // ── couriers and bank book actions ──
  DELHIVERY: ['Delhivery', 'Delhivery', 'Delhivery'],
  SHIPROCKET: ['Shiprocket', 'Shiprocket', 'Shiprocket'],
  RECONCILED: ['Reconciled', 'মিলিয়ে দেখা হয়েছে', 'मिलान किया गया'],
  SELLER_CASH_RECLASSIFIED: [
    'Client cash reclassified',
    'ক্লায়েন্টের টাকা পুনঃশ্রেণীবদ্ধ',
    'क्लाइंट की रकम पुनर्वर्गीकृत',
  ],
  // ── courier conversations ──
  WAITING_US: ['Waiting for us', 'আমাদের অপেক্ষায়', 'हमारी प्रतीक्षा में'],
  WAITING_COURIER: ['Waiting for the courier', 'কুরিয়ারের অপেক্ষায়', 'कूरियर की प्रतीक्षा में'],
  // ── leads ──
  CONTACTED: ['Contacted', 'যোগাযোগ হয়েছে', 'संपर्क किया गया'],
  QUALIFIED: ['Qualified', 'যোগ্য', 'योग्य'],
  CONVERTED: ['Converted', 'রূপান্তরিত', 'परिवर्तित'],
  DECLINED: ['Declined', 'প্রত্যাখ্যাত', 'अस्वीकृत'],
  SPAM: ['Spam', 'স্প্যাম', 'स्पैम'],
  OPEN: ['Open', 'খোলা', 'खुला'],
  DRAFT: ['Draft', 'খসড়া', 'ड्राफ़्ट'],
  PENDING: ['Waiting', 'অপেক্ষায়', 'प्रतीक्षा में'],
  SCHEDULED: ['Scheduled', 'নির্ধারিত', 'निर्धारित'],
  REQUESTED: ['Requested', 'অনুরোধ করা হয়েছে', 'अनुरोध किया गया'],
  IN_PROGRESS: ['In progress', 'চলছে', 'जारी है'],
  IN_FLIGHT: ['Sending now', 'এখন পাঠানো হচ্ছে', 'अभी भेजा जा रहा है'],
  ASSIGNED: ['With an agent', 'এজেন্টের কাছে', 'एजेंट के पास'],
  APPROVED: ['Approved', 'অনুমোদিত', 'स्वीकृत'],
  REJECTED: ['Rejected', 'প্রত্যাখ্যাত', 'अस्वीकृत'],
  EXECUTED: ['Done', 'সম্পন্ন', 'पूरा हुआ'],
  COMPLETED: ['Finished', 'শেষ হয়েছে', 'पूरा हुआ'],
  CONFIRMED: ['Confirmed', 'নিশ্চিত', 'पुष्ट'],
  CLOSED: ['Closed', 'বন্ধ', 'बंद'],
  CANCELLED: ['Cancelled', 'বাতিল', 'रद्द'],
  EXPIRED: ['Timed out', 'সময় শেষ', 'समय निकल गया'],
  USED: ['Used', 'ব্যবহৃত', 'इस्तेमाल हुआ'],
  PAUSED: ['Paused', 'থামানো', 'रोका गया'],
  PENDING_SELLER_APPROVAL: [
    'Waiting for the client',
    'ক্লায়েন্টের অপেক্ষায়',
    'क्लाइंट की प्रतीक्षा में',
  ],
  FAILED: ['Failed', 'ব্যর্থ', 'विफल'],
  ABANDONED: ['Given up', 'ছেড়ে দেওয়া হয়েছে', 'छोड़ दिया गया'],
  ENDPOINT_DISABLED: ['Address switched off', 'ঠিকানা বন্ধ করা', 'पता बंद है'],
  SENT: ['Sent', 'পাঠানো হয়েছে', 'भेजा गया'],
  DELIVERED: ['Delivered', 'ডেলিভারি হয়েছে', 'डिलीवर हुआ'],
  PRINTED: ['Printed', 'প্রিন্ট হয়েছে', 'प्रिंट हुआ'],
  DISPATCHED: ['Dispatched', 'ডিসপ্যাচ হয়েছে', 'रवाना हुआ'],
  ACTIVE: ['Active', 'সক্রিয়', 'सक्रिय'],
  INACTIVE: ['Not active', 'নিষ্ক্রিয়', 'निष्क्रिय'],
  SUSPENDED: ['Suspended', 'স্থগিত', 'निलंबित'],
  ARRIVING: ['Being counted', 'গণনা চলছে', 'गिनती जारी है'],
  DISCREPANCY: ['Counts do not match', 'গণনা মেলেনি', 'गिनती मेल नहीं खाती'],
  // ── stock units ──
  IN_STOCK: ['In stock', 'স্টকে আছে', 'स्टॉक में'],
  PICKED: ['Picked', 'পিক করা হয়েছে', 'पिक हुआ'],
  PACKED: ['Packed', 'প্যাক করা হয়েছে', 'पैक हुआ'],
  RTO_RECEIVED: ['Return received', 'রিটার্ন গ্রহণ করা হয়েছে', 'वापसी प्राप्त'],
  WRITTEN_OFF: ['Written off', 'বাদ দেওয়া হয়েছে', 'बट्टे खाते में'],
  LOST: ['Lost', 'হারিয়ে গেছে', 'खो गया'],
  RETURNED_TO_SELLER: ['Returned to the client', 'ক্লায়েন্টকে ফেরত', 'क्लाइंट को लौटाया'],
  // ── stock movements ──
  RECEIVING: ['Received', 'গ্রহণ', 'प्राप्ति'],
  PUT_AWAY: ['Put on the shelf', 'তাকে রাখা', 'शेल्फ़ पर रखा'],
  PICK: ['Picked for an order', 'অর্ডারের জন্য পিক', 'ऑर्डर के लिए पिक'],
  PACK_CONFIRM: ['Packed', 'প্যাক', 'पैक'],
  PACK_REVERSED: ['Packing undone', 'প্যাক বাতিল', 'पैकिंग वापस'],
  DISPATCH: ['Dispatched', 'ডিসপ্যাচ', 'रवानगी'],
  RETURN_RECEIVE: ['Return received', 'রিটার্ন গ্রহণ', 'वापसी प्राप्त'],
  RETURN_RESTOCK: ['Return put back in stock', 'রিটার্ন স্টকে ফেরত', 'वापसी स्टॉक में'],
  ADJUSTMENT_INCREASE: ['Correction: added', 'সংশোধন: যোগ', 'सुधार: जोड़ा'],
  ADJUSTMENT_DECREASE: ['Correction: removed', 'সংশোধন: বাদ', 'सुधार: घटाया'],
  TRANSFER_OUT: ['Moved out', 'বাইরে সরানো', 'बाहर भेजा'],
  TRANSFER_IN: ['Moved in', 'ভেতরে আনা', 'अंदर आया'],
  CYCLE_COUNT_ADJUST: ['Count correction', 'গণনার সংশোধন', 'गिनती का सुधार'],
  EXPIRY_WRITE_OFF: ['Expired, written off', 'মেয়াদ শেষ, বাদ', 'समय-सीमा समाप्त, बट्टे खाते'],
  // ── stock counts ──
  FULL: ['Whole warehouse', 'পুরো ওয়্যারহাউস', 'पूरा वेयरहाउस'],
  ZONE: ['One zone', 'একটি জোন', 'एक ज़ोन'],
  SAMPLE: ['A sample', 'নমুনা', 'नमूना'],
  SKU_TARGETED: ['Chosen products', 'নির্বাচিত পণ্য', 'चुने हुए उत्पाद'],
  ABC_CLASSIFICATION: ['By A-B-C class', 'A-B-C শ্রেণি অনুযায়ী', 'A-B-C श्रेणी के अनुसार'],
  // ── call outcomes ──
  CUSTOMER_DECLINED: ['Customer said no', 'গ্রাহক না বলেছেন', 'ग्राहक ने मना किया'],
  WRONG_NUMBER: ['Wrong number', 'ভুল নম্বর', 'गलत नंबर'],
  NO_ANSWER: ['No answer', 'কেউ ধরেননি', 'कोई जवाब नहीं'],
  BUSY: ['Busy', 'ব্যস্ত', 'व्यस्त'],
  VOICEMAIL_LEFT: ['Voicemail left', 'ভয়েসমেইল রাখা হয়েছে', 'वॉइसमेल छोड़ा'],
  CALLBACK_REQUESTED: ['Asked for a call back', 'আবার কল করতে বলেছেন', 'दोबारा कॉल माँगी'],
  TECHNICAL_FAILURE: ['Call could not connect', 'কল সংযোগ হয়নি', 'कॉल नहीं लग सकी'],
  LANGUAGE_BARRIER: ['Language problem', 'ভাষার সমস্যা', 'भाषा की समस्या'],
  SPOKE_TO_CUSTOMER: ['Spoke to the customer', 'গ্রাহকের সঙ্গে কথা হয়েছে', 'ग्राहक से बात हुई'],
  // ── courier scans ──
  IN_TRANSIT: ['On the way', 'পথে আছে', 'रास्ते में'],
  OUT_FOR_DELIVERY: ['Out for delivery', 'ডেলিভারির জন্য বেরিয়েছে', 'डिलीवरी के लिए निकला'],
  DELIVERY_ATTEMPTED: [
    'Delivery tried, not handed over',
    'ডেলিভারির চেষ্টা হয়েছে, দেওয়া যায়নি',
    'डिलीवरी की कोशिश हुई, दिया नहीं जा सका',
  ],
  RTO_INITIATED: ['Return started', 'রিটার্ন শুরু হয়েছে', 'वापसी शुरू हुई'],
  RTO_IN_TRANSIT: ['Coming back to us', 'আমাদের কাছে ফিরছে', 'हमारे पास लौट रहा है'],
  RTO_DELIVERED: ['Returned to us', 'আমাদের কাছে ফেরত এসেছে', 'हमारे पास लौट आया'],
  DAMAGED: ['Damaged', 'নষ্ট', 'खराब'],
  // ── why a delivery failed ──
  CUSTOMER_UNAVAILABLE: ['Customer was not there', 'গ্রাহক ছিলেন না', 'ग्राहक मौजूद नहीं था'],
  CUSTOMER_PHONE_UNREACHABLE: [
    'Customer’s phone could not be reached',
    'গ্রাহকের ফোনে পাওয়া যায়নি',
    'ग्राहक का फ़ोन नहीं लगा',
  ],
  ADDRESS_NOT_FOUND: ['Address not found', 'ঠিকানা খুঁজে পাওয়া যায়নি', 'पता नहीं मिला'],
  ADDRESS_INCOMPLETE: ['Address not complete', 'ঠিকানা অসম্পূর্ণ', 'पता अधूरा है'],
  ADDRESS_OUT_OF_DELIVERY_AREA: [
    'Address outside the delivery area',
    'ঠিকানা ডেলিভারি এলাকার বাইরে',
    'पता डिलीवरी क्षेत्र से बाहर',
  ],
  CUSTOMER_REFUSED: [
    'Customer refused the parcel',
    'গ্রাহক পার্সেল নেননি',
    'ग्राहक ने पार्सल लेने से मना किया',
  ],
  PAYMENT_REFUSED: [
    'Customer refused to pay',
    'গ্রাহক টাকা দিতে রাজি হননি',
    'ग्राहक ने भुगतान से मना किया',
  ],
  BAD_WEATHER: ['Bad weather', 'খারাপ আবহাওয়া', 'खराब मौसम'],
  CUSTOMER_NOT_AVAILABLE_AT_TIME: [
    'Customer not free at that time',
    'সেই সময়ে গ্রাহক ছিলেন না',
    'उस समय ग्राहक उपलब्ध नहीं था',
  ],
  DAMAGED_PACKAGE: ['Parcel damaged', 'পার্সেল নষ্ট', 'पार्सल खराब'],
  OTHER: ['Other', 'অন্যান্য', 'अन्य'],
  // ── order charges ──
  BASE_SHIPPING: ['Shipping', 'শিপিং', 'शिपिंग'],
  COD_FEE: ['COD fee', 'সিওডি ফি', 'सीओडी शुल्क'],
  FUEL_SURCHARGE: ['Fuel surcharge', 'জ্বালানি সারচার্জ', 'ईंधन अधिभार'],
  REMOTE_AREA_FEE: ['Remote area fee', 'দূরবর্তী এলাকার ফি', 'दूरस्थ क्षेत्र शुल्क'],
  RTO_FEE: ['Return fee', 'রিটার্ন ফি', 'वापसी शुल्क'],
  WEIGHT_DISPUTE_FEE: ['Weight dispute fee', 'ওজন বিরোধ ফি', 'वज़न विवाद शुल्क'],
  RESHIPMENT_FEE: ['Re-shipping fee', 'পুনরায় শিপিং ফি', 'दोबारा शिपिंग शुल्क'],
  GST: ['GST', 'জিএসটি', 'जीएसटी'],
  ADJUSTMENT: ['Correction', 'সংশোধন', 'सुधार'],
  REFUND: ['Refund', 'রিফান্ড', 'रिफ़ंड'],
  ESTIMATED: ['Estimated', 'আনুমানিক', 'अनुमानित'],
  FINAL: ['Final', 'চূড়ান্ত', 'अंतिम'],
  DISPUTED: ['Disputed', 'বিরোধপূর্ণ', 'विवादित'],
  ADJUSTED: ['Corrected', 'সংশোধিত', 'सुधारा गया'],
  // ── where and how ──
  PRODUCTION: ['Live', 'লাইভ', 'लाइव'],
  LIVE: ['Live', 'লাইভ', 'लाइव'],
  STAGING: ['Test', 'টেস্ট', 'टेस्ट'],
  SANDBOX: ['Test', 'টেস্ট', 'टेस्ट'],
  TEST: ['Test', 'টেস্ট', 'टेस्ट'],
  EMAIL: ['Email', 'ইমেইল', 'ईमेल'],
  PORTAL: ['Courier website', 'কুরিয়ারের ওয়েবসাইট', 'कूरियर की वेबसाइट'],
  PHONE: ['Phone', 'ফোন', 'फ़ोन'],
  MANUAL: ['By hand', 'হাতে', 'हाथ से'],
};

const INDEX: Readonly<Record<Locale, 0 | 1 | 2>> = { en: 0, bn: 1, hi: 2 } as Readonly<
  Record<Locale, 0 | 1 | 2>
>;

/** "IN_PROGRESS" → "In progress": the fallback for a code not in the table. */
function words(code: string): string {
  const lower = code.replaceAll('_', ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The label for one code in one language. Never blank for a non-empty code. */
export function codeLabel(code: string | null | undefined, locale: Locale): string {
  if (code === null || code === undefined || code === '') return '—';
  const row = CODES[code.toUpperCase()];
  if (row === undefined) return words(code);
  return row[INDEX[locale] ?? 0] ?? row[0];
}

/** For a string prop (a chip's `label`, an `<option>`): `const code = useCodeLabel()`. */
export function useCodeLabel(): (code: string | null | undefined) => string {
  const locale = useLocale();
  return (code) => codeLabel(code, locale);
}

/** For JSX children: `<Code value={row.status} />`. */
export function Code({ value }: { readonly value: string | null | undefined }): ReactElement {
  const locale = useLocale();
  return <>{codeLabel(value, locale)}</>;
}
