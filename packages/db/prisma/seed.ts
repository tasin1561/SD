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
  PrismaClient,
  CourierIntegrationType,
  Currency,
  FxRateSource,
  NotificationChannel,
  NotificationRecipientType,
  SettingValueType,
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
};

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
    valueInt: 24,
    displayName: 'Stock Reservation TTL (hours)',
    description: 'Auto-release reservations after N hours',
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
  console.log(`  system_settings: ${systemSettings.length} upserted`);
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

type TemplateSeed = {
  code: string;
  name: string;
  channel: NotificationChannel;
  recipientType: NotificationRecipientType;
  subject?: string;
  bodyTemplate: string;
};

// Placeholder content using Jinja-style {{ }} variables. The notifications
// module will refine wording, add HTML versions, and seed Hindi variants
// for the customer-facing SMS templates.
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
    bodyTemplate:
      'Hi {{ contact_name }}, you have been invited to join Skydrop. Set up your account here: {{ invite_url }}. This link expires on {{ expires_at }}.',
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
];

async function seedNotificationTemplates() {
  for (const t of notificationTemplates) {
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
        isActive: true,
        version: 1,
      },
      update: {
        name: t.name,
        channel: t.channel,
        recipientType: t.recipientType,
        subject: t.subject ?? null,
        bodyTemplate: t.bodyTemplate,
      },
    });
  }
  console.log(`  notification_templates: ${notificationTemplates.length} upserted (en)`);
}

async function main() {
  console.log('Seeding reference data…');
  await seedSystemSettings();
  await seedCouriers();
  await seedFxRates();
  await seedWarehouses();
  await seedRateCards();
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
