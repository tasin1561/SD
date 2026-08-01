// Barrel export for @skydrop/db.
//
// Typical usage:
//   import { prisma, OrderStatus, type Prisma } from '@skydrop/db';
//
// `prisma` is the singleton client. `Prisma` is the namespace from the
// generated client (Prisma.JsonValue, Prisma.OrderWhereInput, etc.).
// Every model type and every enum is re-exported below.

export { prisma, PrismaClient } from './client';
export * from './enums';

export { Prisma } from '@prisma/client';
export type {
  Address,
  AgentCallSettings,
  AuditLog,
  AwbLabel,
  BulkOrderUpload,
  CallAttempt,
  CallQueueEntry,
  Courier,
  CourierCredential,
  CourierWebhook,
  Customer,
  CycleCount,
  CycleCountItem,
  DeliveryAttempt,
  FxRate,
  GoodsReceipt,
  GoodsReceiptLine,
  NotificationLog,
  NotificationTemplate,
  Order,
  OrderCharge,
  OrderEvent,
  OrderItem,
  OrderRecipientAddressCache,
  OrderShipment,
  OutboundWebhookDelivery,
  PinCode,
  Product,
  ProductImage,
  ProductVariant,
  RateCard,
  RateCardItem,
  Seller,
  SellerApiKey,
  SellerEmailVerificationToken,
  SellerInvitation,
  SellerNote,
  SellerNotificationPreference,
  SellerPasswordResetToken,
  SellerPricing,
  SellerRefreshToken,
  SellerWebhookEndpoint,
  Shipment,
  ShipmentItem,
  StaffEmailVerificationToken,
  StaffPasswordResetToken,
  StaffRefreshToken,
  StaffUser,
  StockAdjustment,
  StockBatch,
  StockLevel,
  StockMovement,
  StockReservation,
  SurchargeRule,
  SystemSetting,
  TrackingEvent,
  Warehouse,
  WarehouseBin,
  WarehouseZone,
  ZoneMatrixEntry,
} from '@prisma/client';
