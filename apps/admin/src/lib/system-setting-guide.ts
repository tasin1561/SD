/**
 * Plain-English names for every system setting.
 *
 * Both setting screens read this one guide: the global /settings page
 * (every `system_settings` row) and a seller's detail page (the keys a
 * seller may override, SET-1). A key like
 * `inventory.early_reservation_ndr_action` means nothing to the person
 * deciding whether to change it. This is the words: a name, what the
 * setting decides, and one worked example with real numbers.
 *
 * It is words only. The API stays the authority on what a setting does
 * and what values it accepts (FE-2) — `values` here only makes a known
 * code readable and offers it as a choice; the server still validates.
 * Nothing here holds or reveals a secret: a setting that names where a
 * secret lives is explained, never filled in.
 *
 * `system-setting-guide.test.ts` reads the seed and the migrations that
 * insert settings, and fails when a key has no entry here, so a new
 * key cannot arrive on either page as a bare code.
 */

export type SettingGroup =
  | 'Charges'
  | 'Cash on delivery'
  | 'Wallet & withdrawals'
  | 'Inbound freight'
  | 'Invoices & tax'
  | 'Customer calls'
  | 'Orders'
  | 'Stock holds'
  | 'Inventory'
  | 'Warehouse'
  | 'Courier'
  | 'Courier connection'
  | 'Failed deliveries'
  | 'Courier costs & invoices'
  | 'Tracking & webhooks'
  | 'Alerts'
  | 'Reseller stores'
  | 'Live chat'
  | 'Capacity';

/** Page order of the groups. */
export const SETTING_GROUP_ORDER: readonly SettingGroup[] = [
  'Charges',
  'Cash on delivery',
  'Wallet & withdrawals',
  'Inbound freight',
  'Invoices & tax',
  'Customer calls',
  'Orders',
  'Courier',
  'Stock holds',
  'Inventory',
  'Warehouse',
  'Failed deliveries',
  'Tracking & webhooks',
  'Courier connection',
  'Courier costs & invoices',
  'Alerts',
  'Reseller stores',
  'Live chat',
  'Capacity',
];

export interface SettingGuide {
  readonly name: string;
  readonly group: SettingGroup;
  /** What the setting decides, in one or two sentences. */
  readonly what: string;
  /** One worked example, with the default where it helps. */
  readonly example: string;
  /**
   * The choices for a setting whose value is one of a few codes (a STRING
   * setting's dropdown) or on/off (a BOOLEAN, keyed 'true' / 'false').
   * Each choice says what picking it does, with an example.
   */
  readonly values?: Readonly<Record<string, SettingOption>>;
  /**
   * Choices that come from the live system rather than from this file —
   * couriers, warehouses, courier accounts. Merged with `values` (which
   * then only carries words for the codes it knows, or the "none" choice).
   */
  readonly source?: OptionSource;
  /**
   * A JSON list setting whose items are drawn from a known set: shown as
   * checkboxes, saved as the same JSON array of codes.
   */
  readonly multi?: Readonly<Record<string, SettingOption>>;
}

/** One choice in a setting's dropdown or checkbox list. */
export interface SettingOption {
  readonly label: string;
  /** What choosing it does, in one sentence. */
  readonly does: string;
  /** What that looks like, with real numbers or behaviour. */
  readonly example: string;
}

/** Where a setting's choices are loaded from when they live in the system. */
export type OptionSource =
  | 'couriers'
  | 'fulfilling-warehouses'
  | 'intake-warehouses'
  | 'delhivery-accounts'
  | 'shiprocket-accounts';

function opt(label: string, does: string, example: string): SettingOption {
  return { label, does, example };
}

/** On and Off for a switch, each with what it does and an example. */
function onOff(
  on: readonly [does: string, example: string],
  off: readonly [does: string, example: string],
): Readonly<Record<string, SettingOption>> {
  return {
    true: opt('On', on[0], on[1]),
    false: opt('Off', off[0], off[1]),
  };
}

const AUTH_SCHEMES = {
  HMAC_SHA256: opt(
    'Signed by the courier (HMAC)',
    'Each update must carry a signature over its exact bytes made with our shared secret; anything else is refused and never stored.',
    'An update whose body was altered on the way arrives with a signature that no longer matches, and is answered 401.',
  ),
  SHARED_SECRET: opt(
    'Shared token in a header',
    'Each update must carry the fixed token we gave the courier in a header; a missing or wrong token is refused.',
    'Delhivery sends back the token from their webhook form on every push; a push without it is answered 401.',
  ),
} as const;

const FEE_CURRENCIES = (fee: string, taka: number, rupees: string) =>
  ({
    BDT: opt(
      'Taka (BDT)',
      `The ${fee} is agreed in taka and converted to rupees at the rate on record when the charge is taken.`,
      `A ${fee} of ${taka} means ৳${taka}, about ₹${rupees} at ৳1.23 to the rupee.`,
    ),
    INR: opt(
      'Rupees (INR)',
      `The ${fee} is agreed in rupees and charged as it stands, with no conversion.`,
      `A ${fee} of ${taka} means ₹${taka}.`,
    ),
  }) as const;

/** The 28 states and 8 union territories, as the seed lists them. */
const INDIAN_STATES: readonly string[] = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];

function byState(make: (state: string) => SettingOption): Readonly<Record<string, SettingOption>> {
  return Object.fromEntries(INDIAN_STATES.map((state) => [state, make(state)]));
}

const INVOICE_STATE_OPTIONS = byState((state) =>
  opt(
    state,
    `Every tax invoice names ${state} as the state we invoice from.`,
    `An invoice downloaded today reads "State: ${state}" under our address.`,
  ),
);

const INDIAN_STATE_OPTIONS = byState((state) =>
  opt(
    state,
    `An order that names ${state} as its state is accepted.`,
    `Unticked, a CSV order addressed to ${state} is refused at creation.`,
  ),
);

export const SETTING_GUIDE: Readonly<Record<string, SettingGuide>> = {
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

    values: FEE_CURRENCIES('delivery fee', 200, '162.60'),
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

    values: FEE_CURRENCIES('return fee', 30, '24.39'),
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

    values: FEE_CURRENCIES('customer return fee', 200, '162.60'),
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
      SETTLEMENT: opt(
        'When the courier pays us',
        'The COD is credited when the courier’s payout for that parcel is recorded, with no Instant Pay fee.',
        '₹1,180 COD delivered today: about a week later, when the courier pays, the seller is credited ₹990 (after ₹180 GST and a 1% handling fee).',
      ),
      INSTANT_PAY: opt(
        'Instant Pay, at delivery',
        'The COD is credited the moment the parcel is delivered, less the Instant Pay fee; Skydrop fronts the money until the courier pays.',
        '₹1,180 COD delivered today: credited ₹965 today (₹180 GST, 1% handling ₹10, 2.5% Instant Pay ₹25).',
      ),
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
      AT_DELIVERY: opt(
        'When the parcel is delivered',
        'The delivery charges leave the wallet when the parcel is delivered (or, for a parcel that comes back, when it is received).',
        'An order confirmed Monday and delivered Thursday is charged its ৳200 fee on Thursday.',
      ),
      AT_AWB: opt(
        'When the waybill is booked',
        'The delivery charges leave the wallet as soon as the courier waybill is booked, at order confirmation.',
        'An order confirmed Monday is charged its ৳200 fee on Monday, days before it reaches the customer.',
      ),
    },
  },
  'wallet.accrual_timing_tier': {
    name: 'Credit right away or after a delay',
    group: 'Cash on delivery',
    what: 'Whether a delivered order’s money moves into the wallet immediately, or after the number of days in "Delay before crediting", once the courier has paid Skydrop.',
    example:
      'On "After a delay" with a 7-day delay, a parcel delivered on the 1st is credited on the 8th.',
    values: {
      T_PLUS_N: opt(
        'After a delay',
        'A delivered order’s credits and charges are applied the number of days in "Delay before crediting" after delivery.',
        'With a 7-day delay, a parcel delivered on the 1st moves the wallet on the 8th.',
      ),
      INSTANT: opt(
        'Right away',
        'A delivered order’s credits and charges are applied the moment it is delivered.',
        'A parcel delivered at 3 pm moves the wallet at 3 pm the same day.',
      ),
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
    values: onOff(
      [
        'Once a day, at the chosen hour, everything the seller can withdraw is requested for them.',
        'At 10 am the seller’s withdrawable ₹8,000 is requested without them doing anything.',
      ],
      [
        'Nothing is requested automatically; the seller asks for each withdrawal themselves.',
        'The seller’s ₹8,000 stays in the wallet until they request it.',
      ],
    ),
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
    values: onOff(
      [
        'A waiting withdrawal the wallet can no longer cover is rejected automatically and the seller is told.',
        'A ₹3,000 request left facing a ₹500 balance is rejected within 15 minutes.',
      ],
      [
        'A waiting withdrawal stays waiting even when the wallet can no longer pay it, and blocks new requests.',
        'The ₹3,000 request sits pending against ₹500 until a person rejects it.',
      ],
    ),
  },

  'wallet.negative_balance_stock_backed': {
    name: 'Let stock in our warehouse raise that limit',
    group: 'Wallet & withdrawals',
    what: 'Whether the cost value of a seller’s stock sitting in our warehouse is added to "How far the wallet may go below zero". Their goods are what secures the debt.',
    example:
      'Limit ₹5,000 and ₹20,000 of stock at cost: with this on, new orders are refused only past −₹25,000.',
    values: onOff(
      [
        'A seller may go below zero by the flat limit plus the cost value of their stock in our warehouse.',
        'Limit ₹5,000 and ₹20,000 of stock: new orders are refused only past −₹25,000.',
      ],
      [
        'The flat limit is the whole allowance, whatever stock they hold.',
        'Limit ₹5,000: new orders are refused past −₹5,000 even with ₹20,000 of stock.',
      ],
    ),
  },
  'wallet.withdrawal_sla_hours': {
    name: 'Withdrawal processing time we promise (hours)',
    group: 'Wallet & withdrawals',
    what: 'What sellers are told to expect: a withdrawal request is paid within this many hours. Display only — it does not hold, delay or schedule anything.',
    example:
      'Set to 48: the seller’s wallet page says a request made on Monday morning is paid by Wednesday morning.',
  },
  'wallet.settlement_shortfall_alert_percent': {
    name: 'Alert when a courier payout is short by (%)',
    group: 'Cash on delivery',
    what: 'Sellers are credited what an order was worth even when the courier pays us less. A payout short by more than this percentage is flagged CRITICAL for a person to chase the courier.',
    example:
      'Set to 1: a payout expected at ₹50,000 that arrives as ₹49,300 (1.4% short) is flagged; one at ₹49,800 (0.4%) is absorbed quietly.',
  },

  // ── Inbound freight ─────────────────────────────────────────────────
  'wallet.inbound_freight_mode': {
    name: 'How Bangladesh → India freight is paid',
    group: 'Inbound freight',
    what: 'When the seller is billed for flying their stock into India: at our Bangladesh warehouse before it flies, in full when it lands, or bit by bit as each unit sells.',
    example:
      'On "Pay as it sells", a ৳10,000 bill for 100 units is charged ৳100 each time one of those units is delivered.',
    values: {
      PAY_ADVANCE: opt(
        'Pay before it flies',
        'The freight bill is raised at our Bangladesh warehouse after the count and taken in full before the goods may be sent to India.',
        'A consignment weighed at 40 kg at ৳250 a kg is billed ৳10,000 in Dhaka; it cannot leave until that bill exists.',
      ),
      PAY_NOW: opt(
        'Pay in full when it lands',
        'The freight bill is raised when the goods are counted in India and taken from the wallet in full at once.',
        'A ₹10,000 bill recorded on arrival leaves the wallet the same day.',
      ),
      PAY_LATER: opt(
        'Pay as it sells',
        'The freight bill (plus the service charge) is recovered unit by unit as the goods are delivered or written off.',
        'A ₹10,000 bill on 100 units at 2% is taken ₹102 each time one of those units is delivered.',
      ),
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
      'Tick only "Customer said no": the seller can ask for another call when the customer refused, not when nobody ever answered.',
    multi: {
      REJECTED_BY_CUSTOMER: opt(
        'Customer said no',
        'The seller may ask us to call again an order the customer refused on the phone.',
        'The customer declined on Monday; the seller asks for another call and, once approved, it goes back to the call queue.',
      ),
      REJECTED_NDR: opt(
        'Nobody answered',
        'The seller may ask us to call again an order rejected because the call attempts ran out.',
        'Three calls went unanswered; the seller asks for more attempts and the order is called again.',
      ),
    },
  },

  // ── Courier ─────────────────────────────────────────────────────────
  'ops.default_courier_code': {
    name: 'Courier for this seller’s parcels',
    group: 'Courier',
    what: 'Which courier new parcels are booked with. "manual" means no courier is booked automatically: every parcel waits for a person to arrange it.',
    example:
      'Set to shiprocket: this seller’s new orders are booked with Shiprocket instead of Delhivery.',
    values: {
      delhivery: opt(
        'Delhivery',
        'New parcels are booked with Delhivery at order confirmation.',
        'An order confirmed at 11 am gets a Delhivery waybill within a minute.',
      ),
      shiprocket: opt(
        'Shiprocket',
        'New parcels are booked through Shiprocket, which picks or is told the carrier.',
        'An order confirmed at 11 am is booked through Shiprocket with the carrier the selection policy chooses.',
      ),
      manual: opt(
        'Manual (a person arranges it)',
        'No courier is booked automatically; each parcel waits in manual placement for someone to arrange a courier and type its waybill.',
        'An order confirmed at 11 am sits in manual placement until an operator records the waybill from a paper docket.',
      ),
    },
    source: 'couriers',
  },
  'courier.selection_policy': {
    name: 'How the carrier is chosen (Shiprocket)',
    group: 'Courier',
    what: 'When a parcel goes through Shiprocket, which of their carriers to use. Has no effect on Delhivery parcels.',
    example: 'On "Cheapest", a parcel offered Blue Dart at ₹92 and Ekart at ₹69 goes with Ekart.',
    values: {
      SHIPROCKET_DEFAULT: opt(
        'Let Shiprocket choose',
        'We book without naming a carrier and Shiprocket ranks and picks one itself. No price lookup is made.',
        'A parcel to Pune goes with whichever carrier Shiprocket’s own ranking puts first.',
      ),
      CHEAPEST: opt(
        'Cheapest',
        'We ask Shiprocket for its carriers on the lane and book the lowest price.',
        'Offered Blue Dart ₹92 (2 days) and Ekart ₹69 (5 days), the parcel goes with Ekart.',
      ),
      FASTEST: opt(
        'Fastest',
        'We book the carrier with the shortest delivery estimate; a carrier with no estimate is ranked last.',
        'Offered Blue Dart ₹92 (2 days) and Ekart ₹69 (5 days), the parcel goes with Blue Dart.',
      ),
      CHEAPEST_WITHIN_DAYS: opt(
        'Cheapest within a day limit',
        'We book the cheapest carrier that delivers within "Day limit for cheapest within"; if none does, the fastest.',
        'With a 3-day limit, Blue Dart ₹92 (2 days) wins over Ekart ₹69 (5 days).',
      ),
      MANUAL: opt(
        'A person chooses each time',
        'The parcel waits on the courier decisions screen for someone to pick the carrier; after the wait limit the cheapest is booked and staff are alerted.',
        'A parcel confirmed at 10 am waits on /courier-decisions; unchosen by 4 pm, the cheapest carrier is booked.',
      ),
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
    values: onOff(
      [
        'Stock is held the moment an order is placed, before the call centre confirms it.',
        'A seller with 5 units gets 5 orders in a minute; a 6th order sees no stock at once.',
      ],
      [
        'Stock is held only when the call centre confirms the order.',
        'All 6 orders are accepted; the 6th finds no stock when it is confirmed and goes out of stock.',
      ],
    ),
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
      MANUAL_REVIEW: opt(
        'Ask the seller',
        'The order pauses and the seller decides whether we keep calling or give up; any stock held stays held until they answer.',
        'After 3 unanswered calls the order waits on the seller’s review list; they choose "keep trying" and it goes back to the call queue.',
      ),
      AUTO_RELEASE: opt(
        'Reject it straight away',
        'The order is rejected as unreachable at once and any stock held for it goes back on sale.',
        'After 3 unanswered calls the order is rejected and its 2 held units are sellable again immediately.',
      ),
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
    values: onOff(
      [
        'This seller’s reseller stores may place orders (portal, CSV and API).',
        'A store places an order for 2 kurtas and it goes to our call centre.',
      ],
      [
        'Every order a reseller store tries to place is refused; they can still sign in and browse.',
        'The store’s order is refused with RESELLER_ORDERS_DISABLED.',
      ],
    ),
  },
  'reseller.credit_after_confirmation_enabled': {
    name: 'Reseller terms may pay after phone confirmation',
    group: 'Reseller stores',
    what: 'Whether this seller may give a reseller store terms that pay out a number of days after the order is confirmed on the phone, before the customer has paid. Changed with its own control in the reseller section of this page, because it needs a reason; the Override button here is refused.',
    example:
      'On: a store’s terms can say "credited 3 days after confirmation" instead of "after delivery".',
    values: onOff(
      [
        'A reseller store’s terms may pay out a set number of days after phone confirmation.',
        'Terms can say "credited 3 days after confirmation".',
      ],
      [
        'Terms may only pay out on or after delivery; stores already on confirmation terms are flagged and cannot order.',
        'A new terms version using "after confirmation" is refused.',
      ],
    ),
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

  // ── Invoices & tax ──────────────────────────────────────────────────
  'invoice.company_name': {
    name: 'Company name on our invoices',
    group: 'Invoices & tax',
    what: 'The legal company name printed at the top of every GST tax invoice we issue.',
    example:
      'Set to "Skydrop Logistics Pvt Ltd": every invoice a seller downloads is headed with that name.',
  },
  'invoice.gstin': {
    name: 'Our GSTIN on invoices',
    group: 'Invoices & tax',
    what: 'Skydrop’s GST registration number, printed on every tax invoice. Leave it empty until the registration is complete.',
    example:
      'Empty today, so invoices carry no GSTIN; once registered, paste the 15-character number and every new invoice shows it.',
  },
  'invoice.address': {
    name: 'Our address on invoices',
    group: 'Invoices & tax',
    what: 'The address printed under the GSTIN on every tax invoice. Free text; it may run over several lines.',
    example:
      'Set to "Bengaluru, Karnataka, India": that line appears under our name on each invoice.',
  },
  'invoice.state': {
    name: 'Our state on invoices',
    group: 'Invoices & tax',
    what: 'The Indian state printed as ours on every tax invoice, under our address.',
    example:
      'Set to Karnataka: every invoice a seller downloads reads "State: Karnataka" in our block.',
    values: INVOICE_STATE_OPTIONS,
  },
  'pricing.flat_fee_gst_percent': {
    name: 'GST on our delivery and return fees (%)',
    group: 'Invoices & tax',
    what: 'GST added on top of the flat delivery and return fees. At 0 the fee is what the seller pays, full stop. The same for every seller — a tax rate is not negotiated per seller.',
    example: 'Set to 18: a ₹162.60 delivery fee carries ₹29.27 of GST, so the seller pays ₹191.87.',
  },
  'pricing.gst_rate': {
    name: 'GST rate on goods when a product has none (%)',
    group: 'Invoices & tax',
    what: 'The GST rate used for a product when neither the variant nor the product states its own. Used for customs values and invoices.',
    example: 'Set to 18: a product added without a GST rate is treated as 18%.',
  },
  'pricing.fx_fallback_inr_to_bdt': {
    name: 'Back-up rupee to taka rate (not used)',
    group: 'Invoices & tax',
    what: 'Meant as the rate to fall back on if fetching exchange rates failed. Nothing reads it today: rates are entered on the FX screen, and a missing rate is refused rather than guessed.',
    example:
      'Set to 1.35: changing it has no effect; to change the rate charges use, edit it on the FX rates screen.',
  },

  // ── Customer calls (global only) ────────────────────────────────────
  'ops.call_max_attempts': {
    name: 'Call attempts (older setting, not used)',
    group: 'Customer calls',
    what: 'An earlier version of "Call attempts before giving up". Nothing reads it any more; the call centre follows "Call attempts before giving up" instead.',
    example:
      'Set to 3: changing it changes nothing. Change "Call attempts before giving up" instead.',
  },
  'ops.call_assignment_timeout_minutes': {
    name: 'Time an agent has to act on a pulled call (minutes)',
    group: 'Customer calls',
    what: 'When an agent pulls the next order to call and does nothing with it for this long, it goes back to the queue in its original place for someone else.',
    example:
      'Set to 15: an agent pulls an order at 10:00 and walks away; at 10:15 the next agent can take it.',
  },
  'ops.agent_presence_timeout_minutes': {
    name: 'Agent marked away after (minutes)',
    group: 'Customer calls',
    what: 'An agent who says they are available but has not been seen at the call station for this long is marked unavailable, and any order they were holding goes back to the queue.',
    example:
      'Set to 10: an agent leaves the tab open and goes to lunch; ten minutes later they stop receiving calls.',
  },
  'ops.call_reschedule_min_hours': {
    name: 'Earliest call-back time (hours ahead)',
    group: 'Customer calls',
    what: 'When a customer asks to be called back, the call-back must be at least this far in the future.',
    example: 'Set to 1: at 10:00 an agent can book a call-back for 11:00 or later, not 10:30.',
  },
  'ops.call_reschedule_max_days': {
    name: 'Latest call-back time (days ahead)',
    group: 'Customer calls',
    what: 'When a customer asks to be called back, the call-back may be at most this far in the future.',
    example:
      'Set to 7: a customer asking to be called in two weeks is booked no later than 7 days out.',
  },
  'ops.call_busy_retry_delay_hours': {
    name: 'Wait after a busy line (hours)',
    group: 'Customer calls',
    what: 'When the customer’s line is busy, the order comes back to the call queue after this many hours.',
    example: 'Set to 1: busy at 2 pm, called again from 3 pm.',
  },

  // ── Orders ──────────────────────────────────────────────────────────
  'ops.allowed_indian_states': {
    name: 'States and territories we deliver to',
    group: 'Orders',
    what: 'The list of Indian states and union territories an order may be addressed to. Only checked when the order gives a state — orders from the seller form do not, and are checked by the courier from the PIN code instead.',
    example: 'Untick Ladakh: a CSV order addressed to Ladakh is refused at creation.',
    multi: INDIAN_STATE_OPTIONS,
  },
  'ops.csv_max_order_rows': {
    name: 'Largest order CSV (rows, not used)',
    group: 'Orders',
    what: 'Meant to cap how many rows one bulk order CSV may have. Nothing reads it today: the limit comes from the server’s own configuration (1,000 rows).',
    example: 'Set to 1000: changing it has no effect on uploads.',
  },
  'ops.order_draft_ttl_hours': {
    name: 'Draft orders kept for (hours, not used yet)',
    group: 'Orders',
    what: 'How long a draft order is meant to be kept before it can be cleaned up. The clean-up has not been built, so drafts are kept however old they are.',
    example: 'Set to 72: a draft from last week is still there; nothing removes it yet.',
  },

  // ── Courier (global only) ───────────────────────────────────────────
  'courier.default_account_delhivery': {
    name: 'Default Delhivery account',
    group: 'Courier',
    what: 'Which Delhivery account carries a parcel when the seller has no courier accounts of their own. The value is the account’s id. Empty means any active one — fine with one account, a coin toss with several.',
    example:
      'Empty with one Delhivery account: every Delhivery parcel uses it. With a second account added, set this so parcels do not split between them by chance.',
    values: {
      '': opt(
        'Any active account',
        'A parcel from a seller without their own accounts goes to any active Delhivery account.',
        'With one Delhivery account every parcel uses it; with two, either may be used.',
      ),
    },
    source: 'delhivery-accounts',
  },
  'courier.default_account_shiprocket': {
    name: 'Default Shiprocket account',
    group: 'Courier',
    what: 'The Shiprocket half of the same choice. Empty means Shiprocket is left out of the default split altogether.',
    example:
      'Empty: sellers without their own accounts never go through Shiprocket, whatever the Delhivery share says.',
    values: {
      '': opt(
        'None — Shiprocket is not in the default split',
        'Sellers without their own accounts never go through Shiprocket, whatever the share says.',
        'With the Delhivery share at 70, all 100 parcels still go to Delhivery.',
      ),
    },
    source: 'shiprocket-accounts',
  },
  'courier.delhivery_share_percent': {
    name: 'Share of parcels to Delhivery (%)',
    group: 'Courier',
    what: 'How the two default accounts split the parcels of sellers with no split of their own. Decided per parcel by a weighted draw, so it is reached over many parcels, not exactly.',
    example: 'Set to 70: out of 100 parcels, about 70 go to Delhivery and 30 to Shiprocket.',
  },
  'courier.delhivery_pickup_location': {
    name: 'Delhivery pickup location name',
    group: 'Courier',
    what: 'The name of our warehouse as registered on Delhivery’s portal. Sent with every booking and pickup request, and matched exactly — a different spelling is refused. An account’s own location name wins over this.',
    example:
      'Set to "SKYDROP CCU": every Delhivery booking asks for collection from that location.',
  },
  'courier.shiprocket_pickup_location': {
    name: 'Shiprocket pickup location name',
    group: 'Courier',
    what: 'The name of our warehouse as registered on Shiprocket (Settings → Pickup Addresses), matched exactly when a parcel is booked. An account’s own location name wins over this.',
    example:
      'Set to "Primary": Shiprocket bookings collect from the address registered under that name.',
  },
  'courier.delhivery_origin_pincode': {
    name: 'Delhivery origin PIN code',
    group: 'Courier',
    what: 'The PIN code our parcels leave from. Delhivery quotes delivery time and cost between two PIN codes, so without it those lookups cannot be made.',
    example:
      'Set to 700001: the expected delivery time for a parcel to 110001 is asked for Kolkata → Delhi.',
  },
  'courier.shiprocket_return_address': {
    name: 'Shiprocket return address',
    group: 'Courier',
    what: 'Where a Shiprocket customer return is delivered to — our warehouse. Required before a Shiprocket return collection can be booked; a partly filled address is refused rather than sent.',
    example:
      '{"name":"Skydrop","addressLine1":"…","city":"Kolkata","state":"West Bengal","pincode":"700001","phone":"…"}: returns come back to that door.',
  },
  'courier.default_pickup_time': {
    name: 'Automatic pickup time asked for',
    group: 'Courier',
    what: 'The collection time sent to the courier when the first box of the day asks for a van automatically. A box packed after this time asks for tomorrow’s van.',
    example:
      'Set to 18:00:00: a box closed at 11 am asks for a 6 pm collection today; one closed at 7 pm asks for 6 pm tomorrow.',
  },
  'courier.delhivery_auto_pickup_enabled': {
    name: 'Ask Delhivery for the daily van automatically',
    group: 'Courier',
    what: 'When on, the first box closed each day at a warehouse asks Delhivery for a pickup; later boxes that day do nothing, because one van covers the building. Off means every pickup is raised by hand on the Pickups screen.',
    example:
      'On: the first Delhivery parcel packed at 9 am books the day’s van; the next 30 boxes book nothing more.',
    values: onOff(
      [
        'The first Delhivery box packed each day at a warehouse asks Delhivery for that day’s van.',
        'The box closed at 9 am books a 6 pm pickup; the next 30 boxes book nothing more.',
      ],
      [
        'No pickup is requested automatically; vans are raised by hand on the Pickups screen.',
        'Nobody raises a pickup and no van comes.',
      ],
    ),
  },
  'courier.shiprocket_auto_pickup_enabled': {
    name: 'Ask Shiprocket for the daily van automatically',
    group: 'Courier',
    what: 'The Shiprocket half of the same switch: the first Shiprocket box of the day asks for a pickup, once per warehouse per day.',
    example: 'Off: Shiprocket pickups are raised by hand on the Pickups screen.',
    values: onOff(
      [
        'The first Shiprocket box packed each day at a warehouse asks Shiprocket for that day’s van.',
        'The box closed at 9 am books today’s Shiprocket pickup.',
      ],
      [
        'No Shiprocket pickup is requested automatically.',
        'Shiprocket pickups are raised by hand on the Pickups screen.',
      ],
    ),
  },
  'courier.ticket_automation_enabled': {
    name: 'Raise seller issues with the courier automatically',
    group: 'Courier',
    what: 'When on, an issue a seller raises on a Delhivery parcel is sent through Delhivery’s portal by software. When off, every issue waits for a person to take it to the courier. Only affects issues raised after the change.',
    example:
      'Off: a seller reports a parcel stuck for a week, and the ticket says clearly that a person must raise it with Delhivery.',
    values: onOff(
      [
        'A seller’s issue on a Delhivery parcel is raised through Delhivery’s portal by software, falling back to a person if that fails.',
        'A "parcel stuck" issue raised at 11 am is filed with Delhivery by 11:15.',
      ],
      [
        'Every issue waits for a person to raise it with the courier by hand.',
        'The "parcel stuck" ticket shows as ours to take to Delhivery.',
      ],
    ),
  },
  'courier.delhivery_support_email': {
    name: 'Delhivery support email',
    group: 'Courier',
    what: 'The address an operator emails Delhivery support at, shown beside every Delhivery message waiting to be sent. Nothing is emailed automatically.',
    example:
      'Set to Delhivery’s support address: the send queue shows it next to each message, ready to copy.',
  },
  'courier.shiprocket_support_email': {
    name: 'Shiprocket support email',
    group: 'Courier',
    what: 'The address an operator emails Shiprocket support at, shown beside every Shiprocket message waiting to be sent. Nothing is emailed automatically.',
    example:
      'Empty: the send queue shows no address for Shiprocket messages until one is filled in.',
  },

  // ── Inventory ───────────────────────────────────────────────────────
  'inventory.default_inventory_mode': {
    name: 'How stock is tracked (default)',
    group: 'Inventory',
    what: 'Whether a seller’s stock is counted by quantity, or each unit carries its own serial that is scanned at pick, pack and return. This is the default; it can be changed per seller on the seller’s page.',
    example:
      'On "Serial per unit", 3 phones on an order need 3 serial scans at the pick shelf and again at the pack bench.',
    values: {
      NORMAL: opt(
        'By quantity',
        'Stock is counted in quantities; the pack bench checks each product by its SKU barcode.',
        '3 identical phones on an order: the packer scans the SKU sticker three times.',
      ),
      STRICT: opt(
        'Serial per unit',
        'Every unit carries its own serial, scanned at pick, pack and return, so the exact unit sent is on record.',
        '3 phones on an order: 3 named serials are scanned at the shelf and the same 3 at the pack bench.',
      ),
    },
  },
  'inventory.strict_unit_serial_prefix': {
    name: 'Prefix for serials we print',
    group: 'Inventory',
    what: 'The letters at the start of the serials we generate for a unit that arrives with no usable barcode. Cosmetic only.',
    example: 'Set to SDU: a unit we label reads like SDU-8F3K2Q.',
  },
  'inventory.unit_stuck_sla_hours': {
    name: 'Serial unit stuck after (hours)',
    group: 'Inventory',
    what: 'How long a serial-tracked unit may sit picked or packed before the unit discrepancy report lists it as stuck — a scan that should have happened and did not.',
    example:
      'Set to 48: a unit picked on Monday morning and still not packed on Wednesday morning is listed.',
  },
  'inventory.unit_dispatched_unresolved_days': {
    name: 'Dispatched unit unresolved after (days)',
    group: 'Inventory',
    what: 'How long a serial-tracked unit may stay dispatched before the discrepancy report lists it. Delivery produces no unit scan, so age is how a unit that never came back and was never confirmed shows up.',
    example: 'Set to 30: a unit dispatched on 1 March and not returned is listed from 31 March.',
  },
  'ops.stock_adjustment_approval_threshold_inr': {
    name: 'Stock adjustments needing approval (₹ value)',
    group: 'Inventory',
    what: 'A stock correction worth at least this much (in either direction) waits for an admin to approve it; a smaller one is applied at once.',
    example:
      'Set to 50,000: writing off 10 units at ₹6,000 each (₹60,000) waits for approval; 5 units (₹30,000) is applied straight away.',
  },
  'ops.stock_alert_cooldown_hours': {
    name: 'Low-stock alert quiet period (hours)',
    group: 'Inventory',
    what: 'After a low-stock alert for a product, no new alert is sent for it until stock has recovered and this many hours have passed.',
    example:
      'Set to 24: a product dips below its threshold at 9 am and the seller is told once, not again that day.',
  },

  // ── Warehouse ───────────────────────────────────────────────────────
  'ops.default_warehouse_id': {
    name: 'Default warehouse',
    group: 'Warehouse',
    what: 'The warehouse used when a request does not name one — where stock and new parcels go by default. The value is the warehouse’s id.',
    example:
      'Set to the id of CCU-01: a consignment created without a warehouse is received there.',
    source: 'fulfilling-warehouses',
  },
  'ops.bd_intake_warehouse_id': {
    name: 'Bangladesh intake warehouse',
    group: 'Warehouse',
    what: 'The warehouse in Bangladesh that receives consignments before they travel to India. Must be a warehouse that does not fulfil orders. Empty means sellers cannot send stock via Bangladesh.',
    example:
      'Empty: a seller choosing "via Bangladesh" for a consignment is refused until this is set to the Dhaka warehouse’s id.',
    values: {
      '': opt(
        'None — sending via Bangladesh is off',
        'No Bangladesh warehouse is set, so consignments cannot be routed via Bangladesh.',
        'A seller choosing "via Bangladesh" for a consignment is refused with BD_WAREHOUSE_NOT_CONFIGURED.',
      ),
    },
    source: 'intake-warehouses',
  },
  'ops.pack_box_timeout_minutes': {
    name: 'Open pack box released after (minutes)',
    group: 'Warehouse',
    what: 'A box left open at the pack bench longer than this is released: its scans are discarded and the parcel goes back to the pack queue, so a box abandoned at the end of a shift does not block the order or the packer.',
    example: 'Set to 60: a box opened at 5:30 pm and left is back in the queue by 6:30 pm.',
  },
  'ops.pick_task_timeout_hours': {
    name: 'Unfinished pick released after (hours)',
    group: 'Warehouse',
    what: 'A parcel whose pick was started and not finished within this many hours is made pickable again for someone else.',
    example:
      'Set to 4: a pick started at 10 am and never finished can be picked by anyone from 2 pm.',
  },
  'ops.pick_allocation_retry_max': {
    name: 'Retries when two pickers clash over stock',
    group: 'Warehouse',
    what: 'How many times choosing the shelf and batch for a pick is tried again when another pick changed the same stock at the same moment, before the parcel is sent to manual placement.',
    example: 'Set to 3: a clash is retried up to three times, which almost always succeeds.',
  },
  'ops.pick_allocation_retry_backoff_ms': {
    name: 'Wait between those retries (ms)',
    group: 'Warehouse',
    what: 'How long to wait before each of those retries, in milliseconds, as a list.',
    example: '[100,250,500]: wait 0.1 s, then 0.25 s, then 0.5 s.',
  },
  'ops.bin_snapshot_retention_months': {
    name: 'Keep bin layout backups for (months)',
    group: 'Warehouse',
    what: 'When all of a warehouse’s bins are merged into its floor, a backup of the old layout is kept for this long, so it can be restored. After that it is deleted.',
    example: 'Set to 3: bins merged on 1 January can be restored until 1 April.',
  },
  'ops.handover_scan_required': {
    name: 'Every parcel must be scanned before handover',
    group: 'Warehouse',
    what: 'When on, a parcel cannot be handed to the driver until it has been scanned at the handover bench — the screen and the API both refuse it. Off skips that extra step.',
    example:
      'On: a supervisor tries to confirm a van of 40 parcels, 2 never scanned; those 2 are refused.',
    values: onOff(
      [
        'A parcel must be scanned at the handover bench before it can be given to the driver; unscanned parcels are refused.',
        'Confirming a van of 40 with 2 unscanned: those 2 are refused.',
      ],
      [
        'Parcels can be handed over without the extra scan.',
        'All 40 parcels are handed over on confirmation.',
      ],
    ),
  },
  'ops.handover_scan_dispatches': {
    name: 'The handover scan dispatches the parcel',
    group: 'Warehouse',
    what: 'When on, scanning a parcel at the handover bench is the handover: the order is dispatched there and then, and the manifest closes itself after its last parcel. When off, the scan only records a check and a supervisor confirms the handover.',
    example:
      'On: the driver’s 12 parcels are scanned one by one; each order shows dispatched the moment it is scanned.',
    values: onOff(
      [
        'Scanning a parcel at the handover bench dispatches it there and then; the manifest closes itself after the last parcel.',
        'Each of 12 parcels shows dispatched the moment it is scanned.',
      ],
      [
        'The scan only records a check; a supervisor confirms the handover per manifest.',
        'The 12 parcels stay packed until the supervisor confirms the manifest.',
      ],
    ),
  },

  // ── Failed deliveries ───────────────────────────────────────────────
  'ops.nsa_enabled': {
    name: 'Flag parcels still out for delivery in the evening',
    group: 'Failed deliveries',
    what: 'When on, an evening check flags parcels still out for delivery after the cutoff hour as needing the seller’s attention. Turning it off stops new flags; flags already raised stay.',
    example:
      'On with a 6 pm cutoff: a parcel still out for delivery at 7 pm is flagged to the seller.',
    values: onOff(
      [
        'Each evening, parcels still out for delivery after the cutoff are flagged to the seller as needing attention.',
        'A parcel still with the van at 7 pm shows on the seller’s attention list.',
      ],
      [
        'No new flags are raised; flags already raised stay.',
        'The parcel still out at 7 pm is not flagged.',
      ],
    ),
  },
  'ops.nsa_cutoff_hour': {
    name: 'Evening cutoff for that check (hour, India time)',
    group: 'Failed deliveries',
    what: 'The hour, in India time, after which a parcel still out for delivery counts as stuck for the day.',
    example: 'Set to 18: at 6 pm the van is back and the customer has not been reached.',
  },
  'ops.nsa_max_days': {
    name: 'Days that flag counts up to',
    group: 'Failed deliveries',
    what: 'The flag shows how many nights a parcel has been stuck, up to this number. It stays raised after that; only the count stops rising.',
    example: 'Set to 3: a parcel stuck for five nights shows "3+", and is still flagged.',
  },
  'courier.ndr_runner_enabled': {
    name: 'Nightly automatic re-attempts',
    group: 'Failed deliveries',
    what:
      'The on/off switch for the nightly run that asks the courier to re-attempt failed deliveries. Off stops it at its next run without a deploy; requests already sent are still followed up. ' +
      'Set for one seller, this can only switch it OFF for them — never on. The system-wide switch is the one that decides whether anything runs at all, so with it off nothing is sent for anybody, whatever a seller is set to.',
    example:
      'Off: nothing is asked of the courier at night; re-attempts are requested by hand. Set to On for one seller while the system-wide switch is Off: still nothing is sent for them.',
    values: onOff(
      [
        'Each night the runner asks the courier to re-attempt eligible failed deliveries, for the actions allowed — provided the system-wide switch is also on.',
        'At 9:35 pm Dhaka time 18 failed parcels are submitted for another attempt.',
      ],
      [
        'The nightly runner sends nothing; requests already sent are still followed up. Set for one seller, only that seller’s parcels are left alone.',
        'Failed deliveries are re-attempted only when a person asks.',
      ],
    ),
  },
  'courier.ndr_runner_cron': {
    name: 'When the nightly re-attempt run happens',
    group: 'Failed deliveries',
    what: 'The schedule of that run, as a cron line in Dhaka time. It runs after Delhivery’s 9 pm India cutoff, once the day’s deliveries have closed.',
    example: '"35 21 * * *" means 9:35 pm Dhaka time every day.',
  },
  'courier.ndr_auto_categories': {
    name: 'Actions the nightly run may take',
    group: 'Failed deliveries',
    what:
      'Which actions the nightly run may send on its own, as a list: "RE-ATTEMPT" and/or "PICKUP_RESCHEDULE". Empty means it prepares and logs but sends nothing. ' +
      'Set for one seller, this can only take actions AWAY — the system-wide list is the ceiling, and the seller gets whichever actions appear on both lists.',
    example:
      'Tick only "Re-attempt delivery": failed deliveries are re-attempted automatically; pickup reschedules still need a person. Nothing ticked: the run prepares and logs but sends nothing. ' +
      'System-wide list has only "Re-attempt delivery" and a seller is set to both: that seller still only gets re-attempts.',
    multi: {
      'RE-ATTEMPT': opt(
        'Re-attempt delivery',
        'The nightly run may ask the courier to try delivering a failed parcel again, unattended — provided this is also ticked system-wide.',
        'A parcel whose customer was out on Tuesday is submitted at 9:35 pm for another attempt on Wednesday.',
      ),
      PICKUP_RESCHEDULE: opt(
        'Reschedule pickup',
        'The nightly run may ask the courier to reschedule a failed reverse pickup, unattended — provided this is also ticked system-wide.',
        'A return collection that failed today is rebooked for tomorrow without anyone asking.',
      ),
    },
  },
  'courier.ndr_batch_max': {
    name: 'Most re-attempts in one night',
    group: 'Failed deliveries',
    what: 'The most parcels the nightly run submits in one night, so a mistake cannot summon a van for every parcel at once.',
    example: 'Set to 50: with 80 eligible parcels, 50 are submitted tonight and the rest wait.',
  },
  'courier.ndr_upl_poll_cron': {
    name: 'How often we check on a re-attempt request',
    group: 'Failed deliveries',
    what: 'How often Delhivery is asked what happened to a re-attempt we submitted, as a cron line.',
    example: '"*/20 * * * *" means every 20 minutes.',
  },
  'courier.ndr_upl_poll_deadline_minutes': {
    name: 'Re-attempt request counted as failed after (minutes)',
    group: 'Failed deliveries',
    what: 'A re-attempt request Delhivery has not answered within this many minutes is treated as failed, so a person chases it.',
    example:
      'Set to 240: a request sent at 9:35 pm with no answer by 1:35 am is passed to a person.',
  },
  'courier.ndr_reconciliation_cron': {
    name: 'When we check re-attempts really happened',
    group: 'Failed deliveries',
    what: 'The daily check of whether confirmed re-attempts produced a new delivery attempt in tracking, as a cron line in Dhaka time.',
    example: '"0 12 * * *" means every day at noon.',
  },
  'courier.ndr_reconciliation_window_hours': {
    name: 'Time a re-attempt has to show up (hours)',
    group: 'Failed deliveries',
    what: 'How long after a confirmed re-attempt a new delivery attempt may still appear before we count it as not done.',
    example:
      'Set to 48: confirmed Monday night, a new attempt scan by Wednesday night counts as done.',
  },
  'courier.ndr_reconciliation_alert_percent': {
    name: 'Alert when this share of re-attempts never happened (%)',
    group: 'Failed deliveries',
    what: 'Raises an alert when more than this share of confirmed re-attempts produced no new attempt. It is the only check that catches the courier accepting our requests and not acting on them.',
    example:
      'Set to 25: 12 of 40 confirmed re-attempts (30%) never happened, so an alert is raised.',
  },

  // ── Tracking & webhooks ─────────────────────────────────────────────
  'courier.tracking_poll_auto_recover_enabled': {
    name: 'Restart tracking automatically when it stalls',
    group: 'Tracking & webhooks',
    what: 'When tracking has not completed a cycle for 45 minutes, restart its schedule and run a cycle straight away instead of waiting for a person. The alert is raised either way.',
    example:
      'On: tracking stops updating at 3 am; it is restarted within the hour without anybody pressing a button.',
    values: onOff(
      [
        'A tracking poll with no successful cycle for 45 minutes is restarted and run once, with nobody pressing a button.',
        'Tracking stalls at 3 am and is running again by 3:45 am.',
      ],
      [
        'A stalled poll only raises its alert; a person must press "Run a cycle now".',
        'Tracking stalls at 3 am and stays stalled until someone restarts it.',
      ],
    ),
  },
  'courier.tracking_poll_last_run_at': {
    name: 'Last completed tracking cycle',
    group: 'Tracking & webhooks',
    what: 'The time tracking last finished a cycle, written by the system after every run. If it stops moving, no parcel is updating. Not meant to be edited by hand.',
    example:
      'Showing 10:40 when it is now 12:00: no parcel has had a tracking update for over an hour.',
  },
  'tracking.webhook_auth_scheme': {
    name: 'How courier updates are checked (default)',
    group: 'Tracking & webhooks',
    what: 'How an incoming tracking update from a courier is proven to be genuine, when that courier has no setting of its own: a signature over the message, or a fixed token in a header.',
    example:
      'On "Signed by the courier", an update whose signature does not match is refused and never stored.',
    values: AUTH_SCHEMES,
  },
  'tracking.webhook_auth_scheme.delhivery': {
    name: 'How Delhivery updates are checked',
    group: 'Tracking & webhooks',
    what: 'The same choice for Delhivery. Delhivery does not sign its updates; it sends back the token we gave it, so this stays "Shared token" unless that changes.',
    example: 'On "Shared token", a Delhivery update without our token in its header is refused.',
    values: AUTH_SCHEMES,
  },
  'tracking.webhook_auth_scheme.shiprocket': {
    name: 'How Shiprocket updates are checked',
    group: 'Tracking & webhooks',
    what: 'The same choice for Shiprocket, which also sends back a fixed token rather than signing.',
    example: 'On "Shared token", a Shiprocket push without our token in its header is refused.',
    values: AUTH_SCHEMES,
  },
  'tracking.webhook_secret_ref': {
    name: 'Where the Delhivery update token is kept',
    group: 'Tracking & webhooks',
    what: 'The name of the server environment variable that holds the token Delhivery must send. The token itself is never stored in the database or shown here.',
    example:
      'Set to TRACKING_WEBHOOK_SECRET_DELHIVERY: the server reads the token from that variable on the server.',
  },
  'tracking.webhook_secret_ref.shiprocket': {
    name: 'Where the Shiprocket update token is kept',
    group: 'Tracking & webhooks',
    what: 'The name of the server environment variable that holds the token Shiprocket sends. If that variable is empty, every Shiprocket update is refused.',
    example:
      'Set to TRACKING_WEBHOOK_SECRET_SHIPROCKET: the token lives in that variable on the server.',
  },
  'tracking.public_lookup_rate_limit_per_min': {
    name: 'Public tracking lookups per visitor per minute',
    group: 'Tracking & webhooks',
    what: 'How many times one internet address may look up a waybill on the public tracking page per minute, so nobody can run through waybill numbers. Takes effect within a minute; a zero or unreadable value falls back to 30.',
    example: 'Set to 30: the 31st lookup from one address within a minute is refused.',
  },
  'tracking.webhook_processing_retry_max': {
    name: 'Tries to process a courier update',
    group: 'Tracking & webhooks',
    what: 'How many times a stored courier update is tried before it is left marked failed for someone to look at.',
    example: 'Set to 3: an update that fails three times stays failed and visible.',
  },
  'tracking.webhook_payload_retention_days': {
    name: 'Keep raw courier messages for (days)',
    group: 'Tracking & webhooks',
    what: 'After this many days the raw body of each courier update is blanked to save space. The record that it arrived, whether it was genuine and what it changed is kept forever.',
    example:
      'Set to 90: a scan from January keeps its timeline entry, but its raw message is gone by May.',
  },
  'webhooks.auto_disable_after_consecutive_failures': {
    name: 'Seller webhook switched off after failures (not used)',
    group: 'Tracking & webhooks',
    what: 'Meant as the number of failed deliveries in a row after which a seller’s webhook is switched off. Nothing reads it today: the sending code uses its own built-in limit.',
    example: 'Set to 50: changing it has no effect.',
  },
  'webhooks.max_retry_attempts': {
    name: 'Seller webhook retries (not used)',
    group: 'Tracking & webhooks',
    what: 'Meant as how many times a delivery to a seller’s webhook is retried. Nothing reads it today: retries follow a fixed built-in schedule.',
    example: 'Set to 5: changing it has no effect.',
  },

  // ── Courier connection ──────────────────────────────────────────────
  'courier.delhivery_api_base_url': {
    name: 'Delhivery API address',
    group: 'Courier connection',
    what: 'The address we call Delhivery at. Empty means practice mode: made-up answers, no network. Setting it alone only allows reading; bookings also need "Delhivery live writes".',
    example:
      'Set to https://track.delhivery.com: tracking and quotes come from the real Delhivery.',
  },
  'courier.shiprocket_api_base_url': {
    name: 'Shiprocket API address',
    group: 'Courier connection',
    what: 'The address we call Shiprocket at. Empty means practice mode. Bookings also need "Shiprocket live writes"; the login lives with the courier account, not here.',
    example: 'Set to https://apiv2.shiprocket.in: Shiprocket is reached for real.',
  },
  'courier.delhivery_live_writes_enabled': {
    name: 'Delhivery live writes',
    group: 'Courier connection',
    what: 'When off, we refuse any Delhivery call that does something in the real world — book a parcel, cancel or edit one, ask for a van, request a re-attempt — while still allowing reads. There is no sandbox: every write is a real parcel or a real van.',
    example: 'Off: confirming an order books no waybill, and each refused attempt is audited.',
    values: onOff(
      [
        'Delhivery bookings, cancels, pickups and re-attempts are really sent — each one a real parcel, van or cancellation.',
        'Confirming an order books a real Delhivery waybill.',
      ],
      [
        'Every Delhivery call that would change something is refused and audited; reads still work.',
        'Confirming an order books no waybill, and the refusal is audited HIGH.',
      ],
    ),
  },
  'courier.shiprocket_live_writes_enabled': {
    name: 'Shiprocket live writes',
    group: 'Courier connection',
    what: 'The same switch for Shiprocket: off refuses every booking, cancel, pickup and re-attempt, while reads still work.',
    example: 'Off: a parcel that fails over from Delhivery to Shiprocket is not booked.',
    values: onOff(
      [
        'Shiprocket bookings, cancels, pickups and re-attempts are really sent.',
        'A parcel Delhivery refuses fails over and is booked with Shiprocket.',
      ],
      [
        'Every Shiprocket call that would change something is refused and audited; reads still work.',
        'The failover to Shiprocket is refused and the parcel goes to manual placement.',
      ],
    ),
  },
  'courier.delhivery_waybill_pool_refill_enabled': {
    name: 'Refill the Delhivery waybill pool automatically',
    group: 'Courier connection',
    what: 'Whether a job every 15 minutes fetches spare waybill numbers from Delhivery into a pool. Off because nothing uses the pool yet — bookings get their number from Delhivery directly — so on would claim real waybills for nothing.',
    example:
      'Off: the pool stays as it is; an operator can still fill it from the Delhivery screen.',
    values: onOff(
      [
        'Every 15 minutes, if the pool is below the low-water mark, spare waybills are fetched from Delhivery.',
        'At 199 spare waybills, 500 more are claimed from the account’s allocation.',
      ],
      [
        'The pool is not refilled automatically; an operator can still fill it by hand.',
        'The pool stays at whatever it holds.',
      ],
    ),
  },
  'courier.delhivery_waybill_pool_low_water': {
    name: 'Refill the pool below (waybills)',
    group: 'Courier connection',
    what: 'The pool is topped up when fewer than this many unused waybills remain.',
    example: 'Set to 200: at 199 spare waybills, the next run fetches more.',
  },
  'courier.delhivery_waybill_pool_refill_batch': {
    name: 'Waybills fetched per refill',
    group: 'Courier connection',
    what: 'How many waybill numbers each refill asks Delhivery for (they allow up to 10,000 at a time).',
    example: 'Set to 500: each refill adds 500 waybills to the pool.',
  },
  'courier.delhivery_waybill_settle_seconds': {
    name: 'Rest a new waybill before use (seconds)',
    group: 'Courier connection',
    what: 'How long a freshly fetched waybill waits before it may be used, because Delhivery warns that using one straight away can fail.',
    example: 'Set to 120: waybills fetched at 10:00:00 can be used from 10:02:00.',
  },
  'courier.delhivery_awb_batch_size': {
    name: 'Parcels per waybill batch (not used)',
    group: 'Courier connection',
    what: 'Meant to cap how many parcels one waybill job handles at a time. Nothing reads it today: waybills are booked one order at a time, at confirmation.',
    example: 'Set to 50: changing it has no effect.',
  },
  'courier.awb_job_retry_max': {
    name: 'Tries to book a waybill',
    group: 'Courier connection',
    what: 'How many times the background job that books a waybill is tried when the courier does not answer, before it gives up and the order is chased by the hourly check.',
    example:
      'Set to 3: a courier timing out three times in a row leaves the order for the hourly check.',
  },
  'courier.awb_job_retry_backoff_ms': {
    name: 'Wait between those tries (ms)',
    group: 'Courier connection',
    what: 'How long to wait before each retry, in milliseconds, as a list. Tracking update processing uses the same waits.',
    example: '[1000,5000,15000]: retry after 1 s, then 5 s, then 15 s.',
  },
  'courier.shiprocket_portal_proxy': {
    name: 'Route to the Shiprocket panel',
    group: 'Courier connection',
    what: 'The connection our browser uses to reach the Shiprocket panel. Two exist on the app server: the tunnel to our Bangalore machine, and a NordVPN container that comes out in Mumbai. Empty stops the panel automation; it never connects directly.',
    example:
      'socks5://127.0.0.1:1081 is the Bangalore tunnel; http://127.0.0.1:1082 is the NordVPN container.',
  },
  'courier.shiprocket_portal_egress_check_url': {
    name: 'Check where the Shiprocket browser comes out',
    group: 'Courier connection',
    what: 'Asked before every Shiprocket panel run: is the VPN it goes through up, and where is it? Empty means no check — which is right for the Bangalore tunnel, because that route has nothing to ask. Set it only when the route above is that VPN.',
    example:
      'Set to http://127.0.0.1:8001/v1/publicip/ip: a run refuses to start while the VPN is down.',
  },
  'courier.shiprocket_portal_egress_country': {
    name: 'The country that check must report',
    group: 'Courier connection',
    what: 'A VPN that is down stops the reads on its own. This catches the other case: one that is working perfectly from the wrong country. Empty accepts anywhere.',
    example: 'Set to India: a run refuses to start if the VPN comes out anywhere else.',
  },
  'courier.portal_canary_awb': {
    name: 'Our test waybill for the portal check',
    group: 'Courier connection',
    what: 'A waybill that belongs to us, which the nightly portal check raises and closes a test ticket on. Empty stops the check — pointing it at a customer’s parcel would open tickets on a real delivery.',
    example:
      'Set to a waybill we shipped to ourselves: each night a test ticket is opened and closed on it.',
  },

  // ── Courier costs & invoices ────────────────────────────────────────
  'courier.wallet_sync_enabled': {
    name: 'Read the Delhivery wallet nightly',
    group: 'Courier costs & invoices',
    what: 'Each night, sign in to the Delhivery panel, download the wallet history and read what each parcel really cost. Saving the costs is a separate switch.',
    example: 'On: at 2:40 am India time the last 90 days of the Delhivery wallet are read.',
    values: onOff(
      [
        'Each night at 2:40 am India time the Delhivery wallet is read to learn each parcel’s real cost.',
        'The next morning the last 90 days of wallet movements are in our ledger.',
      ],
      [
        'The nightly Delhivery wallet read does not run; parcel costs stop updating.',
        'A parcel delivered today never gets its real Delhivery cost recorded.',
      ],
    ),
  },
  'courier.wallet_sync_writes_enabled': {
    name: 'Save the Delhivery costs it reads',
    group: 'Courier costs & invoices',
    what: 'Let the nightly Delhivery read save each parcel’s real cost. When off it reads everything and only reports what it would change.',
    example: 'On: a parcel billed ₹69 by Delhivery shows ₹69 as its courier cost the next morning.',
    values: onOff(
      [
        'The nightly Delhivery read saves each parcel’s real cost.',
        'A parcel Delhivery charged ₹69 shows ₹69 as its courier cost next morning.',
      ],
      [
        'The nightly read only reports what it would change; no cost is saved.',
        'The run report lists 40 parcels whose cost would change; none do.',
      ],
    ),
  },
  'courier.wallet_sync_window_days': {
    name: 'Days of Delhivery wallet read each night',
    group: 'Courier costs & invoices',
    what: 'How far back each nightly Delhivery read reaches. Re-reading is free because each transaction is stored once, and a wide window catches corrections made weeks later.',
    example: 'Set to 90: a charge corrected six weeks after the parcel moved is still picked up.',
  },
  'courier.delhivery_wallet_low_balance_inr': {
    name: 'Warn when the Delhivery wallet is below (₹)',
    group: 'Courier costs & invoices',
    what: 'Delhivery’s wallet is prepaid; at zero they stop issuing waybills and orders stop booking. Below this balance somebody is warned in time to add money.',
    example: 'Set to 10,000: the balance falls to ₹9,400 and a warning is raised.',
  },
  'courier.shiprocket_cost_sync_enabled': {
    name: 'Check Shiprocket charges nightly',
    group: 'Courier costs & invoices',
    what: 'Each night, ask Shiprocket’s API for every one of our parcels’ charges and the wallet balance, and check their final bill against the cost we recorded. Skips itself while Shiprocket is in practice mode.',
    example:
      'On: at 9:40 pm India time each Shiprocket parcel’s bill is compared with its recorded cost.',
    values: onOff(
      [
        'Each night Shiprocket’s API is asked for our parcels’ bills and the wallet balance, and the bills are checked against our recorded cost.',
        'A parcel billed ₹92 but recorded at ₹69 raises a bill-vs-ledger issue.',
      ],
      [
        'The nightly Shiprocket bill check does not run.',
        'A Shiprocket bill that disagrees with our cost goes unnoticed.',
      ],
    ),
  },
  'courier.shiprocket_wallet_sync_enabled': {
    name: 'Read the Shiprocket wallet nightly',
    group: 'Courier costs & invoices',
    what: 'Each night, sign in to the Shiprocket panel and read every wallet movement, the recharge history and the ledger, working out each parcel’s cost from them.',
    example:
      'On: at 3:50 am India time the Shiprocket passbook is read through the Bangalore tunnel.',
    values: onOff(
      [
        'Each night at 3:50 am India time the Shiprocket passbook, recharges and ledger are read.',
        'The next morning every Shiprocket wallet movement of the last 90 days is in our ledger.',
      ],
      [
        'The nightly Shiprocket wallet read does not run; their parcel costs stop updating.',
        'A Shiprocket parcel delivered today never gets its real cost recorded.',
      ],
    ),
  },
  'courier.shiprocket_wallet_sync_writes_enabled': {
    name: 'Save the Shiprocket costs it reads',
    group: 'Courier costs & invoices',
    what: 'Let the nightly Shiprocket read save what it found and each parcel’s cost. When off it reads and reports what it would change. It is the only thing that writes a Shiprocket parcel’s cost.',
    example: 'Off: the nightly report lists 40 parcels whose cost would change; none are changed.',
    values: onOff(
      [
        'The nightly Shiprocket read stores the movements and saves each parcel’s cost.',
        'A parcel charged ₹85 in the passbook shows ₹85 as its courier cost.',
      ],
      [
        'The nightly read only reports what it would change; nothing is stored.',
        'The run report lists what would change; parcel costs stay as they were.',
      ],
    ),
  },
  'courier.shiprocket_wallet_sync_window_days': {
    name: 'Days of Shiprocket wallet read each night',
    group: 'Courier costs & invoices',
    what: 'How far back each nightly Shiprocket read reaches. A wide window is also what notices a movement that later disappears from their passbook.',
    example: 'Set to 90: about 70 pages of 100 rows, roughly three minutes a night.',
  },
  'courier.shiprocket_wallet_low_balance_inr': {
    name: 'Warn when the Shiprocket wallet is below (₹)',
    group: 'Courier costs & invoices',
    what: 'Shiprocket’s wallet is prepaid; at zero bookings fail. Below this balance somebody is warned.',
    example: 'Set to 1,000: the balance drops to ₹850 and a warning is raised.',
  },
  'courier.shiprocket_invoice_check_enabled': {
    name: 'Check Shiprocket invoices nightly',
    group: 'Courier costs & invoices',
    what: 'Each night, read Shiprocket’s invoices and their itemised files and compare every line with what their wallet charged. Reads only; changes no cost. Nightly because Shiprocket only settles a dispute raised within 15 days.',
    example:
      'On: an invoice billing an order ₹92 when the wallet charged ₹69 is raised as a problem.',
    values: onOff(
      [
        'Each night Shiprocket’s invoices are compared line by line with what their wallet charged.',
        'An invoice billing an order ₹92 when the wallet took ₹69 is raised within a day.',
      ],
      [
        'Shiprocket invoices are not checked.',
        'An overbilled invoice goes unnoticed and may pass their 15-day dispute window.',
      ],
    ),
  },
  'courier.shiprocket_invoice_check_window_days': {
    name: 'Days of Shiprocket invoices checked',
    group: 'Courier costs & invoices',
    what: 'How far back the list of Shiprocket invoices is read. Wide on purpose, because a charge is only called uninvoiced once a later invoice has also passed it by.',
    example: 'Set to 120: invoices from the last four months are read.',
  },
  'courier.delhivery_invoice_check_enabled': {
    name: 'Check Delhivery invoices nightly',
    group: 'Courier costs & invoices',
    what: 'Each night, read Delhivery’s invoices, their transaction lists and credit and debit notes, and compare them with what their wallet charged. Reads only; changes no cost.',
    example:
      'On: a waybill invoiced ₹79 after the wallet refunded it in full is raised as a problem.',
    values: onOff(
      [
        'Each night Delhivery’s invoices and credit/debit notes are compared with what their wallet charged.',
        'A waybill invoiced ₹79 after the wallet refunded it is raised within a day.',
      ],
      [
        'Delhivery invoices are not checked.',
        'An invoice that bills a refunded waybill goes unnoticed.',
      ],
    ),
  },
  'courier.delhivery_invoice_check_window_days': {
    name: 'Days of Delhivery invoices checked',
    group: 'Courier costs & invoices',
    what: 'Invoices dated within this many days are checked. Their list only goes back 90 days, so a larger number costs nothing and changes nothing.',
    example: 'Set to 120: in practice the last 90 days of Delhivery invoices are checked.',
  },
  'courier.delhivery_invoice_dispute_days': {
    name: 'Days to dispute a Delhivery invoice (our assumption)',
    group: 'Courier costs & invoices',
    what: 'For this long after an invoice’s date, a disagreement is raised loudly so somebody acts; after it, it is only recorded. Delhivery’s real dispute window is not known; 15 mirrors Shiprocket’s.',
    example:
      'Set to 15: a wrong line on an invoice dated the 1st is urgent until the 16th, then recorded only.',
  },
  'pnl.courier_adjustments_from': {
    name: 'Count courier account adjustments from',
    group: 'Courier costs & invoices',
    what: 'The P&L counts courier account-level money (lost-parcel credits, insurance refunds, reconciliations) and charges on waybills that are no Skydrop parcel only from this date, because before it the same accounts carried parcels shipped outside Skydrop. Empty counts everything.',
    example:
      'Set to 1 October 2026: a lost-parcel credit from September is left out of the P&L and named in the line’s note.',
  },

  // ── Alerts ──────────────────────────────────────────────────────────
  'ops.alert_email': {
    name: 'Operations alert email',
    group: 'Alerts',
    what: 'Where some system-detected problems are emailed (failed-delivery re-attempts not happening, tracking stalls). Empty sends no email, but the problem is still recorded.',
    example:
      'Set to ops@skydrop.online: a stalled tracking poll emails that inbox as well as appearing on the issues board.',
  },
  'marketing.lead_notification_email': {
    name: 'Who hears about new invite requests',
    group: 'Alerts',
    what: 'Where a new request for an invitation from the website is announced. Empty means every active super admin, which stays right as admins come and go.',
    example:
      'Set to sales@skydrop.online: only that inbox is told when someone asks for an invite.',
  },
  'notifications.sms_throttle_per_recipient_per_hour': {
    name: 'Text messages per person per hour (not used yet)',
    group: 'Alerts',
    what: 'Meant to cap how many text messages one person receives in an hour. We send no text messages yet, so nothing reads it.',
    example: 'Set to 10: no effect until text messages exist.',
  },
  'ops.awb_stall_alert_hours': {
    name: 'Confirmed order with no waybill — flag after (hours)',
    group: 'Alerts',
    what: 'A confirmed order whose waybill booking failed and was never retried is asked of the courier again after this many hours, and raised on the issues board if it still has none.',
    example:
      'Set to 6: confirmed at 9 am with no waybill, the courier is asked again at 3 pm and the order is flagged if it fails.',
  },
  'ops.tracking_stranded_alert_hours': {
    name: 'Courier and order disagree — flag after (hours)',
    group: 'Alerts',
    what: 'A parcel whose courier updates cannot move its order to where the courier says it is gets raised on the issues board after this many hours, so a seller is not told something no longer true.',
    example:
      'Set to 6: the courier says a parcel is on its way back but the order still says failed delivery; six hours later it is flagged.',
  },
  'ops.rto_stall_alert_hours': {
    name: 'Return accepted but never started — flag after (hours)',
    group: 'Alerts',
    what: 'A seller asked for a parcel back and the courier accepted, but no return scan has arrived. After this many hours it is raised on the issues board.',
    example:
      'Set to 48: accepted Monday morning, still no return scan on Wednesday morning, so it is flagged.',
  },
  'ops.rto_receipt_alert_hours': {
    name: 'Returned but not received — flag after (hours)',
    group: 'Alerts',
    what: 'The courier says a parcel is back with us but nobody has received it at the returns bench. After this many hours it is raised, so someone goes and finds it.',
    example: 'Set to 48: marked returned on the 3rd, not received by the 5th, so it is flagged.',
  },
  'ops.cancelled_waybill_alert_hours': {
    name: 'Cancelled order, waybill still live — flag after (hours)',
    group: 'Alerts',
    what: 'When a confirmed order is cancelled, its waybill stays live (and charged) with the courier until someone cancels it there. After this many hours each such waybill is raised; the check never cancels anything itself.',
    example: 'Set to 2: an order cancelled at 1 pm with its waybill still live is flagged at 3 pm.',
  },
  'ops.courier_outbox_stall_alert_hours': {
    name: 'Courier message unsent — flag after (hours)',
    group: 'Alerts',
    what: 'Every message to a courier’s support waits for a person to send it on their panel. One still unsent after this many hours is raised, and clears once it is sent.',
    example:
      'Set to 24: a message queued Monday at 10 am and not sent by Tuesday 10 am is flagged.',
  },

  // ── Reseller stores (global only) ───────────────────────────────────
  'reseller.fraud_window_days': {
    name: 'Fraud checks: days looked back',
    group: 'Reseller stores',
    what: 'The fraud checks on reseller stores (cancel, return and failed-delivery rates, shared customers, high prices, rapid orders) are judged over orders placed in this many days.',
    example: 'Set to 30: a store’s cancel rate is worked out from its last 30 days of orders.',
  },
  'reseller.fraud_min_orders': {
    name: 'Fraud checks: fewest orders before a rate counts',
    group: 'Reseller stores',
    what: 'A cancel, return or failed-delivery rate is only judged once the store has at least this many orders in the window.',
    example: 'Set to 10: a store with 2 cancellations out of 3 orders is not flagged yet.',
  },
  'reseller.fraud_orders_per_hour': {
    name: 'Fraud checks: orders in one hour',
    group: 'Reseller stores',
    what: 'A store placing this many orders or more within any one hour is flagged for rapid ordering.',
    example: 'Set to 30: 34 orders between 2 and 3 pm flags the store.',
  },
  'reseller.fraud_shared_phone_stores': {
    name: 'Fraud checks: stores sharing one customer',
    group: 'Reseller stores',
    what: 'A customer phone number on orders from at least this many different reseller stores is flagged on each of them.',
    example: 'Set to 3: one number ordering through 3 different stores flags all 3.',
  },
  'reseller.fraud_cancel_rate_percent': {
    name: 'Fraud checks: cancel rate (%)',
    group: 'Reseller stores',
    what: 'A store whose orders are cancelled or rejected at this rate or above is flagged; twice the rate is raised as urgent.',
    example: 'Set to 40: 18 of 40 orders cancelled (45%) flags the store.',
  },
  'reseller.fraud_return_rate_percent': {
    name: 'Fraud checks: return rate (%)',
    group: 'Reseller stores',
    what: 'A store whose parcels come back at this rate or above (of those delivered or returned) is flagged; twice the rate is raised as urgent.',
    example: 'Set to 40: 9 returns out of 20 finished parcels (45%) flags the store.',
  },
  'reseller.fraud_ndr_rate_percent': {
    name: 'Fraud checks: failed delivery rate (%)',
    group: 'Reseller stores',
    what: 'A store whose dispatched parcels have a failed delivery attempt at this rate or above is flagged.',
    example: 'Set to 50: 11 of 20 dispatched parcels with a failed attempt (55%) flags the store.',
  },
  'reseller.fraud_retail_markup_percent': {
    name: 'Fraud checks: price above suggested (%)',
    group: 'Reseller stores',
    what: 'An order line sold for more than the suggested retail price plus this percentage is flagged.',
    example: 'Set to 100: a product suggested at ₹500 sold at ₹1,100 is flagged.',
  },
  'reseller.store_request_remind_hours': {
    name: 'Remind seller staff of a store’s request after (hours)',
    group: 'Reseller stores',
    what: 'A request a reseller store sent for the seller’s approval (cancel, order change, re-attempt, issue) that is still unanswered after this many hours reminds seller staff once, in-app.',
    example:
      'Set to 24: a cancel request sent Monday at 10 am reminds the seller Tuesday at 10 am.',
  },
  'reseller.store_request_expire_hours': {
    name: 'Close a store’s unanswered request after (hours)',
    group: 'Reseller stores',
    what: 'A request still unanswered after this many hours is closed as expired, nothing is carried out, and the store is told so it can follow up.',
    example: 'Set to 72: a request from Monday morning unanswered by Thursday morning is closed.',
  },

  // ── Live chat ───────────────────────────────────────────────────────
  'chat.chatwoot_base_url': {
    name: 'ChatWoot address',
    group: 'Live chat',
    what: 'The address of our own ChatWoot live-chat server. Empty means practice mode: nothing is sent to chat.',
    example: 'Set to https://chat.skydrop.online once the chat server exists.',
  },
  'chat.chatwoot_account_id': {
    name: 'ChatWoot account number',
    group: 'Live chat',
    what: 'The account number from the ChatWoot dashboard address (/app/accounts/<number>/…). Leave 0 in practice mode.',
    example: 'The dashboard address is /app/accounts/1/dashboard, so set it to 1.',
  },
  'chat.chatwoot_inbox_id': {
    name: 'ChatWoot inbox number',
    group: 'Live chat',
    what: 'The number of the ChatWoot inbox that customer order updates are sent through. Leave 0 in practice mode.',
    example: 'The inbox settings page is …/settings/inboxes/4, so set it to 4.',
  },

  // ── Capacity ────────────────────────────────────────────────────────
  'capacity.db_storage_gb': {
    name: 'Database disk size (GB)',
    group: 'Capacity',
    what: 'How much storage the current database plan includes, used by the capacity page. A full disk stops every write, so update this the day the plan is resized.',
    example: 'Set to 10 with 7.4 GB used: the capacity page shows the disk 74% full.',
  },
  'capacity.db_plan_label': {
    name: 'Database plan name',
    group: 'Capacity',
    what: 'A label for the current database plan, shown on the capacity page so its advice can name what to upgrade from.',
    example:
      '"1 GB RAM / 1 vCPU / 10 GB (basic)" appears on the capacity page beside the database figures.',
  },
  'capacity.redis_max_memory_mb': {
    name: 'Redis memory ceiling (MB)',
    group: 'Capacity',
    what: 'How much memory Redis (the background job store) may use before jobs are refused or dropped. Redis reports no limit of its own, so this is our judgement of its share of the server.',
    example: 'Set to 512 with 380 MB used: the capacity page shows Redis at 74%.',
  },
  'capacity.api_instances': {
    name: 'API processes running',
    group: 'Capacity',
    what: 'How many API processes serve traffic. Each holds its own database connections, so this multiplies the connection count on the capacity page.',
    example:
      'Set to 2 with 5 connections each: the capacity page counts 10 of our database connections.',
  },
};

/**
 * STRING settings that stay a text box, each with the reason. Every
 * other STRING setting has a dropdown (`values` and/or `source`);
 * `system-setting-guide.test.ts` fails on a STRING setting in neither
 * list, so a new one cannot quietly fall back to typing.
 */
export const FREE_TEXT_SETTINGS: Readonly<Record<string, string>> = {
  'invoice.company_name': 'A legal name — whatever the company is registered as.',
  'invoice.gstin': 'A registration number issued by the tax office.',
  'invoice.address': 'A postal address, free text over several lines.',
  'inventory.strict_unit_serial_prefix': 'A label prefix; any short text is valid.',
  'courier.shiprocket_portal_proxy': 'A proxy URL for the Bangalore tunnel.',
  'courier.shiprocket_portal_egress_check_url': 'A URL on the app server, or empty.',
  'courier.shiprocket_portal_egress_country': 'A country name, or empty for anywhere.',
  'courier.delhivery_support_email': 'An email address copied from Delhivery’s panel.',
  'courier.shiprocket_support_email': 'An email address copied from Shiprocket’s panel.',
  'courier.delhivery_api_base_url': 'A URL; empty means practice mode.',
  'courier.shiprocket_api_base_url': 'A URL; empty means practice mode.',
  'courier.default_pickup_time': 'A clock time (HH:mm:ss); any minute is valid.',
  'courier.delhivery_pickup_location': 'A name registered on Delhivery’s portal, matched exactly.',
  'courier.shiprocket_pickup_location': 'A name registered on Shiprocket, matched exactly.',
  'courier.delhivery_origin_pincode': 'A six-digit PIN code.',
  'courier.ndr_runner_cron': 'A cron schedule line.',
  'courier.ndr_upl_poll_cron': 'A cron schedule line.',
  'courier.ndr_reconciliation_cron': 'A cron schedule line.',
  'courier.portal_canary_awb': 'A waybill number we own.',
  'ops.alert_email': 'An email address.',
  'marketing.lead_notification_email': 'An email address; empty means every super admin.',
  'tracking.webhook_secret_ref': 'The name of a server environment variable holding a secret.',
  'tracking.webhook_secret_ref.shiprocket':
    'The name of a server environment variable holding a secret.',
  'chat.chatwoot_base_url': 'A URL; empty means practice mode.',
  'capacity.db_plan_label': 'A label for the database plan, shown as written.',
};

/** The guide for a key, or null for a key nobody has written words for yet. */
export function settingGuide(key: string): SettingGuide | null {
  return SETTING_GUIDE[key] ?? null;
}

/** A readable fallback name built from the key itself. */
export function fallbackSettingName(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The known choice a value stands for, or null. */
export function settingOption(key: string, value: unknown): SettingOption | null {
  if (value === null || value === undefined) return null;
  const code = typeof value === 'string' ? value : String(value);
  return settingGuide(key)?.values?.[code] ?? null;
}

/**
 * A value in words: a known code's label, On/Off for a switch, the items
 * of a pick-list, "Not set" for an empty string, and anything else as it
 * came. Words only — the server stays the authority on the value.
 */
export function settingValueLabel(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  const named = settingOption(key, value);
  if (named !== null) return named.label;
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  const multi = settingGuide(key)?.multi;
  const list = Array.isArray(value)
    ? (value as unknown[])
    : typeof value === 'string'
      ? parseList(value)
      : null;
  if (multi !== undefined && list !== null) {
    if (list.length === 0) return 'None';
    return list.map((code) => multi[String(code)]?.label ?? String(code)).join(', ');
  }
  if (value === '') return 'Not set';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** A JSON array written as text, or null when the text is not one. */
export function parseList(text: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as unknown[]) : null;
  } catch {
    return null;
  }
}
