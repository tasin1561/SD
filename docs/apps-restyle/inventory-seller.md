<!-- Phase 0 inventory, read from source on 2026-09-23 (branch feat/apps-premium-restyle, base 9fc408fa). Facts only; the plan is in /APPS-INVENTORY.md. -->

# Seller console (`apps/seller`) — inventory for a visual-only restyle

Everything below was read from source; nothing was changed. Paths are relative to `/home/talha/projects/SD/apps/seller/src/app/` unless given in full. `(authed)` is the route group.

**Shared facts that affect every page:**
- **Almost every page is a client component.** `page.tsx` is usually a small server file that renders one `'use client'` `*-index.tsx` / `*-view.tsx`.
- **The API calls sit in hooks** under `/home/talha/projects/SD/apps/seller/src/lib/*-hooks.ts`. The endpoints below are copied from those hooks, as written.
- **The auth guard lives in `(authed)/layout.tsx`** (server component). It calls `resolveSellerSsrIdentity`, sends signed-out users to `redirect('/login')`, and wraps pages in `QueryProvider → AuthProvider → MoneyDisplayProvider → AuthedShell → RoleBoundary`.
- **`AuthedShell`** (`(authed)/_components/authed-shell.tsx`) uses ui `AppShell`, `MenuButton` (quick actions), `StripFact` (FX rate), `Toaster`, plus `NotificationBellContainer`, `OrderOmnisearch` and `RestrictionBanner`.
- **Error handling:** `(authed)/error.tsx` is a client error boundary. It reloads automatically when a JS chunk has gone stale after a deploy, and otherwise shows a "try again" message with the error text in mono. There are **no `loading.tsx` or `not-found.tsx` files**.
- **Loading is never a spinner.** ui `LoadingState` renders skeleton rows with `animate-pulse` (`packages/ui/src/components/page.tsx:146`). The only spinner in the app is in the omnisearch (§5).
- **The ui `Select` is a styled native `<select>`** (`packages/ui/src/components/form.tsx:150`). So every "Select" listed below is visually a native select.

---

## 1. Routes

| URL | File | Purpose | Server/Client |
|---|---|---|---|
| `/` | `page.tsx` | `redirect('/dashboard')` | server |
| `/login` | `login/page.tsx` (+ `login/layout.tsx` → `AuthConsoleShell`) | Sign in; redirects to `/dashboard` if already signed in | server page, client `LoginForm` |
| `/password-reset` | `password-reset/page.tsx` (+ layout) | Request a reset email | server, client `PasswordResetRequestForm` |
| `/auth/reset-password?token=` | `auth/reset-password/page.tsx` (+ `auth/layout.tsx`) | Set a new password | server, client `ResetPasswordForm` |
| `/auth/verify-email?token=` | `auth/verify-email/page.tsx` | Confirm email | server, client `VerifyEmailPanel` |
| `/auth/accept-invitation?token=` | `auth/accept-invitation/page.tsx` | Register a new seller from an invite | server, client `AcceptInvitationForm` |
| `/auth/accept-team-invitation?token=` | `auth/accept-team-invitation/page.tsx` | Join an existing seller's team | server, client `AcceptTeamInvitationForm` |
| `/dashboard` | `(authed)/dashboard/page.tsx` | Overview: money, recent orders, shortcuts | server → client `DashboardView` |
| `/orders` | `(authed)/orders/page.tsx` | Order list and filters | server → client `OrdersIndex` |
| `/orders/new` | `(authed)/orders/new/page.tsx` | Create an order | server → client `NewOrderForm` |
| `/orders/[id]` | `(authed)/orders/[id]/page.tsx` | Order detail | server (async) → client `OrderDetailView` |
| `/orders/[id]/edit` | `(authed)/orders/[id]/edit/page.tsx` | Edit a draft or pending order | server (has `PageHeader`) → client `EditOrderForm` |
| `/orders/import` | `(authed)/orders/import/page.tsx` | Bulk order CSV import | server (has `PageHeader`) → client `CsvImportPanel kind="orders"` |
| `/orders/import/[id]` | `(authed)/orders/import/[id]/page.tsx` | One order-import run | server → client `OrderImportDetail` |
| `/orders/pending` | `(authed)/orders/pending/page.tsx` | Staged rows waiting to become orders | server → client `PendingOrdersIndex` |
| `/tracking` | `(authed)/tracking/page.tsx` | Parcel tracking list with expandable history | server → client `TrackingIndex` |
| `/needs-attention` | `(authed)/needs-attention/page.tsx` | Customers who couldn't be reached / unconfirmed orders | server → client `NeedsAttentionIndex` |
| `/customers` | `(authed)/customers/page.tsx` | Customer register with detail rows that expand inline | server → client `CustomersIndex` |
| `/tickets` | `(authed)/tickets/page.tsx` | Ticket list | server → client `SellerTicketsIndex` |
| `/tickets/[id]` | `(authed)/tickets/[id]/page.tsx` | Ticket detail and conversation | server → client `TicketDetail` |
| `/products` | `(authed)/products/page.tsx` | Catalogue list | server → client `ProductsIndex` |
| `/products/new` | `(authed)/products/new/page.tsx` | Create a product and its variants | server (has `PageHeader`) → client `NewProductForm` |
| `/products/[id]` | `(authed)/products/[id]/page.tsx` | Product detail and edit | server → client `ProductDetailView` |
| `/products/[id]/variants/[variantId]` | `.../variants/[variantId]/page.tsx` | Variant detail, edit, images, stock settings | server → client `VariantDetailView` |
| `/products/import` | `(authed)/products/import/page.tsx` | Catalogue CSV import and saved mappings | server (has `PageHeader`) → client `CsvImportPanel kind="catalog"` + `SavedMappings` |
| `/products/import/jobs` | `.../import/jobs/page.tsx` | Catalogue import history | server → client `ImportJobsIndex` |
| `/products/import/jobs/[id]` | `.../import/jobs/[id]/page.tsx` | One catalogue import job | server → client `ImportDetail` |
| `/inventory` | `(authed)/inventory/page.tsx` | Stock register | server → client `InventoryView` |
| `/inventory/units` | `(authed)/inventory/units/page.tsx` | Serial-unit discrepancies and serial trace | server → client `UnitDiscrepanciesIndex` |
| `/inbound` | `(authed)/inbound/page.tsx` | Consignment list and "announce a consignment" | server → client `InboundIndex` |
| `/inbound/[id]` | `(authed)/inbound/[id]/page.tsx` | Consignment detail | server → client `ConsignmentDetailView` |
| `/holds` | `(authed)/holds/page.tsx` | Reviews of stock held early | server → client `HoldReviewsIndex` |
| `/freight` | `(authed)/freight/page.tsx` | Inbound freight bills | server → client `SellerFreightIndex` |
| `/wallet` | `(authed)/wallet/page.tsx` | Balances, ledger, top-ups, withdrawals | **client page** |
| `/wallet/limits` | `(authed)/wallet/limits/page.tsx` | Withdrawal schedule and wallet terms | **client page** |
| `/reseller-stores` | `(authed)/reseller-stores/page.tsx` | Reseller store list, stores awaiting approval, create | **client page** |
| `/reseller-stores/[storeId]` | `(authed)/reseller-stores/[storeId]/page.tsx` | Store detail with 4 tabs | **client page** |
| `/reseller-stores/requests` | `(authed)/reseller-stores/requests/page.tsx` | Store requests waiting on the seller | **client page** |
| `/reseller-stores/price-list` | `(authed)/reseller-stores/price-list/page.tsx` | Default reseller prices | **client page** |
| `/reseller-stores/reports` | `(authed)/reseller-stores/reports/page.tsx` | Store scorecards and revenue | **client page** |
| `/reseller-stores/stock-forecast` | `(authed)/reseller-stores/stock-forecast/page.tsx` | Days of stock left | **client page** |
| `/profile` | `(authed)/profile/page.tsx` | Company info, bank details, logo | **client page** (997 lines) |
| `/team` | `(authed)/team/page.tsx` | Team members and invitations | server → client `TeamManagementIndex` |
| `/team/roles` | `(authed)/team/roles/page.tsx` | Roles (RBAC); has `metadata` | server → client `RolesIndex` |
| `/notifications` | `(authed)/notifications/page.tsx` | Notification inbox | server → client `NotificationsView` |
| `/notifications/settings` | `.../notifications/settings/page.tsx` | Topic subscriptions, category preferences, quiet hours | server → client `NotificationSettingsView` |
| `/settings` | `(authed)/settings/page.tsx` | Settings hub (tiles) | server (has `PageHeader`) → client `SettingsHub` |
| `/settings/security` | `.../settings/security/page.tsx` | This session; sign out everywhere | server → client `SecurityIndex` |
| `/settings/stores` | `.../settings/stores/page.tsx` | Shopfront stores | server → client `StoresIndex` |
| `/settings/orders` | `.../settings/orders/page.tsx` | Default delivery fee | server (has `PageHeader`) → client `OrderDefaultsPanel` |
| `/settings/stock` | `.../settings/stock/page.tsx` | Default low-stock threshold | server (has `PageHeader`) → client `AlertConfigPanel` |
| `/settings/api-keys` | `.../settings/api-keys/page.tsx` | API keys | server → client `ApiKeysIndex` |
| `/settings/webhooks` | `.../settings/webhooks/page.tsx` | Webhook endpoints | server → client `WebhooksIndex` |
| `/settings/notifications` | `.../settings/notifications/page.tsx` | Legacy URL: `redirect('/notifications/settings')` | server |

Not pages: `app/api/[...path]/route.ts` (same-origin API proxy) and `src/middleware.ts` (CSP nonce only, no redirects).

---

## 2. Per-page detail

The auth pages share one structure: a logo image, the "Skydrop" wordmark, a `telemetry` "seller portal" line, and `TiltPanel` wrapping a card with a `telemetry` status header ("recovery", "verification", "invite-only", "step 1 of 2").

**/login** — `LoginForm`
- Calls `client.login` → POST `` `/api/auth/${identityKind}/login` `` (`packages/api-client/src/client.ts:90`).
- Fields: email (`#email`, `type=email`), password (`#password`, with a show/hide button whose aria-label is "Hide password" / "Show password").
- Error shown inline. Decorative: `status-dot` inline style `var(--green)`, "sys online".

**/password-reset** — `request-form.tsx`
- POST `/api/auth/seller/password-reset/request`. Field: email.
- Success is an inline message.

**/auth/reset-password** — `reset-form.tsx`
- POST `/api/auth/seller/password-reset/confirm`. Fields: `pw`, `confirm`.
- A missing token shows a static message.

**/auth/verify-email** — `verify-panel.tsx`
- POST `/api/auth/seller/email-verification/confirm`, run automatically.

**/auth/accept-invitation** — `accept-invitation-form.tsx`
- POST `/api/auth/seller/register/invite`.
- Fields: company, contact, phone, whatsapp, password, confirm-password.

**/auth/accept-team-invitation** — `accept-team-invitation-form.tsx`
- POST `/api/auth/seller/accept-team-invitation`.
- Fields: full-name, password, confirm-password.

**/dashboard** — `dashboard/_components/dashboard-view.tsx` (local components: `MoneyTile`, `ShortcutCard`, `WalletBalanceCard`)
- Endpoints: GET `/api/seller/orders?…`, `/api/seller/products?…`, `/api/seller/orders/money-in-flight`, `/api/seller/profile`, `/api/seller/wallet`, `/api/seller/nsa`.
- Sections (`SectionBand`): Finish setting up · Treasury & liquidity · Recent orders · Next steps.
- Table (Recent orders): Order | Recipient | Stage (`OrderStatusBadge`) | COD (`Money`) | Open.
- States: loading uses `LoadingState`, `Skeleton` and `SkeletonRows`. Empty: "No orders yet", "No wallet activity yet". Error: `ErrorState` ×2, both with retry.
- Shows the FX line "₹1 = ৳…".

**/orders** — `orders/_components/orders-index.tsx`
- Endpoints: GET `/api/seller/orders?…`, `/api/seller/orders/summary`, `/api/seller/orders-pending`, `/api/seller/reseller-stores`, `/api/seller/stores`.
- Section "Consignment monitor". Status `FilterChip`s.
- `Select`s: "Placed when", "Filter by store", "Filter by status", "Rows per page". Date inputs "Placed from"/"Placed to". `Input` search.
- Table: Order | Recipient | Phone | Status (`OrderStatusBadge`, plus `orderStatusKind`/`statusLabel` from `@skydrop/ui/status`) | COD (`Money`) | Placed. `TablePaginator`.
- States: `LoadingState`; empty "No orders match that" / "No orders yet"; `ErrorState` with retry.

**/orders/new** — `orders/new/_components/new-order-form.tsx` (1211 lines), plus `customer-history-panel.tsx`, `duplicate-order-dialog.tsx`, `@/components/product-picker`
- Endpoints: POST `/api/seller/orders`; POST `/api/seller/orders/${id}/submit`; GET `/api/seller/order-defaults/customer-delivery-fee`; `/api/seller/stock?…`; `/api/seller/stores`; `/api/seller/serviceability?pincode=&paymentMode=`; `/api/seller/orders/customer-lookup?phoneE164=`; `/api/seller/variants?search=&limit=20`; PUT `/api/seller/variants/${variantId}/favourite`.
- Sections: Recipient · Reference & notes · Click to add products · Ordered products · Payment & parcel.
- Fields: Full name, Phone (with a prefix box showing `sellerInitials`/`IN_DIAL`), Address line 1, Address line 2 (the landmark), PIN code, Store (Select), Your reference, Notes for the call agent, Delivery fee (INR), Advance already paid (INR), Discount (INR), Declared value (INR), Total weight. Payment mode control.
- Dialog: `DuplicateOrderDialog` — Modal "This customer already has an order waiting", tone critical.
- Toasts: "Filled from their last order…", "Order … submitted for confirmation.", "Draft order … saved."
- Customer history: `Skeleton` while loading; rate colour comes from local `rateTone()` via inline `style={{color}}`.
- Not a table. No page-level loading or error state (the form renders straight away).

**/orders/[id]** — `orders/_components/order-detail.tsx` (1020 lines) and sub-panels
- Endpoints: GET `/api/seller/orders/${id}`; `/journey`; `/reattempt-requests`; `/invoice`; POST `/invoice` (generate); link to `/api/seller/orders/${orderId}/invoice/pdf`; `/api/seller/orders/${orderId}/delivery-actions`.
- Also, through sub-panels:
  - `order-charges.tsx`: `/charges`
  - `consignee-panel.tsx`: `/consignee`, `/consignee/history`, POST `/consignee`
  - `delivery-trouble-panel.tsx`: `/delivery-actions` GET/POST, `/call-history`
  - `order-tickets-panel.tsx`: `/api/seller/tickets?…`
  - `reseller-money-panel.tsx`: `/reseller-money`
  - `dispute-figures-modal.tsx`: POST `/api/seller/tickets/store-disputes`
  - `raise-ticket-modal.tsx`: POST `/api/seller/tickets`, GET `/tickets/issue-categories`
  - reattempt dialog: POST `/api/seller/orders/${orderId}/reattempt-request`
  - return dialog: POST `/return`
  - cancel dialog: POST `/cancel`
- Header: `PageHeader`, title `OrderStatusBadge`. `MetaChip`s coloured by local `statusTone()`.
- Sections, numbered by a `band()` counter: Recipient · Payment & parcel · Items · Your notes · Charges · Invoice · Order tracker (ui `OrderJourneyPanels`).
- Tables:
  - Items: (thumb) | Product | Qty | Unit weight
  - Charges: Charge | Amount
  - Reseller money: Fee billed | Yours | Paid by the store | Total; and Your wallet on this order | When | Amount — uses `resellerCreditStatusKind`/`resellerCreditStatusLabel`/`walletDirectionLabel`
- Dialogs:
  - `CancelOrderDialog` "Cancel {orderNumber}?" (tone critical when "heavy"; field "Reason (optional)")
  - `RequestReturnDialog` "Bring this parcel back?" (field "Why is it coming back?")
  - `ReattemptRequestDialog` "Ask us to call this customer again" (field "Why should we call again?")
  - `DeliveryTroublePanel` Modal "What should we do?" (Select "What would you like" REATTEMPT/RTO/…; "What do you know")
  - `DisputeFiguresModal` "Raise this with the store" (How much, Who owes it (Select), What is wrong (Select), Tell us more)
  - `RaiseTicketModal` "Raise an issue" (What is the problem, Which one, Order, What happened)
- Status chips: delivery actions use local `statusKind()` → `StatusBadge`; tickets use `TicketStatusBadge`.
- States: `LoadingState` ×2, `SkeletonRows` in the panels, `ErrorState` ×2 with retry, `ErrorNote`.

**/orders/[id]/edit** — `orders/[id]/edit/_components/edit-order-form.tsx`
- Endpoints: GET `/api/seller/orders/${id}`; PATCH `/api/seller/orders/${orderId}`; POST `/submit`; DELETE `/api/seller/orders/${orderId}` (discard draft); `/stock`; `/stores`.
- Sections: Items · Recipient · Payment & parcel · Notes.
- Fields: Full name, Phone, Second number, Address line 1, Address line 2, PIN code, Payment mode, Delivery fee charged to the customer (INR), Advance already paid (INR), Discount (INR), COD amount (INR), Declared value (INR), Total weight (grams), Package type, Your reference, Store, Urgent, Seller notes.
- Toasts: "Changes saved.", "Saved and submitted for confirmation.", "Draft discarded."
- Discard uses an inline armed confirm (`confirmDiscard` state, line 823).
- States: `LoadingState` ×2, `ErrorState` ×2 (one with retry).
- Has its own `Intl.NumberFormat('en-IN', currency INR)`.

**/orders/import** — `orders/_components/csv-import-panel.tsx` (also used by `/products/import`)
- Endpoints: `${endpointBase}/preview`, `${endpointBase}/process` and the list, with `endpointBase="/api/seller/order-imports"`.
- Sections: Upload · Check before importing · Recent imports.
- Table: File | Status (raw text in mono, uppercase) | Rows | Created | Failed | When | (action).
- Toast: "Import queued — refresh to track progress."
- States: `SkeletonRows`; empty "No imports yet"; `ErrorState` with retry.

**/orders/import/[id]** — `order-import-detail.tsx`
- GET `/api/seller/order-imports/${id}`; error report via raw `fetch` to `/api/seller/order-imports/${importId}/error-report`.
- Section "This run"; `DescriptionList`, `Stat`s. Title is the file name in mono.
- States: `Skeleton` ×3, `ErrorNote` ×3 (retry ×2).

**/orders/pending** — `pending-orders-index.tsx` (local component `RowCard`)
- Endpoints: GET `/api/seller/orders-pending`; POST `/orders-pending/${rowId}` (patch), `/import`, `/discard`.
- Each staged row is a card-like `SectionBand` with its `FormField`s built from `f.label`.
- Toasts: "Row N updated", "Row N is now an order".
- States: `LoadingState`; empty "Nothing waiting"; `ErrorNote`.

**/tracking** — `tracking-index.tsx`, `parcel-timeline.tsx`
- GET `/api/seller/tracking?…`, `/api/seller/tracking/${shipmentId}`.
- Sections: Parcel register · Parcel history. Status `FilterChip`s, search `Input`.
- Table: Parcel | Going to | Status (`ShipmentStatusBadge`, `courierLabel`) | Last update | (expand). A row expands into `ExpandedParcel` with `ParcelTimeline`.
- States: `SkeletonRows` ×2, `ErrorState` ×2 with retry, `TableEmpty`.

**/needs-attention** — `needs-attention-index.tsx`
- GET `/api/seller/nsa`, `/api/seller/orders?…`.
- Sections: unconfirmed · "Could not reach" (`Row` list, not a table).
- Empty "Nothing of yours needs you"; `SkeletonRows`; `ErrorNote` with retry.

**/customers** — `customers-index.tsx`, `customer-detail-panel.tsx`, `address-history.tsx`
- Endpoints: GET `/api/seller/customers?…`, `/api/seller/customers/${id}`; PATCH and DELETE on `/api/seller/customers/${id}`; `/api/seller/recipient-addresses?…`.
- Main table: Phone | Name | Orders | Delivered | RTO | Refused | Risk (`StatusBadge` via local `riskKind()`) | Last order | (expand). `TablePaginator`.
- Expanded row: detail `Card` plus address table (Address | Orders | Delivered | Returned | Last used).
- Modals: "Correct customer details" (Name, Email, Alternate phone, Call language (Select), Notes); "Remove this customer" (critical).
- Toasts: "Customer updated.", "Customer removed."
- States: `SkeletonRows`; empty "Nobody matches that" / "No customers yet" / "No delivery history"; `ErrorNote` with retry.

**/tickets** — `tickets-index.tsx`, plus `courier-thread.tsx`, `ticket-timeline.tsx`, `raise-ticket-modal.tsx`
- GET `/api/seller/tickets?…`; `/courier-escalations/by-ticket/${id}`; `/tickets/${id}/events`.
- Sections: Ticket register · How a ticket closes. `FilterChip`s, search `Input` (aria-label "Search tickets").
- Table: Ticket | Raised by | Subject | Order | Status (`TicketStatusBadge`) | Refund (`Money`) | Date | Courier. Courier-thread chips come from local `badgeKind()` → `StatusBadge`.
- States: `SkeletonRows`; empty "No tickets match" / "No tickets"; `ErrorNote` with retry.

**/tickets/[id]** — `ticket-detail.tsx`, `ticket-conversation.tsx`
- GET `/api/seller/tickets/${id}`, `/events`; POST `/tickets/${ticketId}/notes`; courier thread.
- Sections: Ticket · Conversation. `DescriptionList`, `IssueCategoryLine`, `TicketStatusBadge`, `ticketStatusLabel`, local `statTone()`, `RefundBanner`.
- Conversation: message bubbles, `Textarea` (label "Reply on this ticket"), `MessageRelayStatus`; error toast.
- States: `DetailSkeleton` (`Skeleton` ×6), `SkeletonRows`, `ErrorNote` with retry.

**/products** — `products-index.tsx`
- GET `/api/seller/products?…`, `/api/seller/stock/summary`.
- Section "Catalogue register"; status `FilterChip`s; search.
- Table: (thumb/name) | Your ref | Box & weight | Declared value (`Money`) | Status (`StatusBadge` via local `productStatusKind()`) | Updated. `TablePaginator`.
- States: `LoadingState`; empty "Nothing matches that" / "No products yet"; `ErrorState` with retry.

**/products/new** — `new-product-form.tsx` (1123 lines)
- POST `/api/seller/products`, POST `/products/${id}/variants`, image presign/register (`/api/seller/variants/${id}/images/presign`, `/images`), GET `/products?…`.
- Sections: Product · Applies to every variant · Options · Variants.
- Fields: Product name, Your product ID, Description, Weight (g), Declared value (₹), Length (cm), Width (cm), Height (cm). Option chips (`ValueChips`); image picker.
- Variants table: Variant | SKU | Declared (₹) | Images.
- Sticky submit bar (`sticky bottom-0`, safe-area padding — pinned by a test). No loading or error page state.

**/products/[id]** — `product-detail.tsx`, `add-variant-panel.tsx`
- GET `/products/${id}`, `/variants`; PATCH `/products/${id}`; POST `/archive` | `/unarchive`; POST `/variants`.
- Sections: Details · Variants.
- Edit fields: Name, Description, External ref, Default weight (g), Default length/width/height (cm), Default declared (INR). Add variant: SKU, Variant label.
- Variants table: (sku) | Label | Weight (g) | Status (`StatusBadge`).
- Toasts: success and error. States: `LoadingState` ×2, `ErrorState` ×3 (retry ×2), empty "No variants yet".

**/products/[id]/variants/[variantId]** — `variant-detail.tsx`, `image-upload.tsx`, `stock-config-panel.tsx`
- GET/PATCH `/products/${id}/variants/${vid}`; POST `/archive` | `/unarchive`.
- Images: GET/POST `/variants/${id}/images`, POST `/images/presign`, DELETE `/images/${imageId}`.
- Stock: `/stock/by-variant/${id}`, `/inventory-mode`, PATCH `/threshold`.
- Sections: Details · Pictures · Stock handling.
- Fields: SKU (disabled), Label, Weight (g), Length/Width/Height (cm), Declared (INR), GST rate (%), Barcode, Low-stock alert at.
- Modal "Archive {sku}?". Image status uses a **local** `UploadStatusBadge`.
- States: `LoadingState`; empty "No images yet"; `ErrorState` with retry.

**/products/import** — `CsvImportPanel` (`/api/seller/csv-imports`) + `saved-mappings.tsx`
- Mappings: GET/POST `/api/seller/csv-mappings`, PATCH/DELETE `/csv-mappings/${id}`.
- Mappings table: Name | Columns | Last used | Default (`StatusBadge` "default") | actions.
- Modal "Save a column mapping" / "Edit mapping" (Name, Mapping JSON `Textarea` in mono).
- States: `SkeletonRows`; empty "No saved mappings"; `ErrorNote` ×4.

**/products/import/jobs** — `import-jobs-index.tsx`
- GET `/api/seller/csv-imports?page=&pageSize=`.
- Table: File | Status (`ImportStatusBadge`) | Rows | Products | Variants | Refused | Uploaded. `TablePaginator`.
- `LoadingState`; empty "No imports yet"; `ErrorNote` with retry.

**/products/import/jobs/[id]** — `import-detail.tsx`
- GET `/csv-imports/${id}`, `/error-report`.
- Sections: Outcome · Timing · Refused rows.
- `DetailSkeleton` (`Skeleton` ×7), `ErrorNote` ×2.

**/inventory** — `inventory-view.tsx`
- GET `/api/seller/stock?…`, `/stock/summary`.
- Section "Stock register".
- Table: SKU | Variant | India stock | Reserved | Available | In transit | Low-stock. Numbers are formatted with raw `toLocaleString('en-IN')` inside `font-mono` cells. `TablePaginator`.
- `LoadingState`; empty "No stock yet"; `ErrorState` with retry.

**/inventory/units** — `unit-discrepancies-index.tsx`, `unit-trace-panel.tsx`
- GET `/api/seller/stock-units/discrepancies?warehouseId=`, `/stock-units/trace/${serial}`.
- Sections: Stuck mid-lifecycle · Unresolved dispatches · Count mismatches · Retired units · Trace a serial.
- Tables:
  - Mismatch: SKU | Warehouse | Serials in stock | Recorded on hand | Difference
  - Unit table: Serial | SKU | Status (`StockUnitStatusBadge`) | Time in status | Last scan
  - Trace: When | Moved | Step | Note
- Field: Serial.
- `Skeleton` ×4, `SkeletonRows`; empty "Serials and stock agree"; `ErrorNote` with retry.

**/inbound** — `inbound-index.tsx`, `variant-picker.tsx`
- GET/POST `/api/seller/consignments`, `/variants?search=`.
- Section "Consignment register". `FilterChip`s "Where" and "Route" (labels in mono uppercase).
- Table: Consignment | Route | Products | Your reference | Expected | Where it is (`StatusBadge` via `consignmentStatusKind`). `TablePaginator`.
- Modal "Announce a consignment" with lines table (Product | Qty | Unit cost | ·) and fields Item, Quantity, Unit cost (₹), Manufactured, Expires, Expected arrival, Your reference.
- `SkeletonRows`; empty "Nothing matches that" / "No stock announced yet"; `ErrorNote`.

**/inbound/[id]** — `consignment-detail.tsx`, `edit-receipt-panel.tsx`
- GET `/consignments/${id}`, `/events`; POST `/consignments/${id}/cancel`; `/inbound-freight`; GET/PATCH `/goods-receipts/${id}`.
- Sections: Consignment · What has happened (timeline) · Each stop (leg cards) · Inbound freight (Cards).
- Table: Product | Declared | Counted | Difference (`TableEmpty`). Chips: `FreightStatusBadge`, `freightModeExplainer`.
- Modals: "Cancel {consignmentNumber}?" (field "Why it is coming back"); "Correct {receiptNumber}" (Item, Quantity, Unit cost (₹), Manufactured, Expires, Expected arrival, Your reference).
- Toasts: "… cancelled — N units returned to you", "… updated".
- `LoadingState` ×3, `ErrorState` ×4 (retry ×3).

**/holds** — `hold-reviews-index.tsx`
- GET `/api/seller/early-reservation-reviews?status=`; PATCH `/early-reservation-reviews/${id}`.
- Section "Held stock register"; status `FilterChip`s; `StripFact` footer.
- Table: Order | Units held | Calls made | Status (`EarlyReviewStatusBadge`) | Decision.
- Modal `DecideModal` "Keep holding this stock?" (decision RELEASE / REQUEST_MORE_ATTEMPTS; field Note). Success toast.
- `SkeletonRows`; empty "Nothing waiting on you" / "No matching reviews"; `ErrorNote` with retry.

**/freight** — `freight-index.tsx`
- GET `/api/seller/inbound-freight?status=`.
- Sections: Freight bills · How a bill is charged. `FilterChip`s.
- Table: Consignment | Terms (`freightModeWords`) | Total | Charged so far | Still owed | Units charged | Status (`FreightStatusBadge`).
- `SkeletonRows`; empty "No bills with that status" / "No freight bills yet"; `ErrorNote`.

**/wallet** — `wallet/page.tsx` + `topup-card.tsx`, `topup-wizard.tsx`, `withdrawals-card.tsx`, `credit-standing-card.tsx`, `ledger-entry-label.tsx`
- Endpoints: GET `/api/seller/wallet`, `/wallet/entries?…` (infinite), `/wallet/credit`, `/wallet/topups`, `/wallet/topups/bank-accounts`, `/wallet/topups/${id}/proof-url`; POST `/wallet/topups/proof-upload`, `/wallet/topups`; GET/POST `/wallet/withdrawal-requests`; GET `/withdrawal-requests/eligibility`.
- Chip tabs: Ledger · Top-ups · Withdrawal requests. Client-side CSV "export all" (Download).
- Tables:
  - Ledger: When | Type (`LedgerEntryLabel`, `walletDirectionLabel`, `isWalletCredit`) | Linked | Amount (`Money`) | Balance after
  - Top-ups: Sent | To | Amount | Reference | Status (`TopupStatusBadge`)
  - Withdrawals: Requested | Amount | Status (`WithdrawalStatusBadge`) | Outcome
- Modals:
  - `TopupWizard` "Top up your wallet": multi-step (local `Stepper`, `SelectBank`, `PaymentDetails`, `Submitted`); fields "Amount you paid ({symbol})", "Transaction ID / reference", "Payment proof".
  - `RequestWithdrawalModal` "Request a withdrawal": Amount (₹), Note.
- Toasts: "Top-up recorded…", "Withdrawal requested."
- States: `Skeleton` ×2 (balances), `SkeletonRows`, `ErrorState` ×2 with retry.

**/wallet/limits** — `withdrawal-schedule-card.tsx`, `wallet-terms-card.tsx`
- GET/PATCH `/api/seller/wallet/withdrawal-schedule`; GET `/wallet/settings`.
- Sections: Withdrawal settings · Your limits.
- Controls: `Select` "Automatic withdrawal hour", `Input` "Balance to keep".
- Success and error toasts. The wallet-terms values use `Money`. No explicit loading or error UI in the code.

**/reseller-stores** — `reseller-stores/page.tsx`
- GET/POST `/api/seller/reseller-stores`.
- Section "Waiting for your approval" plus the store table; `StripFact` footer.
- Table: Store | Status (`ResellerStoreStatusBadge`) | Opened by | Wallet managed by | Team | Created.
- Modal "Open a reseller store": Store name, Name customers see, Contact email, Contact phone, Who manages the store's wallet (Select), Their email, Their name.
- `LoadingState`; empty "No reseller stores yet"; `ErrorState` with retry.

**/reseller-stores/[storeId]** — page + `store-actions-section.tsx`, `store-catalogue.tsx`, `store-wallet-section.tsx`, `terms-section.tsx`, `../_components/price-fields.tsx`
- Chip tabs: Overview · Catalogue & stock · Terms · What they can do.
- Endpoints:
  - Store: GET `/reseller-stores/${id}`; POST `/approve`, `/reject`, `/pause`, `/resume`, `/close`; PATCH `/wallet-manager`; POST `/invitations`, `/invitations/${iid}/revoke`
  - Store wallet: `/wallet`, `/wallet/entries`, POST `/wallet/top-up`, `/wallet/payouts`, PATCH `/wallet/negative-limit`
  - Catalogue: `/catalogue`, PUT `/catalogue/${vid}`, image presign/POST/DELETE
  - Terms: `/terms`, `/terms/preview?`, POST `/terms`
  - Action policy: `/action-policy` GET/PUT
- Tables:
  - History: When | What | By | Note
  - Team: Name | Email | Role | State | Actions
  - Catalogue: Product | Sold here | Transfer price | Stock | Available (real) | Store sees | Actions
  - Set-asides: When | SKU | Set aside | On hand then
  - Wallet: When | What | Amount | Balance after
  - Terms: Fee | Worked on | You pay; Version | Published | Store pays | Credit | Accepted
- Modals: Approve (First user's email, Their name), Reject (critical; Why), Close for good (critical; Why), Invite (Name, Email, Role), catalogue edit (Stock, Units set aside, Hidden share (%), What the store calls it, Description for the store, Add a picture), Top up / Record paying (Amount (₹), Note / How you paid it), Auto-pause.
- ConfirmDialogs: Pause, Change wallet manager, Withdraw invitation, Remove picture, Change negative limit, Publish version.
- Many toasts. States: `LoadingState`, `ErrorState` with retry; empty "No history yet", "Nobody on the team yet", "Nothing has moved yet", "No versions yet".

**/reseller-stores/requests** — page
- GET `/store-order-requests`, `/store-action-requests`, `/store-address-changes`; POST `…/${id}/approve` | `/reject`.
- Sections: Cancels, call questions and issues · Delivery asks · Order and address changes.
- Three tables: Store | Order (`OrderStatusBadge`) | They asked … | What they said / Why | Asked | Your answer.
- Three reject modals, each with a "Your reason" field. Approve fires directly.
- `LoadingState` ×4, `ErrorState` ×3 with retry, several empty states.

**/reseller-stores/price-list** — page
- GET `/reseller-price-list`; PUT/DELETE `/reseller-price-list/${variantId}`.
- Table: Product | Available | Transfer price | Retail range | Suggested | Stores selling it | Actions.
- Modal "Reseller price — {name}" (`PriceFields`). ConfirmDialog "Remove the price of {sku}?".
- `LoadingState`, `ErrorState` with retry, empty.

**/reseller-stores/reports** — page
- GET `/reseller-reports/scorecards?`, `/transfer-revenue?`; PUT `/reseller-reports/stores/${id}/auto-pause`.
- Sections: The window (From/To) · Scorecards · Stores ranked … · Transfer revenue by store.
- Modal "Auto-pause …" with a `Switch` and fields Return rate above (%), minimum parcels, last N days.
- `LoadingState` ×2, `ErrorState` ×2.

**/reseller-stores/stock-forecast** — page
- GET `/reseller-reports/stock-forecast`.
- Table: Product | Available | Sold | Per day | Days left | (`StatusBadge` "Reorder").
- `LoadingState`, `ErrorState`, empty.

**/profile** — page with local components `CompanyInfoSection`, `BankDetailsSection`, `BankValuesList`, `LogoSection`
- GET/PATCH `/api/seller/profile`; PATCH `/profile/bank-details`; POST `/profile/logo/presign`, `/logo/register`; DELETE `/profile/logo`.
- Sections: Company info · Bank details · Company logo.
- Fields: Company name, Contact person, Phone (E.164 BD), WhatsApp, Display currency (Select), Display language (Select), Bank name, Branch name, Account holder name, Account number, Routing number, SWIFT code.
- Chips: `StatusBadge` "Change rejected" / "Awaiting approval"; `MetaChip` via local `statusTone()`.
- Toasts: "Profile updated.", "Sent for approval…", "Bank details saved.", "Logo updated.", "Logo removed."
- `LoadingState`, `ErrorState` with retry.

**/team** — `team-management-index.tsx`, `invite-member-modal.tsx`, `invite-link-reveal-card.tsx`
- Endpoints: `/team/members`, PATCH `/team/members/${id}/role`, DELETE `/team/members/${id}`; `/team/invitations` GET/POST, POST `/${id}/resend`, DELETE `/${id}`; `/roles`.
- Tables: Name | Email | Role (Select) | Last login | Joined | Actions; Email | Role | State (`StatusBadge` via local `inviteKind()`) | Expires | Actions.
- Modal "Invite team member" (Full name, Email, Role).
- `LoadingState` ×2, `ErrorState` ×2, `TableEmpty` ×2.

**/team/roles** — `roles-index.tsx`, `role-editor.tsx`
- GET `/api/seller/roles`, catalogue; POST, PATCH, DELETE `/api/seller/roles/${id}`.
- Table: Role | Covers | People | Actions.
- Modal "New role" / "Edit …" (Name, What this role is for).

**/notifications** — `notifications-view.tsx`
- `/api/seller/notifications` (feed with cursor), `/topics`; POST `/${id}/read`, `/${id}/unread`, `/read-all`; DELETE `/${id}`; DELETE base (dismiss all).
- Section "Inbox". Chips: All / Unread / topic groups. Colours come from ui `notificationKindStyle`, applied with inline `style` `var(--status-*)`.
- `LoadingState`; empty "Nothing matches" / "Nothing yet". No `ErrorState`.

**/notifications/settings** — `notification-settings-view.tsx`
- `/notifications/subscriptions` GET/POST/DELETE; `/api/seller/notification-preferences` GET, PATCH `/${category}`.
- Sections: What reaches you · The company's email · quiet hours / time zone card.
- Table: Category | Email | In-app | Quiet hours | What that means (`Switch`es).
- `LoadingState` ×2, `ErrorState` with retry.

**/settings** — `settings-hub.tsx`: tiles with mono ordinals (01, 02, …); empty "Nothing to configure".

**/settings/security** — `security-index.tsx`
- POST `/api/auth/seller/logout-all`, `/api/auth/seller/email-verification/request`.
- Sections: This session · Sign out everywhere. ConfirmDialog "Sign out everywhere?". `Skeleton` ×2.

**/settings/stores** — `stores-index.tsx`
- `/api/seller/stores` GET/POST, PATCH `/${id}`, POST `/${id}/make-default`, PATCH `/${id}/active`.
- Table: Store | Orders | State | Actions. Modal "Rename this store" / "Add a store" (Name, Note).

**/settings/orders** — `order-defaults-panel.tsx`
- GET/PATCH `/api/seller/order-defaults/customer-delivery-fee`. Field: Delivery fee charged to your customer (₹).

**/settings/stock** — `alert-config-panel.tsx`
- GET `/api/seller/stock/alert-config`, PATCH `/alert-config/default`. Field: Default threshold. `Skeleton`.

**/settings/api-keys** — `api-keys-index.tsx`
- `/api/seller/api-keys` GET/POST, POST `/${id}/revoke`.
- Fields: Key name, Expires in days.
- Table: Name | Prefix | Last used | Expires | State (`StatusBadge` via local `stateKind()`) | Actions. `KeyRevealPanel` shows the new key.

**/settings/webhooks** — `webhooks-index.tsx`, `webhook-form-modal.tsx`, `secret-reveal-card.tsx`
- `/api/seller/webhook-endpoints` GET/POST, PATCH/DELETE `/${id}`, POST `/${id}/rotate-secret`.
- Endpoint list is cards, not a table; `StatusBadge` Active / Disabled / Auto-disabled.
- Modal "New webhook endpoint" / "Edit webhook endpoint" (URL, Display name, Description, Subscribed events).

---

## 3. Money-moving or irreversible actions

| Page | Component | Endpoint | Confirmation |
|---|---|---|---|
| /wallet | `withdrawals-card.tsx` `RequestWithdrawalModal` | POST `/api/seller/wallet/withdrawal-requests` | The modal is the form; **no separate confirm step** |
| /wallet | `topup-wizard.tsx` | POST `/wallet/topups` (+ proof-upload) | Multi-step wizard; no final confirm |
| /wallet/limits | `withdrawal-schedule-card.tsx` | PATCH `/wallet/withdrawal-schedule` | **None** (auto-withdraws money) |
| /profile | `BankDetailsSection` | PATCH `/profile/bank-details` | None (goes to admin approval) |
| /profile | `LogoSection` remove | DELETE `/profile/logo` | Inline armed "Confirm remove" |
| /orders/[id] | `cancel-order-dialog.tsx` | POST `/orders/${id}/cancel` | Yes: Modal "Cancel …?" (critical when heavy) |
| /orders/[id] | `request-return-dialog.tsx` | POST `/orders/${id}/return` (mentions ₹200 charge) | Yes: Modal |
| /orders/[id] | `delivery-trouble-panel.tsx` (REATTEMPT/RTO) | POST `/orders/${id}/delivery-actions` | Yes: Modal "What should we do?" |
| /orders/[id] | `reattempt-request-dialog.tsx` | POST `/reattempt-request` | Yes: Modal |
| /orders/[id] | `dispute-figures-modal.tsx` | POST `/tickets/store-disputes` | Yes: Modal |
| /orders/[id] | Generate invoice (`order-detail.tsx:983`) | POST `/orders/${id}/invoice` | **None** |
| /orders/[id] | `consignee-panel.tsx` | POST `/orders/${id}/consignee` (sent to courier) | **None** |
| /orders/[id]/edit | Discard draft | DELETE `/orders/${id}` | Inline armed confirm |
| /orders/[id]/edit, /orders/new | Submit for confirmation | POST `/orders/${id}/submit` | None |
| /orders/pending | Import row / **Discard** (`pending-orders-index.tsx:200`) | POST `/orders-pending/${id}/import` \| `/discard` | **None** |
| /inbound/[id] | `CancelConsignmentModal` | POST `/consignments/${id}/cancel` | Yes: Modal |
| /holds | `DecideModal` (RELEASE stock) | PATCH `/early-reservation-reviews/${id}` | Yes: Modal |
| /customers | Remove customer | DELETE `/customers/${id}` | Yes: Modal (critical) |
| /products/[id] | Archive / restore product (`product-detail.tsx:250`) | POST `/archive` \| `/unarchive` | **None** |
| /products/[id]/variants/[vid] | Archive variant | POST `…/archive` | Yes: Modal "Archive {sku}?" |
| /products/[id]/variants/[vid] | Delete image (`image-upload.tsx:255`) | DELETE `/variants/${id}/images/${imgId}` | **None** |
| /products/import | Remove mapping (`saved-mappings.tsx:134`) | DELETE `/csv-mappings/${id}` | **None** |
| /reseller-stores/[id] | Store wallet top-up / record payout (`MoveModal`) | POST `/wallet/top-up`, `/wallet/payouts` | Modal form; no separate confirm |
| /reseller-stores/[id] | Negative limit | PATCH `/wallet/negative-limit` | Yes: ConfirmDialog |
| /reseller-stores/[id] | Approve / Reject / Close | POST `/approve` `/reject` `/close` | Yes: Modals (Reject and Close are critical) |
| /reseller-stores/[id] | Pause | POST `/pause` | Yes: ConfirmDialog |
| /reseller-stores/[id] | Resume (`page.tsx:604`) | POST `/resume` | **None** |
| /reseller-stores/[id] | Wallet manager change | PATCH `/wallet-manager` | Yes: ConfirmDialog |
| /reseller-stores/[id] | Revoke invitation | POST `/invitations/${iid}/revoke` | Yes: ConfirmDialog |
| /reseller-stores/[id] | Publish terms | POST `/terms` | Yes: ConfirmDialog |
| /reseller-stores/[id] | Catalogue save / remove picture | PUT `/catalogue/${vid}`, DELETE image | Save: none; picture: ConfirmDialog |
| /reseller-stores/[id] | Action policy save | PUT `/action-policy` | None |
| /reseller-stores/requests | Approve (lines 316/513/788) | POST `…/approve` | **None**. Reject has a Modal with a reason |
| /reseller-stores/price-list | Remove price | DELETE `/reseller-price-list/${vid}` | Yes: ConfirmDialog |
| /reseller-stores/reports | Auto-pause rule | PUT `…/auto-pause` | Modal form |
| /settings/security | Sign out everywhere | POST `/api/auth/seller/logout-all` | Yes: ConfirmDialog |
| /settings/stores | Close / Reopen store, Make default | PATCH `/active`, POST `/make-default` | **None** |
| /settings/orders | Delivery fee default | PATCH `/order-defaults/customer-delivery-fee` | None |
| /settings/api-keys | Revoke key | POST `/api-keys/${id}/revoke` | Inline armed "Confirm" (line 245) |
| /settings/webhooks | Delete endpoint | DELETE `/webhook-endpoints/${id}` | Inline armed "Confirm" (line 293) |
| /settings/webhooks | Rotate secret | POST `/rotate-secret` | **None** |
| /team | Deactivate member / Revoke invite | DELETE `/team/members/${id}`, `/team/invitations/${id}` | Inline armed "Confirm" (lines 305, 399) |
| /team | Change role | PATCH `/members/${id}/role` | None (Select onChange) |
| /team/roles | Delete role | DELETE `/api/seller/roles/${id}` | **`window.confirm`** (`roles-index.tsx:56`) |
| /notifications | Dismiss one / **Dismiss all** (`notifications-view.tsx:180`) | DELETE `/notifications/${id}`, DELETE base | **None** |

---

## 4. Components

**`/home/talha/projects/SD/apps/seller/src/components`**
- `auth-console/console-shell.tsx` — auth page frame with the `ThemeToggle`. `auth-console/console.css` holds its own hex palette and the `.telemetry` style.
- `auth-console/corridor-console.tsx` — canvas map animation with hardcoded hex/rgba colours. `auth-console/map-geometry.ts` holds its data.
- `notification-bell-container.tsx` — connects hooks to ui `NotificationBell` (a wrapper, not a duplicate).
- `product-picker.tsx` — `ProductCatalogue`, `OrderedProducts` and a local **`Stepper`** (quantity stepper).
- `query-provider.tsx` — React Query provider.
- `/home/talha/projects/SD/apps/seller/src/lib/tilt.tsx` — `TiltPanel` and `Magnetic` used on auth pages.

**Components inside `app/` that duplicate or overlap `packages/ui`** (every other `_components/*.tsx` file is the page component listed in §1–2):
- `products/[id]/variants/[variantId]/_components/image-upload.tsx` → a local **`UploadStatusBadge`**, which has the same name as ui `UploadStatusBadge` (`status-badge.tsx:208`).
- `products/import/_components/import-status.tsx` `ImportStatusBadge` (local `importStatusKind`) → duplicates ui `UploadStatusBadge`.
- `orders/_components/csv-import-panel.tsx` shows upload status as raw mono uppercase text instead of ui `UploadStatusBadge`.
- `orders/[id]/_components/delivery-trouble-panel.tsx` local `statusKind()` + `StatusBadge` → ui `DeliveryActionStatusBadge`.
- `tickets/_components/courier-thread.tsx` local `badgeKind()` → a generic `StatusBadge` mapping.
- Local status/tone mappers: `customers-index.tsx` `riskKind`, `products-index.tsx` `productStatusKind`, `team-management-index.tsx` `inviteKind`, `api-keys-index.tsx` `stateKind`, `order-detail.tsx`/`profile/page.tsx`/`reseller-stores/[storeId]/page.tsx` `statusTone`, `ticket-detail.tsx` `statTone`, `customer-history-panel.tsx` `rateTone` (inline colour).
- Timelines: `tracking/_components/parcel-timeline.tsx`, `tickets/_components/ticket-timeline.tsx` and `consignment-detail.tsx` `Timeline` overlap ui `JourneyTimeline`/`OrderJourneyPanels` (`order-journey.tsx`).
- Reveal cards repeated three times: `settings/webhooks/_components/secret-reveal-card.tsx`, `team/_components/invite-link-reveal-card.tsx` and `api-keys-index.tsx` `KeyRevealPanel` (same structure, no ui primitive).
- Repeated local helpers:
  - `Dash`: `order-detail`, `product-detail`, `variant-detail`, `ticket-detail`
  - `BackLink`: `import-detail`, `ticket-detail`, `reseller-stores/[storeId]/page`
  - `DetailSkeleton`: `import-detail`, `ticket-detail`
  - `Stepper`: `product-picker`, `topup-wizard`
- `dashboard-view.tsx` `MoneyTile` / `WalletBalanceCard` overlap ui `Stat`.
- `settings/_components/settings-hub.tsx` — tile grid; no ui equivalent.
- `wallet/_components/credit-standing-card.tsx`, `wallet-terms-card.tsx`, `withdrawal-schedule-card.tsx`, `topup-card.tsx`, `ledger-entry-label.tsx` — wallet-specific; they use ui primitives.
- `(authed)/_components/restriction-banner.tsx` — account restriction banner (uses `Money`); no ui banner primitive.
- `(authed)/_components/role-boundary.tsx` — permission gate that renders `EmptyState`.
- `(authed)/_components/order-omnisearch.tsx` — header search (order and ticket lookup).
- `reseller-stores/_components/price-fields.tsx` — shared price inputs.

---

## 5. Style debt

**Mono is applied to money and numbers by the design system, not only by page classes.**
- `packages/ui/src/seller-theme.css:438` sets `.skydrop-tabular { font-family: var(--font-mono) }`.
- ui `Money` and `Num` both apply `skydrop-tabular`, so in the seller app **every `Money` (108 uses) and `Num` (48 uses) renders in mono**.
- `Ident` (14 uses) is hard-coded `font-mono` (`money.tsx:~268`).

**`font-mono` classes in the app** (206 total; per-file counts from grep):
- profile 10, order-detail 10, reseller reports 9, variant-detail 9, team-management 8, webhooks-index 8, new-order-form 8, csv-import-panel 8, import-jobs-index 7, product-detail 7, ticket-detail 6, inventory-view 6, notifications-view 5, inbound-index 5, and 1–4 in most others.
- On ordinary numbers, money, dates or plain text (the debt):
  - `inventory-view.tsx:259,262,265,272,279` — quantities
  - `reseller-stores/reports/page.tsx:243–258` — counts and %; `:310` rank; `:322`
  - `csv-import-panel.tsx:466,469,472` — row counts; `:465` status uppercase; `:475` dates
  - `import-jobs-index.tsx:155,162,165,172,178`
  - `new-order-form.tsx:751,863,1106,1134,1181` — money totals, e.g. `₹{itemsTotal.toLocaleString('en-IN')}`
  - `product-picker.tsx:157,269` — money
  - `product-detail.tsx:206,375,449,458` — dimensions and weights
  - `variant-detail.tsx:411,423,440,454` — weight, dimensions, declared value, GST %
  - `order-detail.tsx:687,756,759` — weight and qty
  - `reseller-stores/page.tsx:264` — member count
  - `store-catalogue.tsx:227` — quantities
  - `new-product-form.tsx:1012,1062`
  - `image-upload.tsx:249` — KB
  - `notification-settings-view.tsx:696` — time
  - `authed-shell.tsx:148` — badge count
  - Dates/timestamps: `orders-index.tsx:700`, `products-index.tsx:457`, `customers-index.tsx:305`, `api-keys-index.tsx:222,225`, `team-management-index.tsx:289,292,379`, `tickets-index.tsx:312`, `wallet/page.tsx:405`, `tracking-index.tsx:243`, `inbound-index.tsx:337`, `consignment-detail.tsx:386`, `unit-trace-panel.tsx:110`, `unit-discrepancies-index.tsx:310`, `store-catalogue.tsx:223`, `reseller-stores/[storeId]/page.tsx:400`, `reseller-stores/page.tsx:267`, `needs-attention-index.tsx:228`, `notifications-view.tsx:362,455`, `webhooks-index.tsx:321,331,344`
  - Emails, phones and names: `profile/page.tsx:354–358,544`, `security-index.tsx:131,180`, `team-management-index.tsx:272,371,372`, `reseller-stores/[storeId]/page.tsx:826,835`, `customers-index.tsx:272`, `customer-detail-panel.tsx:192,205`, `order-detail.tsx:598,609`, `needs-attention-index.tsx:223`, `orders-index.tsx:687`, `topup-wizard.tsx:278`
  - `StripFact` footer rows wrapped in mono `text-[11px]`: `freight-index:361`, `holds:234`, `tickets-index:359`, `reseller-stores/page:212`, `price-list:288`, `requests:192`, `reports:413`, `stock-forecast:195`, `wallet/page:363`
- On identifiers (fine): order numbers (`orders-index:650`, `dashboard:436`, `needs-attention:217,304`, `tracking:213`, `requests:296,497,753`, `order-detail:246`, `pending:144`, `duplicate-order-dialog:74`, `customer-history-panel:43`, `order-omnisearch:188`, `wallet/page:415`, `ticket-detail:181,255`, `edit-order-form:437`); ticket numbers (`tickets-index:270`, `ticket-detail:99`, `omnisearch:158`); SKUs (`inventory-view:251`, `product-detail:359`, `variant-detail:99,406,556`, `inbound-index:696`, `consignment-detail:525`, `variant-picker:150`, `product-picker:146,259`, `price-list:232`, `stock-forecast:163`, `store-catalogue:226`, `order-detail:749`); barcodes and serials (`variant-detail:211,463`, `unit-trace-panel:93`); consignment and receipt numbers (`inbound-index:325`, `consignment-detail:147,444`, `ticket-detail:186,237,270`); invoice number (`order-detail:997`); external refs and PIN (`products-index:429`, `product-detail:115,440`, `orders-index:655`, `order-detail:250,629`); key prefix and secrets (`api-keys-index:221,325`, `secret-reveal-card:65`, `invite-link-reveal-card:63`); URL (`webhooks-index:266`); account and routing numbers (`topup-wizard:282,287`, `topup-card:100,121`); file names and ids (`order-import-detail:161,228`, `import-detail:94`, `import-jobs-index:147`); JSON (`saved-mappings:261`); error text (`error.tsx:88`).

**`uppercase` + `tracking-` label styles**
- In the app:
  - `order-charges.tsx:104`
  - `order-omnisearch.tsx:159,189`
  - `security-index.tsx:211`
  - `webhooks-index.tsx:191` (the `Caption` component)
  - `inbound-index.tsx:212,236`
  - `team-management-index.tsx:262,267`
  - `notifications-view.tsx:348,357`
  - `settings-hub.tsx:72` (tracking only)
  - plus `uppercase`/`tracking` in `new-order-form.tsx` (×3), `order-detail.tsx` (×3), `profile/page.tsx` (×3/×2), `consignee-panel`, `role-editor`, `ticket-timeline`, `csv-import-panel`, `order-import-detail`, `notification-settings-view`, and the auth forms
- In ui, affecting every page:
  - `data-table.tsx:123` — every `THead`
  - `status-badge.tsx:76` — every badge
  - `feedback.tsx:156` — every `Stat` label
  - `console.tsx:133` (`MetaChip`), `:301` (`StripFact` label)
  - `app-shell.tsx:157,255,486,556,574`
  - `page.tsx:260`
- `.telemetry` (mono + uppercase + 0.08em tracking, `components/auth-console/console.css:132`): login page ×6, login-form ×2, the other auth pages ×3–4 each, `dashboard-view` ×1, `authed-shell` ×1, `notifications-view` ×1, `notification-settings-view` ×2.

**"NN //" section eyebrows**
- Rendered by ui `SectionBand` (`packages/ui/src/components/console.tsx:175–179`: mono, 11px, 0.1em tracking, uppercase, `{index} //`).
- In seller, 110 `SectionBand` calls pass `index=`, across 56 files (list in the SectionBand counts above; `order-detail` numbers them with a `band()` counter).
- `wallet/limits/page.tsx` comment: each band "carries its own ordinal (01, 02)".

**Mono breadcrumbs ("SELLER CONSOLE / …")**
- ui `Crumbs` (`console.tsx:65`: `font-mono text-[11px] tracking-[0.08em] uppercase`).
- `{ label: 'Seller console' }` is the first crumb in 47 files: every authed page except those that render no `PageHeader` crumbs. `profile/page.tsx` has it ×4 (repeated across its loading, error and empty branches) and `reseller-stores/[storeId]/page.tsx` ×2.

**Spinners**
- Only one: `(authed)/_components/order-omnisearch.tsx:5,139–140` (`Loader2` + `animate-spin`).
- Skeleton pulses come from ui `LoadingState`, `Skeleton` and `SkeletonRows`.

**Native `<select>`**
- There are no raw `<select>` elements; the grep hits in `products-index.tsx:319` and `tracking-index.tsx:159` are comments. A test forbids them.
- The ui `Select` is itself a styled native select. It is used in: `orders-index`, `new-order-form`, `edit-order-form`, `customer-detail-panel`, `delivery-trouble-panel`, `dispute-figures-modal`, `raise-ticket-modal`, `profile`, `team-management-index`, `invite-member-modal`, `withdrawal-schedule-card`, `reseller-stores/page`, `[storeId]/page`, `store-actions-section`, `store-catalogue`, `terms-section`.

**Hard-coded hex / rgba**
- Only in the auth console: `components/auth-console/console.css:36–126` (whole palette, e.g. `--color-bg: #090d16`) and `corridor-console.tsx:119–151` (hex) plus 119–387 (rgba canvas colours).
- Inline `style` token uses: `var(--sky)` on 5 auth pages, `var(--green)` on `login/page.tsx:55`, `var(--status-*)` in `notifications-view.tsx:330–349`, `tone.fg` in `customer-history-panel.tsx:113`, and `notification-settings-view.tsx:708`.
- `text-[var(--color-critical)]` in `import-jobs-index.tsx:172`.
- No hex values in authed page TSX.

---

## 6. Tests pinned to markup

The Playwright `testDir` is the repo root. The seller project matches `apps/seller/e2e/**/*.spec.ts` plus `e2e-shared/**/*.spec.ts` (`/home/talha/projects/SD/playwright.config.ts`).

**Playwright**
- `/home/talha/projects/SD/apps/seller/e2e/login.spec.ts`: text "Skydrop" (exact), "seller portal" (exact); heading "Sign in"; textbox name "email"; `getByLabel('Password')` / `#password`; button "Sign in"; error text "Invalid email or password."; `/dashboard` redirects to `/login`.
- `/home/talha/projects/SD/e2e-shared/csp.spec.ts`: `/login` must load with no CSP violations and hydrate; nonce-based script-src. No markup selectors.
- `/home/talha/projects/SD/e2e-shared/responsive.spec.ts`:
  - Seller routes: `/login`, and with `E2E_SELLER_EMAIL`/`E2E_SELLER_PASSWORD` set also `/dashboard`, `/orders`, `/orders/new`, `/wallet`, `/settings`, `/products`.
  - Widths 320/360/414/768.
  - Fails on horizontal overflow, on touch targets under 30px high or 20px wide (skipped for `.skydrop-hit` and inline `<a>`), and on input/select/textarea font-size under 16px on touch devices.
  - Uses `input[type=email]`, `input[type=password]`, `button[type=submit]`.

**Vitest** (`/home/talha/projects/SD/apps/seller/src/tests/`, happy-dom)
- Tests that render components:
  - `dashboard-wallet-balance.test.tsx` → `DashboardView`: text "Owed to you", "You owe", "No activity yet", "No wallet activity yet", figures `/3,600/`, `/4,428/`, `/1\.23/`, "the same balance in BDT", no "₹1 =".
  - `ticket-conversation.test.tsx` → `TicketConversation`: label "Reply on this ticket"; "Nothing said yet", "This ticket is closed", "we opened this for you", `/^You ·/`, `/^Skydrop ·/`; **CSS classes `justify-end` / `justify-start` on the bubble and `p.mt-1`**.
  - `tickets-index-number.test.tsx` → `SellerTicketsIndex`: label "Search tickets"; "TK-2026-000001", "You", "Skydrop".
  - `reseller-store-wallet-section.test.tsx` → `StoreWalletSection`: buttons "Change the limit", "Save", "Show older"; link "See the order"; "Change how far below zero the store may go?"; "Showing all 3 movements." / "Showing the latest 2 movements."
  - `variant-archive.test.tsx` → `VariantDetailView`: buttons "Archive variant" / "Restore variant"; "Archive SKU-1?"; `/SKU-1 archived/`, `/SKU-1 restored/`; role `alert`.
  - `webhook-create-fe2.test.tsx` → `WebhookFormModal`: placeholder `https://example.com/skydrop/webhooks`; button `/Create endpoint/`; text `[HTTPS_REQUIRED]`.
  - `ledger-entry-label.test.tsx` → `LedgerEntryLabel`: "Credited by Skydrop", "Debited by Skydrop" and note text.
  - `quick-actions.test.tsx` → ui `MenuButton` + `quickActionsFor`: button `/quick actions/`, role `menu`/`menuitem`; "New order", "Import CSV".
  - `notification-bell.test.tsx` → ui `NotificationBell`: button `/notifications/`, tabs `/money/`, `/couriers/`; `/dismiss/`; "12m ago", "5 unread".
  - `help-disclosure.test.tsx` → ui help disclosure: buttons `/show help for …/`.
  - `money-display-currency.test.tsx` → ui `Money`: glyphs ₹ / ৳ / − / ≈ and Indian grouping (`10,00,000`).
- Tests that read source text (break if strings or classes change):
  - `form-controls-use-primitives.test.ts`: no raw `<textarea>` or `<select>` anywhere in src.
  - `new-product.test.tsx`: `new-product-form.tsx` must contain `<THead>`, `<TBody>`, `<Th`, `variant="ghost"`, `variant="secondary"`, `type="submit" variant="primary" size="md"`, `sticky bottom-0`, `pb-[calc(0.75rem+env(safe-area-inset-bottom))]`; no inline safe-area style; no `role="switch"`; copy strings such as "Add value", "Two options share a name".
  - `csv-preview.test.ts`: `csv-import-panel.tsx` strings "Upload and check", "Nothing has been imported yet", "Discard", "did you mean", and the `disabled={…missingRequired.length > 0` pattern.
  - `order-edit-matches-create.test.ts`: both order forms contain the shared field names, `ProductCatalogue`, `OrderedProducts`, `onRemove=`.
  - `address-guidance.test.ts`: order forms import the address hints; no `label="Landmark"`; copy strings.
  - `stock-config.test.ts`: `stock-config-panel.tsx` strings "Unit tracking", "Use catalogue default", `<StockConfigPanel`.
  - `unit-trace.test.ts`: `<StockUnitStatusBadge`, `<UnitTracePanel />`, copy "never received as a tracked unit".
  - `order-lines-render-all.test.ts`: `items.map(`, no `items[0]`.
  - `autofill-prefix.test.ts`: the `stripSellerPrefix` call pattern.
  - `pages-are-reachable.test.ts`: every static route must be linked by a literal `'/route'` string somewhere (except `/dashboard` and `/settings/notifications`).
  - `seller-theme-scope.test.ts`: `globals.css` imports `@skydrop/ui/seller-theme.css` after tokens; `console.css` must contain `--color-bg: #090d16` and `--color-bg: #f8f9ff;`.
  - `api-paths-use-proxy.test.ts`, `api-client-body.test.ts`, `page-access-alignment.test.ts`: API paths and permissions only, not markup.
- Logic-only (no markup): `consignment-words`, `dashboard-onboarding-flash`, `notification-kind`, `phone`, `seller-prefix`, `variant-matrix`.

---

## 7. Formatting functions

**Money and numbers — `packages/ui/src/components/money.tsx`**
- `formatInr()` (line 88).
- `Money` (132): convert/currency/direction/decimals/size props; `aria-label` in words; `skydrop-tabular` (mono in seller).
- `Num` (235) and `Ident` (258).
- `MoneyDisplayProvider` / `useMoneyDisplay` for INR→BDT display, set in `(authed)/layout.tsx`.
- Status helpers in `@skydrop/ui/status`: `walletDirectionLabel`, `isWalletCredit`, `isStoreWalletCredit`, `storeWalletDirectionLabel`, `resellerCreditStatusKind/Label`, `orderStatusKind`, `statusLabel`, `ticketStatusLabel`, `consignmentStatusKind`, `freightModeWords`, `freightModeExplainer`, `courierLabel`.
- `notification-kind.ts`: `agoLabel`, `humaniseTopic`, `notificationKindStyle`.

**Local money formatting that bypasses `Money`**
- `edit-order-form.tsx:119`: `const inr = new Intl.NumberFormat('en-IN', {currency:'INR'})`.
- `new-order-form.tsx:966,1003,1135,1182`: `₹${x.toLocaleString('en-IN')}`.
- `order-detail.tsx:999`: "Total ₹".
- `order-defaults-panel.tsx:44`: toast `₹${amountInr}`.
- FX lines: `authed-shell.tsx:252`, `dashboard-view.tsx:695`, `wallet/page.tsx:218`.
- `topup-wizard.tsx:315` picks its own symbol.
- `reseller-stores/reports/page.tsx:45`: `pct()`.
- `inventory-view.tsx`: raw `toLocaleString('en-IN')` for quantities.

**Dates — no shared helper; each file formats its own**
- Named local helpers:
  - `lib/ist-day.ts` (`istDateLabel`, `istDayRange`, `lastDays`)
  - `inbound/_components/consignment-words.ts:228,236` (`shortDate`, `stamp`)
  - `order-import-detail.tsx:71` `stamp` (ISO slice)
  - `when()` in `reseller-money-panel:71`, `store-catalogue:51`, `terms-section:41`, `store-wallet-section:41`, `requests/page:45`, `[storeId]/page:63`
  - `day()` in `reseller-stores/page:40`, `[storeId]/page:70`
  - `dayOf()` in `edit-receipt-panel:372`
  - `formatDateTime`/`formatDate` in `ticket-detail:409,414`, `import-detail:290`, `import-jobs-index:205`
  - `whenLabel()` in `profile/page:519`
- `toISOString().slice(0,16).replace('T',' ')`: `orders-index:701`, `products-index:458`, `csv-import-panel:476`, `order-import-detail:73`.
- Bare `toLocaleString()` / `toLocaleDateString()` in ~45 files (per-file counts from grep; e.g. `new-order-form` ×12, `inventory-view` ×5, `team-management` ×3, `api-keys` ×3, `webhooks` ×2, `tracking` ×1, `wallet/page` ×1).
- `Intl.DateTimeFormat` in `notification-settings-view.tsx:675`.
- Other: `humanise()` duplicates in `freight-index:378`, `courier-thread:148`, `ticket-detail:464`, `parcel-timeline:87`, `hold-reviews-index:377`; `humaniseStatus` in `import-status.tsx:46` and `profile:216`; `wallet-terms-card.tsx:67` `format()`.

**Other `lib` formatters**
- `lib/phone.ts` (`toE164`, `toLocalDigits`, `sanitiseLocal`, `isCompleteLocal`).
- `lib/seller-prefix.ts` (`prefixHint`, `stripSellerPrefix`).
- `lib/server-verdict.ts` (`serverVerdict`, for error text).
