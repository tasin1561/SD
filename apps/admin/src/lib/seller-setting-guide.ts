/**
 * Plain-English names for the per-seller settings (SET-1).
 *
 * The seller detail page lists every seller-overridable key, and a key
 * like `inventory.early_reservation_ndr_action` means nothing to the
 * person deciding whether to change it. This is the words: a name, what
 * the setting decides, and one worked example with real numbers.
 *
 * It is words only. The API stays the authority on what a setting does
 * and what values it accepts (FE-2) — `values` here only makes a known
 * code readable and offers it as a choice; the server still validates.
 *
 * `seller-setting-guide.test.ts` reads the seed and fails when an
 * overridable key has no entry here, so a new key cannot arrive on the
 * page as a bare code.
 */

export type SettingGroup =
  | 'Charges'
  | 'Customer calls'
  | 'Courier'
  | 'Cash on delivery'
  | 'Wallet & withdrawals'
  | 'Stock holds'
  | 'Inbound freight'
  | 'Reseller stores';

/** Page order of the groups. */
export const SETTING_GROUP_ORDER: readonly SettingGroup[] = [
  'Charges',
  'Cash on delivery',
  'Wallet & withdrawals',
  'Inbound freight',
  'Customer calls',
  'Courier',
  'Stock holds',
  'Reseller stores',
];

export interface SettingGuide {
  readonly name: string;
  readonly group: SettingGroup;
  /** What the setting decides, in one or two sentences. */
  readonly what: string;
  /** One worked example, with the default where it helps. */
  readonly example: string;
  /** Readable names for a setting whose value is one of a few codes. */
  readonly values?: Readonly<Record<string, string>>;
}

const ON_OFF = { true: 'On', false: 'Off' } as const;

export const SELLER_SETTING_GUIDE: Readonly<Record<string, SettingGuide>> = {
  // ── Charges ─────────────────────────────────────────────────────────
  'pricing.flat_delivery_fee': {
    name: 'Delivery fee per parcel',
    group: 'Charges',
    what: 'What Skydrop charges this seller to deliver one parcel anywhere in India. One flat amount, no zones or weight slabs. The currency is the setting "Delivery fee currency".',
    example:
      'Set to 250 with currency BDT: every parcel costs the seller ৳250, converted to rupees on the day the charge is taken.',
  },
  'pricing.flat_delivery_fee_currency': {
    name: 'Delivery fee currency',
    group: 'Charges',
    what: 'Whether the delivery fee above is agreed in taka (BDT) or rupees (INR). A taka fee is converted to rupees when the charge is taken.',
    example:
      'Fee 200 and currency BDT means ৳200 a parcel (about ₹162). Change the currency to INR and the same 200 means ₹200.',
  },
  'pricing.flat_rto_fee': {
    name: 'Return fee (parcel not delivered)',
    group: 'Charges',
    what: 'Charged on top of the delivery fee when the courier could not deliver and the parcel comes back to our warehouse. Taken when the parcel physically arrives back, not when the courier says it is returning.',
    example:
      'Delivery fee ৳200 and return fee ৳30: a parcel that comes back costs the seller ৳230 in total.',
  },
  'pricing.flat_rto_fee_currency': {
    name: 'Return fee currency',
    group: 'Charges',
    what: 'Whether the return fee is agreed in taka (BDT) or rupees (INR).',
    example:
      'Return fee 30 with currency BDT means ৳30, converted on the day the parcel is received back.',
  },
  'pricing.customer_return_fee': {
    name: 'Customer return fee (delivered, then sent back)',
    group: 'Charges',
    what: 'What the seller pays when a customer asks to send back a parcel that was already delivered. The parcel travels the whole way again, so it costs about as much as a delivery.',
    example:
      'Set to 200: a customer returns a delivered kurta, and the seller pays the original delivery fee plus 200.',
  },
  'pricing.customer_return_fee_currency': {
    name: 'Customer return fee currency',
    group: 'Charges',
    what: 'Whether the customer return fee is agreed in taka (BDT) or rupees (INR).',
    example: 'Customer return fee 200 with currency BDT means ৳200 per returned parcel.',
  },
  'orders.default_customer_delivery_fee_inr': {
    name: 'Delivery charge pre-filled for the customer (₹)',
    group: 'Charges',
    what: 'The delivery charge pre-filled on the seller’s new-order form, added to what the courier collects from the customer. It only fills the box: it does not change what Skydrop charges the seller, and the seller can edit it on any order.',
    example:
      'Set to 99: a new order for a ₹900 product opens with ₹99 delivery, so the customer pays ₹999 on delivery.',
  },

  // ── Cash on delivery ────────────────────────────────────────────────
  'wallet.cod_credit_mode': {
    name: 'When COD money is credited',
    group: 'Cash on delivery',
    what: 'When the cash a courier collects is credited to the seller’s wallet: when the courier pays Skydrop (no fee), or straight away at delivery for an Instant Pay fee.',
    example:
      'On "Instant Pay", a parcel delivered today is credited today. On "When the courier pays us", it is credited about a week later, when the courier settles.',
    values: {
      SETTLEMENT: 'When the courier pays us',
      INSTANT_PAY: 'Instant Pay, at delivery',
    },
  },
  'wallet.cod_gst_percent': {
    name: 'GST taken out of COD (%)',
    group: 'Cash on delivery',
    what: 'The GST rate removed from the cash collected before it is credited. The customer’s price already includes GST, so it is taken out, not added on.',
    example: 'At 18%, a ₹1,180 COD has ₹180 of GST inside it, so ₹1,000 goes towards the seller.',
  },
  'wallet.cod_collection_fee_percent': {
    name: 'COD handling fee (%)',
    group: 'Cash on delivery',
    what: 'A fee on every cash-on-delivery credit, worked out on the amount after GST. 0 means no fee.',
    example: 'At 1%, on ₹1,000 after GST the seller pays ₹10 and is credited ₹990.',
  },
  'wallet.instant_pay_fee_percent': {
    name: 'Instant Pay fee (%)',
    group: 'Cash on delivery',
    what: 'The extra fee for being credited at delivery instead of waiting for the courier. Only charged when "When COD money is credited" is Instant Pay, and it is on top of the COD handling fee.',
    example:
      '₹1,180 COD: GST leaves ₹1,000, a 1% handling fee is ₹10 and 2.5% Instant Pay is ₹25, so the seller is credited ₹965.',
  },
  'wallet.courier_fee_deduction_timing': {
    name: 'When delivery charges are taken',
    group: 'Cash on delivery',
    what: 'When the delivery charges for an order are taken from the wallet: once it is delivered, or as soon as the courier waybill is booked.',
    example:
      'On "When the waybill is booked", the ৳200 fee leaves the wallet the day the order is confirmed, even though the parcel has not reached the customer yet.',
    values: {
      AT_DELIVERY: 'When the parcel is delivered',
      AT_AWB: 'When the waybill is booked',
    },
  },
  'wallet.accrual_timing_tier': {
    name: 'Credit right away or after a delay',
    group: 'Cash on delivery',
    what: 'Whether a delivered order’s money moves into the wallet immediately, or after the number of days in "Delay before crediting", once the courier has paid Skydrop.',
    example:
      'On "After a delay" with a 7-day delay, a parcel delivered on the 1st is credited on the 8th.',
    values: {
      T_PLUS_N: 'After a delay',
      INSTANT: 'Right away',
    },
  },
  'wallet.accrual_delay_days': {
    name: 'Delay before crediting (days)',
    group: 'Cash on delivery',
    what: 'How many days after delivery the money is credited, for a seller on "After a delay". Should cover how long the courier takes to pay Skydrop.',
    example: 'Set to 7: delivered Monday, credited the following Monday.',
  },

  // ── Wallet & withdrawals ────────────────────────────────────────────
  'wallet.minimum_balance_inr': {
    name: 'Money that must stay in the wallet (₹)',
    group: 'Wallet & withdrawals',
    what: 'An amount the seller cannot withdraw. What they can withdraw is the balance minus this.',
    example: 'Set to 2,000 with ₹10,000 in the wallet: the seller can withdraw up to ₹8,000.',
  },
  'wallet.negative_balance_limit_inr': {
    name: 'How far the wallet may go below zero (₹)',
    group: 'Wallet & withdrawals',
    what: 'How much the seller may owe before new orders are refused. Charges can land before money comes in, and the value of their stock in our warehouse can add to this slack.',
    example:
      'Set to 5,000: the seller can reach −₹5,000; one more rupee owed and a new order is refused.',
  },
  'wallet.withdrawal_min_threshold_inr': {
    name: 'Smallest withdrawal (₹)',
    group: 'Wallet & withdrawals',
    what: 'The smallest amount the seller may ask for in one withdrawal.',
    example: 'Set to 500: a request for ₹300 is refused, a request for ₹500 is accepted.',
  },
  'wallet.withdrawal_max_per_day': {
    name: 'Withdrawals allowed per day',
    group: 'Wallet & withdrawals',
    what: 'How many withdrawal requests the seller may make in 24 hours. It counts requests, not money.',
    example: 'Set to 1: after one request this morning, a second one today is refused.',
  },
  'wallet.withdrawal_max_per_month': {
    name: 'Withdrawals allowed per month',
    group: 'Wallet & withdrawals',
    what: 'How many withdrawal requests the seller may make in 30 days. It counts requests, not money.',
    example: 'Set to 20: the 21st request within 30 days is refused.',
  },
  'wallet.auto_withdraw_enabled': {
    name: 'Automatic withdrawals',
    group: 'Wallet & withdrawals',
    what: 'When on, everything the seller can withdraw is requested for them once a day, at the hour in "Automatic withdrawal time".',
    example:
      'On, at 10: every day at 10 am the seller’s withdrawable balance is requested without them asking.',
    values: ON_OFF,
  },
  'wallet.auto_withdraw_hour_local': {
    name: 'Automatic withdrawal time (hour, seller’s time)',
    group: 'Wallet & withdrawals',
    what: 'The hour of the day (0–23) the automatic withdrawal is requested, in the seller’s own time zone.',
    example: 'Set to 10 for a seller in Dhaka: the request is raised at 10 am Dhaka time.',
  },
  'wallet.auto_withdraw_keep_balance_inr': {
    name: 'Keep in the wallet after an automatic withdrawal (₹)',
    group: 'Wallet & withdrawals',
    what: 'What the seller wants left behind when the automatic withdrawal runs, on top of the money that must stay. Does not affect withdrawals they ask for themselves.',
    example: 'Set to 3,000 with ₹12,000 in the wallet: the automatic withdrawal takes ₹9,000.',
  },
  'wallet.auto_reject_unpayable_withdrawals': {
    name: 'Cancel withdrawals the wallet can no longer pay',
    group: 'Wallet & withdrawals',
    what: 'When on, a withdrawal still waiting for approval is rejected automatically if later charges leave too little in the wallet to pay it, so it stops blocking new requests.',
    example:
      'The seller asks for ₹3,000, then ₹2,500 of charges land and leave ₹500: with this on, the request is rejected and the seller is told.',
    values: ON_OFF,
  },

  // ── Inbound freight ─────────────────────────────────────────────────
  'wallet.inbound_freight_mode': {
    name: 'How Bangladesh → India freight is paid',
    group: 'Inbound freight',
    what: 'When the seller is billed for flying their stock into India: at our Bangladesh warehouse before it flies, in full when it lands, or bit by bit as each unit sells.',
    example:
      'On "Pay as it sells", a ৳10,000 bill for 100 units is charged ৳100 each time one of those units is delivered.',
    values: {
      PAY_ADVANCE: 'Pay before it flies',
      PAY_NOW: 'Pay in full when it lands',
      PAY_LATER: 'Pay as it sells',
    },
  },
  'wallet.inbound_freight_service_charge_percent': {
    name: 'Service charge for paying freight later (%)',
    group: 'Inbound freight',
    what: 'An extra percentage added to a freight bill when the seller pays as it sells. Ignored for the other ways of paying.',
    example: 'At 2%, a ₹10,000 freight bill paid as it sells becomes ₹10,200.',
  },

  // ── Customer calls ──────────────────────────────────────────────────
  'ops.call_max_attempts_before_ndr': {
    name: 'Call attempts before giving up',
    group: 'Customer calls',
    what: 'How many times our call centre tries to reach the customer to confirm an order before it is rejected as unreachable. Only calls that reached a real outcome count (no answer, busy, wrong number and so on).',
    example: 'Set to 3: three unanswered calls and the order is stopped instead of shipped.',
  },
  'ops.call_retry_interval_hours': {
    name: 'Wait before calling again (hours)',
    group: 'Customer calls',
    what: 'How long after an unanswered call the order comes back to the call queue.',
    example: 'Set to 4: the customer does not pick up at 10 am, so we call again after 2 pm.',
  },
  'orders.reattempt_requestable_statuses': {
    name: 'Orders the seller may ask us to call again',
    group: 'Customer calls',
    what: 'For which stopped orders the seller sees an "ask us to call again" button. A list of order statuses.',
    example:
      '["REJECTED_BY_CUSTOMER"]: the seller can ask for another call when the customer said no; not when nobody ever answered.',
  },

  // ── Courier ─────────────────────────────────────────────────────────
  'ops.default_courier_code': {
    name: 'Courier for this seller’s parcels',
    group: 'Courier',
    what: 'Which courier new parcels are booked with. "manual" means no courier is booked automatically: every parcel waits for a person to arrange it.',
    example:
      'Set to shiprocket: this seller’s new orders are booked with Shiprocket instead of Delhivery.',
  },
  'courier.selection_policy': {
    name: 'How the carrier is chosen (Shiprocket)',
    group: 'Courier',
    what: 'When a parcel goes through Shiprocket, which of their carriers to use. Has no effect on Delhivery parcels.',
    example: 'On "Cheapest", a parcel offered Blue Dart at ₹92 and Ekart at ₹69 goes with Ekart.',
    values: {
      SHIPROCKET_DEFAULT: 'Let Shiprocket choose',
      CHEAPEST: 'Cheapest',
      FASTEST: 'Fastest',
      CHEAPEST_WITHIN_DAYS: 'Cheapest within a day limit',
      MANUAL: 'A person chooses each time',
    },
  },
  'courier.selection_max_days': {
    name: 'Day limit for "cheapest within"',
    group: 'Courier',
    what: 'Only for "Cheapest within a day limit": the slowest delivery still worth taking for a lower price. If nothing is that fast, the fastest carrier is used.',
    example: 'Set to 5: a ₹60 carrier taking 7 days is skipped for a ₹70 one taking 4 days.',
  },
  'courier.selection_decision_ttl_hours': {
    name: 'Wait for a person to choose the carrier (hours)',
    group: 'Courier',
    what: 'Only for "A person chooses each time": how long a parcel waits for that choice before the cheapest carrier is booked automatically and staff are alerted.',
    example:
      'Set to 6: nobody picks a carrier by 4 pm for a parcel waiting since 10 am, so the cheapest is booked.',
  },

  // ── Stock holds ─────────────────────────────────────────────────────
  'ops.stock_reservation_ttl_hours': {
    name: 'How long confirmed orders hold stock (hours)',
    group: 'Stock holds',
    what: 'How long stock held for a confirmed order stays held before it is released back to sellable stock.',
    example:
      'Set to 48: stock held for an order confirmed on Monday morning is released on Wednesday morning if it has not moved.',
  },
  'inventory.early_reservation_enabled': {
    name: 'Hold stock as soon as an order arrives',
    group: 'Stock holds',
    what: 'When on, stock is held the moment an order is placed, before our call centre has confirmed it with the customer. Protects stock for new orders, but ties it up for orders that may never be confirmed.',
    example:
      'On: a seller with 5 units gets 5 orders in a minute, and a 6th order sees no stock straight away.',
    values: ON_OFF,
  },
  'inventory.early_reservation_ttl_hours': {
    name: 'How long an early hold lasts (hours)',
    group: 'Stock holds',
    what: 'How long stock held at order placement stays held if the order is not confirmed.',
    example:
      'Set to 24: an order placed at noon that nobody confirms releases its stock at noon the next day.',
  },
  'inventory.early_reservation_ndr_action': {
    name: 'When we cannot reach the customer',
    group: 'Stock holds',
    what: 'What happens once the call attempts run out: ask the seller whether to keep trying, or reject the order straight away and release its stock.',
    example:
      'On "Ask the seller", after 3 unanswered calls the seller sees the order and chooses to keep trying or stop.',
    values: {
      MANUAL_REVIEW: 'Ask the seller',
      AUTO_RELEASE: 'Reject it straight away',
    },
  },
  'inventory.early_reservation_review_ttl_hours': {
    name: 'Time the seller has to answer (hours)',
    group: 'Stock holds',
    what: 'For "Ask the seller": how long we wait for the seller’s answer before the order is rejected and its stock released.',
    example:
      'Set to 72: a seller who does not answer within 3 days has the order rejected for them.',
  },

  // ── Reseller stores ─────────────────────────────────────────────────
  'reseller.orders_enabled': {
    name: 'Reseller stores can place orders',
    group: 'Reseller stores',
    what: 'Whether this seller’s reseller stores may place orders at all.',
    example:
      'Off: a store can sign in and see its catalogue, but every new order it tries is refused.',
    values: ON_OFF,
  },
  'reseller.credit_after_confirmation_enabled': {
    name: 'Reseller terms may pay after phone confirmation',
    group: 'Reseller stores',
    what: 'Whether this seller may give a reseller store terms that pay out a number of days after the order is confirmed on the phone, before the customer has paid. Changed with its own control in the reseller section of this page, because it needs a reason; the Override button here is refused.',
    example:
      'On: a store’s terms can say "credited 3 days after confirmation" instead of "after delivery".',
    values: ON_OFF,
  },
  'reseller.store_negative_limit_cap_inr': {
    name: 'Most a reseller store may owe (₹)',
    group: 'Reseller stores',
    what: 'The highest limit this seller may give any one of their reseller stores for going below zero.',
    example: 'Set to 25,000: the seller can let a store owe up to ₹25,000, but not ₹30,000.',
  },
  'reseller.stock_reorder_days': {
    name: 'Reorder alert (days of stock left)',
    group: 'Reseller stores',
    what: 'A product their stores sell is flagged for reordering when, at the recent rate of sales, the stock left lasts fewer than this many days. The seller is told once a week.',
    example: 'Set to 14: 30 units left selling 3 a day lasts 10 days, so it is flagged.',
  },
  'reseller.stock_forecast_window_days': {
    name: 'Days of sales used for the forecast',
    group: 'Reseller stores',
    what: 'How many recent days of confirmed orders are averaged to work out how fast each product sells.',
    example: 'Set to 30: 90 units sold in the last 30 days counts as 3 a day.',
  },
};

/** The guide for a key, or null for a key nobody has written words for yet. */
export function settingGuide(key: string): SettingGuide | null {
  return SELLER_SETTING_GUIDE[key] ?? null;
}

/** A readable fallback name built from the key itself. */
export function fallbackSettingName(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
