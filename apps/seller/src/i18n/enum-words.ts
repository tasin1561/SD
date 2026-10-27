import { CallOutcome, DeliveryActionStatus } from '@skydrop/db';
import { deliveryActionStatusLabel } from '@skydrop/ui/status';

/**
 * Bangla for enum VALUES that the seller console prints as words. The enum
 * values themselves are protocol and never translated; these tables only
 * decide how a value reads. Each is a `Record<Enum, string>`, so a new value
 * fails to compile until it has a Bangla word. English is whatever the
 * component printed before (`humanOutcome`), so English is unchanged.
 */
export const CALL_OUTCOME_BN: Readonly<Record<CallOutcome, string>> = {
  CONFIRMED: 'নিশ্চিত',
  CUSTOMER_DECLINED: 'গ্রাহক প্রত্যাখ্যান করেছেন',
  WRONG_NUMBER: 'ভুল নম্বর',
  NO_ANSWER: 'ফোন ধরেননি',
  BUSY: 'ব্যস্ত ছিল',
  VOICEMAIL_LEFT: 'ভয়েসমেইল রাখা হয়েছে',
  CALLBACK_REQUESTED: 'ফিরতি কল চেয়েছেন',
  TECHNICAL_FAILURE: 'প্রযুক্তিগত ত্রুটি',
  LANGUAGE_BARRIER: 'ভাষাগত সমস্যা',
  SPOKE_TO_CUSTOMER: 'গ্রাহকের সাথে কথা হয়েছে',
};

/** Delivery-request status words come from the shared status vocabulary (one renderer per enum). */
export const DELIVERY_ACTION_STATUS_BN: Readonly<Record<DeliveryActionStatus, string>> =
  Object.fromEntries(
    Object.values(DeliveryActionStatus).map((s) => [s, deliveryActionStatusLabel(s, 'bn')]),
  ) as Record<DeliveryActionStatus, string>;
