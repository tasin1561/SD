// Re-export of every enum from the generated Prisma client. Lets consumers
// do `import { OrderStatus } from '@skydrop/db'` without depending on
// '@prisma/client' directly.

export {
  // Layer 1 — Identity & Access
  StaffRole,
  SellerStatus,
  Currency,
  TopupRequestStatus,
  CodCreditMode,
  SellerNoteCategory,
  ActorType,
  SellerOnboardingStep,
  OnboardingStepActor,
  // Layer 2 — Addresses & Locations
  AddressOwnerType,
  AddressType,
  WarehouseStatus,
  BinType,
  ServiceArea,
  PinCodeSource,
  // Layer 3 — Catalog
  PackageType,
  ProductStatus,
  VariantStatus,
  CsvImportType,
  // Layer 4 — Inventory & WMS
  BatchStatus,
  StockMovementType,
  StockMovementReasonCode,
  ReservationStatus,
  ReservationReleaseReason,
  AdjustmentType,
  AdjustmentStatus,
  CycleCountType,
  CycleCountStatus,
  GoodsReceiptStatus,
  // Layer 5 — Orders & Customers
  CustomerRiskLevel,
  OrderSource,
  PaymentMode,
  OrderStatus,
  OrderCancellationReason,
  OrderEventType,
  BulkUploadStatus,
  // Layer 6 — Call Center
  CallQueueStatus,
  AssignmentMethod,
  QueueClosureReason,
  CallOutcome,
  // Layer 7 — Shipments & Tracking
  ShipmentStatus,
  // Module 8 — Warehouse Operations (manifest + RTO inspection)
  ManifestStatus,
  RtoItemCondition,
  RtoDisposition,
  // Module 9 — Courier Integration
  SupersedeReason,
  LabelPaperSize,
  LabelGenerationReason,
  TrackingEventType,
  TrackingEventSource,
  WebhookStatus,
  DeliveryAttemptOutcome,
  DeliveryFailureReason,
  // Layer 8 — Couriers & Pricing
  CourierIntegrationType,
  CredentialEnvironment,
  SurchargeType,
  SurchargeComputationMethod,
  SurchargeBaseField,
  FxRateSource,
  ChargeType,
  OrderChargeStatus,
  // Layer 9 — Notifications & Webhooks
  NotificationChannel,
  NotificationRecipientType,
  NotificationStatus,
  WebhookDeliveryStatus,
  SettingValueType,
  SellerNotificationCategory,
  NotificationFrequency,
  // Phase 1B — Wallet + remittance
  WalletEntryDirection,
  // Seller team (RBAC)
  SellerUserRole,
  // R2 — withdrawal requests
  WithdrawalRequestStatus,
  WithdrawalRequestedBy,
  // R7 — unified scrap/damage + seller-issue tickets
  TicketType,
  TicketStatus,
  // R5 — two-stage inventory booking
  ReservationBookingStage,
  EarlyReservationReviewStatus,
  // R4 — strict-mode per-unit inventory
  InventoryMode,
  PackBoxStatus,
  StockUnitStatus,
  // R3 — BD→India inbound freight billing
  InboundFreightMode,
  InboundFreightStatus,
  // D3 — pre-fetched courier AWB pool
  CourierWaybillStatus,
  PickupRequestStatus,
} from '@prisma/client';
