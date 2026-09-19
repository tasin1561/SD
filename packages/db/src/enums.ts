// Re-export of every enum from the generated Prisma client. Lets consumers
// do `import { OrderStatus } from '@skydrop/db'` without depending on
// '@prisma/client' directly.

export {
  // Layer 1 — Identity & Access
  StaffRole,
  BankChangeStatus,
  SellerCapability,
  SellerStatus,
  CourierDocumentType,
  Currency,
  TopupRequestStatus,
  StagedRowStatus,
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
  ConsignmentEventType,
  ConsignmentLeg,
  ConsignmentRoute,
  ConsignmentStatus,
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
  CallQueueReason,
  PickBatchStatus,
  QueueClosureReason,
  CallHoldOutcome,
  ReattemptRequestStatus,
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
  CourierRechargeMatch,
  CourierWalletTxnKind,
  CourierWalletTxnCategory,
  CourierWalletTxnLeg,
  SystemIssueKind,
  TicketHandling,
  SystemIssueSeverity,
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
  NotificationCategory,
  NotificationSubscriptionMode,
  NotificationBroadcastStatus,
  NotificationSubjectType,
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
  LabellingSite,
  LabelReprintRequestStatus,
  InventoryMode,
  PackBoxStatus,
  StockUnitStatus,
  // R3 — BD→India inbound freight billing
  InboundFreightBasis,
  InboundFreightMode,
  InboundFreightStatus,
  // D3 — pre-fetched courier AWB pool
  CourierWaybillStatus,
  NdrRequestStatus,
  CourierMessageChannel,
  CourierMessageDirection,
  CourierTemplateCandidateStatus,
  CourierOutboxStatus,
  CourierOutboxKind,
  CourierDispatchErrorClass,
  CourierWriteMode,
  CourierPortalMode,
  PickupRequestStatus,
  InviteLeadStatus,
  ShippingDirection,
} from '@prisma/client';
export { BankOwnerKind, BankEntryType } from '@prisma/client';
export { DeliveryActionKind, DeliveryActionStatus } from '@prisma/client';
export { AuditSeverity } from '@prisma/client';
export { PnlCloseKind, PnlLockState, PnlVersionKind } from '@prisma/client';
// RS-1 / RS-2 — reseller stores (docs/reseller-stores.md).
export {
  SellerStoreKind,
  ResellerStoreStatus,
  ResellerStoreOrigin,
  ResellerWalletManager,
  ResellerStoreEventKind,
  ResellerStockMode,
} from '@prisma/client';
// RS-4 — reseller store terms: when each party is credited.
export { ResellerCreditTrigger } from '@prisma/client';
// RS-6 — reseller store wallets.
export { StoreWalletEntryDirection } from '@prisma/client';
// RS-8 — a reseller store's own expenses.
export { StoreExpenseCategory } from '@prisma/client';
// 2026-09-16 — what a store may do about an order on its own, and where a
// held address correction sits while seller staff decide.
export { ResellerStoreActionMode, StoreAddressChangeStatus } from '@prisma/client';
// 2026-09-17 — a reseller store's held cancel / call-cap answer / issue.
export {
  StoreCallCapProposal,
  StoreOrderRequestKind,
  StoreOrderRequestStatus,
} from '@prisma/client';
// RS-6 phase 3c — a reseller order's per-party credits.
export { ResellerMoneyParty, ResellerCreditStatus } from '@prisma/client';
// 2026-09-19 — what a reseller STORE, as a whole, is told about. The
// first of the two layers a store message passes through; the second is
// a person's own per-topic mute in `notification_subscriptions`.
export { StoreNotificationCategory } from '@prisma/client';
// RS-7 (2026-09-19) — what a store ↔ seller dispute is about.
export { StoreDisputeKind } from '@prisma/client';
