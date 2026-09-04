// Idempotent reference-data seed for Skydrop.
//
// Run with `pnpm --filter @skydrop/db seed` or `pnpm prisma db seed`.
// Safe to re-run: every row uses an upsert keyed on a unique constraint
// (no inserts that would conflict on second run).
//
// Scope: only the data the spec lists as required to boot the system —
// system settings, two seed couriers, fallback FX, the CCU-01 warehouse,
// the default rate card, and 12 stub notification templates. Rate-card
// items, zone matrix, surcharges, pin codes, and seller data are left to
// admin UI / runtime to populate.

import { DELHIVERY_ISSUE_TAXONOMY } from './delhivery-issue-taxonomy';
import {
  Prisma,
  PrismaClient,
  CourierIntegrationType,
  Currency,
  FxRateSource,
  NotificationChannel,
  NotificationRecipientType,
  PaymentMode,
  PinCodeSource,
  ServiceArea,
  SettingValueType,
  SurchargeBaseField,
  SurchargeComputationMethod,
  SurchargeType,
  WarehouseStatus,
} from '@prisma/client';

const prisma = new PrismaClient();

type SystemSettingSeed = {
  key: string;
  category: string;
  valueType: SettingValueType;
  displayName: string;
  description: string;
  valueString?: string;
  valueInt?: number;
  valueDecimal?: string;
  valueBoolean?: boolean;
  valueJson?: unknown;
  // Seller-override caps (settings-resolver mechanism, R0 of the
  // revised-plan roadmap). Unset = not seller-overridable.
  sellerOverridable?: boolean;
  overrideMinInt?: number;
  overrideMaxInt?: number;
  // DECIMAL caps. The resolver already clamps against these columns; the
  // seed simply never wrote them before R3, so a DECIMAL setting's caps
  // silently did not exist.
  overrideMinDecimal?: string;
  overrideMaxDecimal?: string;
};

// 28 Indian States + 8 Union Territories (Module 6 address validation).
const ALLOWED_INDIAN_STATES: string[] = [
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

const systemSettings: SystemSettingSeed[] = [
  // ── Invoice header (used by InvoiceService for the PDF Tax Invoice) ──
  {
    key: 'invoice.company_name',
    category: 'invoice',
    valueType: SettingValueType.STRING,
    valueString: 'Skydrop Logistics Pvt Ltd',
    displayName: 'Invoice — Company name',
    description: 'Legal entity name as printed at the top of every GST tax invoice',
  },
  {
    key: 'invoice.gstin',
    category: 'invoice',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Invoice — GSTIN',
    description: 'Skydrop GSTIN; leave blank until registration completes',
  },
  {
    key: 'invoice.address',
    category: 'invoice',
    valueType: SettingValueType.STRING,
    valueString: 'Bengaluru, Karnataka, India',
    displayName: 'Invoice — Address',
    description: 'Multi-line address (free text) printed under the GSTIN',
  },
  {
    key: 'invoice.state',
    category: 'invoice',
    valueType: SettingValueType.STRING,
    valueString: 'Karnataka',
    displayName: 'Invoice — State',
    description: 'State of supply for IGST/CGST/SGST determination',
  },
  {
    key: 'pricing.flat_delivery_fee_inr',
    category: 'pricing',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '200.00',
    displayName: 'Delivery Fee (INR, flat)',
    description:
      'What a seller is charged to deliver one parcel, anywhere in India. Flat — no zone, no weight slab, no surcharges. Per-seller override via seller_setting_overrides, and the override is the one that counts.',
    sellerOverridable: true,
    overrideMinDecimal: '0',
    overrideMaxDecimal: '100000',
  },
  {
    // DELIBERATELY NOT `pricing.flat_delivery_fee_inr`. That one is what
    // WE charge the seller to move a parcel, and it feeds the pricing
    // engine. This is what the SELLER charges their customer, and it
    // feeds nothing at all — it is a default for one field on the order
    // form, which the seller overwrites whenever they like. Sharing one
    // key would mean a seller adjusting their customer price quietly
    // changed our invoice to them.
    key: 'orders.default_customer_delivery_fee_inr',
    category: 'ops',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '200.00',
    displayName: 'Customer Delivery Fee (INR, default)',
    description:
      'Pre-filled into the delivery fee on a new order, where it is added to the collectable ' +
      'amount. Used for that autofill and nothing else — it does not affect what Skydrop ' +
      'charges the seller, and the seller can change the figure on any order.',
    sellerOverridable: true,
    overrideMinDecimal: '0',
    overrideMaxDecimal: '100000',
  },
  {
    key: 'pricing.customer_return_fee_inr',
    category: 'pricing',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '200',
    displayName: 'Customer Return Fee (INR)',
    description:
      'What a seller pays when the CUSTOMER asks to send a delivered parcel back. It is a second delivery — the parcel travels the same distance again — so it costs the same as one, and the seller pays the outbound ₹200 plus this. Deliberately NOT pricing.flat_rto_fee_inr, which is the smaller fee for a parcel the courier never managed to deliver in the first place.',
    sellerOverridable: true,
  },
  {
    key: 'pricing.flat_rto_fee_inr',
    category: 'pricing',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '30.00',
    displayName: 'RTO Return Fee (INR, flat)',
    description:
      'Charged ON TOP of the delivery fee when a parcel comes back, and only then — debited from the wallet at the moment the return is physically RECEIVED, not when the courier says it is coming. A returned parcel therefore costs delivery + RTO (default 200 + 30 = 230). Per-seller override via seller_setting_overrides.',
    sellerOverridable: true,
    overrideMinDecimal: '0',
    overrideMaxDecimal: '100000',
  },
  {
    key: 'pricing.flat_fee_gst_percent',
    category: 'pricing',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '0.00',
    displayName: 'GST on Delivery Fees (%)',
    description:
      'GST applied on top of the flat delivery and RTO fees. Seeded at 0 — the flat fees are currently what the seller pays, full stop. Set this to 18 to start charging GST on them; nothing in the code needs to change. Deliberately GLOBAL and not seller-overridable: a tax rate is set by law, not per customer. Distinct from pricing.gst_rate, which is the fallback GST on the GOODS for customs and invoicing.',
  },
  {
    key: 'pricing.gst_rate',
    category: 'pricing',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '18.00',
    displayName: 'GST Rate (%)',
    description: 'GST percentage on shipping services',
  },
  {
    key: 'pricing.fx_fallback_inr_to_bdt',
    category: 'pricing',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '1.35',
    displayName: 'Fallback FX Rate INR→BDT',
    description: 'Used when FX fetch fails',
  },
  {
    key: 'ops.call_max_attempts',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 3,
    displayName: 'Max Call Attempts',
    description: 'Calls before auto-cancel',
  },
  {
    key: 'ops.call_retry_interval_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 4,
    displayName: 'Call Retry Interval (hours)',
    description:
      "How long before an order whose customer did not pick up (NO_ANSWER / VOICEMAIL_LEFT) becomes callable again. Per-seller overridable: how hard we chase a customer is a decision about that seller's business. The minimum of 1 hour is deliberate — 0 would redial someone seconds after they ignored the phone and spend all their cap attempts in a minute.",
    sellerOverridable: true,
    overrideMinInt: 1,
    overrideMaxInt: 72,
  },
  {
    key: 'ops.stock_reservation_ttl_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 48,
    displayName: 'Stock Reservation TTL (hours)',
    description:
      'Auto-release reservations after N hours. Per-seller override via seller_setting_overrides (the grandfathered sellers.reservation_ttl_hours_override column still wins over the global default, but the override row wins over both).',
    sellerOverridable: true,
    overrideMinInt: 1,
    overrideMaxInt: 8760,
  },
  {
    key: 'ops.stock_adjustment_approval_threshold_inr',
    category: 'ops',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '50000',
    displayName: 'Stock Adjustment Approval Threshold (INR)',
    description:
      'Adjustments whose absolute INR value impact meets or exceeds this require admin approval; below auto-executes',
  },
  {
    key: 'ops.stock_alert_cooldown_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 24,
    displayName: 'Low-Stock Alert Cooldown (hours)',
    description:
      'After a low-stock alert fires, suppress re-alerting for the same SKU until recovery and this many hours have elapsed',
  },
  {
    key: 'notifications.sms_throttle_per_recipient_per_hour',
    category: 'notifications',
    valueType: SettingValueType.INT,
    valueInt: 10,
    displayName: 'SMS Throttle',
    description: 'Max SMS per recipient per hour',
  },
  {
    key: 'webhooks.auto_disable_after_consecutive_failures',
    category: 'webhooks',
    valueType: SettingValueType.INT,
    valueInt: 50,
    displayName: 'Webhook Auto-Disable Threshold',
    description: 'Disable webhook after N consecutive failures',
  },
  {
    key: 'webhooks.max_retry_attempts',
    category: 'webhooks',
    valueType: SettingValueType.INT,
    valueInt: 5,
    displayName: 'Webhook Max Retries',
    description: 'Max webhook delivery retry attempts',
  },
  // ---- Module 6 — Order Management -------------------------------------
  {
    key: 'ops.csv_max_order_rows',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 1000,
    displayName: 'Bulk Order CSV Max Rows',
    description: 'Reject a bulk order CSV upload with more than this many data rows',
  },
  {
    key: 'ops.order_draft_ttl_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 72,
    displayName: 'Order Draft TTL (hours)',
    description:
      'DRAFT orders older than this are eligible for cleanup (cleanup cron deferred to Phase 2 — value is informational in Phase 1A)',
  },
  {
    key: 'ops.allowed_indian_states',
    category: 'ops',
    valueType: SettingValueType.JSON,
    valueJson: ALLOWED_INDIAN_STATES,
    displayName: 'Allowed Indian States/UTs',
    description:
      'Recipient state must match one of these (28 states + 8 union territories) — soft address validation in Module 6',
  },
  // Module 7 — Call Center. Effective NDR cap = sellers
  // .callMaxAttemptsBeforeNdrOverride ?? ops.call_max_attempts_before_ndr.
  {
    key: 'ops.call_max_attempts_before_ndr',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 3,
    displayName: 'Call Attempts Before NDR',
    description:
      'Default max attempt-counting call outcomes before an order is auto-rejected as REJECTED_NDR (per-seller override: sellers.call_max_attempts_before_ndr_override, or the newer seller_setting_overrides row for this same key)',
    sellerOverridable: true,
    overrideMinInt: 1,
    overrideMaxInt: 10,
  },
  {
    key: 'ops.call_assignment_timeout_minutes',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 15,
    displayName: 'Call Assignment Timeout (minutes)',
    description:
      'A pulled queue entry the agent does not act on within this window is auto-returned to PENDING by the BullMQ expiration worker',
  },
  {
    key: 'orders.reattempt_requestable_statuses',
    category: 'ops',
    valueType: SettingValueType.JSON,
    valueJson: ['REJECTED_BY_CUSTOMER'],
    displayName: 'Statuses a seller may request another call on',
    description:
      'Which failed statuses show the seller an "ask us to call again" button. REJECTED_BY_CUSTOMER by default: they answered and said no, so a human weighs the seller\'s new information against a refusal. Adding REJECTED_NDR is possible and is a REAL trade — nobody ever answered those, so there is no refusal to override, but un-rejecting an order corrupts NDR reporting. For that case prefer inventory.early_reservation_ndr_action = MANUAL_REVIEW, which asks the seller BEFORE the order is rejected. A status the state machine cannot leave is ignored, so this list can never produce a button that fails on approval.',
    sellerOverridable: true,
  },
  {
    key: 'ops.agent_presence_timeout_minutes',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 10,
    displayName: 'Agent Presence Timeout (minutes)',
    description:
      'An agent marked available who has not been seen at the station for this long is stood down automatically and anything they hold returns to the queue. Availability is a claim about being AT the desk; without an expiry a stored true holds a customer order for as long as the tab stays open.',
  },
  {
    key: 'ops.call_reschedule_min_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 1,
    displayName: 'Call Reschedule Min (hours)',
    description: 'CALLBACK_REQUESTED scheduledFor must be at least this many hours in the future',
  },
  {
    key: 'ops.call_reschedule_max_days',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 7,
    displayName: 'Call Reschedule Max (days)',
    description: 'CALLBACK_REQUESTED scheduledFor must be at most this many days in the future',
  },
  {
    key: 'ops.call_busy_retry_delay_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 1,
    displayName: 'Call Busy Retry Delay (hours)',
    description: 'BUSY outcome re-queues the order with availableAt = now + this many hours',
  },
  // Module 8 — Warehouse Operations.
  {
    key: 'ops.default_courier_code',
    category: 'ops',
    valueType: SettingValueType.STRING,
    valueString: 'delhivery',
    displayName: 'Default Courier Code',
    description:
      'Courier assigned to a shipment at provisioning (FK couriers.code). Hardcoded in Phase 1A; Module 9 introduces serviceability/multi-courier routing',
  },
  {
    key: 'ops.pack_box_timeout_minutes',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 60,
    displayName: 'Pack Box Timeout (minutes)',
    description:
      'A box left open at the pack bench longer than this is auto-released: its scans are discarded and the parcel returns to the pack queue. Stops a box abandoned at the end of a shift from wedging an order.',
  },
  {
    key: 'ops.pick_task_timeout_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 4,
    displayName: 'Pick Timeout (hours)',
    description:
      'A shipment whose pick has been in progress longer than this is auto-reverted to re-pickable by the BullMQ pick-expiration worker (WMS-5)',
  },
  {
    key: 'ops.bin_snapshot_retention_months',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 3,
    displayName: 'Bin Layout Snapshot Retention (months)',
    description:
      'How long a pre-collapse bin layout backup is kept before the retention sweep deletes it. A collapse merges every bin into FLOOR and is not otherwise recoverable, so this is the window in which a restore is still possible.',
  },
  {
    key: 'ops.pick_allocation_retry_max',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 3,
    displayName: 'Pick Allocation Retry Max',
    description:
      'Max attempts when M5 allocateAndPopulate surfaces PICK_ALLOCATION_CONFLICT before surfacing PICK_ALLOCATION_RETRY_EXHAUSTED (WMS-3)',
  },
  {
    key: 'ops.pick_allocation_retry_backoff_ms',
    category: 'ops',
    valueType: SettingValueType.JSON,
    valueJson: [100, 250, 500],
    displayName: 'Pick Allocation Retry Backoff (ms)',
    description: 'Per-attempt backoff delays for the WMS-3 pick allocation retry loop',
  },
  // Module 9 — Courier Integration.
  {
    key: 'courier.tracking_poll_auto_recover_enabled',
    category: 'courier',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: true,
    displayName: 'Tracking — recover automatically when the poll stalls',
    description:
      'When a watchdog finds no successful tracking cycle in 45 minutes: re-arm the schedule (in case the repeatable job was lost) and run one cycle immediately, rather than waiting for a human. Safe by construction — a cycle only applies scans newer than each parcel already has. Turn OFF to require a person to press "Run a cycle now"; the alert still fires either way.',
  },
  {
    key: 'courier.wallet_sync_enabled',
    category: 'courier',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: false,
    displayName: 'Delhivery wallet sync — run nightly',
    description:
      'Log into the Delhivery panel each night, download the wallet ledger and read what each parcel really cost. OFF until the portal credentials are provisioned. Turning this ON does NOT let it write — that is a separate switch, so the fetch and the parse can be proven against real files first.',
  },
  {
    key: 'courier.wallet_sync_writes_enabled',
    category: 'courier',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: false,
    displayName: 'Delhivery wallet sync — write the costs',
    description:
      'Let the nightly sync WRITE what it read into the shipment cost columns. While OFF it parses the real file and reports exactly what it would change, which is how a login or a page change surfaces as a report rather than as wrong money in the P&L.',
  },
  {
    key: 'courier.wallet_sync_window_days',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 45,
    displayName: 'Delhivery wallet sync — days to re-read each night',
    description:
      'How far back each nightly fetch reaches. NOT one day: a charge is re-cut weeks after the parcel moved, so a narrow window would import each parcel\u2019s first figure and never see the correction. Re-reading is cheap because the import overwrites rather than skips.',
  },
  {
    key: 'ops.nsa_enabled',
    category: 'ops',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: true,
    displayName: 'NSA — raise Needs Seller Attention flags',
    description:
      'Whether the evening sweep flags parcels that are still out for delivery past the cutoff. Turning this OFF stops new flags being raised; it does not clear the ones already up, and the worklists keep working.',
  },
  {
    key: 'ops.rto_stall_alert_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 48,
    displayName: 'Return accepted but never started — hours before we flag it',
    description:
      'A seller asks for a parcel back and the courier accepts, then no return scan ever arrives. After this many hours the order is raised on the system issues board, because the seller believes their goods are on the way back and nothing else in the system notices they are not.',
  },
  {
    key: 'ops.handover_scan_required',
    category: 'ops',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: false,
    displayName: 'Scan every parcel before handing it to the courier',
    description:
      'When ON, a parcel must be scanned at the handover bench before it can be given to the driver, and the handoff REFUSES any parcel that was not — from the API as well as the screen, so it cannot be worked around. When OFF, parcels are handed over without the extra scan. Off by default because it adds a step; turn it on when a lost parcel has cost more than the step does.',
  },
  {
    key: 'ops.handover_scan_dispatches',
    category: 'ops',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: true,
    displayName: 'A handover scan hands the parcel to the courier',
    description:
      'ON (the default): scanning a parcel at the handover bench IS the handover — the order goes DISPATCHED there and then, and the manifest closes itself once its last parcel is scanned, so nobody confirms a handoff. The scan is the truest signal the system has: it happens per parcel, at the door, at the moment the box leaves, where confirming a handoff is one person asserting afterwards that forty parcels went. OFF: the scan only records that the parcel was checked, and a supervisor still confirms the handoff per manifest. Turn it off if parcels are ever scanned to check them IN rather than out.',
  },
  {
    key: 'ops.tracking_stranded_alert_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 6,
    displayName: 'Courier says one thing, the order says another — hours before we flag it',
    description:
      'A parcel whose courier scans cannot move its order: the tracking mapping has no route from where the order is to where the courier says the parcel is, so every scan is dropped and the seller keeps being told something that is no longer true. Two real parcels sat like that for two days while twenty-four return-leg scans were discarded, and nothing anywhere said so. Long enough that a pair of scans arriving out of order settles by itself first.',
  },
  {
    key: 'ops.awb_stall_alert_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 6,
    displayName: 'Confirmed with no waybill — hours before we retry and flag it',
    description:
      'The waybill is booked once, when the order is confirmed. If that attempt and its retries all fail, nothing asks again — the order sits confirmed with reserved stock and no courier, and the only symptom is its absence from a list. After this many hours the sweep asks the courier again, and raises the order on the system issues board if it still has no waybill.',
  },
  {
    key: 'ops.nsa_cutoff_hour',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 18,
    displayName: 'NSA — evening cutoff hour (India)',
    description:
      'The hour, in the DELIVERY timezone (Asia/Kolkata), after which a parcel still out for delivery is treated as stuck. 18 means 6pm: the van is back and the customer has not been reached.',
  },
  {
    key: 'ops.nsa_max_days',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 3,
    displayName: 'NSA — days the escalation counts to',
    description:
      'How high the day counter climbs — 3 means a parcel stuck a third night is the loudest it gets. The flag STAYS raised beyond this; only the number stops rising, because a parcel stuck five nights has not stopped needing attention.',
  },
  {
    key: 'courier.tracking_poll_last_run_at',
    category: 'courier',
    valueType: SettingValueType.DATE,
    displayName: 'Tracking poll — last completed cycle',
    description:
      'Stamped by TrackingPollService at the end of every cycle. Delhivery B2C pushes no webhooks, so the poller IS tracking: if this stops advancing, no parcel is updating and nothing else will say so. Read by /system/capacity as the tracking-freshness metric. Written by the system, not by hand.',
  },
  {
    key: 'courier.delhivery_api_base_url',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Delhivery API Base URL',
    description:
      'Delhivery REST API base URL. EMPTY = stub mode (deterministic mock responses, no network) — the default for dev/CI/e2e. Production is https://track.delhivery.com (staging would be https://staging-express.delhivery.com, but this account has no sandbox). Setting this alone only enables READS; physical-world writes additionally require courier.delhivery_live_writes_enabled.',
  },
  {
    key: 'courier.shiprocket_api_base_url',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Shiprocket API Base URL',
    description:
      'EMPTY means stub mode, which is where this starts and stays until an account exists. Set to https://apiv2.shiprocket.in only after a controlled first parcel has proved the wire contract — every shape in the adapter is transcribed from their published docs and has never been exercised against a real account. Unlike Delhivery, auth is an email/password login that mints a token lasting about ten days; the credentials live in courier_credentials per account (CUR-1), never here.',
  },
  {
    key: 'courier.default_account_delhivery',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Default Delhivery account',
    description:
      'Which Delhivery account carries a parcel when the seller has no distribution of their own. Empty means "any active one", which is fine with a single account and becomes a coin toss with four — set it once a second account exists.',
  },
  {
    key: 'courier.default_account_shiprocket',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Default Shiprocket account',
    description:
      'The Shiprocket half of the same choice. Empty means Shiprocket is not in the global rotation at all, which is the correct state until an account is provisioned.',
  },
  {
    key: 'courier.delhivery_share_percent',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 100,
    displayName: 'Share of parcels to Delhivery (%)',
    description:
      'How the two default accounts split the work. 70 means roughly seven parcels in ten go to Delhivery and three to Shiprocket. Applied PER PARCEL by a weighted draw, so the split is approached over volume rather than enforced exactly — the alternative is a running counter that two API instances would fight over. Starts at 100 because Shiprocket has no account yet; a seller with their own distribution ignores this entirely.',
  },
  // No Delhivery sandbox exists for this account, so the only environment
  // is production. Reads (serviceability, tracking, cost, TAT, EPOD) are
  // free and side-effect-free; writes manifest real parcels, dispatch real
  // vans and cancel real customers' orders. Hence a second, explicit gate
  // that defaults OFF and is checked by DelhiveryWriteGuardService.
  {
    key: 'courier.delhivery_live_writes_enabled',
    category: 'courier',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: false,
    displayName: 'Delhivery LIVE Writes Enabled',
    description:
      'When OFF (default) Skydrop refuses any Delhivery call with a physical or billable effect — manifest a shipment, edit/cancel one, request a pickup, take an NDR action, register a warehouse, consume waybills — while still allowing reads. There is no sandbox for this account: every write here is a real parcel, a real van or a real cancellation. Turn it on deliberately for live operations (or for a controlled single-parcel test), and expect a HIGH audit row for every blocked attempt while it is off.',
  },
  // Per courier, not one switch for both. Enabling Delhivery for its
  // first controlled parcel must not silently arm every Shiprocket write
  // path: separate contracts, separate accounts, separate money, and
  // readiness to write to one says nothing about the other. The guard
  // derives this key from the courier code, so a third courier needs a
  // row here and no code change.
  //
  // The row matters even though the guard fails closed without it: the
  // admin settings page lists what is IN this table, so a missing row is
  // a switch that can only be thrown by hand in psql.
  {
    key: 'courier.shiprocket_live_writes_enabled',
    category: 'courier',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: false,
    displayName: 'Shiprocket LIVE Writes Enabled',
    description:
      'When OFF (default) Skydrop refuses any Shiprocket call with a physical or billable effect — create an order, assign an AWB, cancel a parcel, request a pickup, take an NDR action, register a pickup location — while still allowing reads. Nothing has ever been written against a real Shiprocket account: every request shape in the adapter is transcribed from their published docs and unproven. Turn this on only for a controlled single-parcel test, and expect a HIGH audit row for every blocked attempt while it is off.',
  },
  // The CUR-10 per-category auto-pickup switch. Separate from
  // `_live_writes_enabled` on purpose: the live-writes flag says whether
  // a write is allowed to reach the courier at all; this says whether a
  // WAREHOUSE EVENT (a box closing) may be the thing that decides to
  // make one, without an operator in the loop for that specific call.
  // Both default OFF, and both must be true for a box close to actually
  // reach the courier — this alone changes nothing while live writes
  // are off, and the reverse.
  {
    key: 'courier.delhivery_auto_pickup_enabled',
    category: 'courier',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: true,
    displayName: 'Delhivery — request the daily pickup automatically',
    description:
      'ON by standing decision (2026-09-03): closing the first box of the day for a warehouse asks Delhivery for a van with nobody visiting the Pickups screen — later boxes that same day are no-ops, because one request already covers the building. The kill switch stays real: turn this OFF to go back to raising every pickup by hand, without a deploy. Still behind courier.delhivery_live_writes_enabled — turning this on with live writes off changes nothing.',
  },
  {
    key: 'courier.shiprocket_auto_pickup_enabled',
    category: 'courier',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: true,
    displayName: 'Shiprocket — request the daily pickup automatically',
    description:
      'The Shiprocket half of courier.delhivery_auto_pickup_enabled — same behaviour, same one-request-per-warehouse-per-day grain, same standing-ON decision. Still behind courier.shiprocket_live_writes_enabled.',
  },
  {
    key: 'courier.default_pickup_time',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '18:00:00',
    displayName: 'Auto-pickup — requested collection time',
    description:
      "HH:mm:ss sent to the courier when a box close auto-requests today's van. An end-of-day slot by default; a warehouse that needs an earlier collection still raises one by hand from the Pickups screen with whatever time it actually wants.",
  },
  {
    key: 'courier.delhivery_pickup_location',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Delhivery Pickup Location Name',
    description:
      "Name of the warehouse pickup location pre-registered in Delhivery's partner portal. Required when real mode is enabled (DelhiveryAwbService passes it as pickup_location.name on create-shipment). Phase-1A is single-warehouse (CCU-01); a multi-warehouse setup adds one key per origin.",
  },
  {
    key: 'courier.delhivery_origin_pincode',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Delhivery Origin Pincode',
    description:
      "The pincode goods dispatch FROM. Delhivery prices a lane and quotes a delivery time between two pincodes, so without this the expected-TAT and real-cost lookups cannot be asked at all — they are the origin half of every query. Sibling of courier.delhivery_pickup_location (that one is the registered warehouse NAME, which must match Delhivery's records exactly; this is the PIN). Phase-1A is single-origin; a multi-warehouse setup puts the address on the warehouse row instead of here.",
  },
  // D3 — the AWB pool. Delhivery allows only FIVE bulk fetches per five
  // minutes and warns that a freshly-minted waybill may error if used
  // immediately, so numbers are pulled ahead of time and left to settle.
  // D5 — how each courier authenticates ITS webhooks to US. Delhivery
  // does not sign payloads: you email them a requirement document
  // nominating your endpoint and your authorization, and they send that
  // credential back. An HMAC-only verifier would 401 every real scan.
  {
    key: 'tracking.webhook_auth_scheme',
    category: 'tracking',
    valueType: SettingValueType.STRING,
    valueString: 'HMAC_SHA256',
    displayName: 'Webhook Auth Scheme (default)',
    description:
      "How inbound courier webhooks are authenticated when a courier-specific key is absent: 'HMAC_SHA256' (the courier signs the raw body — stronger, and the safe default) or 'SHARED_SECRET' (a static credential in a header). Override per courier with tracking.webhook_auth_scheme.<courierCode>.",
  },
  {
    key: 'tracking.webhook_auth_scheme.delhivery',
    category: 'tracking',
    valueType: SettingValueType.STRING,
    valueString: 'SHARED_SECRET',
    displayName: 'Webhook Auth Scheme — Delhivery',
    description:
      'Delhivery does not sign webhooks; it returns the authorization we nominated in their Webhook Requirement Document. Leave as SHARED_SECRET unless Delhivery introduces signing. The credential itself lives in the env var named by tracking.webhook_secret_ref (CUR-1: secret in env, reference in the DB).',
  },
  {
    key: 'courier.delhivery_waybill_pool_refill_enabled',
    category: 'courier',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: false,
    displayName: 'Delhivery Waybill Pool Auto-Refill',
    description:
      "OFF by default because NOTHING CONSUMES THE POOL YET. AWB generation sends an empty waybill and lets Delhivery assign one inline, so the pooled numbers are never handed out. With this on and live writes enabled, the 15-minute cron would claim hundreds of real waybills from the account's allocation into a pool nothing drinks from. Turn it on when something actually consumes it — MPS needs a pre-fetched waybill per box, and that is the case the pool was built for. The manual refill button on the admin Delhivery console ignores this setting, so an operator can still fill the pool deliberately.",
  },
  {
    key: 'courier.delhivery_waybill_pool_low_water',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 200,
    displayName: 'Waybill Pool Low-Water Mark',
    description:
      'Refill the AWB pool when fewer than this many unassigned waybills remain. Set it above a comfortable day of volume: the pool cannot be topped up inline (5 bulk fetches per 5 minutes), so running dry stalls manifesting until the cron next runs.',
  },
  {
    key: 'courier.ndr_runner_enabled',
    category: 'courier',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: false,
    displayName: 'NDR Nightly Runner Enabled',
    description:
      'The KILL SWITCH for automated NDR re-attempts. OFF by default. CUR-10 as amended permits a runner to fire courier writes only on a channel an operator explicitly enabled — this is that channel. Turning it off stops the runner at its next tick without a deploy; in-flight UPL polling and reconciliation continue, because abandoning requests already sent would be worse than finishing them.',
  },
  {
    key: 'courier.ndr_runner_cron',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '35 21 * * *',
    displayName: 'NDR Nightly Runner Schedule',
    description:
      "Cron for the nightly NDR batch, evaluated in Asia/Dhaka (the droplet runs UTC — the timezone is passed explicitly to BullMQ, never assumed). 21:35 Dhaka is just after Delhivery's 21:00 IST cutoff, by which time the day's dispatches have closed and NDR parcels are back in facility. Moving this earlier means submitting against a day that has not finished.",
  },
  {
    key: 'courier.ndr_auto_categories',
    category: 'courier',
    valueType: SettingValueType.JSON,
    valueJson: [],
    displayName: 'NDR Auto-Action Allow List',
    description:
      "Which NDR actions the runner may fire unattended: a JSON array of 'RE-ATTEMPT' and/or 'PICKUP_RESCHEDULE'. EMPTY by default, which means the runner prepares and logs but sends nothing — the only safe initial state while the write contract has never been exercised. Widen one entry at a time.",
  },
  {
    key: 'courier.ndr_batch_max',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 50,
    displayName: 'NDR Nightly Batch Cap',
    description:
      'Most parcels the nightly runner will submit in one night. A cap rather than "all eligible" because the first unattended night should not be able to summon fifty vans if the eligibility filter is wrong, and because each submission costs a fresh tracking read.',
    overrideMinInt: 1,
    overrideMaxInt: 1000,
  },
  {
    key: 'courier.ndr_upl_poll_cron',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '*/20 * * * *',
    displayName: 'NDR UPL Poll Schedule',
    description:
      'How often to ask Delhivery what happened to a submitted NDR request. Every 20 minutes: the outcome is not real-time (the request is queued on their side for the next delivery cycle), the answer rarely changes within an hour, and the NDR endpoints have no documented rate budget so a conservative fallback applies. Faster polling would buy nothing an operator could act on before morning.',
  },
  {
    key: 'courier.ndr_upl_poll_deadline_minutes',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 240,
    displayName: 'NDR UPL Poll Deadline (minutes)',
    description:
      'How long a submitted request may go unanswered before it is treated as FAILED. Silence is NOT "still might work": the customer is waiting either way, and an unconfirmable re-attempt has to be chased by a human. Four hours covers a long courier-side queue while still landing the escalation before the next morning.',
    overrideMinInt: 30,
    overrideMaxInt: 1440,
  },
  {
    key: 'courier.ndr_reconciliation_cron',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '0 12 * * *',
    displayName: 'NDR Reconciliation Schedule',
    description:
      'Daily check of whether confirmed re-attempts actually produced a new delivery attempt in tracking. Midday Dhaka, so a night of requests has had a full delivery cycle to show up.',
  },
  {
    key: 'courier.ndr_reconciliation_window_hours',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 48,
    displayName: 'NDR Reconciliation Window (hours)',
    description:
      'How long after a CONFIRMED request a new attempt scan may still appear before we count it as not acted on. Too short and a slow-but-working courier reads as a failure; too long and a systematic problem takes days to surface.',
    overrideMinInt: 6,
    overrideMaxInt: 168,
  },
  {
    key: 'courier.portal_canary_awb',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Portal Canary AWB',
    description:
      'An AWB WE OWN, which the nightly portal canary raises and resolves tickets against. EMPTY by default and deliberately not guessed: a canary pointed at a real customer’s shipment would raise and close support tickets on a parcel somebody is waiting for, which is worse than having no canary. The canary refuses to run until this is set.',
  },
  {
    key: 'ops.alert_email',
    category: 'ops',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Operations Alert Email',
    description:
      'Where system-detected operational problems are sent (currently the NDR reconciliation alert). EMPTY by default and deliberately not defaulted to a guessed address: an alert delivered nowhere is worse than one that visibly has no destination, because the first looks like everything is fine. When unset, the alert is still written to audit_logs at CRITICAL — the durable record does not depend on email being configured.',
  },
  {
    key: 'courier.ndr_reconciliation_alert_percent',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 25,
    displayName: 'NDR Reconciliation Alert Threshold (%)',
    description:
      'Alert when more than this percentage of confirmed re-attempts produced no new attempt scan. This is the ONLY check that catches Delhivery accepting our calls and not acting on them — every other signal says success. Some drift is normal (a parcel delivered before the re-attempt ran); a sustained quarter is not.',
    overrideMinInt: 1,
    overrideMaxInt: 100,
  },
  {
    key: 'courier.delhivery_waybill_pool_refill_batch',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 500,
    displayName: 'Waybill Pool Refill Batch',
    description:
      'How many waybills to fetch per refill (Delhivery allows up to 10 000 per request, 50 000 per 5 minutes). Bigger batches mean fewer requests against a very small budget.',
    overrideMinInt: 1,
    overrideMaxInt: 10000,
  },
  {
    key: 'courier.delhivery_waybill_settle_seconds',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 120,
    displayName: 'Waybill Settle Delay (seconds)',
    description:
      "How long a freshly-fetched waybill must rest before it may be assigned. Delhivery mints numbers in batches of 25 behind the scenes and warns that using one immediately 'may occasionally result in errors'.",
  },
  {
    key: 'courier.delhivery_awb_batch_size',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 50,
    displayName: 'Delhivery AWB Batch Size',
    description:
      'Max shipments processed per per-manifest AWB generation job iteration (CUR-2 — per-shipment failure isolation within the batch)',
  },
  {
    key: 'courier.awb_job_retry_max',
    category: 'courier',
    valueType: SettingValueType.INT,
    valueInt: 3,
    displayName: 'AWB Job Retry Max',
    description:
      'Max BullMQ attempts for the per-manifest AWB generation job before the manifest is marked FAILED (CUR-2). Per-shipment idempotency (CUR-9) makes retries safe',
  },
  {
    key: 'courier.awb_job_retry_backoff_ms',
    category: 'courier',
    valueType: SettingValueType.JSON,
    valueJson: [1000, 5000, 15000],
    displayName: 'AWB Job Retry Backoff (ms)',
    description: 'Per-attempt backoff delays for the AWB generation BullMQ job',
  },
  // Module 10 — Public Tracking.
  {
    key: 'tracking.webhook_secret_ref',
    category: 'tracking',
    valueType: SettingValueType.STRING,
    valueString: 'TRACKING_WEBHOOK_SECRET_DELHIVERY',
    displayName: 'Tracking Webhook Secret Env Key (Delhivery)',
    description:
      'Name of the env var that holds the HMAC secret used to authenticate inbound Delhivery tracking webhooks (CUR-1 discipline — the secret value lives in env, never the DB). Phase 1A stub mode reads a configured test secret directly; real-mode HMAC scheme is TODO(delhivery-api).',
  },
  {
    key: 'tracking.public_lookup_rate_limit_per_min',
    category: 'tracking',
    valueType: SettingValueType.INT,
    valueInt: 30,
    displayName: 'Public Tracking Lookup Rate Limit (per IP/min)',
    description:
      'TRK-8 anti-enumeration ceiling on the open public AWB lookup endpoint. LIVE: the guard reads this row and a change takes effect within a minute, no redeploy (memoised 60s per instance, so a flood cannot reach the database through the limiter). A non-positive or unreadable value is IGNORED and the code falls back to 30 — a settings mistake must not be able to remove the limit from an endpoint open to the internet. A legitimate customer refreshes their tracking page a handful of times; bulk enumeration of AWBs triggers rate limiting.',
  },
  {
    key: 'tracking.webhook_processing_retry_max',
    category: 'tracking',
    valueType: SettingValueType.INT,
    valueInt: 3,
    displayName: 'Tracking Webhook Processing Retry Max',
    description:
      'Max BullMQ attempts for the tracking-webhook processor before the courier_webhooks row is left FAILED for ops investigation. Per-payload idempotency (TRK-2) makes retries safe.',
  },
  // Module 18 — ChatWoot live chat.
  {
    key: 'chat.chatwoot_base_url',
    category: 'chat',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'ChatWoot Base URL',
    description:
      'Self-hosted ChatWoot URL (e.g. https://chat.skydrop.online). EMPTY = stub mode — ChatWootClientService returns no-op refs, webhook controller accepts payloads without HMAC verify. Set this once the chat droplet is provisioned + CHATWOOT_API_TOKEN env is configured.',
  },
  {
    key: 'chat.chatwoot_account_id',
    category: 'chat',
    valueType: SettingValueType.INT,
    valueInt: 0,
    displayName: 'ChatWoot Account ID',
    description:
      'Numeric account id from your ChatWoot dashboard (URL: /app/accounts/<id>/...). Real-mode API calls embed it in the path. Leave 0 in stub mode.',
  },
  {
    key: 'chat.chatwoot_inbox_id',
    category: 'chat',
    valueType: SettingValueType.INT,
    valueInt: 0,
    displayName: 'ChatWoot Inbox ID',
    description:
      'Numeric inbox id for the API channel that Skydrop sends customer order updates through. Visible at /app/accounts/<account_id>/settings/inboxes/<id>. Leave 0 in stub mode.',
  },
  // R1c (revised-plan roadmap): per-seller courier-fee deduction
  // timing. AT_DELIVERY (default) matches the existing behavior —
  // ORDER_CHARGES debited when OrderDeliveredAccrualListener fires.
  // AT_AWB debits as soon as the AWB is generated (CourierFeeAccrualService),
  // well before delivery is known — a seller-opt-in tradeoff, not a
  // system default.
  {
    key: 'wallet.courier_fee_deduction_timing',
    category: 'wallet',
    valueType: SettingValueType.STRING,
    valueString: 'AT_DELIVERY',
    displayName: 'Courier Fee Deduction Timing',
    description:
      "Default timing for debiting a seller's ORDER_CHARGES: 'AT_DELIVERY' (default — debited when the order is DELIVERED) or 'AT_AWB' (debited as soon as an AWB is generated, before delivery is known). Per-seller override via seller_setting_overrides.",
    sellerOverridable: true,
  },
  // R2 — seller-initiated withdrawal requests.
  {
    key: 'wallet.cod_credit_mode',
    category: 'wallet',
    valueType: SettingValueType.STRING,
    valueString: 'SETTLEMENT',
    displayName: 'COD Credit Mode',
    description:
      "How a seller is paid their COD money. 'SETTLEMENT' (default) credits them when the courier actually settles with us — no float, no fee. 'INSTANT_PAY' credits at delivery for a percentage fee, and we front the money until the courier pays. ONE at a time: this is a mode, not two switches. Per-seller override.",
    sellerOverridable: true,
  },
  {
    key: 'wallet.cod_gst_percent',
    category: 'wallet',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '18.00',
    displayName: 'GST Withheld from COD (%)',
    description:
      'The customer pays a tax-INCLUSIVE price, so this is extracted from the COD (cod × r / (100 + r)), never added on top: ₹1,000 at 18% withholds ₹152.54, not ₹180. WE file it, so the withheld amount is a liability recorded in gst_withholdings — not margin. Per-seller override because GST is slabbed by what is being sold — apparel is 5% or 12%, electronics 18% — so one rate across every seller is wrong for most of them. It is still not NEGOTIABLE: the override records which slab a seller trades in, and the rate is snapshotted per order so changing it never restates a filed quarter.',
    sellerOverridable: true,
    // The GST slabs, and nothing between 0 and 28 is impossible. A wider
    // range would let a typo withhold a third of a seller's takings.
    overrideMinDecimal: '0',
    overrideMaxDecimal: '28',
  },
  {
    key: 'tracking.webhook_payload_retention_days',
    category: 'tracking',
    valueType: SettingValueType.INT,
    valueInt: 90,
    displayName: 'Courier payload retention (days)',
    description:
      'How long the raw courier payload is kept on each webhook row. courier_webhooks is the largest table per order — every scan stores the payload up to three times (headers, raw body, and the parsed copy of the same thing) and nothing ever removed it. After this window the payload columns are BLANKED and the row survives: when the scan arrived, whether its signature verified, and which tracking event it produced are evidence and stay forever. The payload itself is a debugging artefact, useful while a courier dispute is live and worthless a quarter later. Nothing reads these columns after ingest. This does NOT touch tracking_events, and it must never be extended to financial data.',
  },
  {
    key: 'marketing.lead_notification_email',
    category: 'notifications',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Invite-request alert address',
    description:
      'Where a new invite request is announced. EMPTY means every active SUPER_ADMIN — which is right by default, because it stays correct as admins come and go and cannot silently point at a mailbox nobody reads. Set it to a shared inbox when one person should own the queue.',
  },
  // ── capacity ceilings ─────────────────────────────────────────────
  // What the platform is allowed to grow into. These are the numbers a
  // managed database knows and does not tell us: Postgres reports its
  // connection limit but not the disk its plan bought. So the monitor
  // measures usage and reads the CEILING from here, and says on screen
  // which is which — a guessed ceiling wrong by 4x is worse than a
  // gauge that admits it does not know.
  //
  // UPDATE THESE WHEN THE PLAN CHANGES. Nothing else will.
  {
    key: 'capacity.db_storage_gb',
    category: 'capacity',
    valueType: SettingValueType.INT,
    valueInt: 10,
    displayName: 'Database disk (GB)',
    description:
      'The storage the current managed-database plan includes. A full disk does not slow the system down — it stops accepting writes, so orders cannot be placed and money cannot be recorded. Update this the day the plan is resized.',
  },
  {
    key: 'capacity.db_plan_label',
    category: 'capacity',
    valueType: SettingValueType.STRING,
    valueString: '1 GB RAM / 1 vCPU / 10 GB (basic)',
    displayName: 'Database plan',
    description:
      'Human label for the current plan, shown on the capacity page so the remedy can name what to upgrade from.',
  },
  {
    key: 'capacity.redis_max_memory_mb',
    category: 'capacity',
    valueType: SettingValueType.INT,
    valueInt: 512,
    displayName: 'Redis memory ceiling (MB)',
    description:
      "How much memory Redis may use before jobs are refused or evicted. Redis shares the droplet's RAM and reports no limit of its own, so this is a judgement about how much of the droplet it may take. An evicted delayed job is work that silently never happens.",
  },
  {
    key: 'capacity.api_instances',
    category: 'capacity',
    valueType: SettingValueType.INT,
    valueInt: 1,
    displayName: 'API instances running',
    description:
      'How many API processes serve traffic. Each holds its own database connection pool, so this is the multiplier on the connection ceiling. Exactly one of them should carry WORKERS_ENABLED=true.',
  },
  {
    key: 'wallet.cod_collection_fee_percent',
    category: 'wallet',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '0.00',
    displayName: 'COD Collection Fee (%)',
    description:
      "What collecting COD costs the seller at all, charged on the POST-GST amount and on BOTH credit modes. Instant Pay's fee stacks on top: this is the base service, that is the premium for early access. Seeded at 0 — it changes nothing until someone decides it should. Per-seller override; the rate is negotiable, unlike the tax.",
    sellerOverridable: true,
    overrideMinDecimal: '0',
    overrideMaxDecimal: '100',
  },
  {
    key: 'wallet.instant_pay_fee_percent',
    category: 'wallet',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '2.50',
    displayName: 'Instant Pay Fee (%)',
    description:
      'Charged on the POST-GST amount when a seller is on INSTANT_PAY. ALL-IN: it already contains wallet.cod_collection_fee_percent rather than sitting on top of it, so an Instant Pay order carries this one fee and not both. On ₹1,000 COD: GST leaves ₹847.46, and 2.5% of that is ₹21.19 — what the seller pays to be credited now rather than waiting for the courier. Per-seller override; the rate is negotiable, unlike the tax.',
    sellerOverridable: true,
    overrideMinDecimal: '0',
    overrideMaxDecimal: '100',
  },
  {
    key: 'wallet.settlement_shortfall_alert_percent',
    category: 'wallet',
    valueType: SettingValueType.DECIMAL,
    // 1%, not 5%. This is the point at which absorbing a courier's
    // under-payment stops being a rounding error and starts being a
    // subsidy — and at our margins 5% of a settlement is a lot of money
    // to write off before anyone is asked to look at it. Tightening it
    // costs nothing but an audit row and an error log; the seller is
    // credited in full either way (WAL-6).
    valueDecimal: '1.00',
    displayName: 'Settlement Shortfall Alert (%)',
    description:
      'A seller is credited what the order was WORTH, not what the courier remitted — a short payment is our dispute with the courier, not a clawback from a seller paid in good faith. This is the circuit breaker: a settlement short by more than this percentage audits CRITICAL and asks for a human, so we absorb the occasional error without quietly funding a systematic one.',
  },
  {
    key: 'wallet.minimum_balance_inr',
    category: 'wallet',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '0.00',
    displayName: 'Minimum Wallet Balance (INR)',
    description:
      'A floor the seller may not withdraw below. Withdrawable = balance − this. Distinct from the minimum WITHDRAWAL amount: that is the smallest single request, this is what must be left behind. Raise it for a seller shipping prepaid, where the wallet is the only thing standing between us and an unpaid delivery fee. Per-seller override.',
    sellerOverridable: true,
    overrideMinDecimal: '0',
    overrideMaxDecimal: '10000000',
  },
  {
    key: 'wallet.auto_withdraw_keep_balance_inr',
    category: 'wallet',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '0.00',
    displayName: 'Auto-withdrawal: balance to keep (INR)',
    description:
      'What the SELLER wants left in the wallet after an automatic withdrawal, on top of the platform minimum. Theirs to set, unlike the minimum balance beside it: a seller who wants a working float carried between sweeps had no way to say so, and the sweep took everything down to our floor. Applies to the AUTOMATIC sweep only — a request they make by hand is theirs to size. Must be at or above wallet.minimum_balance_inr, which is the floor they may never go under.',
    sellerOverridable: true,
    overrideMinDecimal: '0',
    overrideMaxDecimal: '10000000',
  },
  {
    key: 'wallet.negative_balance_limit_inr',
    category: 'wallet',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '0.00',
    displayName: 'How far below zero a seller may go (INR)',
    description:
      'A wallet goes negative when charges land with nothing behind them — an RTO fee on a seller who has not topped up, freight on stock that has not sold. Some slack is correct: their goods are in our warehouse and the debt clears as those goods sell. Past this, new orders are refused, because every further order spends money we are already owed. Seller-overridable, for an account we know and want to carry.',
    sellerOverridable: true,
    overrideMinDecimal: '0',
    overrideMaxDecimal: '10000000',
  },
  {
    key: 'wallet.negative_balance_stock_backed',
    category: 'wallet',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: true,
    displayName: 'Let stock in our warehouse raise that limit',
    description:
      'When on, a seller may go negative up to the limit above PLUS the cost value of their stock sitting in our warehouse — the thing that actually secures the debt. When off, the flat limit is the whole allowance, whatever they are holding. On is the honest default: refusing an order from a seller with a warehouse full of their goods protects nothing.',
    sellerOverridable: false,
  },
  {
    key: 'wallet.withdrawal_max_per_month',
    category: 'wallet',
    valueType: SettingValueType.INT,
    valueInt: 20,
    displayName: 'Withdrawal Requests Per Month (max)',
    description:
      'Maximum number of withdrawal requests in a rolling 30-day window. A COUNT of requests, not a total amount — the daily limit works the same way. Per-seller override.',
    sellerOverridable: true,
    overrideMinInt: 1,
    overrideMaxInt: 500,
  },
  {
    key: 'wallet.auto_withdraw_enabled',
    category: 'wallet',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: false,
    displayName: 'Auto Withdrawal Enabled',
    description:
      "When on, everything above the minimum balance is requested automatically at the seller's chosen time each day — no manual request needed. Off by default: a seller should opt into money moving without them asking. Per-seller override.",
    sellerOverridable: true,
  },
  {
    key: 'wallet.auto_withdraw_hour_local',
    category: 'wallet',
    valueType: SettingValueType.INT,
    valueInt: 10,
    displayName: 'Auto Withdrawal Hour (seller local time)',
    description:
      "Hour of day (0-23) the auto-withdrawal sweep raises the request, in the SELLER's local timezone — not ours. A Bangladeshi seller asking for 10am means 10am in Dhaka. Per-seller override.",
    sellerOverridable: true,
    overrideMinInt: 0,
    overrideMaxInt: 23,
  },
  {
    key: 'wallet.withdrawal_sla_hours',
    category: 'wallet',
    valueType: SettingValueType.INT,
    valueInt: 48,
    displayName: 'Withdrawal SLA (hours)',
    description:
      'What we tell the seller to expect: a request is processed within this many hours. DISPLAY ONLY — it does not hold, delay or schedule anything, and an agent may pay sooner.',
  },
  {
    key: 'wallet.withdrawal_min_threshold_inr',
    category: 'wallet',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '500.00',
    displayName: 'Withdrawal Minimum Threshold (INR)',
    description:
      'Minimum wallet balance a seller must request in one withdrawal. Per-seller override via seller_setting_overrides.',
    sellerOverridable: true,
  },
  {
    key: 'wallet.withdrawal_max_per_day',
    category: 'wallet',
    valueType: SettingValueType.INT,
    valueInt: 1,
    displayName: 'Withdrawal Requests Per Day (max)',
    description:
      'Maximum number of withdrawal requests a seller may submit in a rolling 24h window. Per-seller override via seller_setting_overrides.',
    sellerOverridable: true,
    overrideMinInt: 1,
    overrideMaxInt: 20,
  },
  // R2b — T_PLUS_N wallet-timing tier. INSTANT (default) preserves
  // today's exact behavior (credit/debit immediately on DELIVERED);
  // T_PLUS_N is a seller opt-in that defers accrual by
  // accrual_delay_days via PendingAccrualSweepService.
  {
    key: 'wallet.accrual_timing_tier',
    category: 'wallet',
    // Default flipped to T_PLUS_N (2026-07-26). Crediting at DELIVERED
    // pays sellers 5-10 days BEFORE the courier settles with us, i.e.
    // Skydrop floats the money and eats any short-payment. INSTANT stays
    // available as a per-seller opt-in (and is the shape a paid
    // instant-credit tier would take), but it is no longer what a new
    // seller gets by default.
    valueType: SettingValueType.STRING,
    valueString: 'T_PLUS_N',
    displayName: 'Wallet Accrual Timing Tier',
    description:
      "'T_PLUS_N' (default — credited/debited accrual_delay_days after DELIVERED, once the courier has settled with us) or 'INSTANT' (credited the moment the parcel is delivered, which means Skydrop fronts the money until the courier pays). Per-seller override via seller_setting_overrides.",
    sellerOverridable: true,
  },
  // R5 — two-stage ("virtual") inventory booking. Defaults keep every
  // existing seller on today's behaviour: stock is claimed only at call
  // confirmation, so opting in is a deliberate per-seller act.
  {
    key: 'inventory.early_reservation_enabled',
    category: 'ops',
    valueType: SettingValueType.BOOLEAN,
    valueBoolean: false,
    displayName: 'Book Stock At Order Placement',
    description:
      'When true, stock is reserved the moment an order lands (before call confirmation) as well as at confirmation. Off by default — an at-placement hold ties up stock for orders that may never be confirmed. Per-seller override.',
    sellerOverridable: true,
  },
  {
    key: 'inventory.early_reservation_ndr_action',
    category: 'ops',
    valueType: SettingValueType.STRING,
    valueString: 'AUTO_RELEASE',
    displayName: 'Early-Hold Action At Call Cap',
    description:
      "What to do with an at-placement stock hold when call attempts are exhausted: 'AUTO_RELEASE' (give the stock back immediately) or 'MANUAL_REVIEW' (surface it on the seller dashboard so they choose release vs more attempts). Per-seller override.",
    sellerOverridable: true,
  },
  {
    key: 'inventory.early_reservation_ttl_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 24,
    displayName: 'Early-Hold TTL (hours)',
    description:
      'How long an at-placement hold survives before the reservation sweeper releases it. Deliberately shorter than the confirmed-order TTL, because these holds back orders nobody has spoken to yet. Per-seller override.',
    sellerOverridable: true,
    overrideMinInt: 1,
    overrideMaxInt: 336,
  },
  // R3 — BD→India inbound freight billing. PAY_NOW default keeps the
  // money flow simple (settled the moment ops records the bill); a
  // seller who negotiates credit terms gets PAY_LATER, and the service
  // charge defaults to 0 so nobody is charged for credit they were never
  // quoted.
  {
    key: 'wallet.inbound_freight_mode',
    category: 'wallet',
    valueType: SettingValueType.STRING,
    valueString: 'PAY_NOW',
    displayName: 'Inbound Freight Payment Mode',
    description:
      "Who fronts the BD→India freight bill: 'PAY_NOW' (default — debited from the wallet when ops records it) or 'PAY_LATER' (carried as a receivable the seller settles later, optionally with a service charge). Per-seller override.",
    sellerOverridable: true,
  },
  {
    key: 'wallet.inbound_freight_service_charge_percent',
    category: 'wallet',
    valueType: SettingValueType.DECIMAL,
    valueDecimal: '0.00',
    displayName: 'Inbound Freight Pay-Later Service Charge (%)',
    description:
      'Percentage added to a PAY_LATER inbound freight bill. Ignored for PAY_NOW. Defaults to 0 — a seller is only charged for credit terms that were explicitly quoted to them. Per-seller override.',
    sellerOverridable: true,
    overrideMinDecimal: '0.00',
    overrideMaxDecimal: '5.00',
  },
  // R5b — how long an unanswered call-cap review may hold stock before
  // the sweep releases it and rejects the order. Without a TTL,
  // AWAITING_SELLER_DECISION would be a stock-holding black hole.
  {
    key: 'inventory.early_reservation_review_ttl_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 72,
    displayName: 'Call-Cap Review TTL (hours)',
    description:
      'How long an order may sit in AWAITING_SELLER_DECISION before the hourly sweep releases any held stock and rejects it (REJECTED_NDR). Only applies to sellers whose NDR action is MANUAL_REVIEW. Per-seller override.',
    sellerOverridable: true,
    overrideMinInt: 1,
    overrideMaxInt: 720,
  },
  // R4 — STRICT-mode per-unit inventory. NORMAL default means nothing
  // changes for anyone on deploy; strict is opted into per seller (this
  // setting) or per SKU (product_variants.inventory_mode wins).
  {
    key: 'inventory.default_inventory_mode',
    category: 'ops',
    valueType: SettingValueType.STRING,
    valueString: 'NORMAL',
    displayName: 'Default Inventory Mode',
    description:
      "Tracking mode for a seller's SKUs: 'NORMAL' (aggregate quantities, today's behaviour) or 'STRICT' (one scanned serial per physical unit at pick/pack/RTO). ADMIN-ONLY — set here, or per seller from the seller's detail page. It decides how the warehouse floor works, so it is our operational call rather than something a seller flips from their own settings.",
    sellerOverridable: false,
  },
  {
    key: 'inventory.strict_unit_serial_prefix',
    category: 'ops',
    valueType: SettingValueType.STRING,
    valueString: 'SDU',
    displayName: 'Generated Unit Serial Prefix',
    description:
      'Prefix for serials Skydrop generates + prints at receiving when a strict-mode unit arrives without a usable supplier barcode. Purely cosmetic — uniqueness comes from the generated body.',
    sellerOverridable: false,
  },
  {
    key: 'inventory.unit_stuck_sla_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 48,
    displayName: 'Unit Stuck SLA (hours)',
    description:
      'How long a serialized unit may sit in a mid-lifecycle status (PICKED / PACKED) before the discrepancy report flags it as stuck — i.e. an expected scan that never happened.',
    sellerOverridable: false,
    overrideMinInt: 1,
    overrideMaxInt: 2160,
  },
  {
    key: 'inventory.unit_dispatched_unresolved_days',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 30,
    displayName: 'Dispatched-Unresolved Window (days)',
    description:
      'How long a unit may stay DISPATCHED before the discrepancy report treats it as unresolved. Delivery is stock-neutral and produces no unit scan (TRK-7), so ageing is how a never-returned, never-confirmed unit surfaces.',
    sellerOverridable: false,
    overrideMinInt: 1,
    overrideMaxInt: 365,
  },
  {
    key: 'wallet.accrual_delay_days',
    category: 'wallet',
    valueType: SettingValueType.INT,
    // 7 days: Delhivery's stated settlement window is 5-10 days, so this
    // covers the typical case. The R2c settlement ledger is what will
    // tell you the REAL distribution — raise this if the reconciliation
    // report shows withdrawals routinely landing later than 7 days.
    valueInt: 7,
    displayName: 'Accrual Delay (days)',
    description:
      "Days after DELIVERED before a T_PLUS_N-tier seller's wallet is credited/debited. Should be >= the courier's settlement window, so we are paying out money we already hold. Ignored for INSTANT-tier sellers. Per-seller override via seller_setting_overrides.",
    sellerOverridable: true,
    overrideMinInt: 1,
    overrideMaxInt: 30,
  },
];

async function seedSystemSettings() {
  for (const s of systemSettings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      create: {
        key: s.key,
        category: s.category,
        valueType: s.valueType,
        valueString: s.valueString ?? null,
        valueInt: s.valueInt ?? null,
        valueDecimal: s.valueDecimal ?? null,
        valueBoolean: s.valueBoolean ?? null,
        valueJson: (s.valueJson ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        displayName: s.displayName,
        description: s.description,
        sellerOverridable: s.sellerOverridable ?? false,
        overrideMinInt: s.overrideMinInt ?? null,
        overrideMaxInt: s.overrideMaxInt ?? null,
        overrideMinDecimal: s.overrideMinDecimal ?? null,
        overrideMaxDecimal: s.overrideMaxDecimal ?? null,
      },
      update: {
        category: s.category,
        valueType: s.valueType,
        displayName: s.displayName,
        description: s.description,
        sellerOverridable: s.sellerOverridable ?? false,
        overrideMinInt: s.overrideMinInt ?? null,
        overrideMaxInt: s.overrideMaxInt ?? null,
        overrideMinDecimal: s.overrideMinDecimal ?? null,
        overrideMaxDecimal: s.overrideMaxDecimal ?? null,
      },
    });
  }

  // ops.default_warehouse_id resolves to CCU-01's uuid at seed time rather
  // than a hard-coded literal, so it stays correct across environments
  // (ids are uuidv7, not deterministic). Requires seedWarehouses() to have
  // run first — main() orders it that way. Value is create-only like every
  // other setting: an admin re-pointing the default is preserved on re-seed.
  const blr01 = await prisma.warehouse.findUnique({
    where: { code: 'CCU-01' },
    select: { id: true },
  });
  if (!blr01) {
    throw new Error(
      'seed: CCU-01 warehouse must exist before system settings — check seed order in main()',
    );
  }
  const defaultWarehouseDesc =
    'Warehouse used when a request does not specify one (Phase 1A is single-warehouse)';
  await prisma.systemSetting.upsert({
    where: { key: 'ops.default_warehouse_id' },
    create: {
      key: 'ops.default_warehouse_id',
      category: 'ops',
      valueType: SettingValueType.STRING,
      valueString: blr01.id,
      displayName: 'Default Warehouse',
      description: defaultWarehouseDesc,
    },
    update: {
      category: 'ops',
      valueType: SettingValueType.STRING,
      displayName: 'Default Warehouse',
      description: defaultWarehouseDesc,
    },
  });

  // The Bangladesh intake warehouse. Deliberately seeded EMPTY: there is
  // no such building until somebody creates one, and inventing an id
  // would point a route at a warehouse that does not exist. A VIA_BD
  // consignment refuses with BD_WAREHOUSE_NOT_CONFIGURED until this is
  // set, which is the honest failure — better than silently routing the
  // seller's stock to India when they said Bangladesh.
  const bdWarehouseDesc =
    'Warehouse that receives BD-routed consignments before they travel to India. ' +
    'Must be a warehouse with fulfilsOrders = false. Empty means VIA_BD routing is unavailable.';
  await prisma.systemSetting.upsert({
    where: { key: 'ops.bd_intake_warehouse_id' },
    create: {
      key: 'ops.bd_intake_warehouse_id',
      category: 'ops',
      valueType: SettingValueType.STRING,
      valueString: '',
      displayName: 'Bangladesh Intake Warehouse',
      description: bdWarehouseDesc,
    },
    update: {
      category: 'ops',
      valueType: SettingValueType.STRING,
      displayName: 'Bangladesh Intake Warehouse',
      description: bdWarehouseDesc,
    },
  });

  console.log(`  system_settings: ${systemSettings.length + 2} upserted`);
}

async function seedCouriers() {
  // Shiprocket exists as a row but starts SWITCHED OFF.
  //
  // The row has to exist or there is nothing for the admin console to
  // toggle — and until 2026-08-29 it did not, which meant Shiprocket
  // was off only by accident: `CourierEnablementService` fails closed on
  // an unknown courier, so the safety was real but nobody had decided
  // it. Accidental safety stops being safe the moment someone creates
  // the row by hand to test something.
  //
  // isActive:false is the deliberate version. Nothing has ever been
  // written against a real Shiprocket account — every request shape in
  // the adapter is transcribed from their published docs and unproven —
  // so intake stays off until a controlled first parcel says otherwise.
  // `update: {}` means flipping it on in the console is NOT undone by
  // the next deploy, which is the whole point of it being a switch.
  await prisma.courier.upsert({
    where: { code: 'shiprocket' },
    create: {
      code: 'shiprocket',
      name: 'Shiprocket',
      displayName: 'Shiprocket',
      integrationType: CourierIntegrationType.API_FULL,
      supportsCod: true,
      supportsPrepaid: true,
      supportsRto: true,
      // They aggregate carriers and settle disputes on the carrier's
      // behalf; we have never run one, so this stays false until we do.
      supportsWeightDispute: false,
      defaultServiceTypes: ['surface'],
      volumetricDivisor: 5000,
      isActive: false,
      // Below Delhivery: with both enabled and no explicit split, the
      // proven integration should be the one that gets the parcel.
      priorityForRouting: 40,
    },
    update: {},
  });

  await prisma.courier.upsert({
    where: { code: 'delhivery' },
    create: {
      code: 'delhivery',
      name: 'Delhivery',
      displayName: 'Delhivery Express',
      integrationType: CourierIntegrationType.API_FULL,
      supportsCod: true,
      supportsPrepaid: true,
      supportsRto: true,
      supportsWeightDispute: true,
      defaultServiceTypes: ['express', 'surface'],
      volumetricDivisor: 5000,
      isActive: true,
      priorityForRouting: 50,
    },
    update: {},
  });
  await prisma.courier.upsert({
    where: { code: 'manual' },
    create: {
      code: 'manual',
      name: 'Manual Courier',
      displayName: 'Manual Courier Assignment',
      integrationType: CourierIntegrationType.MANUAL,
      supportsCod: true,
      supportsPrepaid: true,
      supportsRto: true,
      defaultServiceTypes: ['express'],
      volumetricDivisor: 5000,
      isActive: true,
      priorityForRouting: 999,
    },
    update: {},
  });
  console.log(`  couriers: 2 upserted (delhivery, manual)`);
}

async function seedFxRates() {
  const now = new Date();
  await prisma.fxRate.upsert({
    where: {
      fromCurrency_toCurrency: { fromCurrency: Currency.INR, toCurrency: Currency.BDT },
    },
    create: {
      fromCurrency: Currency.INR,
      toCurrency: Currency.BDT,
      rate: '1.350000',
      source: FxRateSource.FALLBACK,
      fetchedAt: now,
    },
    update: {},
  });
  await prisma.fxRate.upsert({
    where: {
      fromCurrency_toCurrency: { fromCurrency: Currency.BDT, toCurrency: Currency.INR },
    },
    create: {
      fromCurrency: Currency.BDT,
      toCurrency: Currency.INR,
      rate: '0.740000',
      source: FxRateSource.FALLBACK,
      fetchedAt: now,
    },
    update: {},
  });
  console.log(`  fx_rates: 2 upserted (INR↔BDT fallback)`);
}

async function seedWarehouses() {
  await prisma.warehouse.upsert({
    where: { code: 'CCU-01' },
    create: {
      code: 'CCU-01',
      name: 'Kolkata Main',
      status: WarehouseStatus.ACTIVE,
      countryCode: 'IN',
      timezone: 'Asia/Kolkata',
    },
    update: {},
  });
  // The MAIN zone and FLOOR bin, exactly as warehouse CREATION provisions
  // them. The seed never did, so the one warehouse production ever had
  // reached live with ZERO bins — the receiving screen's putaway dropdown
  // was empty and there was no way to book anything in through the UI.
  // BinPolicyService self-heals a FLOOR on the write path, which is why
  // this went unnoticed: the API worked and the screen did not.
  const wh = await prisma.warehouse.findUniqueOrThrow({
    where: { code: 'CCU-01' },
    select: { id: true },
  });
  const zone = await prisma.warehouseZone.upsert({
    where: { warehouseId_code: { warehouseId: wh.id, code: 'MAIN' } },
    create: { warehouseId: wh.id, code: 'MAIN', name: 'Main', pickOrder: 100 },
    update: {},
    select: { id: true },
  });
  await prisma.warehouseBin.upsert({
    where: { warehouseId_code: { warehouseId: wh.id, code: 'FLOOR' } },
    create: { warehouseId: wh.id, zoneId: zone.id, code: 'FLOOR', type: 'STORAGE' },
    update: {},
  });

  console.log(`  warehouses: 1 upserted (CCU-01) with MAIN zone + FLOOR bin`);
}

async function seedRateCards() {
  await prisma.rateCard.upsert({
    where: { code: 'default-2026' },
    create: {
      code: 'default-2026',
      name: 'Default Rate Card 2026',
      description: 'Standard rates for all sellers without custom contracts',
      isDefault: true,
      isActive: true,
      effectiveFrom: new Date(),
      currency: Currency.INR,
    },
    update: {},
  });
  console.log(`  rate_cards: 1 upserted (default-2026)`);
}

/**
 * Zone matrix: origin METRO (CCU-01) → destination area → letter zone.
 * Same five zones (A..E) for both seeded couriers. The pricing engine
 * looks up (courier, origin, dest) and uses the zone string as part
 * of the RateCardItem key.
 *
 * Phase 1A is single-origin (CCU-01); when multi-warehouse lands the
 * matrix must be regenerated per origin.
 */
const ZONE_MATRIX_ROWS: ReadonlyArray<{
  destArea: ServiceArea;
  zone: string;
}> = [
  { destArea: ServiceArea.METRO, zone: 'A' },
  { destArea: ServiceArea.TIER1, zone: 'B' },
  { destArea: ServiceArea.TIER2, zone: 'C' },
  { destArea: ServiceArea.REST, zone: 'D' },
  { destArea: ServiceArea.SPECIAL_NE, zone: 'E' },
  { destArea: ServiceArea.SPECIAL_JK, zone: 'E' },
];

async function seedZoneMatrix() {
  const couriers = await prisma.courier.findMany({
    where: { code: { in: ['delhivery', 'manual'] } },
    select: { id: true, code: true },
  });
  let count = 0;
  for (const courier of couriers) {
    for (const row of ZONE_MATRIX_ROWS) {
      await prisma.zoneMatrixEntry.upsert({
        where: {
          courierId_originArea_destArea: {
            courierId: courier.id,
            originArea: ServiceArea.METRO,
            destArea: row.destArea,
          },
        },
        create: {
          courierId: courier.id,
          originArea: ServiceArea.METRO,
          destArea: row.destArea,
          zone: row.zone,
        },
        update: { zone: row.zone },
      });
      count += 1;
    }
  }
  console.log(`  zone_matrix_entries: ${count} upserted`);
}

/**
 * Rate card items: (zone × weight slab) base rate + per-kg overage.
 *
 * Numbers chosen as a reasonable Phase-1A starting point — match a
 * Delhivery surface-express ballpark for India. Admin can override
 * via the rate-card admin tooling later.
 */
interface RateRow {
  zone: string;
  weightSlabFromGrams: number;
  weightSlabToGrams: number;
  baseChargeInr: string;
  perKgChargeInr: string | null;
}

const RATE_CARD_ROWS: ReadonlyArray<RateRow> = [
  // 0–500g
  {
    zone: 'A',
    weightSlabFromGrams: 0,
    weightSlabToGrams: 500,
    baseChargeInr: '60.00',
    perKgChargeInr: null,
  },
  {
    zone: 'B',
    weightSlabFromGrams: 0,
    weightSlabToGrams: 500,
    baseChargeInr: '80.00',
    perKgChargeInr: null,
  },
  {
    zone: 'C',
    weightSlabFromGrams: 0,
    weightSlabToGrams: 500,
    baseChargeInr: '100.00',
    perKgChargeInr: null,
  },
  {
    zone: 'D',
    weightSlabFromGrams: 0,
    weightSlabToGrams: 500,
    baseChargeInr: '130.00',
    perKgChargeInr: null,
  },
  {
    zone: 'E',
    weightSlabFromGrams: 0,
    weightSlabToGrams: 500,
    baseChargeInr: '180.00',
    perKgChargeInr: null,
  },
  // 500g–1kg
  {
    zone: 'A',
    weightSlabFromGrams: 500,
    weightSlabToGrams: 1000,
    baseChargeInr: '90.00',
    perKgChargeInr: null,
  },
  {
    zone: 'B',
    weightSlabFromGrams: 500,
    weightSlabToGrams: 1000,
    baseChargeInr: '120.00',
    perKgChargeInr: null,
  },
  {
    zone: 'C',
    weightSlabFromGrams: 500,
    weightSlabToGrams: 1000,
    baseChargeInr: '150.00',
    perKgChargeInr: null,
  },
  {
    zone: 'D',
    weightSlabFromGrams: 500,
    weightSlabToGrams: 1000,
    baseChargeInr: '190.00',
    perKgChargeInr: null,
  },
  {
    zone: 'E',
    weightSlabFromGrams: 500,
    weightSlabToGrams: 1000,
    baseChargeInr: '260.00',
    perKgChargeInr: null,
  },
  // 1kg–2kg
  {
    zone: 'A',
    weightSlabFromGrams: 1000,
    weightSlabToGrams: 2000,
    baseChargeInr: '130.00',
    perKgChargeInr: null,
  },
  {
    zone: 'B',
    weightSlabFromGrams: 1000,
    weightSlabToGrams: 2000,
    baseChargeInr: '170.00',
    perKgChargeInr: null,
  },
  {
    zone: 'C',
    weightSlabFromGrams: 1000,
    weightSlabToGrams: 2000,
    baseChargeInr: '215.00',
    perKgChargeInr: null,
  },
  {
    zone: 'D',
    weightSlabFromGrams: 1000,
    weightSlabToGrams: 2000,
    baseChargeInr: '280.00',
    perKgChargeInr: null,
  },
  {
    zone: 'E',
    weightSlabFromGrams: 1000,
    weightSlabToGrams: 2000,
    baseChargeInr: '380.00',
    perKgChargeInr: null,
  },
  // 2kg–5kg with per-kg overage above 2kg floor
  {
    zone: 'A',
    weightSlabFromGrams: 2000,
    weightSlabToGrams: 5000,
    baseChargeInr: '180.00',
    perKgChargeInr: '40.00',
  },
  {
    zone: 'B',
    weightSlabFromGrams: 2000,
    weightSlabToGrams: 5000,
    baseChargeInr: '240.00',
    perKgChargeInr: '55.00',
  },
  {
    zone: 'C',
    weightSlabFromGrams: 2000,
    weightSlabToGrams: 5000,
    baseChargeInr: '300.00',
    perKgChargeInr: '70.00',
  },
  {
    zone: 'D',
    weightSlabFromGrams: 2000,
    weightSlabToGrams: 5000,
    baseChargeInr: '400.00',
    perKgChargeInr: '95.00',
  },
  {
    zone: 'E',
    weightSlabFromGrams: 2000,
    weightSlabToGrams: 5000,
    baseChargeInr: '540.00',
    perKgChargeInr: '130.00',
  },
  // 5kg–10kg per-kg only (base lifted)
  {
    zone: 'A',
    weightSlabFromGrams: 5000,
    weightSlabToGrams: 10000,
    baseChargeInr: '300.00',
    perKgChargeInr: '40.00',
  },
  {
    zone: 'B',
    weightSlabFromGrams: 5000,
    weightSlabToGrams: 10000,
    baseChargeInr: '405.00',
    perKgChargeInr: '55.00',
  },
  {
    zone: 'C',
    weightSlabFromGrams: 5000,
    weightSlabToGrams: 10000,
    baseChargeInr: '510.00',
    perKgChargeInr: '70.00',
  },
  {
    zone: 'D',
    weightSlabFromGrams: 5000,
    weightSlabToGrams: 10000,
    baseChargeInr: '685.00',
    perKgChargeInr: '95.00',
  },
  {
    zone: 'E',
    weightSlabFromGrams: 5000,
    weightSlabToGrams: 10000,
    baseChargeInr: '930.00',
    perKgChargeInr: '130.00',
  },
  // 10kg–30kg
  {
    zone: 'A',
    weightSlabFromGrams: 10000,
    weightSlabToGrams: 30000,
    baseChargeInr: '500.00',
    perKgChargeInr: '38.00',
  },
  {
    zone: 'B',
    weightSlabFromGrams: 10000,
    weightSlabToGrams: 30000,
    baseChargeInr: '680.00',
    perKgChargeInr: '52.00',
  },
  {
    zone: 'C',
    weightSlabFromGrams: 10000,
    weightSlabToGrams: 30000,
    baseChargeInr: '860.00',
    perKgChargeInr: '66.00',
  },
  {
    zone: 'D',
    weightSlabFromGrams: 10000,
    weightSlabToGrams: 30000,
    baseChargeInr: '1160.00',
    perKgChargeInr: '90.00',
  },
  {
    zone: 'E',
    weightSlabFromGrams: 10000,
    weightSlabToGrams: 30000,
    baseChargeInr: '1580.00',
    perKgChargeInr: '125.00',
  },
];

async function seedRateCardItems() {
  const rateCard = await prisma.rateCard.findUnique({
    where: { code: 'default-2026' },
    select: { id: true },
  });
  if (!rateCard) {
    console.log('  rate_card_items: SKIPPED (default-2026 not found)');
    return;
  }
  const couriers = await prisma.courier.findMany({
    where: { code: { in: ['delhivery', 'manual'] } },
    select: { id: true, code: true },
  });
  let count = 0;
  for (const courier of couriers) {
    // 'standard' is the PricingEngineService default service type;
    // 'express' / 'surface' are Delhivery tier alternatives.
    for (const serviceType of ['standard', 'express', 'surface']) {
      for (const row of RATE_CARD_ROWS) {
        await prisma.rateCardItem.upsert({
          where: {
            rateCardId_courierId_serviceType_zone_weightSlabFromGrams: {
              rateCardId: rateCard.id,
              courierId: courier.id,
              serviceType,
              zone: row.zone,
              weightSlabFromGrams: row.weightSlabFromGrams,
            },
          },
          create: {
            rateCardId: rateCard.id,
            courierId: courier.id,
            serviceType,
            zone: row.zone,
            weightSlabFromGrams: row.weightSlabFromGrams,
            weightSlabToGrams: row.weightSlabToGrams,
            baseChargeInr: row.baseChargeInr,
            perKgChargeInr: row.perKgChargeInr,
            isActive: true,
          },
          update: {
            weightSlabToGrams: row.weightSlabToGrams,
            baseChargeInr: row.baseChargeInr,
            perKgChargeInr: row.perKgChargeInr,
            isActive: true,
          },
        });
        count += 1;
      }
    }
  }
  console.log(`  rate_card_items: ${count} upserted`);
}

/**
 * Surcharge rules — COD fee, fuel surcharge, remote area fee.
 *
 * Identified by a unique (rateCardId, type, name) tuple in seed via
 * findFirst → upsert (the schema doesn't define a natural-key unique
 * on the table, so the seed manages idempotency in code).
 */
interface SurchargeSeed {
  type: SurchargeType;
  name: string;
  computationMethod: SurchargeComputationMethod;
  flatAmountInr: string | null;
  percentage: string | null;
  minAmountInr: string | null;
  maxAmountInr: string | null;
  baseField: SurchargeBaseField | null;
  appliesOnlyIfPaymentMode: PaymentMode | null;
  appliesOnlyForServiceAreas: ServiceArea[];
  isVisibleToSeller: boolean;
  displayOrder: number;
}

const SURCHARGE_SEEDS: ReadonlyArray<SurchargeSeed> = [
  {
    type: SurchargeType.COD_FEE,
    name: 'COD handling fee',
    computationMethod: SurchargeComputationMethod.PERCENTAGE,
    flatAmountInr: null,
    percentage: '2.00',
    minAmountInr: '30.00',
    maxAmountInr: '100.00',
    baseField: SurchargeBaseField.COD_AMOUNT,
    appliesOnlyIfPaymentMode: PaymentMode.COD,
    appliesOnlyForServiceAreas: [],
    isVisibleToSeller: true,
    displayOrder: 10,
  },
  {
    type: SurchargeType.FUEL_SURCHARGE,
    name: 'Fuel surcharge',
    computationMethod: SurchargeComputationMethod.PERCENTAGE,
    flatAmountInr: null,
    percentage: '8.00',
    minAmountInr: null,
    maxAmountInr: null,
    baseField: SurchargeBaseField.SHIPPING_CHARGE,
    appliesOnlyIfPaymentMode: null,
    appliesOnlyForServiceAreas: [],
    isVisibleToSeller: true,
    displayOrder: 20,
  },
  {
    type: SurchargeType.REMOTE_AREA_FEE,
    name: 'Remote area surcharge',
    computationMethod: SurchargeComputationMethod.FLAT,
    flatAmountInr: '50.00',
    percentage: null,
    minAmountInr: null,
    maxAmountInr: null,
    baseField: null,
    appliesOnlyIfPaymentMode: null,
    appliesOnlyForServiceAreas: [ServiceArea.SPECIAL_NE, ServiceArea.SPECIAL_JK],
    isVisibleToSeller: true,
    displayOrder: 30,
  },
];

async function seedSurchargeRules() {
  const rateCard = await prisma.rateCard.findUnique({
    where: { code: 'default-2026' },
    select: { id: true },
  });
  if (!rateCard) {
    console.log('  surcharge_rules: SKIPPED (default-2026 not found)');
    return;
  }
  let count = 0;
  for (const s of SURCHARGE_SEEDS) {
    const existing = await prisma.surchargeRule.findFirst({
      where: { rateCardId: rateCard.id, type: s.type, name: s.name },
      select: { id: true },
    });
    if (existing) {
      await prisma.surchargeRule.update({
        where: { id: existing.id },
        data: {
          computationMethod: s.computationMethod,
          flatAmountInr: s.flatAmountInr,
          percentage: s.percentage,
          minAmountInr: s.minAmountInr,
          maxAmountInr: s.maxAmountInr,
          baseField: s.baseField,
          appliesOnlyIfPaymentMode: s.appliesOnlyIfPaymentMode,
          appliesOnlyForServiceAreas: s.appliesOnlyForServiceAreas,
          isVisibleToSeller: s.isVisibleToSeller,
          displayOrder: s.displayOrder,
          isActive: true,
        },
      });
    } else {
      await prisma.surchargeRule.create({
        data: {
          rateCardId: rateCard.id,
          type: s.type,
          name: s.name,
          computationMethod: s.computationMethod,
          flatAmountInr: s.flatAmountInr,
          percentage: s.percentage,
          minAmountInr: s.minAmountInr,
          maxAmountInr: s.maxAmountInr,
          baseField: s.baseField,
          appliesOnlyIfPaymentMode: s.appliesOnlyIfPaymentMode,
          appliesOnlyForServiceAreas: s.appliesOnlyForServiceAreas,
          isVisibleToSeller: s.isVisibleToSeller,
          displayOrder: s.displayOrder,
          isActive: true,
        },
      });
    }
    count += 1;
  }
  console.log(`  surcharge_rules: ${count} upserted`);
}

/**
 * Sample PIN codes for the major Indian metros + tier-1 cities.
 * Not exhaustive — only enough to let the pricing engine resolve
 * realistic zones for the most common destinations. Production
 * imports a full PIN-code dump (DoT-published) via a separate job.
 */
interface PinSeed {
  pin: string;
  city: string;
  state: string;
  area: ServiceArea;
}

const PIN_SEEDS: ReadonlyArray<PinSeed> = [
  // METRO — top 8 metros
  { pin: '110001', city: 'New Delhi', state: 'Delhi', area: ServiceArea.METRO },
  { pin: '400001', city: 'Mumbai', state: 'Maharashtra', area: ServiceArea.METRO },
  { pin: '600001', city: 'Chennai', state: 'Tamil Nadu', area: ServiceArea.METRO },
  { pin: '700001', city: 'Kolkata', state: 'West Bengal', area: ServiceArea.METRO },
  { pin: '560001', city: 'Bengaluru', state: 'Karnataka', area: ServiceArea.METRO },
  { pin: '500001', city: 'Hyderabad', state: 'Telangana', area: ServiceArea.METRO },
  { pin: '380001', city: 'Ahmedabad', state: 'Gujarat', area: ServiceArea.METRO },
  { pin: '411001', city: 'Pune', state: 'Maharashtra', area: ServiceArea.METRO },
  // TIER1
  { pin: '302001', city: 'Jaipur', state: 'Rajasthan', area: ServiceArea.TIER1 },
  { pin: '226001', city: 'Lucknow', state: 'Uttar Pradesh', area: ServiceArea.TIER1 },
  { pin: '440001', city: 'Nagpur', state: 'Maharashtra', area: ServiceArea.TIER1 },
  { pin: '160001', city: 'Chandigarh', state: 'Chandigarh', area: ServiceArea.TIER1 },
  { pin: '462001', city: 'Bhopal', state: 'Madhya Pradesh', area: ServiceArea.TIER1 },
  { pin: '751001', city: 'Bhubaneswar', state: 'Odisha', area: ServiceArea.TIER1 },
  { pin: '682001', city: 'Kochi', state: 'Kerala', area: ServiceArea.TIER1 },
  { pin: '530001', city: 'Visakhapatnam', state: 'Andhra Pradesh', area: ServiceArea.TIER1 },
  // TIER2
  { pin: '641001', city: 'Coimbatore', state: 'Tamil Nadu', area: ServiceArea.TIER2 },
  { pin: '395001', city: 'Surat', state: 'Gujarat', area: ServiceArea.TIER2 },
  { pin: '452001', city: 'Indore', state: 'Madhya Pradesh', area: ServiceArea.TIER2 },
  { pin: '110085', city: 'Delhi NCR – Rohini', state: 'Delhi', area: ServiceArea.METRO },
  { pin: '201301', city: 'Noida', state: 'Uttar Pradesh', area: ServiceArea.METRO },
  { pin: '122001', city: 'Gurugram', state: 'Haryana', area: ServiceArea.METRO },
  // SPECIAL_NE — north-east
  { pin: '781001', city: 'Guwahati', state: 'Assam', area: ServiceArea.SPECIAL_NE },
  { pin: '795001', city: 'Imphal', state: 'Manipur', area: ServiceArea.SPECIAL_NE },
  { pin: '797001', city: 'Kohima', state: 'Nagaland', area: ServiceArea.SPECIAL_NE },
  // SPECIAL_JK
  { pin: '180001', city: 'Jammu', state: 'Jammu & Kashmir', area: ServiceArea.SPECIAL_JK },
  { pin: '190001', city: 'Srinagar', state: 'Jammu & Kashmir', area: ServiceArea.SPECIAL_JK },
];

async function seedPinCodes() {
  let count = 0;
  for (const p of PIN_SEEDS) {
    await prisma.pinCode.upsert({
      where: { pinCode: p.pin },
      create: {
        pinCode: p.pin,
        countryCode: 'IN',
        city: p.city,
        stateProvince: p.state,
        serviceArea: p.area,
        source: PinCodeSource.MANUAL_IMPORT,
      },
      update: {
        city: p.city,
        stateProvince: p.state,
        serviceArea: p.area,
      },
    });
    count += 1;
  }
  console.log(`  pin_codes: ${count} upserted`);
}

type TemplateSeed = {
  code: string;
  name: string;
  channel: NotificationChannel;
  recipientType: NotificationRecipientType;
  subject?: string;
  bodyTemplate: string;
  /** Optional HTML version. When set, the EmailDispatchService sends
   *  both text + HTML (multipart/alternative). Email clients prefer
   *  HTML when available; the text body is the fallback. */
  htmlBodyTemplate?: string;
};

/**
 * Branded HTML wrapper for transactional emails — applied to every
 * customer + seller + staff email template via `wrapHtml(...)`. Takes
 * a title, body HTML (paragraphs / lists / details), and optional
 * primary CTA (label + url). All inline styles so it renders the
 * same in Gmail / Outlook / Apple Mail. Light-theme palette (the
 * dark-theme variant uses the same hex codes — recipients see a
 * white card on a neutral background regardless of their app theme).
 */
function wrapHtml(opts: {
  title: string;
  bodyHtml: string;
  cta?: { label: string; url: string };
}): string {
  const cta = opts.cta
    ? `
            <tr>
              <td style="padding:0 32px 24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background:#4566e6;border-radius:6px;">
                      <a href="${opts.cta.url}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;letter-spacing:0.01em;">${opts.cta.label}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`
    : '';
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fa;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;max-width:560px;width:100%;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <div style="font-size:16px;font-weight:600;color:#0f172a;letter-spacing:-0.01em;">Skydrop</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <h1 style="margin:0 0 16px 0;font-size:20px;font-weight:600;color:#0f172a;letter-spacing:-0.015em;line-height:1.35;">${opts.title}</h1>
                <div style="font-size:14px;line-height:1.65;color:#4b5563;">
                  ${opts.bodyHtml}
                </div>
              </td>
            </tr>${cta}
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <div style="border-top:1px solid #e5e7eb;padding-top:14px;">
                  <p style="margin:0;font-size:11px;line-height:1.6;color:#9ca3af;">
                    Skydrop — cross-border courier &amp; warehouse aggregator.
                  </p>
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Auto-generate an HTML body when an email template doesn't supply
 * its own htmlBodyTemplate. Wraps the plain-text body in the brand
 * shell using the subject as the headline and the body broken into
 * paragraphs on blank lines or full-stop boundaries.
 *
 * Safe with Nunjucks `{{ var }}` placeholders: they're preserved
 * verbatim because we don't HTML-escape them (Nunjucks will render
 * the result with autoescape ON for the htmlBodyTemplate path —
 * see EmailDispatchService).
 *
 * Light-touch CTA detection: a `{{ ..._url }}` placeholder in the
 * body promotes to a button when there's exactly one. The body is
 * then trimmed of that URL fragment.
 */
function autoHtmlFromText(subject: string, body: string): string {
  // Paragraphify on blank lines OR sentence boundaries followed by space.
  const segments = body
    .split(/\n{2,}/g)
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z{])/g))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Detect first `{{ *_url }}` and promote it to a CTA when there's
  // exactly one in the body.
  const urlMatches = body.match(/\{\{\s*\w*_url\s*\}\}/g) ?? [];
  let cta: { label: string; url: string } | undefined;
  if (urlMatches.length === 1) {
    const placeholder = urlMatches[0];
    const url = placeholder;
    const labelFromVar = placeholder
      .replace(/\{\{|\}\}|\s/g, '')
      .replace(/_url$/, '')
      .replace(/_/g, ' ');
    cta = {
      label:
        labelFromVar === 'invite'
          ? 'Accept invitation'
          : labelFromVar === 'reset'
            ? 'Reset password'
            : labelFromVar === 'verify'
              ? 'Verify email'
              : labelFromVar === 'tracking'
                ? 'Track shipment'
                : labelFromVar === 'app'
                  ? 'Open Skydrop'
                  : 'Open',
      url,
    };
  }

  const bodyHtml = segments
    .map((p) => `<p style="margin:0 0 12px 0;">${p}</p>`)
    .join('\n                  ');

  return wrapHtml({ title: subject, bodyHtml, ...(cta ? { cta } : {}) });
}

// Placeholder content using Jinja-style {{ }} variables. Customer-
// facing templates additionally seed Hindi variants (deferred until
// the customer apps land).
const notificationTemplates: TemplateSeed[] = [
  {
    code: 'seller.topup_submitted.email',
    name: 'Top-up recorded — awaiting verification',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'We have your top-up of {{ amount }} — checking our statement now',
    bodyTemplate:
      'Thanks {{ company_name }} — we have recorded your transfer.\n\nAmount: {{ amount }}\nPaid into: {{ bank_label }}\nReference: {{ reference }}\n\nNothing has been added to your balance yet. We check this against our bank statement by hand, which usually takes 24-48 hours, and your wallet is credited the moment it is matched. We will email you either way.\n\nIf you sent the money but the details above look wrong, reply to this email before the 24 hours are up — it is much easier to fix now than after.',
  },
  {
    code: 'seller.topup_accepted.email',
    name: 'Top-up verified — wallet credited',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Your top-up of {{ amount }} is in — wallet credited',
    bodyTemplate:
      'We found your payment on our statement and credited your wallet.\n\nAmount: {{ amount }}\nCredited: {{ credited }}\nPaid into: {{ bank_label }}\nReference: {{ reference }}\n\nIt is available to spend now. You can see the entry on your wallet ledger.',
  },
  {
    code: 'seller.topup_rejected.email',
    name: 'Top-up could not be verified',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'We could not verify your top-up of {{ amount }}',
    bodyTemplate:
      'We were not able to match your transfer against our bank statement, so nothing has been added to your balance.\n\nAmount: {{ amount }}\nPaid into: {{ bank_label }}\nReference: {{ reference }}\n\nWhy: {{ reason }}\n\nThis is usually a reference we could not find, an amount that does not match, or a payment that has not cleared yet. If the money did leave your account, reply to this email with the transaction reference or a receipt and we will look again — your money is not lost, we just cannot see it from here yet.',
  },
  {
    code: 'ops.courier_portal_challenge.email',
    name: 'Courier portal challenge — a human must sign in',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject: 'Delhivery portal is asking for a {{ challenge }} — automation is frozen',
    bodyTemplate:
      'The portal automation hit a {{ challenge }} challenge at {{ url }} and STOPPED. Nothing has been retried, and nothing will be: retrying a challenge in a loop is indistinguishable from an attack and would cost us the account.\n\nThe portal write channel is paused for 24 hours. Sign in to one.delhivery.com by hand, complete the challenge, then resume the channel from Admin → Courier escalation.\n\nThe ops queue is unaffected — humans can still clear it.',
  },
  {
    code: 'ops.courier_taxonomy_changed.email',
    name: 'Delhivery issue-category taxonomy changed',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject: 'Delhivery issue categories changed ({{ created }} new, {{ changed }} re-worded)',
    bodyTemplate:
      'The nightly taxonomy fetch found changes.\n\nNew: {{ created }}\nRe-worded: {{ changed }}\nNo longer offered: {{ disappeared }}\n\nA NEW category is not on the auto list and cannot be until someone decides about it — but it may be the one your sellers now need. A category that DISAPPEARED is worth a look: if it carried a human-only lock, that lock has stopped being exercised.',
  },
  {
    code: 'ops.courier_mode_change_code.email',
    name: 'Courier write-mode change — confirmation code',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject: 'Confirm the {{ courier_code }} write-mode change: {{ code }}',
    bodyTemplate:
      'Someone (you, we hope) asked to set the {{ courier_code }} courier write channel to {{ requested_mode }}.\n\nConfirmation code: {{ code }}\n\nReason given: {{ reason }}\n\nThis widens what the system may do WITHOUT a human — including posting into threads customers read. If this was not you, do not share the code, and tell someone.\n\nThe code expires in 10 minutes.',
  },
  {
    code: 'ops.tracking_stalled.email',
    name: 'Tracking poll stalled — email to ops',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject: 'Tracking has not moved for {{ minutes }} minutes',
    bodyTemplate:
      'No tracking cycle has completed successfully in {{ minutes }} minutes (threshold {{ threshold }}).\n\nDelhivery sends us no webhooks, so this poll is the only thing that moves an order to delivered. While it is stopped, no parcel updates, no order reaches DELIVERED, and COD is not credited — so seller withdrawals stop with it.\n\nAutomatic recovery: {{ recovery }}\n\nIf that did not fix it, check in order: is the API up ({{ health_url }}); is the worker running (pm2, WORKERS_ENABLED); did Redis lose the repeatable job (restarting the API re-adds it); is courier.delhivery_api_base_url still set (empty means stub mode, where the poller does nothing).\n\nYou can also run a cycle by hand from the Delhivery page in admin. It is safe to press repeatedly.',
  },
  {
    code: 'ops.ndr_reconciliation_alert.email',
    name: 'NDR reconciliation alert — email to ops',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject:
      'NDR reconciliation: {{ not_acted_percent }}% of confirmed re-attempts produced nothing',
    bodyTemplate:
      'Of {{ checked }} re-attempts Delhivery CONFIRMED, {{ not_acted }} produced no new delivery attempt in tracking ({{ not_acted_percent }}%, threshold {{ threshold }}%).\n\nDelhivery accepting a request is not the same as acting on it. This is the only check that tells those apart — takeAction, the UPL poll and the tracking feed all report success either way.',
  },
  {
    code: 'order.confirmed.customer.sms',
    name: 'Order confirmed — SMS to customer',
    channel: NotificationChannel.SMS,
    recipientType: NotificationRecipientType.CUSTOMER,
    bodyTemplate:
      'Hi {{ customer_name }}, your Skydrop order {{ order_number }} is confirmed. We will dispatch it shortly. Track: {{ tracking_url }}',
  },
  {
    code: 'order.confirmed.seller.email',
    name: 'Order confirmed — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Order {{ order_number }} confirmed by customer',
    bodyTemplate:
      'Order {{ order_number }} has been confirmed by the customer on the call. It is now queued for pick and pack.',
  },
  {
    code: 'shipment.dispatched.customer.sms',
    name: 'Shipment dispatched — SMS to customer',
    channel: NotificationChannel.SMS,
    recipientType: NotificationRecipientType.CUSTOMER,
    bodyTemplate:
      'Your order {{ order_number }} has been dispatched. AWB: {{ awb_number }}. Track: {{ tracking_url }}',
  },
  {
    code: 'shipment.out_for_delivery.customer.sms',
    name: 'Out for delivery — SMS to customer',
    channel: NotificationChannel.SMS,
    recipientType: NotificationRecipientType.CUSTOMER,
    bodyTemplate:
      'Your Skydrop parcel {{ order_number }} is out for delivery today. Please keep {{ cod_amount }} ready if COD.',
  },
  {
    code: 'shipment.delivered.customer.sms',
    name: 'Delivered — SMS to customer',
    channel: NotificationChannel.SMS,
    recipientType: NotificationRecipientType.CUSTOMER,
    bodyTemplate:
      'Your Skydrop parcel {{ order_number }} has been delivered. Thank you for shopping with {{ seller_name }}.',
  },
  {
    code: 'shipment.rto_initiated.seller.email',
    name: 'RTO initiated — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'RTO initiated for order {{ order_number }}',
    bodyTemplate:
      'Order {{ order_number }} (AWB {{ awb_number }}) is being returned to our warehouse. Reason: {{ rto_reason }}. We will update you when it is received and restocked.',
  },
  {
    code: 'seller.invoice.delivered.email',
    name: 'Seller invoice delivered — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Invoice {{ invoice_number }} — order delivered',
    bodyTemplate: [
      'Hi {{ contact_name }},',
      '',
      'Order {{ order_number }} has been delivered.',
      '',
      'Invoice: {{ invoice_number }}',
      'Total: INR {{ total_inr }}',
      '',
      'Download the GST tax invoice (PDF):',
      '{{ pdf_url }}',
      '',
      '— Skydrop',
    ].join('\n'),
    htmlBodyTemplate: [
      '<!doctype html><html><body style="margin:0;padding:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">',
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fa;padding:40px 16px;"><tr><td align="center">',
      '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;max-width:560px;width:100%;">',
      '<tr><td style="padding:28px 32px 0 32px;"><div style="font-size:16px;font-weight:600;color:#0f172a;">Skydrop</div></td></tr>',
      '<tr><td style="padding:20px 32px 0 32px;">',
      '<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0f172a;line-height:1.3;">Invoice {{ invoice_number }}</h1>',
      '<p style="margin:0 0 12px 0;font-size:14px;line-height:1.65;color:#4b5563;">Hi {{ contact_name }} — order <strong style="color:#0f172a;font-family:ui-monospace,monospace;">{{ order_number }}</strong> has been delivered.</p>',
      '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:8px 0 16px 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">',
      '<tr><td style="padding:10px 14px;font-size:13px;color:#6b7280;background:#fafbfc;border-bottom:1px solid #e5e7eb;">Invoice total</td><td style="padding:10px 14px;font-size:14px;color:#0f172a;font-weight:600;background:#fafbfc;border-bottom:1px solid #e5e7eb;text-align:right;font-family:ui-monospace,monospace;">INR {{ total_inr }}</td></tr>',
      '</table>',
      '<p style="margin:0 0 16px 0;font-size:14px;line-height:1.65;color:#4b5563;">Download your GST tax invoice (PDF):</p>',
      '<p style="margin:0 0 24px 0;"><a href="{{ pdf_url }}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:6px;">Download invoice PDF</a></p>',
      '<p style="margin:0 0 14px 0;font-size:12px;color:#9ca3af;">If the button doesn&apos;t work: <span style="word-break:break-all;color:#6b7280;">{{ pdf_url }}</span></p>',
      '</td></tr>',
      '<tr><td style="padding:18px 32px 28px 32px;border-top:1px solid #f1f5f9;"><div style="font-size:12px;color:#9ca3af;">Skydrop</div></td></tr>',
      '</table></td></tr></table></body></html>',
    ].join('\n'),
  },
  {
    code: 'staff.invitation.email',
    name: 'Staff invitation — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'You are invited to Skydrop Admin',
    bodyTemplate: [
      "You've been invited to join Skydrop as a staff member.",
      '',
      'Role: {{ role }}',
      '',
      'Set up your staff account here:',
      '{{ invite_url }}',
      '',
      'The invitation expires on {{ expires_at_display }}.',
      '',
      "If you weren't expecting this, you can safely ignore it.",
      '',
      '— The Skydrop team',
    ].join('\n'),
  },
  {
    code: 'seller.invitation.email',
    name: 'Seller invitation — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'You are invited to Skydrop',
    bodyTemplate: [
      "You're invited to Skydrop.",
      '',
      "You've been invited to join Skydrop — the cross-border courier aggregator helping Bangladeshi sellers ship into India.",
      '',
      'Set up your seller account here:',
      '{{ invite_url }}',
      '',
      'This invitation expires on {{ expires_at_display }}.',
      '',
      "If you weren't expecting this, you can safely ignore this email.",
      '',
      '— The Skydrop team',
    ].join('\n'),
    htmlBodyTemplate: `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fa;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;max-width:560px;width:100%;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <div style="font-size:16px;font-weight:600;color:#0f172a;letter-spacing:-0.01em;">Skydrop</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:600;color:#0f172a;letter-spacing:-0.015em;line-height:1.3;">You're invited to Skydrop</h1>
                <p style="margin:0 0 14px 0;font-size:14px;line-height:1.65;color:#4b5563;">
                  You've been invited to join <strong style="color:#1f2937;">Skydrop</strong> — the cross-border courier aggregator helping Bangladeshi sellers ship into India.
                </p>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:1.65;color:#4b5563;">
                  Use the button below to create your seller account. This invitation expires on <strong style="color:#1f2937;">{{ expires_at_display }}</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background:#4566e6;border-radius:6px;">
                      <a href="{{ invite_url }}" style="display:inline-block;padding:11px 22px;font-size:14px;font-weight:500;color:#ffffff;text-decoration:none;letter-spacing:0.01em;">Accept invitation</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 28px 32px;">
                <div style="border-top:1px solid #e5e7eb;padding-top:18px;">
                  <p style="margin:0 0 6px 0;font-size:12px;line-height:1.6;color:#6b7280;">
                    Button not working? Paste this link into your browser:
                  </p>
                  <p style="margin:0;font-size:12px;line-height:1.6;color:#4566e6;word-break:break-all;">
                    <a href="{{ invite_url }}" style="color:#4566e6;text-decoration:underline;">{{ invite_url }}</a>
                  </p>
                </div>
              </td>
            </tr>
          </table>
          <p style="font-size:11px;color:#9ca3af;margin:18px 0 0 0;max-width:560px;line-height:1.6;">
            You're receiving this because someone at Skydrop invited you. If you weren't expecting this, you can safely ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  },
  {
    code: 'seller.team_invitation.email',
    name: 'Seller team invitation — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: '{{ inviter_company }} invited you to join their Skydrop team',
    bodyTemplate: [
      '{{ inviter_name }} has invited you to join the {{ inviter_company }} team on Skydrop.',
      '',
      'Role: {{ role }}',
      '',
      'Set up your account here:',
      '{{ invite_url }}',
      '',
      'This invitation expires on {{ expires_at_display }}.',
      '',
      "If you weren't expecting this, you can safely ignore this email.",
      '',
      '— The Skydrop team',
    ].join('\n'),
  },
  {
    code: 'seller.welcome.email',
    name: 'Seller welcome — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Welcome to Skydrop — {{ company_name }}',
    bodyTemplate:
      'Welcome aboard, {{ contact_name }}. Your Skydrop seller account for {{ company_name }} is set up and you can sign in to {{ seller_app_url }} now. Start by adding products to your catalog and shipping stock to our warehouse.',
  },
  {
    code: 'seller.approved.email',
    name: 'Seller approved — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Your Skydrop account is approved',
    bodyTemplate:
      'Good news, {{ contact_name }} — your Skydrop seller account has been approved. You can now ship stock to our warehouse and start placing orders.',
  },
  {
    code: 'seller.rejected.email',
    name: 'Seller rejected — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Update on your Skydrop application',
    bodyTemplate:
      'Hi {{ contact_name }}, after reviewing your Skydrop application we are unable to approve it at this time. Reason: {{ rejection_reason }}. Reach out to support@skydrop.online if you would like to appeal.',
  },
  {
    code: 'marketing.invite_lead_ack.email',
    name: 'Invite request — acknowledgement to the requester',
    channel: NotificationChannel.EMAIL,
    // A stranger, not a seller yet. The recipient type is the closest
    // truthful one; there is no account to point an id at, which is why
    // the ledger row carries only the address.
    recipientType: NotificationRecipientType.SELLER,
    subject: 'We have your Skydrop invite request',
    // Says back what they told us. A confirmation that only says
    // "received" leaves the one doubt worth answering — whether the
    // details went in correctly — and someone who typed their email
    // wrong will never see this at all, which is itself the signal.
    bodyTemplate:
      'Thanks {{ full_name }} — we have your request for a Skydrop invite.\n\nSomeone will read it properly and get back to you within one working day, on this address or on {{ phone }}.\n\nWhat you told us:\n  Company: {{ company_name }}\n  Delivering to: {{ direction }}\n  Sells: {{ product_types }}\n  Orders a month: {{ monthly_orders }}\n\nIf any of that is wrong, just reply to this email and we will fix it before we call.\n\n— The Skydrop team\n{{ support_email }}',
    // This one carries its OWN html because "what you told us" is a
    // detail table, and autoHtmlFromText cannot know that: it breaks the
    // text into paragraphs on BLANK lines, so the four indented lines
    // arrive as one <p> whose newlines HTML collapses into spaces —
    // "Company: Acme Delivering to: Bangladesh → India Sells: not said".
    // The first thing a prospective seller receives should not read as a
    // broken email from the company asking to hold their money.
    //
    // Every variable is the same one the plain-text body uses; the
    // renderer has throwOnUndefined:false, so a renamed one would blank
    // silently rather than fail. Two are wrapped in {% if %} on purpose:
    // support_email is not currently among the variables InviteLeadService
    // passes, and an empty line under the sign-off looks like a bug rather
    // than an omission.
    //
    // 'not said' is the literal InviteLeadService substitutes for an
    // unanswered optional. It is rendered in the muted label colour so it
    // reads as an absent answer rather than as something they typed —
    // the row still shows, because "we did not ask" and "you skipped it"
    // are different facts and the recipient is the one who can correct it.
    htmlBodyTemplate: `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f6fa;padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:10px;border:1px solid #e5e7eb;max-width:560px;width:100%;box-shadow:0 1px 2px rgba(15,23,42,0.04);">
            <tr>
              <td style="padding:28px 32px 0 32px;">
                <div style="font-size:16px;font-weight:600;color:#0f172a;letter-spacing:-0.01em;">Skydrop</div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 0 32px;">
                <h1 style="margin:0 0 14px 0;font-size:20px;font-weight:600;color:#0f172a;letter-spacing:-0.015em;line-height:1.35;">We have your invite request</h1>
                <p style="margin:0 0 12px 0;font-size:14px;line-height:1.65;color:#4b5563;">
                  Thanks {{ full_name }} — we have your request for a Skydrop invite.
                </p>
                <p style="margin:0 0 22px 0;font-size:14px;line-height:1.65;color:#4b5563;">
                  Someone will read it properly and get back to you within one working day, on this address or on <strong style="color:#1f2937;white-space:nowrap;">{{ phone }}</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;">
                <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;padding-bottom:8px;">
                  What you told us
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fafbfc;border:1px solid #e5e7eb;border-radius:8px;">
                  <tr>
                    <td width="42%" style="padding:10px 14px;font-size:13px;line-height:1.5;color:#6b7280;border-bottom:1px solid #eceff3;vertical-align:top;">Company</td>
                    <td style="padding:10px 14px;font-size:14px;line-height:1.5;color:#0f172a;font-weight:500;border-bottom:1px solid #eceff3;vertical-align:top;">{{ company_name }}</td>
                  </tr>
                  <tr>
                    <td width="42%" style="padding:10px 14px;font-size:13px;line-height:1.5;color:#6b7280;border-bottom:1px solid #eceff3;vertical-align:top;">Delivering to</td>
                    <td style="padding:10px 14px;font-size:14px;line-height:1.5;color:#0f172a;font-weight:500;border-bottom:1px solid #eceff3;vertical-align:top;">{% if direction == 'not said' %}<span style="color:#9ca3af;font-weight:400;">not said</span>{% else %}{{ direction }}{% endif %}</td>
                  </tr>
                  <tr>
                    <td width="42%" style="padding:10px 14px;font-size:13px;line-height:1.5;color:#6b7280;border-bottom:1px solid #eceff3;vertical-align:top;">Sells</td>
                    <td style="padding:10px 14px;font-size:14px;line-height:1.5;color:#0f172a;font-weight:500;border-bottom:1px solid #eceff3;vertical-align:top;">{% if product_types == 'not said' %}<span style="color:#9ca3af;font-weight:400;">not said</span>{% else %}{{ product_types }}{% endif %}</td>
                  </tr>
                  <tr>
                    <td width="42%" style="padding:10px 14px;font-size:13px;line-height:1.5;color:#6b7280;vertical-align:top;">Orders a month</td>
                    <td style="padding:10px 14px;font-size:14px;line-height:1.5;color:#0f172a;font-weight:500;vertical-align:top;">{% if monthly_orders == 'not said' %}<span style="color:#9ca3af;font-weight:400;">not said</span>{% else %}{{ monthly_orders }}{% endif %}</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 32px 0 32px;">
                <p style="margin:0;font-size:14px;line-height:1.65;color:#4b5563;">
                  If any of that is wrong, just reply to this email and we will fix it before we call.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 28px 32px;">
                <div style="border-top:1px solid #e5e7eb;padding-top:16px;">
                  <p style="margin:0;font-size:14px;line-height:1.6;color:#4b5563;">— The Skydrop team</p>{% if support_email %}
                  <p style="margin:4px 0 0 0;font-size:13px;line-height:1.6;">
                    <a href="mailto:{{ support_email }}" style="color:#4566e6;text-decoration:none;">{{ support_email }}</a>
                  </p>{% endif %}
                </div>
              </td>
            </tr>
          </table>
          <p style="font-size:11px;color:#9ca3af;margin:18px 0 0 0;max-width:560px;line-height:1.6;">
            You're receiving this because you asked Skydrop for an invite. Skydrop — cross-border courier &amp; warehouse aggregator.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  },
  {
    code: 'staff.invite_lead.email',
    name: 'New invite request — staff alert',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    // The company and the volume are in the subject on purpose: this
    // arrives on a phone, and whether it is worth opening now depends on
    // exactly those two things.
    subject: 'New invite request — {{ company_name }}{{ volume_suffix }}',
    bodyTemplate:
      '{{ full_name }} at {{ company_name }} asked for an invite.\n\nDirection: {{ direction }}\nEmail: {{ email }}\nPhone: {{ phone }}\nSells: {{ product_types }}\nOrders a month: {{ monthly_orders }}\n\n{{ lead_message }}\n\nWork the queue here: {{ leads_url }}',
  },
  {
    code: 'staff.welcome.email',
    name: 'Staff account created — welcome',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject: 'Your Skydrop staff account is ready',
    // Says the ADDRESS back to them on purpose. Staff often have more
    // than one, and the one that works is whichever the invitation went
    // to — a fact nobody has any way to check later without this line.
    bodyTemplate:
      'Your Skydrop staff account is set up and ready to use.\n\nSign in here: {{ login_url }}\nYour username is your email: {{ email }}\nRole: {{ role }}\n\nForgotten your password? Use the "forgot password?" link on the sign-in page and we will email you a reset link.\n\nIf you did not set this account up, tell us at {{ support_email }} straight away.',
  },
  {
    code: 'staff.password_changed.email',
    name: 'Staff password changed — security alert',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject: 'Your Skydrop staff password was changed',
    // The "if this was not you" line is the entire point. A password
    // change the owner did not make is indistinguishable from a takeover
    // until somebody tells them, and every session was just signed out —
    // so the attacker holds the only working credential.
    bodyTemplate:
      'The password on your Skydrop staff account ({{ email }}) was changed on {{ changed_at }}.\n\nEvery signed-in session was ended, so you will need to sign in again: {{ login_url }}\n\nIf this was not you, someone else has access to your account. Reply to this email or contact {{ support_email }} immediately, and we will lock it.\n\nRequest origin: {{ ip_address }}',
  },
  {
    code: 'seller.password_changed.email',
    name: 'Seller password changed — security alert',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Your Skydrop password was changed',
    bodyTemplate:
      'The password on your Skydrop account ({{ email }}) was changed on {{ changed_at }}.\n\nEvery signed-in session was ended, so you will need to sign in again: {{ login_url }}\n\nIf this was not you, someone else has access to your account — and your account holds your stock and your money. Contact {{ support_email }} immediately and we will lock it.\n\nRequest origin: {{ ip_address }}',
  },
  {
    code: 'staff.password_reset.email',
    name: 'Staff password reset — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject: 'Reset your Skydrop staff password',
    bodyTemplate:
      'A password reset was requested for your Skydrop staff account. Reset here: {{ reset_url }}. This link expires in 30 minutes. If you did not request this, please ignore.',
  },
  {
    code: 'seller.password_reset.email',
    name: 'Seller password reset — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Reset your Skydrop password',
    bodyTemplate:
      'A password reset was requested for your Skydrop seller account. Reset here: {{ reset_url }}. This link expires in 30 minutes. If you did not request this, please ignore.',
  },
  {
    code: 'staff.email_verification.email',
    name: 'Staff email verification — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject: 'Verify your Skydrop staff email',
    bodyTemplate:
      'Hi {{ contact_name }}, please verify your Skydrop staff email by clicking: {{ verify_url }}. This link expires in {{ expires_hours }} hours. If you did not request this, please ignore.',
  },
  {
    code: 'seller.email_verification.email',
    name: 'Seller email verification — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Verify your Skydrop email',
    bodyTemplate:
      'Hi {{ contact_name }}, please verify your Skydrop seller email by clicking: {{ verify_url }}. This link expires in {{ expires_hours }} hours. If you did not request this, please ignore.',
  },
  {
    code: 'seller.account_suspended.email',
    name: 'Seller account suspended — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Your Skydrop account has been suspended',
    bodyTemplate:
      'Hi {{ company_name }}, your Skydrop seller account has been suspended. Reason: {{ reason }}. While suspended you can still log in to view your account in read-only mode, but you cannot place new orders or modify your profile. Reach out to {{ support_email }} to resolve.',
  },
  // ── Bank details ────────────────────────────────────────────────
  // Where a seller's money goes is the highest-stakes thing they can
  // change, and the person who most needs to hear about a change is the
  // one who did NOT make it. Every one of these is sent to the account
  // owner so an unexpected message is the alarm.
  {
    code: 'seller.bank_details_added.email',
    name: 'Seller bank details added — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Bank details added to your Skydrop account',
    bodyTemplate:
      'Hi {{ company_name }}, bank details were just added to your Skydrop account. Withdrawals will go to {{ bank_name }}, account ending {{ account_last4 }}. Any later change to these details has to be approved by our team before it takes effect. If this was not you, contact {{ support_email }} straight away.',
  },
  {
    code: 'seller.bank_details_removed.email',
    name: 'Seller bank details removed — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Bank details removed from your Skydrop account',
    bodyTemplate:
      'Hi {{ company_name }}, the bank details on your Skydrop account were just removed, so we have nowhere to send your withdrawals until you add an account again. You can add one at {{ app_url }}/profile. If this was not you, contact {{ support_email }} straight away.',
  },
  {
    code: 'seller.bank_change_submitted.email',
    name: 'Seller bank change submitted — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'We received your bank detail change request',
    bodyTemplate:
      'Hi {{ company_name }}, we received a request to change the bank details on your Skydrop account to {{ bank_name }}, account ending {{ account_last4 }}. Our team reviews this before it takes effect — until then your withdrawals keep going to the account already on file, and no further change can be submitted. If this was not you, contact {{ support_email }} straight away.',
  },
  {
    code: 'seller.bank_change_approved.email',
    name: 'Seller bank change approved — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Your bank detail change is now live',
    bodyTemplate:
      'Hi {{ company_name }}, your bank detail change has been approved. From now on your withdrawals go to {{ bank_name }}, account ending {{ account_last4 }}. You can see the details at {{ app_url }}/profile. If this was not you, contact {{ support_email }} straight away.',
  },
  {
    code: 'seller.bank_change_rejected.email',
    name: 'Seller bank change rejected — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Your bank detail change was not approved',
    bodyTemplate:
      'Hi {{ company_name }}, your bank detail change was not approved. Reason: {{ reason }}. Nothing has moved — your withdrawals still go to the account already on file. You can correct the details and submit again at {{ app_url }}/profile, or reply to {{ support_email }} if you need a hand.',
  },
  {
    code: 'seller.account_reapproved.email',
    name: 'Seller account reapproved — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Your Skydrop account has been reactivated',
    bodyTemplate:
      'Good news, {{ company_name }} — your Skydrop seller account has been reactivated. You can log in and resume operations at {{ app_url }}. If you need anything, reach out to {{ support_email }}.',
  },
  {
    code: 'seller.onboarding_complete.email',
    name: 'Seller onboarding complete — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'You are all set on Skydrop, {{ company_name }}',
    bodyTemplate:
      'Hi {{ company_name }}, your Skydrop onboarding is complete. You can now ship inventory to our warehouse and start placing orders from {{ app_url }}. Questions? {{ support_email }}.',
  },
  {
    code: 'staff.bin_collapse_challenge.email',
    name: 'Bin collapse — confirmation code',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.STAFF,
    subject: 'Confirm collapsing {{ warehouse_code }} to one location — code {{ code }}',
    bodyTemplate:
      'Hi {{ staff_name }}, someone signed in as you asked to collapse every bin in {{ warehouse_name }} ({{ warehouse_code }}) into a single FLOOR location. That would merge {{ bins_affected }} bin(s) holding {{ units_affected }} unit(s), and the original placement would survive only in the backup taken alongside it.\n\nReason given: {{ reason }}\n\nYour code is {{ code }}. It expires in {{ expires_minutes }} minutes.\n\nIf this was not you, do not enter the code — tell whoever runs the warehouse, and change your password.',
  },
  // ---- Two-leg consignments (docs/consignment-two-leg.md) --------------
  // The seller asked to know where their stock is in real time. Each
  // milestone gets a mail; the timeline on the consignment page is the
  // durable version of the same facts.
  {
    code: 'seller.consignment_bd_received.email',
    name: 'Consignment counted in Bangladesh — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: '{{ consignment_number }} has arrived at our Bangladesh warehouse',
    bodyTemplate:
      'Hi {{ company_name }}, we have received and counted {{ consignment_number }} at our Bangladesh warehouse: {{ total_received }} unit(s) across {{ line_count }} product(s). {{ variance_note }}\n\nIt is not sellable yet — stock becomes available once it reaches India and is counted there. Watch it move at {{ app_url }}.',
  },
  {
    code: 'seller.consignment_dispatched.email',
    name: 'Consignment left Bangladesh — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: '{{ consignment_number }} is on its way to India',
    bodyTemplate:
      'Hi {{ company_name }}, {{ units_dispatched }} unit(s) from {{ consignment_number }} have left our Bangladesh warehouse for India.{{ eta_note }}\n\nThey show as in transit until they land and are counted, and cannot be sold while they are in the air. Track it at {{ app_url }}.',
  },
  {
    code: 'seller.consignment_arrived.email',
    name: 'Consignment landed in India — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: '{{ consignment_number }} has landed — {{ total_received }} unit(s) now sellable',
    bodyTemplate:
      'Hi {{ company_name }}, {{ consignment_number }} has arrived at our Indian warehouse and been counted: {{ total_received }} unit(s) across {{ line_count }} product(s) are now available to sell. {{ variance_note }}\n\nSee the full journey at {{ app_url }}.',
  },
  {
    code: 'seller.consignment_cancelled.email',
    name: 'Consignment cancelled — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: '{{ consignment_number }} has been cancelled',
    bodyTemplate:
      'Hi {{ company_name }}, {{ consignment_number }} has been cancelled and {{ units_returned }} unit(s) are being returned to you.\n\nReason: {{ reason }}\n\nThose units have been removed from your Skydrop stock. Anything you need, reach us at {{ support_email }}.',
  },
  // ---- Module 5 — Inventory & WMS (sender resolves to hello@) ----------
  {
    code: 'seller.stock_low_alert.email',
    name: 'Low-stock alert — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Low stock: {{ sku_code }} is down to {{ qty_available }}',
    bodyTemplate:
      'Hi {{ company_name }}, your SKU {{ sku_code }}{{ variant_label }} at {{ warehouse_name }} has {{ qty_available }} units available, at or below your alert threshold of {{ threshold }}. Restock soon to avoid stockouts. Manage thresholds at {{ app_url }}.',
  },
  {
    code: 'seller.goods_receipt_completed.email',
    name: 'Goods receipt completed — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Goods receipt {{ receipt_number }} completed',
    bodyTemplate:
      'Hi {{ company_name }}, we have finished receiving goods receipt {{ receipt_number }} at {{ warehouse_name }}. {{ total_received }} units across {{ line_count }} SKUs are now in stock. View details at {{ app_url }}.',
  },
  {
    code: 'seller.goods_receipt_discrepancy.email',
    name: 'Goods receipt discrepancy — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Discrepancy on goods receipt {{ receipt_number }}',
    bodyTemplate:
      'Hi {{ company_name }}, goods receipt {{ receipt_number }} at {{ warehouse_name }} has discrepancies between expected and received quantities and is on hold pending review. Notes: {{ discrepancy_notes }}. Our team is resolving it; questions to {{ support_email }}.',
  },
  {
    code: 'seller.stock_adjustment_executed.email',
    name: 'Stock adjustment executed — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Stock adjustment applied at {{ warehouse_name }}',
    bodyTemplate:
      'Hi {{ company_name }}, a {{ adjustment_type }} stock adjustment was applied to your inventory at {{ warehouse_name }}. Reason: {{ reason_code }}. Net value impact: INR {{ value_impact_inr }}. Reference: {{ adjustment_id }}. Questions to {{ support_email }}.',
  },
  // ---- Module 6 — Order Management (sender resolves to hello@) ---------
  {
    code: 'seller.order_created.email',
    name: 'Order created — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Order {{ order_number }} created',
    bodyTemplate:
      'Hi {{ company_name }}, order {{ order_number }} for {{ recipient_name }} ({{ recipient_city }}, {{ recipient_state }}) has been created with {{ item_count }} item(s) and is now {{ order_status }}. View it at {{ app_url }}.',
  },
  {
    code: 'seller.bulk_upload_completed.email',
    name: 'Bulk order upload completed — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Bulk order upload {{ file_name }} finished',
    bodyTemplate:
      'Hi {{ company_name }}, your bulk order upload "{{ file_name }}" finished with status {{ upload_status }}: {{ orders_created }} created, {{ rows_skipped }} skipped, {{ rows_failed }} failed.{{ error_report_line }} View details at {{ app_url }}.',
  },
  {
    code: 'seller.order_status_changed.email',
    name: 'Order status changed — email to seller',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Order {{ order_number }} is now {{ new_status }}',
    bodyTemplate:
      'Hi {{ company_name }}, order {{ order_number }} changed from {{ old_status }} to {{ new_status }}.{{ status_note }} Track progress at {{ app_url }}. (You can tune which status changes email you in notification preferences.)',
  },
  {
    code: 'customer.order_confirmed.email',
    name: 'Order confirmed — bilingual email to customer (M11)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.CUSTOMER,
    subject:
      'Your order {{ order_number }} is confirmed / आपका ऑर्डर {{ order_number }} पुष्टि हुआ',
    bodyTemplate:
      'Hi {{ customer_name }}, your order {{ order_number }} has been confirmed and is being prepared for dispatch. We will notify you when it ships. Track it any time at {{ tracking_url }}.\n\n' +
      '---\n\n' +
      'नमस्ते {{ customer_name }}, आपका ऑर्डर {{ order_number }} पुष्टि हो गया है और शिप करने की तैयारी चल रही है। शिप होने पर हम आपको सूचित करेंगे। ट्रैक करें: {{ tracking_url }}',
  },
  {
    code: 'customer.order_delivered.email',
    name: 'Order delivered — bilingual email to customer (M11)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.CUSTOMER,
    subject:
      'Your order {{ order_number }} was delivered / आपका ऑर्डर {{ order_number }} डिलीवर हो गया',
    bodyTemplate:
      'Hi {{ customer_name }}, your order {{ order_number }} was delivered on {{ delivered_at }}. Thank you for shopping with {{ seller_company_name }}. Questions? Reply or visit {{ tracking_url }}.\n\n' +
      '---\n\n' +
      'नमस्ते {{ customer_name }}, आपका ऑर्डर {{ order_number }} {{ delivered_at }} को डिलीवर हो गया है। {{ seller_company_name }} से खरीदारी करने के लिए धन्यवाद। प्रश्न? उत्तर दें या यहाँ जाएँ: {{ tracking_url }}',
  },
  // ---- Module 11 — Lifecycle-event fan-out templates -----------------
  // Customer templates: bilingual body (EN + HI in one email; Q6 — per-
  // locale rendering structure is the Phase-2 seam for stored
  // recipient preference). Seller templates: EN only.
  // Subject convention for bilingual customer: "{EN} / {HI}".
  // The dispatched customer template is the M11 PRIORITY template —
  // it carries {{ tracking_url }} pointing at M10's
  // GET /public/tracking/:awb endpoint.
  {
    code: 'customer.order_dispatched.email',
    name: 'Order dispatched — bilingual email to customer (M11, ★ tracking link)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.CUSTOMER,
    subject:
      'Your order {{ order_number }} has shipped (AWB {{ awb_number }}) / आपका ऑर्डर {{ order_number }} शिप हो गया',
    bodyTemplate:
      'Hi {{ customer_name }}, your order {{ order_number }} from {{ seller_company_name }} has been dispatched via {{ courier_name }} (AWB {{ awb_number }}). Track its progress any time at {{ tracking_url }}. Expected delivery: {{ expected_delivery_at }}.\n\n' +
      '---\n\n' +
      'नमस्ते {{ customer_name }}, {{ seller_company_name }} से आपका ऑर्डर {{ order_number }} {{ courier_name }} के माध्यम से शिप कर दिया गया है (AWB {{ awb_number }})। यहाँ ट्रैक करें: {{ tracking_url }}. अनुमानित डिलीवरी: {{ expected_delivery_at }}.',
  },
  {
    code: 'customer.order_out_for_delivery.email',
    name: 'Out for delivery — bilingual email to customer (M11)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.CUSTOMER,
    subject:
      'Your order {{ order_number }} is out for delivery / आपका ऑर्डर {{ order_number }} डिलीवरी के लिए निकल चुका है',
    bodyTemplate:
      'Hi {{ customer_name }}, your order {{ order_number }} is out for delivery today. Please keep {{ cod_amount_inr }} INR ready if this is a Cash-on-Delivery order. Track at {{ tracking_url }}.\n\n' +
      '---\n\n' +
      'नमस्ते {{ customer_name }}, आपका ऑर्डर {{ order_number }} आज डिलीवरी के लिए निकल चुका है। यदि यह COD है तो कृपया {{ cod_amount_inr }} INR तैयार रखें। ट्रैक करें: {{ tracking_url }}',
  },
  {
    code: 'customer.order_delivery_failed.email',
    name: 'Delivery attempt failed — bilingual email to customer (M11, NDR)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.CUSTOMER,
    subject:
      'Delivery attempt for order {{ order_number }} did not succeed / आपके ऑर्डर {{ order_number }} की डिलीवरी विफल हुई',
    bodyTemplate:
      'Hi {{ customer_name }}, our courier {{ courier_name }} attempted to deliver order {{ order_number }} today but could not complete it. Reason: {{ ndr_reason }}. The courier will reattempt; please ensure someone is available at the address. Track at {{ tracking_url }}.\n\n' +
      '---\n\n' +
      'नमस्ते {{ customer_name }}, हमारे कूरियर {{ courier_name }} ने आज आपका ऑर्डर {{ order_number }} डिलीवर करने का प्रयास किया लेकिन सफल नहीं हो सका। कारण: {{ ndr_reason }}। कूरियर फिर से प्रयास करेगा; कृपया सुनिश्चित करें कि कोई पते पर उपलब्ध हो। ट्रैक करें: {{ tracking_url }}',
  },
  {
    code: 'customer.order_cancelled.email',
    name: 'Order cancelled — bilingual email to customer (M11)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.CUSTOMER,
    subject:
      'Your order {{ order_number }} was cancelled / आपका ऑर्डर {{ order_number }} रद्द कर दिया गया',
    bodyTemplate:
      'Hi {{ customer_name }}, your order {{ order_number }} from {{ seller_company_name }} has been cancelled. Reason: {{ cancellation_reason }}. If this was unexpected, please reply to this email or contact {{ support_email }}.\n\n' +
      '---\n\n' +
      'नमस्ते {{ customer_name }}, {{ seller_company_name }} से आपका ऑर्डर {{ order_number }} रद्द कर दिया गया है। कारण: {{ cancellation_reason }}। यदि यह अप्रत्याशित था, तो कृपया इस ईमेल का उत्तर दें या {{ support_email }} से संपर्क करें।',
  },
  // Seller lifecycle templates (EN only — Q6). Some lifecycle events
  // already had seeded seller templates from earlier modules and are
  // reused by the M11 mapping unchanged:
  //   - CONFIRMED          → order.confirmed.seller.email (M7)
  //   - RTO_INITIATED      → shipment.rto_initiated.seller.email (M5)
  // The ones below are new (or upgraded from generic
  // seller.order_status_changed.email, which stays seeded for legacy
  // back-compat but is no longer in the M11 mapping).
  {
    code: 'seller.order_dispatched.email',
    name: 'Order dispatched — email to seller (M11)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Order {{ order_number }} dispatched ({{ courier_name }} AWB {{ awb_number }})',
    bodyTemplate:
      'Hi {{ company_name }}, order {{ order_number }} for {{ recipient_name }} ({{ recipient_city }}, {{ recipient_state }}) has been dispatched via {{ courier_name }} with AWB {{ awb_number }}. Track its progress at {{ app_url }}.',
  },
  {
    code: 'seller.order_delivered.email',
    name: 'Order delivered — email to seller (M11)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Order {{ order_number }} delivered',
    bodyTemplate:
      'Hi {{ company_name }}, order {{ order_number }} for {{ recipient_name }} was delivered on {{ delivered_at }}. AWB {{ awb_number }} / {{ courier_name }}. View the order at {{ app_url }}.',
  },
  {
    code: 'seller.order_delivery_failed.email',
    name: 'Order delivery failed — email to seller (M11, NDR)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Delivery attempt failed for order {{ order_number }}',
    bodyTemplate:
      'Hi {{ company_name }}, courier {{ courier_name }} attempted to deliver order {{ order_number }} (AWB {{ awb_number }}) but could not complete it. Reason: {{ ndr_reason }}. The courier will reattempt. View the order at {{ app_url }}.',
  },
  // NSA — a parcel out for delivery that never arrived and never failed.
  // Deliberately its own template rather than reusing the NDR one: an
  // NDR carries a reason from the courier, and the whole point of this
  // one is that there ISN'T one. Saying "reason: —" would read as a
  // system that lost the reason rather than a courier that never gave it.
  {
    code: 'seller.order_needs_attention.email',
    name: 'NSA — still out for delivery at the evening cutoff',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Order {{ order_number }} is still out for delivery — {{ nsa_day_phrase }}',
    bodyTemplate:
      'Hi {{ company_name }}, order {{ order_number }} for {{ recipient_name }} in {{ recipient_city }} (AWB {{ awb_number }}, {{ courier_name }}) went out for delivery and was still out at the end of the day — {{ nsa_day_phrase }}. The courier has not told us why, so we are asking them. You do not need to do anything; this is so you hear it from us before your customer asks you. Track it at {{ app_url }}.',
  },
  {
    code: 'seller.order_rto_received.email',
    name: 'RTO received — email to seller (M11; resolves M8 deferred status-change email)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Returned shipment received at warehouse — order {{ order_number }}',
    bodyTemplate:
      'Hi {{ company_name }}, the return for order {{ order_number }} (AWB {{ awb_number }}) has arrived at our warehouse and has been received. The disposition (restock vs. write-off) will follow inspection. View the order at {{ app_url }}.',
  },
  {
    code: 'seller.order_cancelled.email',
    name: 'Order cancelled — email to seller (M11)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Order {{ order_number }} cancelled',
    bodyTemplate:
      'Hi {{ company_name }}, order {{ order_number }} for {{ recipient_name }} has been cancelled. Reason: {{ cancellation_reason }}. Any reserved stock has been released. View the order at {{ app_url }}.',
  },
  // R5b — the one lifecycle status that needs the seller to DO something.
  {
    code: 'seller.order_awaiting_decision.email',
    name: 'Call attempts exhausted — awaiting seller decision (R5b)',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Action needed: order {{ order_number }} — we could not reach the customer',
    bodyTemplate:
      'Hi {{ company_name }}, we tried to confirm order {{ order_number }} for {{ recipient_name }} and could not reach them. We have STOPPED calling and are holding the order for your decision: ask us to keep trying, or release it. Any stock held for this order stays reserved until you decide. Decide at {{ app_url }}.',
  },
];

async function seedNotificationTemplates() {
  let autoHtmlCount = 0;
  for (const t of notificationTemplates) {
    // Auto-generate an HTML body for every EMAIL template that didn't
    // supply one. Keeps the bar high without writing 30+ unique
    // HTML strings — branded shell on every email, day one.
    let htmlBody = t.htmlBodyTemplate ?? null;
    if (htmlBody === null && t.channel === NotificationChannel.EMAIL) {
      htmlBody = autoHtmlFromText(t.subject ?? t.name, t.bodyTemplate);
      autoHtmlCount += 1;
    }
    await prisma.notificationTemplate.upsert({
      where: { code_language: { code: t.code, language: 'en' } },
      create: {
        code: t.code,
        name: t.name,
        channel: t.channel,
        recipientType: t.recipientType,
        language: 'en',
        subject: t.subject ?? null,
        bodyTemplate: t.bodyTemplate,
        htmlBodyTemplate: htmlBody,
        isActive: true,
        version: 1,
      },
      update: {
        name: t.name,
        channel: t.channel,
        recipientType: t.recipientType,
        subject: t.subject ?? null,
        bodyTemplate: t.bodyTemplate,
        htmlBodyTemplate: htmlBody,
      },
    });
  }
  console.log(
    `  notification_templates: ${notificationTemplates.length} upserted (en) — ${autoHtmlCount} HTML bodies auto-generated`,
  );
}

/**
 * The courier message-template library — the FOUR canned replies we have
 * verbatim from the Delhivery One panel.
 *
 * These are seeded as DATA, and the library is read from the database at
 * match time, so a fifth template is a row rather than a release. That
 * matters because the corpus grows from real courier traffic: every
 * unmatched message lands in `courier_template_candidates`, and promoting
 * one must not wait on a deploy.
 *
 * Patterns are deliberately LOOSE around the parts that vary (names,
 * AWBs, dates) and tight on the phrase that identifies the template. They
 * are matched case-insensitively against a whitespace-normalised body.
 *
 * `state` and `action` are LABELS. Nothing here instructs the system; a
 * TypeScript decision table consumes the label and decides what happens.
 */
const courierMessageTemplates = [
  {
    code: 'NDR_ACK_24_48',
    // "...trying our best to deliver your shipment within 24 to 48 hours"
    pattern: 'trying our best to deliver.{0,40}within 24 to 48 hours',
    state: 'ACKNOWLEDGED',
    action: null,
    priority: 10,
    notes: 'Delhivery NDR acknowledgement. No action — it is a holding reply.',
  },
  {
    code: 'OFD_TODAY',
    // "...out for delivery and should be delivered by the end of the day"
    pattern: 'out for delivery and should be delivered by the end of the day',
    state: 'OUT_FOR_DELIVERY',
    action: null,
    priority: 10,
    notes: 'Parcel is on a van today. Informational.',
  },
  {
    code: 'REQ_ALT_PHONE',
    // "...share an alternate contact number for the consignee by replying to this ticket"
    pattern: 'share an alternate contact number for the consignee',
    state: 'ACTION_REQUIRED',
    action: 'ASK_SELLER_ALT_PHONE',
    priority: 5,
    notes:
      'The only one of the four that asks something of us. Higher priority (lower number) so it wins over a generic acknowledgement in the same message.',
  },
  {
    code: 'BEHAVIOUR_ACK',
    // "We sincerely regret the unacceptable behavior of our delivery agent
    //  and assure you that strict disciplinary action will be taken..."
    pattern: 'regret the unacceptable behavior of our delivery agent',
    state: 'ACKNOWLEDGED',
    action: null,
    priority: 10,
    notes: 'Behaviour-complaint acknowledgement. American spelling is THEIRS — do not "fix" it.',
  },
];

async function seedCourierMessageTemplates() {
  for (const t of courierMessageTemplates) {
    await prisma.courierMessageTemplate.upsert({
      where: { code: t.code },
      // Update the pattern on re-seed: a corrected pattern should reach
      // deployed environments. `isActive` is NOT touched, so a template
      // an operator switched off stays off.
      update: {
        pattern: t.pattern,
        state: t.state,
        action: t.action,
        priority: t.priority,
        notes: t.notes,
      },
      create: t,
    });
  }
  console.log(`  ${courierMessageTemplates.length} courier message templates`);
}

/**
 * Expense categories somebody can file a cost against on day one.
 *
 * Seeded rather than left empty because an empty category list means the
 * first expense gets filed under whatever the person types, and two
 * people type two things for the same cost. Admins add their own on top;
 * these are only a floor.
 */
async function seedExpenseCategories(): Promise<void> {
  const rows = [
    ['warehouse_rent', 'Warehouse rent', 'Rent and utilities for a warehouse we occupy.'],
    ['salaries', 'Salaries & wages', 'Staff pay, including the call centre and warehouse floor.'],
    [
      'courier_charges',
      'Courier charges',
      'What a courier bills us, beyond what is recovered per order.',
    ],
    [
      'freight_forwarder',
      'Freight forwarder',
      'BD to India movement — the cost side of inbound freight.',
    ],
    ['customs_duty', 'Customs & duty', 'Duty, clearing agents and border charges.'],
    [
      'software',
      'Software & hosting',
      'Servers, SaaS, domains, and anything billed monthly to run the system.',
    ],
    [
      'bank_charges',
      'Bank & payment charges',
      'Wire fees, gateway fees, and what a bank takes to move money.',
    ],
    ['marketing', 'Marketing', 'Acquiring sellers — ads, content, commissions.'],
    ['professional_fees', 'Professional fees', 'Legal, accounting, audit, compliance.'],
    ['office', 'Office & admin', 'Everything that keeps the office running and fits nowhere else.'],
    [
      'other',
      'Other',
      'Deliberately last and deliberately vague — a cost with no home belongs here rather than in the wrong one.',
    ],
  ] as const;

  for (const [code, name, hint] of rows) {
    await prisma.expenseCategory.upsert({
      where: { code },
      // Name and hint are refreshed; is_active is NOT, so an admin who
      // retires a category keeps it retired across a re-seed.
      update: { name, hint },
      create: { code, name, hint },
    });
  }
  console.log(`  expense categories: ${rows.length}`);
}

/**
 * Delhivery's ticket taxonomy.
 *
 * Upsert on `(courierCode, externalId)` — the same key the real fetcher
 * matches on — so the day their MCP is provisioned and the fetch works,
 * it overwrites these verbatim rather than duplicating the tree.
 *
 * `isHumanOnly` is set on the way IN but never cleared here: the
 * fetcher freezes it sticky for the same reason, and the safe direction
 * for a lock is on.
 */
async function seedDelhiveryIssueCategories(): Promise<void> {
  for (const c of DELHIVERY_ISSUE_TAXONOMY) {
    await prisma.courierIssueCategory.upsert({
      where: { courierCode_externalId: { courierCode: 'delhivery', externalId: c.externalId } },
      create: {
        courierCode: 'delhivery',
        externalId: c.externalId,
        label: c.label,
        parentExternalId: c.parentExternalId ?? null,
        isHumanOnly: c.isHumanOnly ?? false,
      },
      update: {
        label: c.label,
        parentExternalId: c.parentExternalId ?? null,
        // Sticky: only ever turned ON by a re-seed.
        ...(c.isHumanOnly === true ? { isHumanOnly: true } : {}),
        lastSeenAt: new Date(),
      },
    });
  }
  console.log(`  ✓ ${DELHIVERY_ISSUE_TAXONOMY.length} Delhivery issue categories`);
}

async function main() {
  console.log('Seeding reference data…');
  // Warehouses first: ops.default_warehouse_id resolves CCU-01's id.
  await seedWarehouses();
  await seedSystemSettings();
  await seedCouriers();
  await seedExpenseCategories();
  await seedFxRates();
  await seedRateCards();
  // M15 pricing data: depends on rate-card + couriers.
  await seedZoneMatrix();
  await seedRateCardItems();
  await seedSurchargeRules();
  await seedPinCodes();
  await seedNotificationTemplates();
  await seedCourierMessageTemplates();
  await seedDelhiveryIssueCategories();
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
