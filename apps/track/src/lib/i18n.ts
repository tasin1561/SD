/**
 * apps/track i18n — English + Hindi + Bangla.
 *
 * The public tracking page is the only customer-facing surface in
 * Phase 1A; CLAUDE.md scopes it as bilingual. Approach: cookie-driven
 * locale (`lang=hi`), defaulting to English. Server components read
 * the cookie via `next/headers` and pass `Locale` to children.
 *
 * Keys are flat strings — no nesting, no plurals (none needed yet).
 */

import type { PublicShipmentDisplayStatus } from './types';

export type Locale = 'en' | 'hi' | 'bn';

export const LOCALES: ReadonlyArray<Locale> = ['en', 'hi', 'bn'];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(v: string | undefined): v is Locale {
  return v === 'en' || v === 'hi' || v === 'bn';
}

/**
 * Translations table. Add a new key by adding to BOTH languages — TS
 * `Record<TranslationKey, string>` makes a missed translation a
 * compile error.
 */
type Dict = {
  readonly brand: string;
  readonly tagline: string;

  // Landing page
  readonly landingTitle: string;
  readonly landingSubtitle: string;
  readonly awbLabel: string;
  readonly awbPlaceholder: string;
  readonly trackButton: string;

  // Detail page
  readonly notFoundTitle: string;
  readonly notFoundBody: string;
  readonly tryAnother: string;
  /** The lookup itself failed (rate limit, server error, network) —
   *  deliberately NOT "not found", which would tell a customer their
   *  parcel does not exist when we simply could not ask. */
  readonly unavailableTitle: string;
  readonly unavailableBody: string;
  readonly retry: string;
  readonly trackAnother: string;
  readonly updated: string;
  readonly destination: string;
  readonly estimatedDelivery: string;
  /** RS-10 — the reseller store the customer bought from. */
  readonly soldBy: string;
  readonly timelineHeading: string;
  readonly noScansYet: string;
  readonly courier: string;
  readonly parcel: string;
  /** The journey timeline's accessible name, and its progress words. */
  readonly journey: string;
  readonly onTheWay: string;
  /** Spoken state of each timeline step (colour is never the only signal). */
  readonly stepDone: string;
  readonly stepCurrent: string;
  readonly stepTodo: string;
  readonly stepSkipped: string;
  /** The long-journey fold; `{n}` is the number of hidden scans. */
  readonly earlierShow: string;
  readonly earlierHide: string;

  // Status labels (one per PublicShipmentDisplayStatus value)
  readonly s_processing: string;
  readonly s_dispatched: string;
  readonly s_in_transit: string;
  readonly s_out_for_delivery: string;
  readonly s_delivery_attempted: string;
  readonly s_delivered: string;
  readonly s_return_initiated: string;
  readonly s_returning: string;
  readonly s_returned: string;
  readonly s_lost: string;
  readonly s_damaged: string;
  readonly s_cancelled: string;

  // Locale switcher
  readonly switchToEn: string;
  readonly switchToHi: string;
  readonly switchToBn: string;
  readonly languageLabel: string;
};

const EN: Dict = {
  brand: 'Skydrop',
  tagline: 'Parcel tracking',
  landingTitle: 'Track your shipment',
  landingSubtitle: 'Enter the AWB number from your shipping confirmation email or SMS.',
  awbLabel: 'AWB number',
  awbPlaceholder: 'e.g. DL12345678',
  trackButton: 'Track',
  notFoundTitle: 'Tracking number not found',
  notFoundBody:
    "We couldn't find a parcel for this number. Double-check the AWB from your confirmation email or SMS. Tracking may take up to 24 hours to become active after dispatch.",
  tryAnother: 'Try another AWB',
  unavailableTitle: 'Tracking is temporarily unavailable',
  unavailableBody:
    "We couldn't reach the tracking service just now. Your parcel is not affected — please try again in a minute.",
  retry: 'Try again',
  trackAnother: 'Track another',
  updated: 'Updated',
  destination: 'Destination',
  estimatedDelivery: 'Estimated delivery',
  soldBy: 'Sold by',
  timelineHeading: 'Timeline',
  noScansYet: 'No scans yet. Once the courier picks up the parcel, scan events will appear here.',
  courier: 'Courier',
  parcel: 'Parcel',
  journey: 'Parcel journey',
  onTheWay: 'On the way',
  stepDone: 'Completed',
  stepCurrent: 'Current step',
  stepTodo: 'Still to come',
  stepSkipped: 'Skipped',
  earlierShow: 'Show {n} earlier scans',
  earlierHide: 'Hide earlier scans',
  s_processing: 'Processing',
  s_dispatched: 'Dispatched',
  s_in_transit: 'In transit',
  s_out_for_delivery: 'Out for delivery',
  s_delivery_attempted: 'Delivery attempted',
  s_delivered: 'Delivered',
  s_return_initiated: 'Return initiated',
  s_returning: 'Returning',
  s_returned: 'Returned',
  s_lost: 'Lost',
  s_damaged: 'Damaged',
  s_cancelled: 'Cancelled',
  switchToEn: 'English',
  switchToHi: 'हिन्दी',
  switchToBn: 'বাংলা',
  languageLabel: 'Language',
};

const HI: Dict = {
  brand: 'स्काईड्रॉप',
  tagline: 'पार्सल ट्रैकिंग',
  landingTitle: 'अपनी शिपमेंट ट्रैक करें',
  landingSubtitle: 'अपनी कन्फर्मेशन ईमेल या SMS से AWB नंबर दर्ज करें।',
  awbLabel: 'AWB नंबर',
  awbPlaceholder: 'उदा. DL12345678',
  trackButton: 'ट्रैक करें',
  notFoundTitle: 'ट्रैकिंग नंबर नहीं मिला',
  notFoundBody:
    'हमें इस नंबर के लिए कोई पार्सल नहीं मिला। कृपया अपनी कन्फर्मेशन ईमेल या SMS से AWB दोबारा जांचें। डिस्पैच के बाद ट्रैकिंग सक्रिय होने में 24 घंटे तक लग सकते हैं।',
  tryAnother: 'दूसरा AWB आज़माएँ',
  unavailableTitle: 'ट्रैकिंग अभी अस्थायी रूप से उपलब्ध नहीं है',
  unavailableBody:
    'हम अभी ट्रैकिंग सेवा से संपर्क नहीं कर सके। आपके पार्सल पर इसका कोई असर नहीं है — कृपया एक मिनट बाद फिर से प्रयास करें।',
  retry: 'फिर से प्रयास करें',
  trackAnother: 'दूसरा ट्रैक करें',
  updated: 'अद्यतन',
  destination: 'गंतव्य',
  estimatedDelivery: 'अनुमानित डिलीवरी',
  soldBy: 'विक्रेता',
  timelineHeading: 'टाइमलाइन',
  noScansYet: 'अभी तक कोई स्कैन नहीं। कूरियर द्वारा पार्सल उठाते ही स्कैन इवेंट यहाँ दिखाई देंगे।',
  courier: 'कूरियर',
  parcel: 'पार्सल',
  journey: 'पार्सल की यात्रा',
  onTheWay: 'रास्ते में',
  stepDone: 'पूरा हुआ',
  stepCurrent: 'मौजूदा चरण',
  stepTodo: 'आगे होना है',
  stepSkipped: 'छोड़ा गया',
  earlierShow: '{n} पुराने स्कैन दिखाएँ',
  earlierHide: 'पुराने स्कैन छिपाएँ',
  s_processing: 'प्रक्रियाधीन',
  s_dispatched: 'डिस्पैच',
  s_in_transit: 'रास्ते में',
  s_out_for_delivery: 'डिलीवरी के लिए निकला',
  s_delivery_attempted: 'डिलीवरी का प्रयास',
  s_delivered: 'डिलीवर हो गया',
  s_return_initiated: 'वापसी शुरू',
  s_returning: 'वापस आ रहा है',
  s_returned: 'वापस आ गया',
  s_lost: 'खो गया',
  s_damaged: 'क्षतिग्रस्त',
  s_cancelled: 'रद्द',
  switchToEn: 'English',
  switchToHi: 'हिन्दी',
  switchToBn: 'বাংলা',
  languageLabel: 'भाषा',
};

const BN: Dict = {
  brand: 'স্কাইড্রপ',
  tagline: 'পার্সেল ট্র্যাকিং',
  landingTitle: 'আপনার পার্সেল ট্র্যাক করুন',
  landingSubtitle: 'আপনার কনফার্মেশন ইমেইল বা SMS থেকে AWB নম্বরটি লিখুন।',
  awbLabel: 'AWB নম্বর',
  awbPlaceholder: 'যেমন DL12345678',
  trackButton: 'ট্র্যাক করুন',
  notFoundTitle: 'ট্র্যাকিং নম্বর পাওয়া যায়নি',
  notFoundBody:
    'এই নম্বরে আমরা কোনো পার্সেল খুঁজে পাইনি। আপনার কনফার্মেশন ইমেইল বা SMS থেকে AWB নম্বরটি আবার মিলিয়ে দেখুন। ডিসপ্যাচের পর ট্র্যাকিং চালু হতে ২৪ ঘণ্টা পর্যন্ত সময় লাগতে পারে।',
  tryAnother: 'অন্য একটি AWB চেষ্টা করুন',
  unavailableTitle: 'ট্র্যাকিং সাময়িকভাবে পাওয়া যাচ্ছে না',
  unavailableBody:
    'আমরা এইমাত্র ট্র্যাকিং সেবার সাথে যোগাযোগ করতে পারিনি। আপনার পার্সেলের কোনো ক্ষতি হয়নি — অনুগ্রহ করে এক মিনিট পর আবার চেষ্টা করুন।',
  retry: 'আবার চেষ্টা করুন',
  trackAnother: 'অন্যটি ট্র্যাক করুন',
  updated: 'আপডেট',
  destination: 'গন্তব্য',
  estimatedDelivery: 'আনুমানিক ডেলিভারি',
  soldBy: 'বিক্রেতা',
  timelineHeading: 'টাইমলাইন',
  noScansYet:
    'এখনও কোনো স্ক্যান নেই। কুরিয়ার পার্সেলটি নেওয়ার পর স্ক্যানের তথ্য এখানে দেখা যাবে।',
  courier: 'কুরিয়ার',
  parcel: 'পার্সেল',
  journey: 'পার্সেলের যাত্রা',
  onTheWay: 'পথে আছে',
  stepDone: 'সম্পন্ন',
  stepCurrent: 'বর্তমান ধাপ',
  stepTodo: 'এখনও বাকি',
  stepSkipped: 'বাদ দেওয়া হয়েছে',
  earlierShow: '{n}টি আগের স্ক্যান দেখুন',
  earlierHide: 'আগের স্ক্যান লুকান',
  s_processing: 'প্রক্রিয়াধীন',
  s_dispatched: 'ডিসপ্যাচ হয়েছে',
  s_in_transit: 'পথে আছে',
  s_out_for_delivery: 'ডেলিভারির জন্য বেরিয়েছে',
  s_delivery_attempted: 'ডেলিভারির চেষ্টা হয়েছে',
  s_delivered: 'ডেলিভারি হয়েছে',
  s_return_initiated: 'ফেরত শুরু হয়েছে',
  s_returning: 'ফেরত আসছে',
  s_returned: 'ফেরত এসেছে',
  s_lost: 'হারিয়ে গেছে',
  s_damaged: 'ক্ষতিগ্রস্ত',
  s_cancelled: 'বাতিল',
  switchToEn: 'English',
  switchToHi: 'हिन्दी',
  switchToBn: 'বাংলা',
  languageLabel: 'ভাষা',
};

const TABLE: Record<Locale, Dict> = { en: EN, hi: HI, bn: BN };

export function t(locale: Locale, key: keyof Dict): string {
  return TABLE[locale][key];
}

export function statusKey(s: PublicShipmentDisplayStatus): keyof Dict {
  return `s_${s}` as keyof Dict;
}
