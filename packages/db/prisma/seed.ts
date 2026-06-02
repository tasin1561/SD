// Idempotent reference-data seed for Skydrop.
//
// Run with `pnpm --filter @skydrop/db seed` or `pnpm prisma db seed`.
// Safe to re-run: every row uses an upsert keyed on a unique constraint
// (no inserts that would conflict on second run).
//
// Scope: only the data the spec lists as required to boot the system —
// system settings, two seed couriers, fallback FX, the BLR-01 warehouse,
// the default rate card, and 12 stub notification templates. Rate-card
// items, zone matrix, surcharges, pin codes, and seller data are left to
// admin UI / runtime to populate.

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
};

// 28 Indian States + 8 Union Territories (Module 6 address validation).
const ALLOWED_INDIAN_STATES: string[] = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
];

const systemSettings: SystemSettingSeed[] = [
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
    description: 'Hours between no-response retries',
  },
  {
    key: 'ops.stock_reservation_ttl_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 48,
    displayName: 'Stock Reservation TTL (hours)',
    description: 'Auto-release reservations after N hours',
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
      'Default max attempt-counting call outcomes before an order is auto-rejected as REJECTED_NDR (per-seller override: sellers.call_max_attempts_before_ndr_override)',
  },
  {
    key: 'ops.call_assignment_timeout_minutes',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 30,
    displayName: 'Call Assignment Timeout (minutes)',
    description:
      'A pulled queue entry the agent does not act on within this window is auto-returned to PENDING by the BullMQ expiration worker',
  },
  {
    key: 'ops.call_reschedule_min_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 1,
    displayName: 'Call Reschedule Min (hours)',
    description:
      'CALLBACK_REQUESTED scheduledFor must be at least this many hours in the future',
  },
  {
    key: 'ops.call_reschedule_max_days',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 7,
    displayName: 'Call Reschedule Max (days)',
    description:
      'CALLBACK_REQUESTED scheduledFor must be at most this many days in the future',
  },
  {
    key: 'ops.call_busy_retry_delay_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 1,
    displayName: 'Call Busy Retry Delay (hours)',
    description:
      'BUSY outcome re-queues the order with availableAt = now + this many hours',
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
    key: 'ops.pick_task_timeout_hours',
    category: 'ops',
    valueType: SettingValueType.INT,
    valueInt: 4,
    displayName: 'Pick Timeout (hours)',
    description:
      'A shipment whose pick has been in progress longer than this is auto-reverted to re-pickable by the BullMQ pick-expiration worker (WMS-5)',
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
    description:
      'Per-attempt backoff delays for the WMS-3 pick allocation retry loop',
  },
  // Module 9 — Courier Integration.
  {
    key: 'courier.delhivery_api_base_url',
    category: 'courier',
    valueType: SettingValueType.STRING,
    valueString: '',
    displayName: 'Delhivery API Base URL',
    description:
      'Delhivery REST API base URL. EMPTY = stub mode (DelhiveryClient returns deterministic mock responses; no network). Set to the sandbox/production URL once the real wire contract is validated against Delhivery credentials — TODO(delhivery-api)',
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
    description:
      'Per-attempt backoff delays for the AWB generation BullMQ job',
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
      'TRK-8 anti-enumeration ceiling on the open public AWB lookup endpoint. A legitimate customer refreshes their tracking page a handful of times; bulk enumeration of AWBs triggers rate limiting.',
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
      },
      update: {
        category: s.category,
        valueType: s.valueType,
        displayName: s.displayName,
        description: s.description,
      },
    });
  }

  // ops.default_warehouse_id resolves to BLR-01's uuid at seed time rather
  // than a hard-coded literal, so it stays correct across environments
  // (ids are uuidv7, not deterministic). Requires seedWarehouses() to have
  // run first — main() orders it that way. Value is create-only like every
  // other setting: an admin re-pointing the default is preserved on re-seed.
  const blr01 = await prisma.warehouse.findUnique({
    where: { code: 'BLR-01' },
    select: { id: true },
  });
  if (!blr01) {
    throw new Error(
      'seed: BLR-01 warehouse must exist before system settings — check seed order in main()',
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

  console.log(`  system_settings: ${systemSettings.length + 1} upserted`);
}

async function seedCouriers() {
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
    where: { code: 'BLR-01' },
    create: {
      code: 'BLR-01',
      name: 'Bangalore Main',
      status: WarehouseStatus.ACTIVE,
      countryCode: 'IN',
      timezone: 'Asia/Kolkata',
    },
    update: {},
  });
  console.log(`  warehouses: 1 upserted (BLR-01)`);
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
 * Zone matrix: origin METRO (BLR-01) → destination area → letter zone.
 * Same five zones (A..E) for both seeded couriers. The pricing engine
 * looks up (courier, origin, dest) and uses the zone string as part
 * of the RateCardItem key.
 *
 * Phase 1A is single-origin (BLR-01); when multi-warehouse lands the
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
  { zone: 'A', weightSlabFromGrams: 0, weightSlabToGrams: 500, baseChargeInr: '60.00', perKgChargeInr: null },
  { zone: 'B', weightSlabFromGrams: 0, weightSlabToGrams: 500, baseChargeInr: '80.00', perKgChargeInr: null },
  { zone: 'C', weightSlabFromGrams: 0, weightSlabToGrams: 500, baseChargeInr: '100.00', perKgChargeInr: null },
  { zone: 'D', weightSlabFromGrams: 0, weightSlabToGrams: 500, baseChargeInr: '130.00', perKgChargeInr: null },
  { zone: 'E', weightSlabFromGrams: 0, weightSlabToGrams: 500, baseChargeInr: '180.00', perKgChargeInr: null },
  // 500g–1kg
  { zone: 'A', weightSlabFromGrams: 500, weightSlabToGrams: 1000, baseChargeInr: '90.00', perKgChargeInr: null },
  { zone: 'B', weightSlabFromGrams: 500, weightSlabToGrams: 1000, baseChargeInr: '120.00', perKgChargeInr: null },
  { zone: 'C', weightSlabFromGrams: 500, weightSlabToGrams: 1000, baseChargeInr: '150.00', perKgChargeInr: null },
  { zone: 'D', weightSlabFromGrams: 500, weightSlabToGrams: 1000, baseChargeInr: '190.00', perKgChargeInr: null },
  { zone: 'E', weightSlabFromGrams: 500, weightSlabToGrams: 1000, baseChargeInr: '260.00', perKgChargeInr: null },
  // 1kg–2kg
  { zone: 'A', weightSlabFromGrams: 1000, weightSlabToGrams: 2000, baseChargeInr: '130.00', perKgChargeInr: null },
  { zone: 'B', weightSlabFromGrams: 1000, weightSlabToGrams: 2000, baseChargeInr: '170.00', perKgChargeInr: null },
  { zone: 'C', weightSlabFromGrams: 1000, weightSlabToGrams: 2000, baseChargeInr: '215.00', perKgChargeInr: null },
  { zone: 'D', weightSlabFromGrams: 1000, weightSlabToGrams: 2000, baseChargeInr: '280.00', perKgChargeInr: null },
  { zone: 'E', weightSlabFromGrams: 1000, weightSlabToGrams: 2000, baseChargeInr: '380.00', perKgChargeInr: null },
  // 2kg–5kg with per-kg overage above 2kg floor
  { zone: 'A', weightSlabFromGrams: 2000, weightSlabToGrams: 5000, baseChargeInr: '180.00', perKgChargeInr: '40.00' },
  { zone: 'B', weightSlabFromGrams: 2000, weightSlabToGrams: 5000, baseChargeInr: '240.00', perKgChargeInr: '55.00' },
  { zone: 'C', weightSlabFromGrams: 2000, weightSlabToGrams: 5000, baseChargeInr: '300.00', perKgChargeInr: '70.00' },
  { zone: 'D', weightSlabFromGrams: 2000, weightSlabToGrams: 5000, baseChargeInr: '400.00', perKgChargeInr: '95.00' },
  { zone: 'E', weightSlabFromGrams: 2000, weightSlabToGrams: 5000, baseChargeInr: '540.00', perKgChargeInr: '130.00' },
  // 5kg–10kg per-kg only (base lifted)
  { zone: 'A', weightSlabFromGrams: 5000, weightSlabToGrams: 10000, baseChargeInr: '300.00', perKgChargeInr: '40.00' },
  { zone: 'B', weightSlabFromGrams: 5000, weightSlabToGrams: 10000, baseChargeInr: '405.00', perKgChargeInr: '55.00' },
  { zone: 'C', weightSlabFromGrams: 5000, weightSlabToGrams: 10000, baseChargeInr: '510.00', perKgChargeInr: '70.00' },
  { zone: 'D', weightSlabFromGrams: 5000, weightSlabToGrams: 10000, baseChargeInr: '685.00', perKgChargeInr: '95.00' },
  { zone: 'E', weightSlabFromGrams: 5000, weightSlabToGrams: 10000, baseChargeInr: '930.00', perKgChargeInr: '130.00' },
  // 10kg–30kg
  { zone: 'A', weightSlabFromGrams: 10000, weightSlabToGrams: 30000, baseChargeInr: '500.00', perKgChargeInr: '38.00' },
  { zone: 'B', weightSlabFromGrams: 10000, weightSlabToGrams: 30000, baseChargeInr: '680.00', perKgChargeInr: '52.00' },
  { zone: 'C', weightSlabFromGrams: 10000, weightSlabToGrams: 30000, baseChargeInr: '860.00', perKgChargeInr: '66.00' },
  { zone: 'D', weightSlabFromGrams: 10000, weightSlabToGrams: 30000, baseChargeInr: '1160.00', perKgChargeInr: '90.00' },
  { zone: 'E', weightSlabFromGrams: 10000, weightSlabToGrams: 30000, baseChargeInr: '1580.00', perKgChargeInr: '125.00' },
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
        labelFromVar === 'invite' ? 'Accept invitation'
        : labelFromVar === 'reset' ? 'Reset password'
        : labelFromVar === 'verify' ? 'Verify email'
        : labelFromVar === 'tracking' ? 'Track shipment'
        : labelFromVar === 'app' ? 'Open Skydrop'
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
    code: 'seller.welcome.email',
    name: 'Seller welcome — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Welcome to Skydrop — {{ company_name }}',
    bodyTemplate:
      'Welcome aboard, {{ contact_name }}. Your Skydrop seller account for {{ company_name }} is set up. Next step: complete your profile and verify your bank details.',
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
    code: 'seller.category_proposal_received.email',
    name: 'Category proposal received — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'We received your category proposal: {{ proposed_name }}',
    bodyTemplate:
      'Hi {{ company_name }}, we received your proposal to add the category "{{ proposed_name }}". Our team will review it and get back to you. You can track its status from {{ app_url }}.',
  },
  {
    code: 'seller.category_proposal_approved.email',
    name: 'Category proposal approved — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Your category "{{ proposed_name }}" was approved',
    bodyTemplate:
      'Good news, {{ company_name }} — your proposed category "{{ proposed_name }}" has been approved and is now available. You can assign products to it from {{ app_url }}.{{ decision_note }}',
  },
  {
    code: 'seller.category_proposal_rejected.email',
    name: 'Category proposal rejected — email',
    channel: NotificationChannel.EMAIL,
    recipientType: NotificationRecipientType.SELLER,
    subject: 'Update on your category proposal "{{ proposed_name }}"',
    bodyTemplate:
      'Hi {{ company_name }}, after reviewing your proposal to add "{{ proposed_name }}" we are not able to add it at this time. Reason: {{ decision_note }}. Reach out to {{ support_email }} if you would like to discuss.',
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
    subject: 'Your order {{ order_number }} is confirmed / आपका ऑर्डर {{ order_number }} पुष्टि हुआ',
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
    subject: 'Your order {{ order_number }} was delivered / आपका ऑर्डर {{ order_number }} डिलीवर हो गया',
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

async function main() {
  console.log('Seeding reference data…');
  // Warehouses first: ops.default_warehouse_id resolves BLR-01's id.
  await seedWarehouses();
  await seedSystemSettings();
  await seedCouriers();
  await seedFxRates();
  await seedRateCards();
  // M15 pricing data: depends on rate-card + couriers.
  await seedZoneMatrix();
  await seedRateCardItems();
  await seedSurchargeRules();
  await seedPinCodes();
  await seedNotificationTemplates();
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
