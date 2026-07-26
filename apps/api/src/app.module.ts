import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { EnvService } from './config/env.service';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { SpacesModule } from './infrastructure/spaces/spaces.module';
import { HealthModule } from './modules/health/health.module';
import { AuthCommonModule } from './modules/auth-common/auth-common.module';
import { EmailModule } from './modules/email/email.module';
import { StaffAuthModule } from './modules/staff-auth/staff-auth.module';
import { SellerAuthModule } from './modules/seller-auth/seller-auth.module';
import { SellerInvitationModule } from './modules/seller-invitation/seller-invitation.module';
import { SellerApiKeyModule } from './modules/seller-api-key/seller-api-key.module';
import { SellerManagementModule } from './modules/seller-management/seller-management.module';
import { SellerOnboardingModule } from './modules/seller-onboarding/seller-onboarding.module';
import { SellerProfileModule } from './modules/seller-profile/seller-profile.module';
import { SellerAddressModule } from './modules/seller-address/seller-address.module';
import { SellerNotificationPreferenceModule } from './modules/seller-notification-preference/seller-notification-preference.module';
import { AdminSellerModule } from './modules/admin-seller/admin-seller.module';
import { CatalogCategoryModule } from './modules/catalog-category/catalog-category.module';
import { CatalogAttributeModule } from './modules/catalog-attribute/catalog-attribute.module';
import { CatalogCategoryProposalModule } from './modules/catalog-category-proposal/catalog-category-proposal.module';
import { CatalogProductModule } from './modules/catalog-product/catalog-product.module';
import { CatalogVariantModule } from './modules/catalog-variant/catalog-variant.module';
import { CatalogImageModule } from './modules/catalog-image/catalog-image.module';
import { CatalogCsvImportModule } from './modules/catalog-csv-import/catalog-csv-import.module';
import { CatalogReadModule } from './modules/catalog-read/catalog-read.module';
import { InventorySharedModule } from './modules/inventory-shared/inventory-shared.module';
import { InventoryWarehouseModule } from './modules/inventory-warehouse/inventory-warehouse.module';
import { InventoryStockModule } from './modules/inventory-stock/inventory-stock.module';
import { InventoryMovementModule } from './modules/inventory-movement/inventory-movement.module';
import { InventoryReceiptModule } from './modules/inventory-receipt/inventory-receipt.module';
import { InventoryAdjustmentModule } from './modules/inventory-adjustment/inventory-adjustment.module';
import { InventoryCycleCountModule } from './modules/inventory-cycle-count/inventory-cycle-count.module';
import { InventoryTransferModule } from './modules/inventory-transfer/inventory-transfer.module';
import { InventoryUnitModule } from './modules/inventory-unit/inventory-unit.module';
import { OrderModule } from './modules/order/order.module';
import { OrderCsvImportModule } from './modules/order-csv-import/order-csv-import.module';
import { CallCenterModule } from './modules/call-center/call-center.module';
import { ShipmentProvisionModule } from './modules/shipment-provision/shipment-provision.module';
import { WarehousePickModule } from './modules/warehouse-pick/warehouse-pick.module';
import { WarehouseManifestModule } from './modules/warehouse-manifest/warehouse-manifest.module';
import { WarehousePackModule } from './modules/warehouse-pack/warehouse-pack.module';
import { WarehouseRtoModule } from './modules/warehouse-rto/warehouse-rto.module';
import { CourierSharedModule } from './modules/courier-shared/courier-shared.module';
import { CourierDelhiveryModule } from './modules/courier-delhivery/courier-delhivery.module';
import { CourierAwbModule } from './modules/courier-awb/courier-awb.module';
import { CourierDispatchModule } from './modules/courier-dispatch/courier-dispatch.module';
import { CourierManualPlacementModule } from './modules/courier-manual-placement/courier-manual-placement.module';
import { CourierAccountAdminModule } from './modules/courier-account-admin/courier-account-admin.module';
import { TrackingIngestionModule } from './modules/tracking-ingestion/tracking-ingestion.module';
import { TrackingEventsModule } from './modules/tracking-events/tracking-events.module';
import { TrackingPublicModule } from './modules/tracking-public/tracking-public.module';
import { TrackingManualModule } from './modules/tracking-manual/tracking-manual.module';
import { TrackingPollModule } from './modules/tracking-poll/tracking-poll.module';
import { LifecycleEventsModule } from './modules/lifecycle-events/lifecycle-events.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SystemSettingsModule } from './modules/system-settings/system-settings.module';
import { SettingsModule } from './modules/settings/settings.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { FxModule } from './modules/fx/fx.module';
import { OrderChargesModule } from './modules/order-charges/order-charges.module';
import { ChatModule } from './modules/chat/chat.module';
import { TicketModule } from './modules/ticket/ticket.module';
import { EarlyReservationModule } from './modules/early-reservation/early-reservation.module';
import { EarlyReservationDecisionModule } from './modules/early-reservation-decision/early-reservation-decision.module';
import { SellerWebhookModule } from './modules/seller-webhook/seller-webhook.module';
import { SellerWebhookDeliveryModule } from './modules/seller-webhook-delivery/seller-webhook-delivery.module';
import { SellerWalletModule } from './modules/seller-wallet/seller-wallet.module';
import { InboundFreightModule } from './modules/inbound-freight/inbound-freight.module';
import { SellerWalletAccrualModule } from './modules/seller-wallet-accrual/seller-wallet-accrual.module';
import { SellerWalletReadModule } from './modules/seller-wallet-read/seller-wallet-read.module';
import { SellerWalletWithdrawalModule } from './modules/seller-wallet-withdrawal/seller-wallet-withdrawal.module';
import { AdminRemittanceModule } from './modules/admin-remittance/admin-remittance.module';
import { AdminReportsModule } from './modules/admin-reports/admin-reports.module';
import { AdminWebhookDeliveriesModule } from './modules/admin-webhook-deliveries/admin-webhook-deliveries.module';
import { InvoiceModule } from './modules/invoice/invoice.module';
import { StaffInvitationModule } from './modules/staff-invitation/staff-invitation.module';
import { SellerTeamModule } from './modules/seller-team/seller-team.module';
import { ThrottlerModule } from './common/throttler/throttler.module';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { pinoConfig } from './common/pino/logger-config';
import { envSchema } from './config/env.schema';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      inject: [EnvService],
      useFactory: (env: EnvService) =>
        pinoConfig(
          envSchema.parse({
            NODE_ENV: env.nodeEnv,
            PORT: env.port,
            LOG_LEVEL: env.logLevel,
            DATABASE_URL: env.databaseUrl,
            REDIS_URL: env.redisUrl,
            JWT_SIGNING_KEY: env.jwtSigningKey,
            RESEND_API_KEY: env.resendApiKey,
            SELLER_APP_URL: env.sellerAppUrl,
            ADMIN_APP_URL: env.adminAppUrl,
            SUPPORT_EMAIL: env.supportEmail,
            COOKIE_DOMAIN: env.cookieDomain,
          }),
        ),
    }),
    PrismaModule,
    RedisModule,
    SpacesModule,
    ThrottlerModule,
    AuthCommonModule,
    EmailModule,
    StaffAuthModule,
    SellerAuthModule,
    SellerInvitationModule,
    SellerApiKeyModule,
    SellerManagementModule,
    SellerOnboardingModule,
    SellerProfileModule,
    SellerAddressModule,
    SellerNotificationPreferenceModule,
    AdminSellerModule,
    CatalogCategoryModule,
    CatalogAttributeModule,
    CatalogCategoryProposalModule,
    CatalogProductModule,
    CatalogVariantModule,
    CatalogImageModule,
    CatalogCsvImportModule,
    CatalogReadModule,
    InventorySharedModule,
    InventoryWarehouseModule,
    InventoryStockModule,
    InventoryMovementModule,
    InventoryReceiptModule,
    InventoryAdjustmentModule,
    InventoryCycleCountModule,
    InventoryTransferModule,
    InventoryUnitModule,
    OrderModule,
    OrderCsvImportModule,
    CallCenterModule,
    ShipmentProvisionModule,
    WarehousePickModule,
    WarehouseManifestModule,
    WarehousePackModule,
    WarehouseRtoModule,
    CourierSharedModule,
    CourierDelhiveryModule,
    CourierAwbModule,
    CourierDispatchModule,
    CourierManualPlacementModule,
    CourierAccountAdminModule,
    TrackingIngestionModule,
    TrackingEventsModule,
    TrackingPublicModule,
    TrackingManualModule,
    TrackingPollModule,
    LifecycleEventsModule,
    NotificationsModule,
    SystemSettingsModule,
    SettingsModule,
    PricingModule,
    FxModule,
    OrderChargesModule,
    ChatModule,
    TicketModule,
    EarlyReservationModule,
    EarlyReservationDecisionModule,
    SellerWebhookModule,
    SellerWebhookDeliveryModule,
    SellerWalletModule,
    InboundFreightModule,
    SellerWalletAccrualModule,
    SellerWalletReadModule,
    SellerWalletWithdrawalModule,
    AdminRemittanceModule,
    AdminReportsModule,
    AdminWebhookDeliveriesModule,
    InvoiceModule,
    StaffInvitationModule,
    SellerTeamModule,
    HealthModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
