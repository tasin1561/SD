// Re-export of every enum from the generated Prisma client. Lets consumers
// do `import { OrderStatus } from '@skydrop/db'` without depending on
// '@prisma/client' directly.

export {
  // Layer 1 — Identity & Access
  StaffRole,
  SellerStatus,
  Currency,
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
  CategoryProposalStatus,
  AttributeValueType,
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
} from '@prisma/client';
