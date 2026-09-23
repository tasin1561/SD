/**
 * apps/track i18n — English + Hindi.
 *
 * The public tracking page is the only customer-facing surface in
 * Phase 1A; CLAUDE.md scopes it as bilingual. Approach: cookie-driven
 * locale (`lang=hi`), defaulting to English. Server components read
 * the cookie via `next/headers` and pass `Locale` to children.
 *
 * Keys are flat strings — no nesting, no plurals (none needed yet).
 */

import type { PublicShipmentDisplayStatus } from './types';

export type Locale = 'en' | 'hi';

export const LOCALES: ReadonlyArray<Locale> = ['en', 'hi'];

export const DEFAULT_LOCALE: Locale = 'en';

export function isLocale(v: string | undefined): v is Locale {
  return v === 'en' || v === 'hi';
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
};

const TABLE: Record<Locale, Dict> = { en: EN, hi: HI };

export function t(locale: Locale, key: keyof Dict): string {
  return TABLE[locale][key];
}

export function statusKey(s: PublicShipmentDisplayStatus): keyof Dict {
  return `s_${s}` as keyof Dict;
}
