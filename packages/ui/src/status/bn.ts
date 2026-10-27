/**
 * Bangla status wording — the Bangla half of the F2-exhaustive label mappers
 * in `./index.ts`.
 *
 * Status words are translated HERE and nowhere else: a component never keeps
 * its own Bangla for a status, for the same reason it never keeps its own
 * English (CNS-2 / BIN-1 — two renderers of one enum drift). Each table is a
 * `Record<Enum, string>`, so a new enum value fails to compile until somebody
 * decides how it reads in Bangla too.
 *
 * Only the label FUNCTIONS' words live here. Enum VALUES, kinds (colours) and
 * every key stay as they are — they are protocol, not copy.
 *
 * Latin script is kept for terms the operations team says in English:
 * RTO, NDR, AWB, COD.
 */
import type {
  BulkUploadStatus,
  DeliveryActionStatus,
  EarlyReservationReviewStatus,
  InboundFreightStatus,
  OrderStatus,
  ResellerCreditStatus,
  ResellerStoreStatus,
  ShipmentStatus,
  StockUnitStatus,
  StoreAddressChangeStatus,
  StoreOrderRequestStatus,
  StoreWalletEntryDirection,
  TicketStatus,
  WithdrawalRequestStatus,
} from '@skydrop/db';

export const ORDER_STATUS_BN: Record<OrderStatus, string> = {
  DRAFT: 'খসড়া',
  PENDING_CONFIRMATION: 'নিশ্চিতকরণের অপেক্ষায়',
  CALL_NO_RESPONSE: 'কলে সাড়া মেলেনি',
  CALL_RESCHEDULED: 'কল পুনরায় নির্ধারিত',
  CONFIRMED: 'নিশ্চিত',
  OUT_OF_STOCK: 'স্টক নেই',
  CANCELLED: 'বাতিল',
  CANCELLED_BY_ADMIN: 'অ্যাডমিন বাতিল করেছে',
  REJECTED: 'প্রত্যাখ্যাত',
  REJECTED_BY_CUSTOMER: 'গ্রাহক প্রত্যাখ্যান করেছেন',
  REJECTED_NDR: 'প্রত্যাখ্যাত (NDR)',
  AWAITING_SELLER_DECISION: 'ক্লায়েন্টের সিদ্ধান্তের অপেক্ষায়',
  AWAITING_COURIER: 'কুরিয়ারের অপেক্ষায়',
  PENDING_PICK: 'পিক করার অপেক্ষায়',
  PICKED: 'পিক করা হয়েছে',
  PACKED: 'প্যাক করা হয়েছে',
  PACK_FAILED: 'প্যাকিং ব্যর্থ',
  PENDING_DISPATCH: 'ডিসপ্যাচের অপেক্ষায়',
  DISPATCHED: 'ডিসপ্যাচ হয়েছে',
  IN_TRANSIT: 'পথে আছে',
  OUT_FOR_DELIVERY: 'ডেলিভারির জন্য বেরিয়েছে',
  DELIVERED: 'ডেলিভারি হয়েছে',
  DELIVERY_FAILED: 'ডেলিভারি ব্যর্থ',
  RTO_INITIATED: 'RTO শুরু হয়েছে',
  RTO_IN_TRANSIT: 'RTO পথে আছে',
  RTO_RECEIVED: 'RTO গ্রহণ করা হয়েছে',
  RTO_RESTOCKED: 'RTO স্টকে ফেরানো হয়েছে',
  RTO_DAMAGED: 'RTO-তে ক্ষতিগ্রস্ত',
  LOST_IN_TRANSIT: 'পথে হারিয়ে গেছে',
  PENDING_MANUAL_PLACEMENT: 'ম্যানুয়াল প্লেসমেন্টের অপেক্ষায়',
};

export const SHIPMENT_STATUS_BN: Record<ShipmentStatus, string> = {
  CREATED: 'তৈরি হয়েছে',
  AWB_PENDING: 'AWB-এর অপেক্ষায়',
  AWB_GENERATED: 'AWB তৈরি হয়েছে',
  FAILED_AT_CREATION: 'তৈরির সময় ব্যর্থ',
  HANDED_TO_COURIER: 'কুরিয়ারকে দেওয়া হয়েছে',
  IN_TRANSIT: 'পথে আছে',
  AT_HUB: 'হাবে আছে',
  OUT_FOR_DELIVERY: 'ডেলিভারির জন্য বেরিয়েছে',
  DELIVERY_ATTEMPTED: 'ডেলিভারির চেষ্টা হয়েছে',
  DELIVERED: 'ডেলিভারি হয়েছে',
  RTO_INITIATED: 'RTO শুরু হয়েছে',
  RTO_IN_TRANSIT: 'RTO পথে আছে',
  RTO_DELIVERED: 'RTO ফেরত পৌঁছেছে',
  LOST: 'হারিয়ে গেছে',
  DAMAGED: 'ক্ষতিগ্রস্ত',
  CANCELLED: 'বাতিল',
};

export const INBOUND_FREIGHT_STATUS_BN: Record<InboundFreightStatus, string> = {
  PENDING: 'অপেক্ষায়',
  PARTIALLY_SETTLED: 'আংশিক পরিশোধিত',
  SETTLED: 'পরিশোধিত',
  WAIVED: 'মওকুফ',
  // `statusLabel` overrides VOIDED to "Withdrawn"; the Bangla follows it.
  VOIDED: 'প্রত্যাহার করা হয়েছে',
};

export const WITHDRAWAL_STATUS_BN: Record<WithdrawalRequestStatus, string> = {
  PENDING: 'অপেক্ষায়',
  APPROVED: 'অনুমোদিত',
  PAID: 'পরিশোধিত',
  REJECTED: 'প্রত্যাখ্যাত',
};

/** The seller's half of `withdrawalStatusLabel` — same three departures from
 *  the staff words the English makes, for the same reason. */
export const WITHDRAWAL_STATUS_SELLER_BN: Record<WithdrawalRequestStatus, string> = {
  PENDING: 'অনুরোধ করা হয়েছে',
  APPROVED: 'পেমেন্ট প্রক্রিয়াধীন',
  PAID: 'পরিশোধিত',
  REJECTED: 'প্রত্যাখ্যান করা হয়েছে',
};

/** `storeAddressChangeStatusLabel` in Bangla. Deliberately NOT in the flat lookup. */
export const STORE_ADDRESS_CHANGE_STATUS_BN: Record<StoreAddressChangeStatus, string> = {
  PENDING: 'ক্লায়েন্ট স্টাফের অপেক্ষায়',
  APPROVED: 'অনুমোদিত',
  APPLIED: 'সংশোধন করা হয়েছে',
  REJECTED: 'প্রত্যাখ্যাত',
  FAILED: 'প্রয়োগ করা যায়নি',
  EXPIRED: 'সময়মতো উত্তর মেলেনি',
  SUPERSEDED: 'ক্লায়েন্ট স্টাফ নিজেই সংশোধন করেছে',
};

/** `storeOrderRequestStatusLabel` in Bangla. Deliberately NOT in the flat lookup. */
export const STORE_ORDER_REQUEST_STATUS_BN: Record<StoreOrderRequestStatus, string> = {
  PENDING: 'ক্লায়েন্ট স্টাফের অপেক্ষায়',
  APPROVED: 'অনুমোদিত',
  EXECUTED: 'সম্পন্ন',
  REJECTED: 'প্রত্যাখ্যাত',
  FAILED: 'করা যায়নি',
  EXPIRED: 'সময়মতো উত্তর মেলেনি',
};

/** `resellerStoreStatusLabel` in Bangla. Deliberately NOT in the flat lookup. */
export const RESELLER_STORE_STATUS_BN: Record<ResellerStoreStatus, string> = {
  PENDING_SELLER_APPROVAL: 'অনুমোদনের অপেক্ষায়',
  ACTIVE: 'সক্রিয়',
  PAUSED: 'স্থগিত',
  CLOSED: 'বন্ধ',
  REJECTED: 'প্রত্যাখ্যাত',
};

/** `resellerCreditStatusLabel` in Bangla. Deliberately NOT in the flat lookup. */
export const RESELLER_CREDIT_STATUS_BN: Record<ResellerCreditStatus, string> = {
  WAITING: 'অপেক্ষায়',
  DUE: 'প্রদেয়',
  CREDITED: 'জমা হয়েছে',
  REVERSED: 'ফেরত নেওয়া হয়েছে',
  SKIPPED: 'জমা হয়নি',
};

/** `storeWalletDirectionLabel` in Bangla. Functions, not strings: four of
 *  these name the client, and Bangla puts the name in a different place. */
export const STORE_WALLET_DIRECTION_BN: Record<
  StoreWalletEntryDirection,
  (seller: string) => string
> = {
  SELLER_TOPUP: (s) => `${s} টপ-আপ করেছে`,
  SELLER_PAYOUT: (s) => `${s} পরিশোধ করেছে (রেকর্ড করা)`,
  TOPUP: () => 'টপ-আপ জমা হয়েছে',
  WITHDRAWAL: () => 'উইথড্রয়াল পরিশোধিত',
  ORDER_CREDIT: () => 'অর্ডারের মার্জিন',
  ORDER_CREDIT_REVERSAL: () => 'অর্ডারের মার্জিন ফেরত নেওয়া হয়েছে',
  FEE_SHARE: () => 'Skydrop ফি-র অংশ',
  COD_TAX_SHARE: () => 'COD করের অংশ',
  SHARE_REFUND: () => 'ফি-র অংশ ফেরত',
  PREPAID_DEBIT: () => 'প্রিপেইড অর্ডার',
  PREPAID_REFUND: () => 'প্রিপেইড অর্ডার ফেরত',
  TRANSFER_PRICE: (s) => `${s}-এর ট্রান্সফার প্রাইসে পণ্য`,
  TRANSFER_PRICE_REFUND: () => 'ট্রান্সফার প্রাইস ফেরত দেওয়া হয়েছে',
  DISPUTE_SETTLEMENT_IN: (s) => `বিরোধ নিষ্পত্তি — ${s} পরিশোধ করেছে`,
  DISPUTE_SETTLEMENT_OUT: (s) => `বিরোধ নিষ্পত্তি — ${s}-কে পরিশোধ করা হয়েছে`,
};

export const EARLY_RESERVATION_STATUS_BN: Record<EarlyReservationReviewStatus, string> = {
  OPEN: 'খোলা',
  SELLER_RELEASED: 'ক্লায়েন্ট ছেড়ে দিয়েছেন',
  SELLER_REQUESTED_MORE_ATTEMPTS: 'ক্লায়েন্ট আরও চেষ্টা চেয়েছেন',
  AUTO_RELEASED: 'স্বয়ংক্রিয়ভাবে ছাড়া হয়েছে',
};

export const STOCK_UNIT_STATUS_BN: Record<StockUnitStatus, string> = {
  IN_STOCK: 'স্টকে আছে',
  PICKED: 'পিক করা হয়েছে',
  PACKED: 'প্যাক করা হয়েছে',
  DISPATCHED: 'ডিসপ্যাচ হয়েছে',
  RTO_RECEIVED: 'RTO গ্রহণ করা হয়েছে',
  WRITTEN_OFF: 'অবলোপিত',
  LOST: 'হারিয়ে গেছে',
  RETURNED_TO_SELLER: 'ক্লায়েন্টকে ফেরত দেওয়া হয়েছে',
};

/** `statusLabel` derives a generic word for a TicketStatus; this is its Bangla. */
const TICKET_STATUS_GENERIC_BN: Record<TicketStatus, string> = {
  OPEN: 'খোলা',
  NEGOTIATING: 'আলোচনা চলছে',
  RESOLVED_REFUND: 'সমাধান: ফেরত',
  RESOLVED_RETURNED: 'সমাধান: মালামাল ফেরত',
  RESOLVED_WRITE_OFF_ACCEPTED: 'সমাধান: অবলোপন গৃহীত',
  REJECTED: 'প্রত্যাখ্যাত',
  CLOSED_BY_COURIER: 'কুরিয়ার বন্ধ করেছে',
};

/**
 * The flat lookup `statusLabel` uses. The seven enums share some values
 * (PENDING, REJECTED, PICKED …); where they do, the words agree, and the unit
 * spec asserts that so a future edit cannot make one status read two ways.
 */
export const STATUS_LABEL_BN: Readonly<Record<string, string>> = {
  ...EARLY_RESERVATION_STATUS_BN,
  ...INBOUND_FREIGHT_STATUS_BN,
  ...STOCK_UNIT_STATUS_BN,
  ...TICKET_STATUS_GENERIC_BN,
  ...WITHDRAWAL_STATUS_BN,
  ...SHIPMENT_STATUS_BN,
  ...ORDER_STATUS_BN,
};

/** For the spec only: every table `STATUS_LABEL_BN` is built from. */
export const STATUS_LABEL_BN_SOURCES: readonly Readonly<Record<string, string>>[] = [
  EARLY_RESERVATION_STATUS_BN,
  INBOUND_FREIGHT_STATUS_BN,
  STOCK_UNIT_STATUS_BN,
  TICKET_STATUS_GENERIC_BN,
  WITHDRAWAL_STATUS_BN,
  SHIPMENT_STATUS_BN,
  ORDER_STATUS_BN,
];

/** `ticketStatusLabel` — "Closed ·" first, then which kind (same shape as English). */
export const TICKET_STATUS_BN: Record<TicketStatus, string> = {
  OPEN: 'খোলা',
  NEGOTIATING: 'পর্যালোচনায়',
  RESOLVED_REFUND: 'বন্ধ · টাকা ফেরত',
  RESOLVED_RETURNED: 'বন্ধ · মালামাল ফেরত',
  RESOLVED_WRITE_OFF_ACCEPTED: 'বন্ধ · অবলোপন',
  REJECTED: 'বন্ধ · গ্রহণযোগ্য হয়নি',
  CLOSED_BY_COURIER: 'বন্ধ · কুরিয়ার কর্তৃক',
};

export const UPLOAD_STATUS_BN: Record<BulkUploadStatus, string> = {
  PENDING: 'অপেক্ষায়',
  PROCESSING: 'ইমপোর্ট হচ্ছে',
  COMPLETED: 'সম্পন্ন',
  COMPLETED_WITH_ERRORS: 'সম্পন্ন, কিছু সারি ব্যর্থ',
  FAILED: 'ব্যর্থ',
  CANCELLED: 'বাতিল',
};

export const DELIVERY_ACTION_STATUS_BN: Record<DeliveryActionStatus, string> = {
  PENDING: 'ক্লায়েন্টের উত্তরের অপেক্ষায়',
  APPROVED: 'অনুমোদিত',
  REJECTED: 'প্রত্যাখ্যাত',
  EXECUTED: 'সম্পন্ন',
  FAILED: 'করা যায়নি',
  EXPIRED: 'সময়মতো উত্তর মেলেনি',
};
