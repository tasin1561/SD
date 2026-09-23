<!-- Phase 0 inventory, read from source on 2026-09-23 (branch feat/apps-premium-restyle, base 9fc408fa). Facts only; the plan is in /APPS-INVENTORY.md. -->

# apps/admin inventory for the visual-only restyle (read-only)

Root: `/home/talha/projects/SD/apps/admin/src`. In the paths below, `(A)` stands for `app/(authed)` and `_c` for `_components`.

- **Size:** 88 `page.tsx` files and about 52.6k lines of TSX under `app/`.
- **Page files are thin.** Almost every one is a server component (no `'use client'`) that renders one client `*-index.tsx`. The only client `page.tsx` files are `(A)/reseller-stores/page.tsx`, `(A)/reseller-stores/[storeId]/page.tsx` and `(A)/reseller-stores/analysis/page.tsx`.
- **Endpoints live in hooks.** Most endpoint strings are in `src/lib/*-hooks.ts`, not in the components. I list the hook-to-endpoint mapping per page.
- **Shared primitives come from `@skydrop/ui/components`:** `Table/THead/Tr/Th/Td/TableEmpty/TablePaginator`, `Modal/ModalFooter/ConfirmDialog`, `LoadingState`, `SkeletonRows`, `ErrorState`, `ErrorNote`, `EmptyState`, `StatusBadge` and its variants, `useToast`, `Money`, `Num`, `Ident`, `Stat`.
- **`LoadingState` is a skeleton**, not a spinner (`packages/ui/src/components/page.tsx:146`, animate-pulse rows). `SkeletonRows` and `Skeleton` are skeletons too.
- **There are no dev routes.** `app/api/[...path]/route.ts` is the same-origin API proxy. `src/middleware.ts` is the auth matcher.

---

## 1. Routes, grouped by sidebar group

The sidebar is defined in `(A)/_components/authed-shell.tsx:96-201` and filtered by `lib/page-access.ts` through `canSeePath`. The chrome is the shared `AppShell`, which carries `OrderOmnisearch` in the header centre and the notification bell.

"S" means a server `page.tsx` that renders a client component. "C" means a client `page.tsx`.

### Operations

| URL | page file | Purpose | S/C → main component |
|---|---|---|---|
| /dashboard | (A)/dashboard/page.tsx | KPI tiles and work queues | S → `dashboard-view.tsx` |
| /system-issues | (A)/system-issues/page.tsx | "Needs a person" issue list | S → `system-issues-index.tsx` |
| /orders | (A)/orders/page.tsx | Cross-seller order list | S → `orders-index.tsx` |
| /orders/[id] | (A)/orders/[id]/page.tsx | Order detail and all order ops panels | S → `orders/_c/order-detail.tsx` |
| /delivery-actions | (A)/delivery-actions/page.tsx | Failed-delivery request queue | S → `delivery-actions-index.tsx` |
| /courier-decisions | (A)/courier-decisions/page.tsx | Pick a carrier for held parcels | S → `courier-decision-index.tsx` |
| /manual-placement | (A)/manual-placement/page.tsx | Parcels needing a manual AWB | S → `manual-placement-index.tsx` |
| /nsa | (A)/nsa/page.tsx | "Needs attention" (stuck) parcels | S → `nsa-index.tsx` |
| /call-center | (A)/call-center/page.tsx | Agent call station | S (has a `PageHeader`) → `call-center-station.tsx` |
| /call-center/queue | (A)/call-center/queue/page.tsx | Supervisor call queue | S → `queue-index.tsx` |
| /reattempt-requests | (A)/reattempt-requests/page.tsx | Seller re-attempt approvals | S → `reattempt-requests-index.tsx` |
| /call-center/agents | (A)/call-center/agents/page.tsx | Agent roster and metrics | S → `agents-index.tsx` |
| /warehouse | (A)/warehouse/page.tsx | Hub with 7 tiles: bins, consignments, receive, printing, pack, handover, rto | S, inline JSX |
| /warehouse/bins | (A)/warehouse/bins/page.tsx | Bin layout, contents, bin ops | S → `bins-index.tsx` (+`bin-contents-overview`, `bin-ops-panel`) |
| /warehouse/bins/[binId] | …/bins/[binId]/page.tsx | One bin's contents | S → `bin-detail.tsx` |
| /warehouse/consignments | …/consignments/page.tsx | Consignment list | S → `consignments-index.tsx` |
| /warehouse/consignments/[id] | …/consignments/[id]/page.tsx | Consignment journey: labels, dispatch, cancel | S → `consignment-panel.tsx` |
| /warehouse/receive | …/receive/page.tsx | Goods-receipt list | S → `receive-index.tsx` |
| /warehouse/receive/[id] | …/receive/[id]/page.tsx | Receiving counts | S → `receive-detail-view.tsx` |
| /warehouse/printing | …/printing/page.tsx | Label and pick-list printing (5 tabs) | S → `printing-station.tsx` |
| /warehouse/pick | …/pick/page.tsx | Single-parcel and serial pick (linked only from printing) | S → `pick-station.tsx` + `force-expire.tsx` |
| /warehouse/pack | …/pack/page.tsx | Pack bench (scan) | S → `pack-station.tsx` + `pack-queue-list.tsx` |
| /warehouse/handover | …/handover/page.tsx | Van handover (scan) | S → `handover-bench.tsx` + `handover-queue.tsx` |
| /warehouse/pickups | …/pickups/page.tsx | Courier pickup requests (linked from handover) | S → `pickups-index.tsx` |
| /warehouse/manifests | …/manifests/page.tsx | Manifest history | S → `manifests-index.tsx` |
| /warehouse/manifests/[id] | …/manifests/[id]/page.tsx | Manifest detail | S → `manifest-detail-view.tsx` + `move-shipment-panel.tsx` |
| /warehouse/rto | …/rto/page.tsx | RTO receive, inspect, finalise (tabs) | S → `rto-station.tsx` |
| /tickets | (A)/tickets/page.tsx | Ticket list | S → `tickets-index.tsx` |
| /tickets/[id] | (A)/tickets/[id]/page.tsx | Ticket detail | S → `admin-ticket-detail.tsx` |
| /holds | (A)/holds/page.tsx | Early-reservation hold reviews | S → `admin-holds-index.tsx` |
| /inventory | (A)/inventory/page.tsx | `redirect('/inventory/adjustments')` | S |
| /inventory/adjustments | …/adjustments/page.tsx | Stock adjustments (prefill via search params) | S (async) → `adjustments-index.tsx` + `new-adjustment-panel.tsx` |
| /inventory/cycle-counts | …/cycle-counts/page.tsx | Cycle counts | S → `cycle-counts-index.tsx` |
| /inventory/movements | …/movements/page.tsx | Stock ledger (`?warehouse=&bin=`) | S (async) → `movements-index.tsx` |
| /inventory/transfers | …/transfers/page.tsx | Stock transfer form | S → `transfers-index.tsx` |
| /inventory-units | (A)/inventory-units/page.tsx | Serial trace and unit discrepancies | S → `unit-triage-index.tsx` + `unit-trace-panel.tsx` |

### Money

| URL | page file | Purpose | S/C → main component |
|---|---|---|---|
| /seller-wallets | (A)/seller-wallets/page.tsx | Wallet overview | S → `seller-wallets-index.tsx` |
| /seller-wallets/[id] | …/[id]/page.tsx | One wallet: ledger, top-ups, withdrawals, holdings | S → `seller-wallet-detail.tsx` + `move-seller-cash-modal.tsx` |
| /settlements | (A)/settlements/page.tsx | Courier COD payouts and reconciliation | S → `settlements-index.tsx` |
| /withdrawals | (A)/withdrawals/page.tsx | Seller withdrawal requests | S → `withdrawals-index.tsx` + `resolve-withdrawal-modal.tsx` |
| /wallet-transfers | (A)/wallet-transfers/page.tsx | Move seller money (`?sellerId=`) | S (async) → `wallet-transfers-index.tsx` |
| /topups | (A)/topups/page.tsx | Seller top-up claims | S → `topups-index.tsx` |
| /reseller-store-wallets | (A)/reseller-store-wallets/page.tsx | Store top-ups and withdrawals (Suspense with `LoadingState`) | S → `reseller-store-wallets-index.tsx` |
| /treasury | (A)/treasury/page.tsx | Bank accounts and book | S → `treasury-index.tsx` + transfer, owner-money and reconcile modals |
| /courier-wallet | (A)/courier-wallet/page.tsx | Courier wallet recharges | S → `courier-wallet-index.tsx` |
| /pnl | (A)/pnl/page.tsx | Profit & loss | S → `pnl-index.tsx` |
| /pnl/carry-forward | (A)/pnl/carry-forward/page.tsx | Month close, lock, carry-forward | S → `carry-forward-index.tsx` |
| /expenses | (A)/expenses/page.tsx | Expenses and investments (2 tabs) | S → `expenses-index.tsx` + 4 modals |
| /expenses/categories | …/categories/page.tsx | Expense categories (not in nav) | S → `expense-categories-index.tsx` |
| /liabilities | (A)/liabilities/page.tsx | "What we owe" | S → `liabilities-index.tsx` |
| /liabilities/instant-pay | …/instant-pay/page.tsx | Instant Pay advances (not in nav) | S (async, search params) → `instant-pay-advances.tsx` |
| /bank-accounts | (A)/bank-accounts/page.tsx | Platform bank accounts | S → `_bank-accounts-panel.tsx` |
| /bank-accounts/history | …/history/page.tsx | Bank account change history (not in nav) | S → `bank-account-history-index.tsx` |
| /remittances | (A)/remittances/page.tsx | Seller remittances | S → `remittances-index.tsx` + `remittance-form-modal` + `payout-instruction-panel` |
| /bank-changes | (A)/bank-changes/page.tsx | Seller bank-change approvals | S → `bank-changes-index.tsx` |
| /freight | (A)/freight/page.tsx | Inbound freight bills | S → `freight-index.tsx` + `freight-actions`, `our-cost-cell`, `record-freight-modal` |
| /margin | (A)/margin/page.tsx | Lane margin | S → `margin-index.tsx` |
| /pricing | (A)/pricing/page.tsx | Pricing preview and charge backfill | S → `pricing-index.tsx` + `charges-backfill-card.tsx` |
| /fx | (A)/fx/page.tsx | FX rates | S → `fx-rates-index.tsx` + history drawer + override modal |

### Network

| URL | page file | Purpose | S/C → main component |
|---|---|---|---|
| /leads | (A)/leads/page.tsx | Invite requests | S → `leads-index.tsx` + `lead-drawer.tsx` |
| /sellers | (A)/sellers/page.tsx | Seller list | S → `sellers-index.tsx` |
| /sellers/[id] | (A)/sellers/[id]/page.tsx | Seller detail (many panels) | S → `seller-detail.tsx` |
| /stores | (A)/stores/page.tsx | Seller stores | S → `seller-stores-index.tsx` |
| /reseller-stores | (A)/reseller-stores/page.tsx | Reseller stores and create | **C** |
| /reseller-stores/[storeId] | …/[storeId]/page.tsx | Store terms, team, wallet, catalogue | **C** (+`catalogue-terms`, `store-wallet-panel`) |
| /reseller-stores/analysis | …/analysis/page.tsx | Fraud flags, disputes, float | **C** (+`pause-store-modal`) |
| /courier-accounts | (A)/courier-accounts/page.tsx | Courier accounts and master switches | S → `courier-accounts-index.tsx` |
| /delhivery | (A)/delhivery/page.tsx | Delhivery ops (status, setup, tracking, wallet import) | S → `delhivery-ops-index.tsx` |
| /shiprocket | (A)/shiprocket/page.tsx | Shiprocket status and connectivity | S → `shiprocket-ops-index.tsx` |
| /cost-sync | (A)/cost-sync/page.tsx | Courier cost and wallet sync | S → `cost-sync-index.tsx` + `shiprocket-cost-section.tsx` |
| /courier-escalation | (A)/courier-escalation/page.tsx | Escalation send queue | S → `courier-escalation-index.tsx` |
| /courier-escalation/threads | …/threads/page.tsx | Conversations (link tab, `escalation-tabs.tsx`) | S → `threads-index.tsx` |
| /courier-escalation/templates | …/templates/page.tsx | Patterns | S → `templates-index.tsx` |
| /courier-escalation/portal | …/portal/page.tsx | Portal worker | S → `portal-index.tsx` |

### System

| URL | page file | Purpose | S/C → main component |
|---|---|---|---|
| /reports | (A)/reports/page.tsx | Report summary | S → `reports-dashboard.tsx` |
| /webhooks | (A)/webhooks/page.tsx | Webhook deliveries | S → `webhook-deliveries-index.tsx` |
| /staff | (A)/staff/page.tsx | Staff and invitations | S → `staff-management-index.tsx` + `invite-staff-modal`, `invite-link-reveal-card` |
| /roles | (A)/roles/page.tsx | RBAC roles | S → `roles-index.tsx` + `role-editor.tsx` |
| /system/capacity | (A)/system/capacity/page.tsx | System limits | S → `capacity-monitor.tsx` |
| /settings | (A)/settings/page.tsx | System settings | S → `settings-index.tsx` + `edit-setting-dialog.tsx` |

### Not in the sidebar

- `/account` → `(A)/account/page.tsx`. It is the identity link and renders `account-security-view` and `session-revocation-card`.
- `/notifications`, `/notifications/broadcasts`, `/notifications/settings` → reached from the bell. Views are `notifications-view`, `broadcasts-view` and `notification-settings-view`.
- `/` → `app/page.tsx` redirects to `/dashboard`.
- `/login` → `app/login/page.tsx`. Server component; redirects to `/dashboard` if already signed in; renders `login-form.tsx`.
- `/auth/accept-invitation`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email` → server pages inside `AuthConsoleShell`, with forms `accept-invitation-form`, `forgot-form`, `reset-form`, `verify-panel`.
- **Layouts:** `app/layout.tsx` (Geist sans and mono local fonts, theme init script), `(A)/layout.tsx` (server; redirects to `/login`; `QueryProvider` + `AuthProvider` + `AuthedShell`), `login/layout.tsx`, `auth/layout.tsx`.
- **Error boundary:** `(A)/error.tsx` (reset or reload button; mono error text at line 88).

---

## 2. Per-page detail

### Legend

- **L** = loading state. `LoadingState` and `SkeletonRows` are both skeletons. "text" means a plain "Loading…" string.
- **E** = empty state (`EmptyState` or `TableEmpty`).
- **Err** = error state (`ErrorState` or `ErrorNote`). "+retry" means a `retry=` prop is present.
- **T** = toasts (`useToast`).
- **Paged** = `TablePaginator` with the page size shown. Anything else is unpaginated and renders the whole API list.

### Status chip conventions

- The `*StatusBadge` components and the `*Kind`/`*Label` functions come from `@skydrop/ui/components` and `@skydrop/ui/status`.
- Local colour maps are named inline in the blocks below.

### Operations

**/dashboard** (`dashboard-view.tsx`)
- Hooks: `useOrdersList` (GET `/api/admin/orders${qs}`, pageSize 1, used for counts), `useReportSummary` (GET `/api/admin/reports/summary${qs}`), `useTicketsList` (GET `/api/admin/tickets${qs(query)}`), `useWithdrawalsList` (GET `/api/admin/withdrawal-requests${qs(query)}`).
- Stat tiles: Awaiting call, Seller decision, To pick, Manual placement, Out of stock, Open tickets, Withdrawal requests, Orders created, Confirmed on call, Delivered, Returned (RTO), Rejected on NDR, Dispatched. Plus a local `MoneyCard` at line 267.
- States: L = `SkeletonRows`/`Skeleton`; Err = `ErrorState` +retry. Tiles hide per permission (tested).

**/system-issues** (`system-issues-index.tsx`)
- GET `/api/admin/system-issues${includeResolved?}`.
- Actions: POST `/{id}/acknowledge`, POST `/{id}/resolve`, POST `/announce-unnotified`.
- Resolve modal "Close this issue" has the field "What was done". T.
- States: L `SkeletonRows`, E, Err +retry.

**/orders** (`orders-index.tsx`)
- `useOrdersList`, `useSellersList` (GET `/api/admin/sellers${qs}`, pageSize 100).
- Search `<form onSubmit>` at line 136, plus filters Search / Status / Source / Seller.
- Table columns: Order # | Recipient | Phone | Status | Source | COD (INR) | Placed. Rows use `Tr onActivate` → `/orders/{id}`.
- Paged 20. Chip `OrderStatusBadge`.
- States: L `LoadingState`, E, Err +retry.

**/orders/[id]** (`order-detail.tsx`, which composes the panels below)
- Detail hooks: `useOrderDetail` (GET `/api/admin/orders/${id}`), `useOrderJourney` (GET `/api/admin/orders/${id}/journey`, rendered by `OrderJourneyPanels`).
- Items table (raw `<table>`): SKU | Product | Qty | Reserved | Weight (g).
- Chips: `OrderStatusBadge` and a local `storeKind`.
- States: L `LoadingState` + `SkeletonRows`, Err ×2 +retry.
- Panels:
  - `order-actions-panel.tsx`: cancel modal (fields "Cancellation reason", "Internal note (optional)") → POST `/orders/${orderId}/cancel`. Also hosts force-mutation, release and restore reservations.
  - `force-mutation-dialog.tsx`: god mode; POST `/force-mutation`.
  - `release-reservations-dialog.tsx`: POST `/release-reservations`; field "Reason (optional)".
  - `restore-reservations-dialog.tsx`: POST `/restore-reservations`.
  - `order-charges.tsx`: GET `/orders/${orderId}/charges`, POST `/charges/compute`. Raw table Charge | Visibility | Amount (INR). SkeletonRows / E / Err +retry.
  - `order-shipments-section.tsx`: GET `/orders/${id}/shipments`. `LoadingState`, Err +retry. Uses `courierLabel`.
  - `courier-ops-panel.tsx`: GET `/api/admin/courier-ops/shipments/${id}/insight` and `/ndr-readiness?action=`. POST `/document?docType=`, `/edit`, `/cancel`, `/cancelled-outside`, `/ewaybill`, `/ndr-action`. Modals "Correct the recipient" (Name, Phone, Address) and "Attach an e-way bill" (Invoice number, E-way bill number). 3 `ConfirmDialog`s. T ×13.
  - `consignee-panel.tsx`: GET `/orders/${id}/consignee` and `/consignee/history`; POST `/consignee` (Name, Phone, Address). T.
  - `manual-placement-panel.tsx`: POST `/api/admin/courier/manual-placement/shipments/${id}/place-awb` (AWB number, Courier, Service type) and `/cancel` (Reason). 2 modals.
  - `manual-scan-panel.tsx`: POST `/api/admin/tracking/shipments/${id}/manual-scan`. Modal "Record a courier scan": What happened, When it happened, City, Why delivery failed, Description.
  - `shipment-cost-panel.tsx`: POST `/api/admin/treasury/shipments/${id}/cost` (Delivery cost (INR), Return cost (INR)).
  - `admin-request-return-dialog.tsx`: POST `/orders/${id}/return` ("Why is it coming back?"). T.
  - `stuck-order-recovery.tsx`: POST `/retry-stock`, `/return-to-pick`. T.
  - `reseller-money-panel.tsx`: GET `/orders/${id}/reseller-money`. 3 tables; `resellerCreditStatusKind`/`Label`.
  - `reseller-order-panel.tsx`: table Line | Qty | Transfer price | Retail | Range | Stock.

**/delivery-actions** (`delivery-actions-index.tsx`)
- GET `/api/admin/delivery-actions${status?}`; POST `/{id}/approve` and `/{id}/reject`.
- Table: Order | Seller | Asked for | Why | State | Decide. Local `statusKind()` at line 57.
- Decide modal "Approve: …" / "Decline this request".
- States: L `LoadingState`, E, Err +retry.

**/courier-decisions** (`courier-decision-index.tsx`)
- GET `/api/admin/courier-decisions`; POST `/shipments/${id}/choose`.
- Table: Order | Destination | Parcel | Waiting | Pick a carrier. Local `waitTone` at line 52.
- States: L `LoadingState`, E, Err +retry.

**/manual-placement** (`manual-placement-index.tsx`)
- GET `/api/admin/courier/manual-placement/queue`.
- Table: Order | Destination | COD | Why it is here | After the waybill | Waiting | Place it. Local `waitTone` at line 57.
- States: L `LoadingState`, E, Err +retry.

**/nsa** (`nsa-index.tsx`)
- GET `/api/admin/nsa`; POST `/nsa/${orderId}/acknowledge`, `/nsa/sweep`.
- Table: Night | Order | Seller | Recipient | AWB | COD | Being chased.
- Modal "Chasing {order}" with "What you found". T.
- States: L `SkeletonRows`, E, Err +retry.

**/call-center** (`call-center-station.tsx`, 1068 lines, plus `customer-risk-strip`, `my-availability`, `my-call-history`)
- `usePullNextCall` POST `/api/agent/calls/next`; `useCurrentCalls` GET `/api/agent/calls/current`; `useRecordCallAttempt` POST `/api/agent/calls/${id}/record-attempt`; `useReleaseCall` POST `/release`; `useServiceabilityCheck` GET `/api/admin/serviceability?pincode=&paymentMode=`.
- Direct calls: GET `/api/agent/settings`, POST `/api/agent/settings/heartbeat` (on `visibilitychange`, line 280-287), PATCH `/api/agent/settings` (availability).
- `useOrderCustomerReputation`: GET `/api/admin/orders/${id}/customer-reputation`.
- `useAgentCallHistory`: GET `/api/agent/calls/history?page=&pageSize=`. Table When | Outcome | Length | Order | Notes; PAGE_SIZE 10.
- Form fields: Outcome, Callback scheduled for, Notes / "What the customer told you".
- T ×3; E present. No loading or error component in the station itself; history has SkeletonRows / E / Err +retry.

**/call-center/queue** (`queue-index.tsx`, `force-outcome-panel.tsx`)
- GET `/api/admin/call-queue${qs}` and `/stats`; POST `/${entryId}/reschedule`, `/reassign`, `/force-outcome`; `useAgents` GET `/api/admin/agents`.
- Table: Order | Waiting since | Available | Calls | Pulls | Assigned to | Status. Rows `onActivate` → order. Paged 25. Local `queueKind` at line 283.
- Modals: "When should this call become callable?" (Callable from, Why); "Move this call to another agent" (Give it to); force outcome "Overrule this call — {order}" (Outcome, Call started, Call ended, Callback scheduled for, Notes).
- States: L SkeletonRows, E, Err +retry.

**/reattempt-requests** (`reattempt-requests-index.tsx`)
- GET `/api/admin/reattempt-requests${status}`; POST `/${id}/approve` or `/reject`.
- Filter Status. Decide modal fields: Extra calls to allow, Note. Rendered as cards, not a table.
- States: L `LoadingState`, E, Err +retry.

**/call-center/agents** (`agents-index.tsx`)
- GET `/api/admin/agents` and `/api/admin/agents/${id}/metrics`; PATCH `/${id}/settings` ("Maximum concurrent calls").
- Tables: Agent | Hours | Languages | Holding | Available; and Outcome | Count | Share.
- Modal is the agent email. States: SkeletonRows, E, Err +retry.

**/warehouse**: static tile hub. No API.

**/warehouse/bins** (`bins-index.tsx`, `bin-contents-overview.tsx`, `bin-ops-panel.tsx`, `warehouse/_components/warehouse-form-panel.tsx`)
- Endpoints:
  - GET `/api/admin/warehouses`, `/${wid}/bins`, `/${wid}/zones`.
  - POST `/zones`, `/bins`; DELETE `/bins/${binId}`; PATCH `/bin-tracking`; POST, PATCH `/api/admin/warehouses`.
  - POST `/bin-ops/move-bin/${src}`, `/bin-ops/bulk-transfer`.
  - GET `/api/admin/bin-contents`.
- Tables:
  - Bins: Bin | Zone | Type | Pickable | On hand.
  - Overview: Product | SKU | Seller | Batch | On hand | Reserved.
  - Bin-ops lines: Seller id | Variant id | Batch id | Qty | From | To.
- Forms:
  - Bins: Zone, Type, Aisle, Rack, Shelf, Code, Name.
  - Warehouse: Code, Name, Status, Country, Timezone, Ships customer orders.
  - Bin ops: Warehouse, From, To.
- Modals: "New zone"; "Turn tracking on/off?"; "Move everything in {bin}?" (`bin-ops-panel.tsx:432`). T.
- States: L `LoadingState`/SkeletonRows, E, Err.

**/warehouse/bins/[binId]** (`bin-detail.tsx`)
- GET `/api/admin/bin-contents/${binId}?page=&pageSize=`.
- Table: Product | SKU | Seller | Batch | On hand | Reserved | Last moved | Adjust. Paged 50.
- States: SkeletonRows, E, Err +retry.

**/warehouse/consignments** (`consignments-index.tsx`)
- GET `/api/admin/consignments${qs}` and sellers.
- Filters Status / Route / Seller. Table: Consignment | Seller | Route | Status | Legs | Announced. Paged 20. `consignmentStatusKind`.
- States: L `LoadingState`, E, Err +retry.

**/warehouse/consignments/[id]** (`consignment-panel.tsx`, `label-reprint-requests.tsx`, `label-sheet.tsx`, `steps.tsx`)
- Endpoints:
  - GET `/api/admin/consignments/${id}`, `/events`, `/labels`, `/${key}/freight-mode`.
  - PATCH `/labelling-site`, `/freight-mode`.
  - POST `/labels/print`, `/labels/reprint-requests`, `/dispatch`, `/cancel`.
  - Reprint queue: GET `/labels/reprint-requests`; POST `…/reprint-requests/${rid}/approve`, `/reject`, `/print`.
- Fields: Labelling station (Select), Serials to reprint, Why, per-line "Units of {sku} leaving" (number), Expected arrival in India (date), Forwarder reference, freight-mode Select.
- Cancel modal (tone critical, field "Why"). `label-sheet.tsx` prints via `window.print()`.
- Chips `consignmentStatusKind`, `labelReprintStateKind`. T ×8.
- States: L `LoadingState`, Err +retry.

**/warehouse/receive** (`receive-index.tsx`)
- GET `/api/admin/goods-receipts${qs}`, sellers, warehouses.
- Filters: seller, warehouse. Table: Receipt | Consignment | Seller | Status | Products | Declared | Last update. Rows `onActivate`. Paged 20.
- States: L `LoadingState`, E, Err +retry.

**/warehouse/receive/[id]** (`receive-detail-view.tsx`)
- GET `/api/admin/goods-receipts/${id}`; POST `/start-receiving`, `/lines`, `/complete`, `/cancel`.
- Also GET `/api/admin/warehouse/printing/sku-labels/goods-receipt/${id}` and warehouse bins.
- Per line: Received qty, Damaged, Putaway bin, SerialScanner (STRICT SKUs).
- Header buttons: Start receiving, Cancel receipt, Print product labels, Record all products, Complete. Cancel modal field "Why". T ×6.
- States: L `LoadingState "Loading…"`, Err +retry.

**/warehouse/printing** (`printing-station.tsx`, `selection-table.tsx`)
- Tabs are 5 `Button`s (lines 84-102, not `role=tab`): Shipping labels, Reprint a label, Picking list, Past batches, Find a product.
- Endpoints:
  - GET `/api/admin/warehouse/printing/label-queue`, `label-reprint-queue`, `pick-queue`, `pick-batches${qs}`, `product-locations?q=`, `sku-labels/history`.
  - POST `labels/build`, `labels/confirm-printed`, `labels/reprint`, `pick-batches`, `…/build-list`, `…/confirm-printed`, `…/cancel`, `…/mark-picked`, `sku-labels/variants`.
- Tables:
  - `SelectionTable`: checkbox | Order | Courier | AWB | Destination | COD | Items | Printed.
  - Batches: Batch | Status | Warehouse | Parcels | Created | Printed | Actions.
  - History: When | Who | Stickers | From | Total.
- Modals "Did the labels print?" and "Did the picking list print?". PDFs go through `lib/print-pdf.ts` (iframe print / download). T ×9.
- States: L `LoadingState` ×7, E, Err +retry ×6.

**/warehouse/pick** (`pick-station.tsx`, `force-expire.tsx`)
- POST `/api/warehouse/picks/next`, `/${id}/start`, `/${id}/items`, `/${id}/complete`; POST `/api/admin/warehouse/picks/${id}/expire`.
- Per line: SerialScanner (STRICT), Bin, Batch, Record button.
- Force-expire modal "Release a stuck pick claim" (Shipment id). T ×5; E.

**/warehouse/pack** (`pack-station.tsx`, `pack-queue-list.tsx`): see §4 for the scan field.
- GET `/api/warehouse/packs/queue`; POST `/boxes/open`, `/boxes/${id}/scan`, `/close`, `/cancel`, `/packs/${id}/complete`, `/force-complete`; GET `/api/admin/courier/scan-block`.
- Refusal modal (critical). T ×5.
- Queue list states: SkeletonRows, E, Err +retry.

**/warehouse/handover** (`handover-bench.tsx`, `handover-queue.tsx`)
- POST `/api/admin/courier/handover-scan`; GET `/api/admin/courier/scan-block` and `/handover-queue`.
- Running list of scanned parcels; `StatusBadge kind="draft" "already gone"`. Refusal modal.
- Queue states: SkeletonRows, E, Err +retry.

**/warehouse/pickups** (`pickups-index.tsx`)
- GET `/api/admin/courier-ops/pickups`; POST (raise); PATCH `/${id}` (close); POST `/${id}/release-day`.
- Table: Date | Warehouse | Time | Parcels | Status | Actions. Local `pickupKind` at line 44.
- Modals "Request a pickup" (Courier, Warehouse, Date, Time, Parcels to hand over) and "Free this day…?" (critical, Reason). T.
- States: SkeletonRows, E, Err +retry.

**/warehouse/manifests** (`manifests-index.tsx`)
- GET `/api/admin/warehouse/manifests${qs}`.
- Table: Manifest | Status | Courier | Shipments | Created | Closed. `onActivate`. Paged 25.
- States: `LoadingState`, E, Err +retry.

**/warehouse/manifests/[id]** (`manifest-detail-view.tsx`, `move-shipment-panel.tsx`)
- GET `/manifests/${id}`; POST `/manifests/${id}/close`; POST `/api/admin/courier/manifests/${id}/confirm-handoff`; POST `/api/admin/warehouse/shipments/${id}/move-manifest`.
- Table: Shipment | Status | Order | Packed. 2 `ConfirmDialog`s.
- Move modal fields: Shipment, Target manifest. T.
- States: `LoadingState`, E, Err +retry.

**/warehouse/rto** (`rto-station.tsx`, `rto-tabs.tsx`, `awaiting-returns.tsx`, `open-returns.tsx`, `rto-item-row.tsx`, `putaway-panel.tsx`)
- Tabs: `role="tablist"`/`role="tab"`, stored in URL `?tab=`: At our door / Still with the courier / On the bench / Receive & inspect. Count badges.
- Endpoints: GET `/api/warehouse/rto/awaiting-receipt`, `/shipments`, `/shipments/${id}`, `/shipments/${id}/putaway`; POST `/receive`, `/items/${id}/inspect`, `/shipments/${id}/finalize`, `/putaway`.
- Tables: Parcel | Order | Items | Courier says | Waiting (local `waitTone`); Parcel | Seller | Received | Items | Open.
- Item row: Condition, What happens to it, Notes, split rows (Units / Condition / What happens to them / Notes).
- States: loading is a text card ("Loading shipment…"); error is an inline critical div with no retry; E "No shipment selected". T ×3.

**/tickets** (`tickets-index.tsx`)
- GET `/api/admin/tickets${qs}`. Search "Search tickets".
- Table: Ticket | Type | Handling | Subject | Order | Status | Refund | Raised. `onActivate`. Paged 25. `TicketStatusBadge`, `TicketHandlingBadge`.
- States: SkeletonRows, E, Err +retry.

**/tickets/[id]** (`admin-ticket-detail.tsx`, `admin-ticket-conversation.tsx`, `ticket-courier-panel.tsx`, `store-dispute-settle.tsx`)
- GET `/api/admin/tickets/${id}` and `/events`; PATCH `/tickets/${id}` (Move to, How, Refund (INR), Notes).
- POST `/notes`, `/events/${eid}/relayed`, `/store-dispute-settlement` (Who pays, Amount (INR), Note; ConfirmDialog).
- Courier escalation: GET `by-ticket/${id}`, `escalations/${id}`; POST `tickets/${id}/open`, `…/reply`, `…/inbound`, `outbox/${id}/mark-sent`.
- Chips: `TicketStatusBadge`, local `disputeKind`, `MessageRelayStatus`.
- States: SkeletonRows, Err +retry. T.

**/holds** (`admin-holds-index.tsx`)
- GET `/api/admin/early-reservation-reviews${qs}`.
- Table: Seller | Order | Units | Calls | Age | Status (`EarlyReviewStatusBadge`).
- States: SkeletonRows, E, Err +retry.

**/inventory/adjustments** (`adjustments-index.tsx`, `new-adjustment-panel.tsx`)
- GET `/api/admin/stock-adjustments${qs}`; POST create, `/${id}/approve`, `/${id}/reject`.
- Tables: Raised | Type | Reason | Lines | Value impact | Status; detail lines Variant | Bin | Batch | Qty change | Unit cost. Paged 25. Local `adjustmentKind` at line 202.
- Create modal "Raise a stock adjustment": Seller id, Direction, Quantity, Reason, Variant id, Bin id, Batch id, What happened.
- States: SkeletonRows, E, Err +retry.

**/inventory/cycle-counts** (`cycle-counts-index.tsx`)
- GET `/api/admin/cycle-counts${qs}`; POST create, `/${id}/start`, `/${id}/items`, `/${id}/complete`.
- Stats: Counts shown, In progress, Discrepancies found.
- Tables: Date | Type | Warehouse | Items | Discrepancies | Value | Status (local `countKind` at line 185); detail Variant | Bin | System | Counted | Difference | Notes. Paged 25.
- Modals: "Schedule a cycle count" (Warehouse, Scope, Count date); "Cycle count" (Variant id, Counted quantity, Bin id, Batch id, Notes).
- States: SkeletonRows, E, Err +retry.

**/inventory/movements** (`movements-index.tsx`)
- GET `/api/admin/stock-movements${qs}`. Filters: Variant id, Warehouse, Bin, Type.
- Table: When | Type | Variant | Bin | Change | After | Reason | Caused by. Paged 50.
- States: SkeletonRows, E, Err +retry.

**/inventory/transfers** (`transfers-index.tsx`)
- POST `/api/admin/stock-transfers`.
- Form: Seller id, Variant id, Quantity, source Warehouse / Bin id / Batch id, destination Warehouse / Bin id / Batch id, Note.
- Err only. No table.

**/inventory-units** (`unit-triage-index.tsx`, `unit-trace-panel.tsx`)
- GET `/api/admin/stock-units/triage`, `/discrepancies/${sellerId}`, `/trace/${sellerId}/${serial}`.
- Tables: Seller | Stuck | Unresolved dispatch | Count mismatch | Total | Their thresholds; SKU | Warehouse | Serials | On hand | Difference; Serial | SKU | Status | In status | Last scan; trace When | Moved | Gate | Parcel | Note. `StockUnitStatusBadge`.
- States: SkeletonRows, E, Err +retry.

### Money

**/seller-wallets** (`seller-wallets-index.tsx`)
- GET `/api/admin/seller-wallets`; POST `/seller-wallets/reconcile` ("Re-check ledgers"); `useFxRatesList`.
- Filter "Filter wallets". Table: Seller | Available balance | Requested out | Awaiting review | Last movement | Status | Actions. Local `Bdt`, `MoneyTile`.
- States: `LoadingState`, E, Err +retry. T.

**/seller-wallets/[id]** (`seller-wallet-detail.tsx`, `move-seller-cash-modal.tsx`)
- GET `/seller-wallets/${id}`, `/entries`, `/topups`, `/withdrawals`; GET `/api/admin/treasury/sellers/${id}/holdings`; `useInstantPayAdvances`.
- Tabs: Buttons with `aria-current`: ledger / topups / withdrawals.
- Tables: When | Type | Linked | Amount | Balance after; When | Amount | Status | Note.
- Move-cash modal POST `/api/admin/treasury/accounts/${id}/reclassify-seller-cash` (Which way, Amount, Worth to their wallet (INR), Why the bank book was wrong).
- States: `LoadingState`, E, Err +retry.

**/settlements** (`settlements-index.tsx`, `record-settlement-modal.tsx`, `allocate-settlement-modal.tsx`)
- GET `/api/admin/courier-settlements${qs}` (limit 50) and `/reconciliation`; POST create, `/preview-remittance`, `/${id}/allocate`.
- Tables: Reference | Received | Amount | Allocated | Unallocated | Orders; Order | Delivered | Age | Expected | Settled | Shortfall (`onActivate`).
- Record form: Courier account, Received on, Payout reference (UTR), Amount received (INR), Early-COD fee, Freight from COD, RTO reversal, Note, order lines, reversed lines.
- Allocate form: Order ID / Settled (INR) rows.
- States: SkeletonRows, E, Err +retry. T.

**/withdrawals** (`withdrawals-index.tsx`, `resolve-withdrawal-modal.tsx`)
- GET `/api/admin/withdrawal-requests${qs}`; PATCH `/${id}/approve`, `/reject`, `/paid`.
- Table: Requested | Seller | Amount | They receive | Wallet balance | Source | Status | Actions. Paged 25. `WithdrawalStatusBadge`.
- Resolve modal fields: Remittance ID, Reason.
- States: SkeletonRows, E, Err +retry. T.

**/wallet-transfers** (`wallet-transfers-index.tsx`)
- GET `/api/admin/wallet-transfers/sellers?q=`, `/sellers/${id}`, `/wallet-transfers[?sellerId]`; POST `/preview`, POST `/wallet-transfers`.
- Form: Find a seller, Which way, Amount (₹), From which of our rupee accounts, Reason, Internal note.
- Tables: preview Account | Moving | Theirs: before → after | Ours: before → after; history When | Seller | Amount | Wallet after | Reason (seller sees) | Internal note | By | Cash.
- Confirm modal "Post this transfer?". States: SkeletonRows, E, Err +retry ×3.

**/topups** (`topups-index.tsx`)
- GET `/api/admin/wallet/topups${status}`, `/${id}/proof-url`; POST `/${id}/accept`, `/reject`.
- Table: Claimed | Seller | Paid into | Amount | Evidence | Status | Review. Label via `topupStatusLabel` (tested "Waiting for review").
- Modal fields: Note / Reason. States: `LoadingState`, E, Err +retry. T.

**/reseller-store-wallets** (`reseller-store-wallets-index.tsx`)
- GET `/api/admin/reseller-store-wallets/topups?`, `/withdrawals?`, `/stores/${id}`; POST `topups/${id}/accept|reject`, GET `topups/${id}/proof`; POST `withdrawals/${id}/approve|reject|pay`; `usePlatformBankAccounts`.
- Tables: Claimed | Store · seller | Paid into | Amount | Evidence | Status | Review; Asked | Store · seller | Pay to | Amount | Status | Act. `TopupStatusBadge`, `WithdrawalStatusBadge`.
- 4 modals. Pay form: Paid from, Bank reference, Paid on.
- States: `LoadingState`, E, Err +retry. T ×6.

**/treasury** (`treasury-index.tsx`, `transfer-modal.tsx`, `owner-money-modal.tsx`, `reconcile-modal.tsx`)
- GET `/api/admin/treasury/overview`, `/entries?` (limit 50); POST `/entries/${id}/mark-opening-balance`, `/transfers`, `/accounts/${id}/owner-money`, `/accounts/${id}/reconcile`.
- Tables: Account | Purpose | Settles from | Ours | Held for sellers | Total | Actions; When | Account | What | Whose | Amount | Opening balance. Local `ownerKind`.
- Transfer form: From, To, Left, Arrived, Whose money, Rate quoted to the seller, When, Reference, Note.
- Owner money: Which way, Amount, On, What it was for, Bank reference.
- Reconcile: Whose balance, What the statement says, Worth to their wallet (INR), Why the book was wrong.
- States: `LoadingState`, E, Err +retry.

**/courier-wallet** (`courier-wallet-index.tsx`)
- GET `/api/admin/courier-wallet/accounts`, `/recharges`, `/unmatched-payments`; POST `/recharges/${id}/record-bank-side`, `/resolve`, `/payments`.
- Tables: Paid from | Reference | When | Amount; Account | Balance | Last read | Unreconciled; Their recharge | Bank reference | When | Amount | State. Local `matchTone` at line 60.
- 3 modals: "Which account paid for this?", "This recharge was not paid for by us", "Record a wallet top-up" (Wallet topped up, Paid from, Amount (₹), Date paid, Bank reference).
- States: `LoadingState`, E, Err +retry.

**/pnl** (`pnl-index.tsx`)
- GET `/api/admin/treasury/pnl${qs}`, `/pnl/lines/${key}/items`. Filters From / To.
- Raw `<table>`: Source | Revenue | Cost | Margin | % | Measured; Reference | Date | Revenue | Cost.
- States: `LoadingState`, Err +retry.

**/pnl/carry-forward** (`carry-forward-index.tsx`, 1225 lines)
- GET `/api/admin/treasury/pnl-periods`, `/${m}`, `/${m}/lines/${line}/rows`, `/pnl-carry-forwards?`, `/${m}/nightly-jobs`; POST `/${m}/lock-permanently`, `/god-mode-relock`, `/close`, `/backfill-close`.
- Forms: Month, Why it is being locked now, Justification (≥30), "Type {month} to confirm", Why it is being closed by hand, Through month, Why these months are being closed.
- 4 raw-table families (Version / How / When / Who / Reason / Net…; Line / Revenue / Cost / Margin; Month / Net / Note; Record / What changed / Found…).
- 3 modals and 1 ConfirmDialog. States: `LoadingState`, E, Err +retry.

**/expenses** (`expenses-index.tsx` + `expense-modal`, `investment-modal`, `investment-return-modal`, `category-modal`)
- Tabs: `role="tablist"` with local `TabButton`: spending / investments.
- GET `/api/admin/treasury/entries` (limit 200), `/expense-categories`, `/investments`, `/inbound-freight?search=`; POST `/inbound-freight/${id}/attribute-expense`, `/treasury/entries`, `/investments`, `/investments/${id}/return`, `/inbound-freight/${id}/pay-forwarder`.
- Tables: When it moved | Category | Paid from | Amount | Reference | Recorded by | Consignment; What | With | Placed | Returned | Net | State | Actions.
- Forms:
  - Expense: Paid from, Category, Amount, When, Reference, Note, Attributed to, Link to a consignment.
  - Investment: What, With whom, From account, Principal, Placed on, Note.
  - Return: Into account, Amount, Received.
- States: `LoadingState`, E, Err +retry.

**/expenses/categories** (`expense-categories-index.tsx`)
- GET, POST and PATCH `/treasury/expense-categories`. Table: Code | Name | What goes here | State | Actions.
- Retire/restore modal. States: `LoadingState`, E, Err +retry.

**/liabilities** (`liabilities-index.tsx`)
- GET `/api/admin/treasury/liabilities`. Tables: What | Amount | Items; Seller | Owes | What for | Stock held (at cost) | Cover.
- States: `LoadingState`, E, Err +retry.

**/liabilities/instant-pay** (`instant-pay-advances.tsx`)
- GET `/treasury/instant-pay-advances${qs}`. Filters Seller / Courier account.
- Table: Order | Seller | Owed by | Credited | Fronted from.
- States: `LoadingState`, E, Err +retry.

**/bank-accounts** (`_bank-accounts-panel.tsx`)
- GET, POST, PATCH and DELETE `/api/admin/platform-bank-accounts[/${id}]`.
- Table: Label | Bank | Account | Currency | Offered | Actions.
- Modal form: Label, Bank name, Account holder, Account number, IFSC / SWIFT, Branch, District, Routing number, Currency, Order, Balance today, What it is for, Transfer instructions.
- States: SkeletonRows, E, Err +retry. T.

**/bank-accounts/history**: GET `/platform-bank-accounts/history`. Table When | What | Changed | By. States: `LoadingState`, E, Err +retry.

**/remittances** (`remittances-index.tsx`, `remittance-form-modal.tsx`, `payout-instruction-panel.tsx`)
- GET `/api/admin/remittances${qs}` (pageSize 50) and withdrawals; POST `/api/admin/remittances`; GET `/remittances/seller/${id}/balance`; POST `/sellers/${id}/bank-account/reveal`.
- Raw `<table>` ×2: Seller | Amount | They receive | Wallet balance | Waiting; Paid at | Seller | Source | Destination | Paid from | Bank ref | FX.
- Form (`<form onSubmit>`): Seller, Wallet currency, Bank currency, Source amount, FX rate, Destination amount, Paid from, Bank fee, Bank reference, Paid at, Note.
- States: SkeletonRows, E, Err +retry.

**/bank-changes** (`bank-changes-index.tsx`)
- GET `/api/admin/bank-change-requests${qs}`; POST `/${id}/approve`, `/reject`.
- Table: Field | On file now | Proposed. Modal field "Reason the seller will read".
- States: `LoadingState`, E, Err +retry.

**/freight** (`freight-index.tsx`, `freight-actions.tsx`, `our-cost-cell.tsx`, `record-freight-modal.tsx`)
- GET `/api/admin/inbound-freight${qs}`, `/${id}/cost-breakdown`; POST create, `/${id}/settle`, `/void`, `/waive`, `/our-cost`, `/pay-forwarder`.
- Tables: Consignment | Mode | Bill | Our cost | Recovered | Outstanding | Units | Status | Actions; Product | Units | Weight | Rate | Per unit | Line. `FreightStatusBadge`.
- Record-freight modal has a raw `<table>`. Fields: Which stop is being billed, Agreed in, Mode, Note.
- States: SkeletonRows, E, Err +retry.

**/margin** (`margin-index.tsx`)
- GET `/courier-ops/margin-report?limit=`, `/stored?limit=`. "Sample size" control.
- Table: Shipment | Lane | Billed | Actual cost | Margin | Card drift. `onActivate`.
- States: SkeletonRows, E, Err +retry.

**/pricing** (`pricing-index.tsx`, `charges-backfill-card.tsx`)
- POST `/api/admin/pricing/preview` (Seller id, Destination pincode, Weight (grams), Declared value (₹), Payment, COD amount (₹), Courier). Table Line | Amount.
- Backfill: POST `/api/admin/orders/charges/backfill`, `/api/admin/wallets/charges/bill-unbilled`. ConfirmDialog.

**/fx** (`fx-rates-index.tsx`, `fx-history-drawer.tsx`, `fx-override-modal.tsx`)
- GET `/api/admin/fx-rates`, `/history/${from}/${to}`; PATCH `/fx-rates` (`<form onSubmit>`: Current rate, New rate, Reason ≥ 10 chars).
- Raw `<table>`: Pair | Rate | Source | Fetched | Actions; history When | Rate | Previous | Source | Reason. The "drawer" is a `Modal`.
- States: `LoadingState`, Err +retry.

### Network

**/leads** (`leads-index.tsx`, `lead-drawer.tsx`)
- GET `/api/admin/invite-leads${qs}`; PATCH `/${id}`; invitations GET, POST, `/resend`.
- Table: Company | Contact | Route | Volume | Status | Waiting. Rows `onActivate` → drawer (a `Modal`: Status, Internal notes). `inviteLeadStatusKind`.
- States: `LoadingState`, E, Err +retry.

**/sellers** (`sellers-index.tsx`, `invitations-panel.tsx`, `create-invitation-dialog.tsx`)
- GET `/api/admin/sellers${qs}`; invitations GET `?status=pending`, POST, `/resend`, DELETE.
- Table: Company | Code | Contact | Email | Status | Approved | Created. `onActivate`. Paged 20. `SellerStatusBadge`.
- Invite `<form>` field: Email address.
- States: `LoadingState`, E, Err +retry.

**/sellers/[id]** (`seller-detail.tsx` plus these panels)
- `status-action-panel`: PATCH `/sellers/${id}/status`.
- `identity-correction-panel`: PATCH `/identity` (Company name, Phone, Reason).
- `restriction-panel`: GET, POST `/restriction`, POST `/restriction/${rid}/lift` (Lifts automatically at balance (₹), Reason).
- `seller-settings-section`: GET `/sellers/${id}/settings`, PUT or DELETE `/settings/${key}`. Table Setting | In effect | System default | Source; `HasOverrideBadge`.
- `credit-after-confirmation-panel`: GET, PUT `/reseller-credit-after-confirmation` (Why).
- `seller-courier-links-section`: GET, POST, PATCH, DELETE `/sellers/${id}/courier-accounts`. Table Account | Courier | Weight | Share | State | Actions.
- `bulk-dequeue-panel`: POST `/api/admin/call-queue/bulk-dequeue` (Reason).
- Initials: PATCH `/initials`. Bank reveal: POST `/bank-account/reveal`.
- States: `LoadingState`, Err +retry.

**/stores** (`seller-stores-index.tsx`)
- GET `/api/admin/seller-stores${qs}`; POST `/sellers/${sid}`; PATCH `/${storeId}`; POST `/make-default`; PATCH `/active`.
- Table: Store | Orders | State | Actions. Modal fields: Name, Note.
- States: `LoadingState`, E, Err +retry.

**/reseller-stores** (client `page.tsx`)
- GET `/api/admin/reseller-stores${qs}`; POST create (`<form onSubmit>` at line 238: Seller, Find the seller, Store name, Name customers see, Contact email, Contact phone, Note for the seller).
- Table: Store | Seller | Status | Opened by | Wallet | Team | Created. `ResellerStoreStatusBadge`.

**/reseller-stores/[storeId]** (client)
- GET `/reseller-stores/${id}`, `/terms`, `/catalogue`, store-wallet and `/entries`.
- Tables: Fee | Store pays | Seller pays | Example; Version | Published | Accepted | Note; When | What | From → to | By | Note; Name | Email | Role | State; catalogue Product | Sold | Transfer price | Stock | Available (real) | Store sees; wallet When | What | Amount | Balance after.
- `PauseStoreModal`. States: `LoadingState`, `ErrorState` +retry, `EmptyState` "No terms published".

**/reseller-stores/analysis** (client)
- GET `/reseller-analysis/fraud-flags`, `/disputes`, `/float`; POST `/stores/${id}/pause`.
- Tables: Store | Signal | Why | Ticket; Store | Order | Status | Opened; Seller / store | Wallet | Credited before payout | Instant Pay advanced. `ticketStatusKind`/`Label`, `resellerStoreStatusLabel`.

**/courier-accounts** (`courier-accounts-index.tsx`, `courier-master-switches.tsx`, create, edit and portal-login modals)
- GET `/api/admin/couriers`; PATCH `/couriers/${code}`; GET, POST, PATCH `/courier-accounts`; POST `/${id}/credential-fields`.
- Table: Label | Courier | Environment | Pickup location | State | Actions.
- Create form: Courier code, Environment, Label, Pickup location name, Notes, credential name/value rows.
- Edit form: Label, Pickup location name, COD payouts land in, Notes.
- Portal login: Email, Password, Company.
- States: SkeletonRows, E, Err +retry. T.

**/delhivery** (`delhivery-ops-index.tsx` + `account-setup-panel`, `tracking-lookup-panel`, `tracking-poll-panel`, `wallet-import-panel`)
- GET `/api/admin/delhivery/status`, `/connectivity`; POST `/waybill-pool/refill`; POST, PUT `/courier-ops/warehouses`; POST `/tracking/poll/lookup`, GET `/tracking/poll/health`, POST `/tracking/poll/run`; POST `/courier/wallet-import/delhivery`.
- Tables: Endpoint | Remaining | Budget | Headroom; Courier time (theirs) | Stored as (UTC) | Leg | Status | NSL | We read it as.
- Setup form: Pincode, Warehouse name, Type the name again, Phone, Address, City, Email, Return address, Return city, Return pincode, Return state.
- States: SkeletonRows, Err +retry. T.

**/shiprocket** (`shiprocket-ops-index.tsx`)
- GET `/api/admin/shiprocket/status`, `/connectivity?from=&to=` (From pincode, To pincode).
- Tables: Account | Pickup location | Wallet | Read; Parcel | Waybill | Carrier | Status | Booked.
- States: SkeletonRows, E, Err +retry.

**/cost-sync** (`cost-sync-index.tsx`, `shiprocket-cost-section.tsx`)
- GET `/api/admin/courier-portal/wallet-sync`, POST `/run`; GET `/courier-cost/shiprocket`, POST `/run`, `/wallet-sync`, `/invoice-check`, `/portal-probe`.
- Tables: When | Result | Window | Costs written | Export total; Invoice | Type | Date | Amount | Against the wallet | Dispute by; Order | AWB | Their status | Charged so far (estimate) | Final bill | Recorded cost (wallet) | Last read.
- Local `runTone`. `RefreshCw animate-spin` on run buttons.
- States: `LoadingState`, E, Err +retry.

**/courier-escalation** (+ threads, templates, portal; shared link-tabs in `escalation-tabs.tsx`: Send queue / Conversations / Patterns / Portal worker)
- Send queue: GET `/courier-escalation/outbox`, `/channel`, `/taxonomy`; POST `outbox/${id}/claim|mark-sent|release`, `/reconcile`, `channel/mode/request`, `mode/confirm` (six-digit code input), `channel/pause`, `/resume`. Table Parcel | Message | Status | Actions.
- Threads: GET `/escalations`, `/escalations/${id}`; POST `/reply`, `/inbound`. Local `stateKind`.
- Templates: GET `/template-candidates`, `/templates`; POST `/promote`, `/reject` (Code, Means, Action, Order, Pattern).
- Portal: GET `/portal-runs`; POST `channel/portal-mode` ("Reason for going live"). Local `outcomeKind`.
- States: SkeletonRows, E, Err +retry. T.

### System

**/reports** (`reports-dashboard.tsx`)
- GET `/api/admin/reports/summary${qs}`. Raw `<input type="date">` ×2 for the range.
- Stat tiles: Created, Confirmed, Delivered, RTO initiated, Cancelled, Rejected (NDR), Confirm/Delivery/NDR/RTO rate, Dispatched, Avg hours to dispatch, Avg days to delivery, COD collected, Charges debited, Remittances paid, Net outstanding.
- States: SkeletonRows ×4, Err +retry.

**/webhooks** (`webhook-deliveries-index.tsx`)
- GET `/api/admin/webhook-deliveries${qs}` (pageSize 100); POST `/${id}/retry`.
- Raw `<table>`: When | Seller | Event | URL | Attempt | Status | HTTP | Time | Action. Local `statusColor` at line 164.
- States: `LoadingState`, Err +retry. T.

**/staff** (`staff-management-index.tsx`, `invite-staff-modal.tsx`, `invite-link-reveal-card.tsx`)
- GET `/api/admin/staff/users`, `/invitations`; PATCH `/users/${id}/role`; DELETE `/users/${id}`; POST, POST `/resend`, DELETE invitations; GET `/api/admin/staff-roles`.
- Raw `<table>` ×2: Email | Role | Last login | Created | Actions; Email | Role | Status | Expires | Actions.
- Invite `<form>`: Email, Role. States: `LoadingState`, Err +retry. T.

**/roles** (`roles-index.tsx`, `role-editor.tsx`)
- `/api/admin/staff-roles` (GET `/catalogue`, GET, POST, PATCH `/${id}`, DELETE `/${id}`).
- Table: Role | Covers | People | Actions. Editor modal: Name, What this role is for, "Search permissions", permission checkboxes.
- ConfirmDialog for delete. States: `LoadingState`, Err +retry.

**/system/capacity** (`capacity-monitor.tsx`): GET `/api/admin/system/capacity`. States: `LoadingState`, Err +retry.

**/settings** (`settings-index.tsx`, `edit-setting-dialog.tsx`)
- GET `/api/admin/system-settings`, `/${key}`; PATCH `/${key}` (`<form onSubmit>`: Value / Value (JSON) / Currency).
- Grouped cards, no table. Local `valueTypeKind` at line 133.
- States: `LoadingState`, E, Err +retry.

### Unlisted pages

- **/account:** `useAccountIdentity` (`client.meStaff()`), POST `/api/auth/staff/email-verification/request`, POST `/api/auth/staff/logout-all` (ConfirmDialog). `LoadingState`, Err +retry. T.
- **/notifications:** `/api/admin/notifications` (GET feed with cursor, POST `/${id}/read`, `/read-all`, `/${id}/unread`, DELETE `/${id}`, DELETE all). SkeletonRows only.
- **/notifications/broadcasts:** POST `/broadcasts/preview`, POST `/broadcasts`, GET `/broadcasts`. Form: Who it reaches, Title, Message. Table: Sent | Title | Reached | Delivered | Failed | Status.
- **/notifications/settings:** GET `/topics`, `/subscriptions`; POST `/subscriptions`; DELETE `/subscriptions/${topic}`. SkeletonRows.
- **/login:** `client.login()`. Raw inputs `#email` and `#password` with `telemetry` labels.
- **/auth/*:** POST `/api/auth/staff/password-reset/request`, `/password-reset/confirm`, `/email-verification/confirm`, and raw `fetch('/api/auth/staff/accept-invitation')`.

---

## 3. Money-moving or irreversible actions and their confirms

"Modal" means the action happens from the modal's submit button; the modal acts as the confirm step.

### Wallets and cash

| Action | Where | Endpoint | Confirm? What it restates |
|---|---|---|---|
| Accept seller top-up | topups-index.tsx:264 | POST `/wallet/topups/${id}/accept` | Modal titled `Credit {currency} {amount}?` plus "adds the money… not reversible without an adjusting entry" |
| Reject top-up | same | POST `/reject` | Modal "Reject this claim?" (critical); reason required |
| Approve withdrawal | withdrawals-index.tsx:293-310 | PATCH `/withdrawal-requests/${id}/approve` | **No confirm.** One click from the table row (toast only) |
| Reject withdrawal / mark paid | resolve-withdrawal-modal.tsx | PATCH `/reject`, `/paid` | Modal "Resolve withdrawal request"; restates Amount (`Money`) and status badge. Remittance ID or reason |
| Accept store top-up | reseller-store-wallets-index.tsx:288 | POST `…/topups/${id}/accept` | Modal `Credit {formatInr(amount)} to {store}?` |
| Approve store withdrawal | :458 | POST `…/withdrawals/${id}/approve` | Modal `Approve paying {store} {amount}?` plus payee, bank, account and IFSC |
| Reject store withdrawal | :506 | POST `/reject` | Modal "Reject this withdrawal?" (critical) |
| Pay store withdrawal | :592 | POST `/pay` | Modal `Record paying {store} {amount}`, restating payee and bank |
| Wallet transfer (credit/debit a seller) | wallet-transfers-index.tsx:377 | POST `/wallet-transfers/preview`, then POST `/wallet-transfers` | Preview table (before → after), then Modal "Post this transfer?" with a restating sentence (`data-testid="wallet-transfer-sentence"`) |
| Re-check seller ledgers | seller-wallets-index.tsx:143 | POST `/seller-wallets/reconcile` | No confirm |
| Reclassify seller cash | move-seller-cash-modal.tsx:90 | POST `/treasury/accounts/${id}/reclassify-seller-cash` | Modal titled with the holding label; amount and reason fields |
| Seller remittance (debits wallet) | remittance-form-modal.tsx:261 | POST `/api/admin/remittances` | Modal form "Record remittance"; the description states it debits the wallet. No separate confirm |
| Store dispute settle | store-dispute-settle.tsx:141 | POST `/tickets/${id}/store-dispute-settlement` | ConfirmDialog "Settle this dispute?" (restates who pays and amount) |
| Ticket refund on transition | admin-ticket-detail.tsx | PATCH `/tickets/${id}` (Refund (INR)) | No separate confirm |
| Charge un-billed orders | charges-backfill-card.tsx:202 | POST `/wallets/charges/bill-unbilled` | ConfirmDialog `Charge N orders?`, restating the count and total `Money`, "debits real seller balances", destructive |
| Backfill charges | charges-backfill-card.tsx:56 | POST `/orders/charges/backfill` | Dry-run preview first; no confirm on the real run |
| Compute order charges | order-charges.tsx | POST `/orders/${id}/charges/compute` | No confirm |

### Treasury, P&L, expenses, courier payments

| Action | Where | Endpoint | Confirm? What it restates |
|---|---|---|---|
| Treasury transfer | transfer-modal.tsx:176 | POST `/treasury/transfers` | Modal form only |
| Owner money | owner-money-modal.tsx:92 | POST `/accounts/${id}/owner-money` | Modal form only |
| Reconcile account | reconcile-modal.tsx:112 | POST `/accounts/${id}/reconcile` | Modal form only |
| Mark opening balance | treasury-index.tsx:91 | POST `/entries/${id}/mark-opening-balance` | **`window.prompt`** for the reason. No styled confirm |
| Record expense / pay forwarder | expense-modal.tsx:152, our-cost-cell.tsx:228 | POST `/treasury/entries`, `/inbound-freight/${id}/pay-forwarder` | Modal form only |
| Set our cost | our-cost-cell.tsx:147 | POST `/inbound-freight/${id}/our-cost` | Modal form only |
| Attach expense to consignment | expenses-index.tsx:379 | POST `/attribute-expense` | Modal restates `{currency} {amount} from {account}` |
| Place investment / record return | investment-modal.tsx:83, investment-return-modal.tsx:82 | POST `/investments`, `/investments/${id}/return` | Modal form only |
| Record freight bill (pay-now debits seller wallet) | record-freight-modal.tsx:269 | POST `/inbound-freight` | Modal form; the description states the debit |
| Settle / waive / void freight | freight-actions.tsx:136 / :161 / :208 | POST `/settle`, `/waive`, `/void` | ConfirmDialog "Settle this freight bill?"; Modal "Waive…" and "Withdraw…" with reason |
| Record courier payout | record-settlement-modal.tsx:243 | POST `/courier-settlements` | Modal form only |
| Allocate courier payout | allocate-settlement-modal.tsx:83 | POST `/${id}/allocate` | Modal restates the reference |
| Courier wallet payment / bank side / resolve | courier-wallet-index.tsx:394/453/510 | POST `/payments`, `/record-bank-side`, `/resolve` | Modals; :395 restates `₹{amount} reached {account} on {date}` |
| Shipment cost | shipment-cost-panel.tsx:71 | POST `/treasury/shipments/${id}/cost` | Modal form only |
| P&L close month | carry-forward-index.tsx:675 | POST `/pnl-periods/${m}/close` | Modal "Close {month}" (critical) with reason |
| P&L lock permanently | :473 | POST `/lock-permanently` | Modal "Lock {month} permanently" (critical) |
| P&L god-mode relock | :553 | POST `/god-mode-relock` | Modal (critical), justification ≥30 characters plus "Type {month} to confirm" |
| P&L backfill close | :1208 | POST `/backfill-close` | ConfirmDialog "Close these months for good?" |

### Seller controls, orders, god mode

| Action | Where | Endpoint | Confirm? What it restates |
|---|---|---|---|
| God mode (force mutation) | force-mutation-dialog.tsx:237 | POST `/orders/${id}/force-mutation` | Critical Modal, two stages: acknowledgement checkbox, justification, typed `FORCE-MUTATE`, then a confirmation stage |
| Cancel order | order-actions-panel.tsx:256 | POST `/orders/${id}/cancel` | Modal "Cancel order {orderNumber}?" |
| Release / restore reservations | release-…:56, restore-…:63 | POST `/release-reservations`, `/restore-reservations` | Modal |
| Cancel with courier / cancelled outside | courier-ops-panel.tsx:314/426/449 | POST `/courier-ops/shipments/${id}/cancel`, `/cancelled-outside` | ConfirmDialog ×3 |
| NDR action / edit / e-way bill | courier-ops-panel.tsx | POST `/ndr-action`, `/edit`, `/ewaybill` | Modals ("Correct the recipient", "Attach an e-way bill"); NDR action unconfirmed |
| Admin return | admin-request-return-dialog.tsx:65 | POST `/orders/${id}/return` | Modal `Bring {order} back?` |
| Manual AWB / cancel as unfulfillable | manual-placement-panel.tsx:151/:221 | POST `…/place-awb`, `…/cancel` | Modal |
| Retry stock / return to pick | stuck-order-recovery.tsx | POST | No confirm |
| Seller status (suspend / reapprove) | status-action-panel.tsx:133 | PATCH `/sellers/${id}/status` | Modal "Suspend this seller?" |
| Seller restriction apply / lift | restriction-panel.tsx:148 | POST `/restriction`, `/lift` | Apply uses Modal "Place a hold"; lift not checked in detail |
| Seller settings override (limits) | seller-settings-section.tsx:241 | PUT or DELETE `/sellers/${id}/settings/${key}` | Modal "Override for this seller" |
| Credit-after-confirmation | credit-after-confirmation-panel.tsx:127 | PUT `…/reseller-credit-after-confirmation` | Modal with reason |
| Identity correction | identity-correction-panel.tsx:120 | PATCH `/identity` | Modal |
| Bank change approve / reject | bank-changes-index.tsx:264 | POST `/bank-change-requests/${id}/approve` / `reject` | Modal `Pay {company} into the new account?` |
| Courier-link unlink / weight | seller-courier-links-section.tsx:441/:380 | DELETE / PATCH | Modal `Unlink {name}?` |
| Bulk dequeue call queue | bulk-dequeue-panel.tsx:105 | POST `/call-queue/bulk-dequeue` | Modal "Close {seller}'s call queue?" |
| Pause reseller store | pause-store-modal.tsx:38 | POST `/reseller-analysis/stores/${id}/pause` | Critical Modal `Pause "{store}"?` |

### Stock and warehouse

| Action | Where | Endpoint | Confirm? What it restates |
|---|---|---|---|
| Adjustment approve / reject / create | adjustments-index.tsx:254, new-adjustment-panel.tsx:146 | POST `/stock-adjustments…` | Modals |
| Cycle count complete (raises adjustments) | cycle-counts-index.tsx:533 | POST `/cycle-counts/${id}/complete` | **No separate confirm.** The button label restates "Complete — raises N adjustments" |
| Stock transfer | transfers-index.tsx | POST `/stock-transfers` | No confirm |
| Bin delete | bins-index.tsx:451 | DELETE `/bins/${id}` | No confirm |
| Move whole bin | bin-ops-panel.tsx:432 | POST `…/move-bin/…` | Modal `Move everything in {bin}?` |
| Bin tracking on/off | bins-index.tsx:504 | PATCH `/bin-tracking` | Modal |
| Receive complete (writes stock) | receive-detail-view.tsx:335 | POST `/goods-receipts/${id}/complete` | **No confirm** |
| Receive cancel | receive-detail-view.tsx:555 | POST `/cancel` | Critical Modal `Cancel {receiptNumber}?` |
| RTO finalize (restock / write-off) | rto-station.tsx:296 | POST `/rto/shipments/${id}/finalize` | **No confirm** |
| RTO putaway | putaway-panel.tsx:190 | POST `/putaway` | No confirm |
| Consignment dispatch | consignment-panel.tsx:540 | POST `/consignments/${id}/dispatch` | **No confirm** |
| Consignment cancel | consignment-panel.tsx:667 | POST `/cancel` | Critical Modal `Cancel {consignmentNumber}?` |
| Pack force-complete / cancel box | pack-station.tsx:468-505, :433-462 | POST `/force-complete`, `/boxes/${id}/cancel` | Inline two-step with reason (≥20 / ≥3 characters). No modal |
| Force-expire pick | force-expire.tsx:74 | POST `/warehouse/picks/${id}/expire` | Modal |
| Manifest close / confirm handoff | manifest-detail-view.tsx:204/:214 | POST `/close`, `/confirm-handoff` | ConfirmDialog ×2 (restates "decrements warehouse stock") |
| Printing confirm printed / abandon batch / mark picked | printing-station.tsx | POST … | "Did it print?" Modals for confirm; abandon and mark-picked are direct buttons |
| Label reprint approve / reject / print | label-reprint-requests.tsx | POST | No confirm |
| Release pickup day | pickups-index.tsx:229 | POST `/release-day` | Critical Modal |

### Admin, courier and system configuration

| Action | Where | Endpoint | Confirm? What it restates |
|---|---|---|---|
| Courier master on/off | courier-master-switches.tsx:40 | PATCH `/couriers/${code}` | **`window.prompt`** for the reason |
| Courier account deactivate / default | courier-accounts-index.tsx:189-210 | PATCH `/courier-accounts/${id}` | No confirm |
| Escalation channel pause / resume | courier-escalation-index.tsx:247-262 | POST `/channel/pause` / `resume` | No confirm |
| Escalation mode change | courier-escalation-index.tsx:528/567 | POST `/channel/mode/request`, then `/mode/confirm` | Six-digit code challenge |
| FX override | fx-override-modal.tsx:53 | PATCH `/fx-rates` | Modal (reason ≥ 10 characters) |
| System setting edit | edit-setting-dialog.tsx | PATCH `/system-settings/${key}` | Modal form |
| Staff deactivate | staff-management-index.tsx:179-195 | DELETE `/staff/users/${id}` | Inline "Confirm / Cancel" buttons |
| Staff role change | staff-management-index.tsx:160 | PATCH `/users/${id}/role` | **None.** Fires on `Select` change |
| Revoke staff invite | staff-management-index.tsx:268 | DELETE `/staff/invitations/${id}` | No confirm |
| Role delete | roles-index.tsx:160 | DELETE `/staff-roles/${id}` | ConfirmDialog `Delete {name}?` |
| Seller invite delete | invitations-panel.tsx:119 | DELETE | ConfirmDialog |
| Bank account retire | _bank-accounts-panel.tsx | DELETE `/platform-bank-accounts/${id}` | Not a ConfirmDialog; source test pins `>Delete<` |
| Expense category retire / restore | expense-categories-index.tsx:197 | PATCH | Modal `Retire {name}?` |
| Log out all sessions | session-revocation-card.tsx:130 | POST `/auth/staff/logout-all` | ConfirmDialog |
| Call queue force outcome | force-outcome-panel.tsx:149 | POST `/call-queue/${id}/force-outcome` | Critical Modal |
| Reattempt / delivery-action decide | reattempt:165, delivery-actions:244 | POST approve / reject | Modals |
| NSA sweep / system-issue announce / webhook retry | nsa:99, system-issues:126, webhooks:45 | POST | No confirm |

---

## 4. Keyboard shortcuts, scanner input, barcode/serial entry

**Global finding:** there is no `useHotkeys`, no global shortcut map, and no app-level `keydown` listener in apps/admin. Every scanner integration is either "Input + `onKeyDown` Enter" or the shared `SerialScanner`. **No vitest or Playwright test drives any scan field, any Enter-to-submit, the camera component, or keyboard focus.**

### Shared scanner building blocks

**SerialScanner** (`src/components/ui/serial-scanner.tsx`)
- Input `id={id}` at :107-122 with `font-mono text-base`, `autoComplete="off"` and `autoFocus={autoFocus}` (:112, default false). Placeholder "Scan a unit serial…".
- `onKeyDown` Enter (:115-120) calls `preventDefault` then `capture()` (:79-92): trims, ignores empty, de-duplicates with the notice `"{serial} is already in this list."` (:86-88), and appends.
- Count display `n / required`; turns `text-critical` when over the target (:99, :123-135).
- Remove-chip buttons `aria-label="Remove {serial}"` (:149-157).
- `scanCountMet()` (:57-64): exact count, or `allowFewer` for receiving.
- Used at:
  - `pack-station.tsx:359` (autoFocus, pending-completion step)
  - `pick-station.tsx:252` (STRICT lines, `required=quantity`)
  - `receive-detail-view.tsx:532` (STRICT lines, `required=received qty`)
- Tests: none.

**BarcodeCamera / CameraScanButton** (`src/components/barcode-camera.tsx`)
- Modal hosting a `<video>`. Lazily imports `@zxing/browser` (:49). `decodeFromVideoDevice` (:54) stops on the first read and calls `onScan` (:62-64). Stream stopped on close or unmount (:85-89). `cameraFailure()` messages (:126-149).
- `CameraScanButton` (:152-165) is hidden when `getUserMedia` is missing.
- Used at:
  - pack (`pack-station.tsx:510-520`): a scan sets the code and runs `onScan`.
  - handover (`handover-bench.tsx:132, 194-202`): a scan runs `submit`.
  - RTO (`rto-station.tsx:227, 318-331`): a scan only fills the AWB field; receiving stays a deliberate click.
- Test: `camera-permissions-policy.test.ts` checks only the `Permissions-Policy camera=(self)` header in `next.config.mjs`, not the component.

### Scan and entry points, by page

**Pack bench** (`(A)/warehouse/pack/_c/pack-station.tsx`)
- `inputRef` (:108). `useEffect` refocuses the field on every change of `[box, lines, error, cancelling]` (:109-111).
- Input `#pack-scan` (:308-326) with `font-mono text-base`. Disabled while `busy || refusal !== null` (:315). Hidden while `pending` or scan-block is active (:300).
- Enter (:319-324) calls `onScan(code)` (:135-190). What a scan means depends on state:
  - No box open: POST `/api/warehouse/packs/boxes/open` (toast "Box open — {awb}").
  - Code equals `box.awbNumber`: POST `/boxes/${id}/close`. On `UNIT_SCAN_REQUIRED` it switches to the pending-serials step (:165-169).
  - Anything else: POST `/boxes/${id}/scan`. Increments that line's `scanned`; if the server says it is a unit, adds the serial (:178-180).
- A refused scan opens a blocking critical Modal "That scan was refused", with "I have fixed it" refocusing the field (:525-552).
- Scan-block card at :275-296 (GET `/api/admin/courier/scan-block`).
- Per-line counter `{scanned} / {quantity}` (:396-420).
- Cancel reason Input :443 (≥3 chars). Force reason Input :484 (≥20 chars, only with the `warehouse.pick.supervise` permission).
- Tests: none. `page-access-alignment.test.ts` only checks route permissions.

**Handover bench** (`(A)/warehouse/handover/_c/handover-bench.tsx`)
- Input `#handover-scan` (:116-131) with `font-mono text-base`. **No `autoFocus` attribute.** Focus is restored in `finally` after each submit (:76) and when the refusal modal closes (:209, :223).
- Enter (:125-130) calls `submit()`: POST `/api/admin/courier/handover-scan`, then prepends to the session list (:60-69).
- Disabled while pending, refused or blocked (:120). Refusal Modal "That parcel was refused" / "Understood" (:204-229).
- Session count text (:135). List rows (:165-191). Queue below from GET `/courier/handover-queue`.
- Tests: none.

**Pick station** (`(A)/warehouse/pick/_c/pick-station.tsx`)
- No keyboard handlers of its own.
- `SerialScanner` per STRICT line (:252-264), no `autoFocus`.
- Free-text Bin Input (:266-278) and Batch Input (:279-291); Enter does nothing.
- Record button (:292-299) gated by `scanCountMet` (:216). Calls POST `/api/warehouse/picks/${id}/items` with `scannedSerials` for STRICT lines only (:113-122).
- Pull, Start and Complete are buttons (:156-172, :311-318).
- `force-expire.tsx:82` has a "Shipment id" Input inside a modal.
- Tests: none.

**Receiving / goods receipt** (`(A)/warehouse/receive/_c/receive-detail-view.tsx`)
- Count fields per line:
  - "Received qty" (:475-484): `type=number`, `min=0`, `max=1_000_000`, `inputMode="numeric"`.
  - "Damaged" (:485-493).
  - "Putaway bin" Select (:494-522).
- `SerialScanner` for STRICT lines (:532-539), no `autoFocus`.
- No Enter handling on the count fields. Buttons: Record all products (:327-334), Complete (:335-343, disabled when `serialsOverCount`).
- Tests: none.

**RTO station** (`(A)/warehouse/rto/_c/rto-station.tsx`, `rto-item-row.tsx`, `putaway-panel.tsx`)
- AWB Input (:216-223): **no Enter handler, no autoFocus.** Receiving needs the Receive button (:228-235) → POST `/api/warehouse/rto/receive`. The camera fills the field only.
- Tabs are `role="tab"` buttons (`rto-tabs.tsx:43-51`). Click only; no arrow-key handling.
- Inspection per line in `rto-item-row.tsx`: Condition Select :273, "What happens to it" Select :292, Notes :311. Split-by-quantity rows: Units Input `inputMode="numeric"` :332-338, Condition :341, disposition :359, Notes :380. Buttons: Split by quantity :426, Save inspection :430.
- `putaway-panel.tsx:168`: shelf Select per row.
- Tests:
  - `rto-split-by-quantity.test.tsx` (labels, buttons, `role=status`; mouse and `userEvent` typing only)
  - `rto-disposition-labels.test.tsx` (option names)
  - `rto-line-thumbnail.test.tsx`
  - `rto-putaway.test.ts` (source regex)
  - None test the AWB field.

**Cycle counts** (`(A)/inventory/cycle-counts/_c/cycle-counts-index.tsx`)
- In the "Cycle count" modal: Variant id :365-372, Counted quantity :373-381 (`type=number`), Bin id :383-388, Batch id :390-400, Notes Textarea :402-410.
- Record button :418-440 (no Enter handling). Start and Complete buttons :523-543.
- Test: `request-contracts.test.ts` pins source strings (`binId: binId.trim(),`, `batchId: batchId.trim(),`, `binId.trim() === ''`).

**Stock adjustments, transfers and bin ops** (count entry)
- `new-adjustment-panel.tsx:175`: Quantity, `inputMode=numeric`.
- `transfers-index.tsx:99-107`: Quantity.
- `bin-ops-panel.tsx:352-358`: Quantity, `aria-label="Quantity"`.
- `bins-index.tsx:322, :330`: aisle and rack numeric inputs.
- No Enter handlers. `audit-dead-ends.test.ts` pins adjustment-panel source strings.

**Printing and labels** (`(A)/warehouse/printing/_c/printing-station.tsx`)
- Tab buttons (:84-102).
- `window.prompt("How many labels for {sku}?")` (:870-874) is the label-quantity entry; it parses an int and calls POST `sku-labels/variants`.
- Other inputs:
  - "Find a product" (:820-825): no Enter; queries at ≥2 characters.
  - "Search batches" (:612-617).
  - Reprint reason Input (:484).
- `selection-table.tsx` checkboxes: select-all at :55-59, per-row at :84-88.
- Printing goes through `lib/print-pdf.ts`. `label-sheet.tsx:67` and `components/sku-label-sheet.tsx:82` call `window.print()` and render `Barcode128`.
- Tests: none.

**Consignment serials** (`consignment-panel.tsx`)
- `parseSerials()` (:48-59) accepts a scanner's Enter-separated or pasted whitespace- or comma-separated list.
- "Serials to reprint" Input :443-448 (no Enter handler). "Why" :449.
- Dispatch units per line: `type=number` :511-517, `aria-label="Units of {sku} leaving"`.
- Tests: none.

**Serial trace** (`(A)/inventory-units/_c/unit-trace-panel.tsx`)
- Serial Input :76-87. Enter (:80-85) calls `submit()` → GET `/api/admin/stock-units/trace/${sellerId}/${serial}`. Comment: "A barcode gun types the number and presses Enter."
- Tests: none.

**Header order omnisearch** (`(A)/_components/order-omnisearch.tsx`)
- Raw `<input type="search">` :112-133, debounced 250 ms (:50-53).
- `onKeyDown` (:123-133): Escape closes; Enter navigates only when there is exactly one order or one ticket result.
- Document `mousedown` outside-click listener (:55-62). `Loader2 animate-spin` (:135-138).
- Tests: none.

### Other key-driven behaviour

- **Enter-to-submit through `<form onSubmit>`:**
  - `orders-index.tsx:136` (search)
  - `fx-override-modal.tsx:57`
  - `remittance-form-modal.tsx:265`
  - `credit-after-confirmation-panel.tsx:139`
  - `edit-setting-dialog.tsx:118`
  - `reseller-stores/page.tsx:238`
  - `create-invitation-dialog.tsx:54`
  - `invite-staff-modal.tsx:63`
  - `login-form.tsx:59`
  - `forgot-form.tsx:76`, `reset-form.tsx:80`, `accept-invitation-form.tsx:209`
  - Only the login form is covered, by the Playwright `login.spec.ts` (fills and clicks "Sign in"; it does not press Enter).
- **Shared package (`packages/ui`):**
  - `notification-bell.tsx:108-114`: document `keydown` Escape closes the bell.
  - `menu-button.tsx:179, :199`: trigger and menu `onKeyDown`.
  - `Modal` is Radix Dialog (Escape closes).
  - `data-table.tsx:141-190`: `Tr onActivate` is click-only; keyboard users use the `<a>` in the primary cell. `row-activation.test.tsx` covers this.
  - `theme-toggle.tsx:77`: storage event.
- **Other `autoFocus`:**
  - `forgot-form.tsx:86`
  - `seller-stores-index.tsx:322`
  - `owner-money-modal.tsx:118`
  - `reconcile-modal.tsx:145`
  - `our-cost-cell.tsx:157, :259`
  - `expenses-index.tsx:393`
  - `move-seller-cash-modal.tsx:124`
- **Non-key listeners:** `call-center-station.tsx:287` (`visibilitychange` heartbeat); `corridor-console.tsx:449` (`visibilitychange`); `lib/tilt.tsx:79-126` (pointer events).

---

## 5. Components under `apps/admin/src/components`

| File | What it is | Duplication |
|---|---|---|
| `barcode-camera.tsx` | `BarcodeCamera` modal (zxing) and `CameraScanButton` | None in ui; admin-only |
| `ui/serial-scanner.tsx` | `SerialScanner` and `scanCountMet`. The only file in `components/ui`; its header says it is built to lift into `@skydrop/ui` (no `@/` imports) | No equivalent in `packages/ui` |
| `sku-label-sheet.tsx` | Printable SKU label sheet (`Barcode128`, print CSS with `#fff`/`#000`, `window.print`) | Near-duplicate print shell of `(A)/warehouse/consignments/[id]/_c/label-sheet.tsx`. Both use ui `Barcode128` |
| `phone-to-call.tsx` | Copyable phone number (mono, uppercase label) | None |
| `notification-bell-container.tsx` | Wires ui `NotificationBell` to hooks | Near-copies in `apps/seller` and `apps/reseller` `src/components` |
| `query-provider.tsx` | TanStack `QueryClientProvider` | Copies in seller and reseller |
| `auth-console/console-shell.tsx` | `AuthConsoleShell` / `AuthConsoleHeader` (login and auth chrome, uses ui `ThemeToggle`) | Required byte-identical across admin, seller and reseller (`auth-console-copies.test.ts`) |
| `auth-console/corridor-console.tsx` | Animated corridor map canvas (hex colours at :119-151) | Same identity requirement |
| `auth-console/console.css` | `.mc-login`, `.telemetry` (mono uppercase 0.08em), boot animations; 51 hex values | Must equal reseller's copy and differ from seller's (tested) |
| `auth-console/map-geometry.ts` | Map ring data | none |

**Local re-implementations inside `app/` of things ui already provides:**
- Four separate tab implementations:
  - `expenses-index.tsx` `TabButton` (`role=tablist`)
  - `rto-tabs.tsx` (`role=tab`)
  - `printing-station.tsx:84-102` (Buttons)
  - `seller-wallet-detail.tsx:244` (Buttons with `aria-current`)
  - Plus link-tabs in `courier-escalation/_c/escalation-tabs.tsx`.
- Local money tiles: `dashboard-view.tsx:267 MoneyCard`, `seller-wallets-index.tsx:389 MoneyTile` and `:64 Bdt` (ui has `Stat` and `Money`).
- Raw `<table>` instead of ui `Table`:
  - `fx-rates-index`, `fx-history-drawer`
  - `order-detail`, `order-charges`
  - `pnl-index`, `carry-forward-index`
  - `remittances-index`
  - `staff-management-index`
  - `webhook-deliveries-index`
  - `record-freight-modal`
- `receive-detail-view` `Field` (ui has `DescriptionList`).
- The `lead-drawer` and `fx-history-drawer` "drawers" are `Modal`s.

---

## 6. Style debt

### `font-mono` (213 hits)

**Hits per file (top):**
- `order-detail.tsx`: 12
- `force-mutation-dialog.tsx`: 10
- `order-actions-panel.tsx`: 9
- `staff-management-index.tsx`: 7
- `seller-detail.tsx`: 7
- `webhook-deliveries-index.tsx`: 6
- `printing-station.tsx`: 6
- `receive-index.tsx`, `receive-detail-view.tsx`, `orders-index.tsx`: 5 each
- `pack-station.tsx`, `manifests-index.tsx`, `bins-index.tsx`, `edit-setting-dialog.tsx`, `sellers-index.tsx`, `carry-forward-index.tsx`, `tracking-lookup-panel.tsx`: 4 each
- About 70 more files with 1-3 each.

**Mono on money or ordinary numbers** (not IDs):
- `orders-index.tsx:302`: COD amount.
- `order-detail.tsx:150, 152-153`: COD and Declared INR. `:163-164`: weight. `:214-221`: qty, reserved, unit weight.
- `topups-index.tsx:193-194`: `{currency} {amount}`.
- `remittance-form-modal.tsx:294`: wrapper around `Money` balances.
- `seller-wallet-detail.tsx:222`: setting value.
- `fx-rates-index.tsx:68-69` and `fx-history-drawer.tsx:59-60`: rate `toFixed(6)`, plus previous rate.
- `manifests-index.tsx:97`: shipment count.
- `receive-index.tsx:174`: line count.
- `seller-courier-links-section.tsx:222-223`: distribution weight.
- `order-actions-panel.tsx:482`: released count.
- Quantities inside mono SKU lines: `pick-station.tsx:233-236`, `rto-item-row.tsx:258-259`, `receive-detail-view.tsx:440-441`, `putaway-panel.tsx:146-147`, `call-center-station.tsx:855-856`, `order-actions-panel.tsx:487-488`.
- `pack-station.tsx:414`: counters use `tabular-nums`, not mono.

**Mono on dates:**
- `orders-index.tsx:305`
- `sellers-index.tsx:132, 135`
- `seller-detail.tsx:129`
- `manifests-index.tsx:99, 103`
- `receive-index.tsx:176, 179`
- `staff-management-index.tsx:171, 174, 255`
- `fx-rates-index.tsx:87-88`, `fx-history-drawer.tsx:56-57`
- `remittances-index.tsx:209`
- `webhook-deliveries-index.tsx:114`
- `manifest-detail-view.tsx:187`
- `courier-wallet-index.tsx:184, 304`

**Legitimate mono** (AWB, order and shipment numbers, SKUs, serials, account numbers, IFSC, codes):
- `pack-station.tsx:325, 329, 351, 408`
- `handover-bench.tsx:123, 173`
- `serial-scanner.tsx:121, 145`
- `bank-accounts:247, 255`
- `topups:188`
- `reseller-order-panel:110`
- `cost-sync:133, 571`
- `courier-master-switches:95`
- … and the ui `Ident` component.

### `uppercase` (84 hits, 69 of them also carry `tracking-*`)

Label-style lines by file:
- `order-detail.tsx`: 148, 167, 173, 178, 195, 236, 246, 256
- `order-actions-panel.tsx`: 118, 165, 171, 386, 414, 432, 470
- `staff-management-index.tsx`: 138, 153, 222, 245, 247, 248
- `dashboard-view.tsx`: 76, 149, 154, 373
- `settings-index.tsx`: 96, 99, 102
- `seller-wallets-index.tsx`: 171, 327, 423
- `payout-instruction-panel.tsx`: 84, 150, 177
- `order-charges.tsx`: 68, 92, 124
- `courier-escalation-index.tsx`: 194, 198, 224
- `receive-detail-view.tsx`: 268, 547, 591
- `webhook-deliveries-index`: 97, 129
- `pick-station`: 204, 243
- `manifest-detail-view`: 176, 231
- `record-settlement-modal`: 306, 425
- `pnl-index`: 287, 353
- `force-mutation-dialog`: 459, 651
- `unit-triage-index`: 217, 271
- `fx-rates-index`: 53, 80
- `fx-history-drawer`: 41, 88
- `freight-index`: 353, 439
- `call-center-station`: 969, 1016
- `order-omnisearch`: 155, 185
- `consignee-panel:173`, `remittance-form-modal:284`, `invitations-panel:72`, `receive-index:173`, `role-editor:191`, `orders-index:299`, `edit-setting-dialog:104`, `invite-link-reveal-card:37`, `notification-settings-view:68`, `remittances-index:194`, `seller-wallet-detail:224`, `courier-ops-panel:174`, `create-courier-account-modal:201`, `manifests-index:92`, `seller-courier-links-section:221`, `phone-to-call:71`
- `console.css:133` (`.telemetry`)

Shared ui primitives bake the same look into every page:
- `data-table.tsx:123`: `Th` header is `uppercase tracking-wide`.
- `status-badge.tsx:76`, `page.tsx:260`, `feedback.tsx:156`.
- `app-shell.tsx:157, 255, 486, 556, 574`: nav group headings and subtitle.
- `console.tsx:65, 133, 175, 301`.
- `notification-bell.tsx:183, 291`, `order-journey.tsx:184, 463`.

### Other debt

- **"01 //"-style eyebrows:** none in apps/admin. The auth pages use `.telemetry` mono-uppercase micro-labels instead (`login/page.tsx:43, 52, 58, 61, 76`; `auth/*/page.tsx`; `accept-invitation-form.tsx:161-202`; `login-form.tsx:61, 76`).
- **Mono breadcrumbs:** `packages/ui/src/components/console.tsx:65` (`Crumbs`: `font-mono text-[11px] tracking-[0.08em] uppercase`). Not used in apps/admin (no `Crumbs`, `SectionBand` or `MetaChip` imports).
- **Spinners:**
  - `order-omnisearch.tsx:135-136` (`Loader2 animate-spin`)
  - `cost-sync-index.tsx:388` (`RefreshCw animate-spin`)
  - `shiprocket-cost-section.tsx:325, 382, 472, 506`
  - Everything else uses skeletons or "…ing" button labels.
- **Native `<select>` / `<textarea>`:** none. `form-controls-use-primitives.test.ts` fails on any raw `<select`/`<textarea` line in admin (`record-freight-modal.tsx:373` mentions it only in a comment).
  - Raw `<input>` outside the primitive (non-checkbox cases): `login-form`, auth forms, `order-omnisearch:112`, `reports-dashboard:45, 54` (date inputs), `store-dispute-settle:108`, `admin-ticket-detail:407`, `restriction-panel:155, 176`, `delivery-actions:117`, `wallet-import-panel:69`, `courier-escalation-index:554`, plus several checkbox/radio `<input>`s.
- **Hard-coded hex:**
  - `components/auth-console/console.css`: 51
  - `corridor-console.tsx:119, 120, 130, 151`
  - `consignments/[id]/_c/label-sheet.tsx:44-49` (print CSS `#fff`/`#000`)
  - `components/sku-label-sheet.tsx:42-47`
  - None in page components.

---

## 7. Tests pinned to markup

Vitest config is `apps/admin/vitest.config.ts` (happy-dom, `src/tests/**/*.test.{ts,tsx}`). The helper is `src/tests/helpers.tsx`. What each test depends on:

**Rendered-DOM tests:**
- **`admin-ticket-conversation.test.tsx`:** label "Reply to the seller"; button "Mark delivered"; text "Nothing said yet.", `/^Seller ·/`, `/^Skydrop ·/`.
- **`bin-contents.test.tsx`** (bin-detail, bin-contents-overview, movements-index):
  - Test IDs `bin-total-FLOOR`, `bin-total-R-01-01`, `bin-total-D-01-01`, `layout-total-FLOOR`.
  - Labels "Bin type", "Bin", "Seller", "Product, SKU or batch".
  - Links "FLOOR", "Movements for this bin", `/decide them at the RTO station/`, `/1 more line — open FLOOR/`.
  - Texts "This bin is empty", "Bin FLOOR", "· CCU-01"; alt "Cotton Kurta".
- **`courier-escalation-fe2.test.tsx`:** labels `/^Code/`, `/^Means/`, `/^Pattern/`; buttons `/write a pattern/`, `/make it live/`.
- **`dashboard-permissions.test.tsx`:** texts "Open tickets", "Withdrawal requests", "Awaiting call", `/performance & fulfilment/i`, `/no permissions that show anything here/i`; absence of `/403/`.
- **`god-mode-fe2.test.tsx`:** labels `/Force order status/`, `/Justification/`; placeholder `FORCE-MUTATE`; checkbox `/I acknowledge the data-integrity risk/`; buttons `/Continue → confirmation/`, `/Force-mutate this order/`.
- **`instant-pay-advances.test.tsx`:** link "See courier payouts"; order numbers; `/has been paid by its courier/`.
- **`ops-status-kinds.test.tsx`:** `querySelector('[data-status-kind="in-transit"]')`; texts `/Closed/`, `/refunded/`.
- **`reseller-order-panel-version.test.tsx`:** "Version 3".
- **`reseller-store-wallets-approve.test.tsx`:** button `/^approve$/i`; `role=dialog`; button `/approve the withdrawal/i`; text `₹1,250.50`; `[code] message`.
- **`role-editor-search.test.tsx`:** labels "Name", "Search permissions"; permission checkboxes; "God-mode override"; `/1 selected not shown/`; `/nothing matches/i`; button `/create role/i`.
- **`row-activation.test.tsx`:** button "Deactivate"; link "Menev Store".
- **`rto-disposition-labels.test.tsx`:** option names "Put back in stock", "Keep aside (damaged)…", "Write off (not sellable)…", "Decide later"; help-copy regexes.
- **`rto-line-thumbnail.test.tsx`:** `className` contains `bg-surface-raised`; `img`/`aria-hidden` selectors.
- **`rto-split-by-quantity.test.tsx`:** labels "Condition", "Units in row 2", "What happens to them, row 2", "Notes, row 2"; buttons "Split by quantity", "One decision for all 2", "Save inspection"; `role=status`.
- **`seller-detail-sections.test.tsx`:** buttons `/close all open queue entries/i`, `/^close entries$/i`, `/^unlink$/i`; label `/reason/i`; "Delhivery One", "100%".
- **`seller-status-fe2.test.tsx`:** button `/suspend account/i`; "Suspend this seller?"; textarea label `/Reason \(optional/`; button `/^Suspend$/`.
- **`store-dispute-settle-fe2.test.tsx`:** labels `/amount/i`, `/who pays/i`; button `/^settle$/i`.
- **`tickets-index-number.test.tsx`:** label "Search tickets"; "TK-2026-000003".
- **`topup-status-kind.test.tsx`:** "Waiting for review" (not "PENDING").
- **`ui-primitives.test.tsx`:** `.font-mono`, `.skydrop-tabular`, `.border`, `.text-[var(--color-credit)]`, `.text-[var(--color-debit)]`; `role=columnheader`; texts `12,34,567`, `176.29`, `/No settlements recorded/`, `/Outstanding float/`.
- **`wallet-transfers.test.tsx`:** textboxes `/^Amount/`, `/^Reason/`; buttons "Preview", "Post transfer", "Yes, post it"; test ID `wallet-transfer-sentence`.
- **`theme-persists.test.tsx`:** `role=switch`.

**Source and regex tests** (they read files, so renames or markup changes can break them):
- **`form-controls-use-primitives.test.ts`:** no raw `<select`/`<textarea` anywhere in admin.
- **`table-columns-line-up.test.tsx`:** every `<THead>` `Th` count equals the `Td` count per `<Tr>`, across admin and seller; expects more than 20 tables.
- **`table-empty-nesting.test.tsx`:** `<TableEmpty` only inside `<TBody>`.
- **`page-header-markup.test.tsx`:** no block elements inside `<p>` for `PageHeader`/`Section` subtitles.
- **`pages-are-reachable.test.ts`:** every route is linked or in `EXPECTED_UNLINKED` (includes `/dashboard`, `/warehouse/pick`, `/warehouse/pickups`, …).
- **`api-paths-use-proxy.test.ts`:** every `client.request(` path starts with `/api`.
- **`api-client-body.test.ts`:** source scan.
- **`request-contracts.test.ts`:** exact strings in the status-action, transfers and cycle-count sources.
- **`audit-dead-ends.test.ts`:** `<NewAdjustmentPanel`, `if (!mayCreate) return null;`, the `complete =` batchId regex.
- **`bank-accounts.test.ts`:** `>\s*Delete\s*<`, `if (!mayManage) return null;`.
- **`manual-placement.test.tsx`:** `if (!mayPlace) return null;`, `tone="critical"`, `readonly trackingUrl`.
- **`stuck-order-recovery.test.ts`:** JSX conditionals in `stuck-order-recovery.tsx`.
- **`rto-putaway.test.tsx`:** `putaway-panel` source regexes.
- **`call-station-recovers-held-call.test.ts`:** station source regexes (`bootstrapped`, `setAssignment(held)`, …).
- **`broadcast-audiences.test.ts`:** `disabled={…!audienceComplete`.
- **`delhivery-account-setup.test.ts`:** `<AccountSetupPanel />` in the index; panel string forms.
- **`wallet-topup.test.ts`:** copy regexes (`Add funds|Top up now|credited instantly`, `adds the money to the seller`, `canSubmit=`).
- **`credential-field-names.test.ts`:** credential-name source.
- **`owner-money-contract.test.ts`:** hook path and DTO fields.
- **`auth-console-copies.test.ts`:** console files identical across apps.
- **`camera-permissions-policy.test.ts`:** `next.config.mjs` `permissionsPolicy({ camera: true })`.
- **`page-access-alignment.test.ts`:** `page-access.ts` vs API controllers.
- **Pure logic, no markup:** `adjustment-prefill`, `call-brand`, `courier-label`, `datetime-local-default`, `ist-day`, `treasury-money` (`absAmount`/`isZeroAmount`).

**Playwright** (`/home/talha/projects/SD/playwright.config.ts`): the admin project matches `apps/admin/e2e/**/*.spec.ts` plus `e2e-shared/**/*.spec.ts` on port 3002.
- **`apps/admin/e2e/login.spec.ts`:** texts "Skydrop" (exact), "operations console" (exact); heading "Sign in"; `getByRole('textbox', {name:'email'})`; `#password`; button "Sign in"; text "Invalid email or password."; `/dashboard` redirects to `/login`.
- **`e2e-shared/csp.spec.ts`:** `/login` loads with no CSP violations; nonce-based `script-src`.
- **`e2e-shared/responsive.spec.ts`:** at widths 320, 360, 414 and 768 it checks `/login` and, with credentials, `/dashboard`, `/orders`, `/settings`, `/staff`, `/fx`, `/reports`. It fails on horizontal overflow; on coarse pointers it also fails on tap targets under 30px tall or 20px wide (unless `.skydrop-hit`) and on inputs with font-size under 16px.

---

## 8. Formatting functions

**Money:**
- **Shared (`packages/ui/src/components/money.tsx`):**
  - `formatInr()` (:88): `−₹` plus `formatAmount`.
  - `<Money>` (:132): INR/BDT symbols, direction colours, convert via `MoneyDisplayProvider`/`useMoneyDisplay`.
  - `<Num>` (:235): `Intl.NumberFormat('en-IN')`, `skydrop-tabular`.
  - `<Ident>` (:258): mono xs.
- **Usage in admin:** `<Money` 274, `<Num` 77, `formatInr` 6.
- **Ad hoc:**
  - `charges-backfill-card.tsx:24`: `new Intl.NumberFormat('en-IN', {style:'currency'})`. The only direct `Intl` call in admin.
  - 37 raw `₹` strings, e.g. `admin-ticket-detail` ×6, `treasury-index` ×4, `store-dispute-settle` ×3, `courier-ops-panel` ×3, `courier-wallet-index:395`.
  - 41 `toFixed` calls, e.g. `transfer-modal` ×5, `remittance-form-modal` ×4, `fx-history-drawer` ×3, `expenses-index` ×3, `fx-rates-index` (rate `toFixed(6)`).
  - `treasury-index.tsx:55 absAmount`, `:60 isZeroAmount`.
  - Local `Bdt` and `MoneyTile` (`seller-wallets-index.tsx:64, 389`), `MoneyCard` (`dashboard-view.tsx:267`).
  - `lib/fee-currency.ts`: INR/BDT option list only.

**Dates:**
- `lib/ist-day.ts`: `istDay`, `istDayRange`, `istDateLabel` (`toLocaleDateString('en-IN', {timeZone:'Asia/Kolkata'})`).
- `lib/datetime-local.ts`: `toDateTimeLocalValue`.
- Local helpers:
  - `when()` in `reseller-stores/[storeId]/page.tsx:34`, `label-reprint-requests.tsx:25`, `shiprocket-ops-index.tsx:30`, `reseller-money-panel.tsx:58`, `reseller-store-wallets-index.tsx:52`, `store-wallet-panel.tsx:25`.
  - `dt` in `consignment-panel.tsx:64` (`en-IN`, medium/short).
  - `fmtWhen`/`fmtDay` in `cost-sync-index.tsx:58, 66` and `shiprocket-cost-section.tsx:38`.
  - `istDateTime` in `carry-forward-index.tsx:136`.
  - `formatWhen` in `account-security-view.tsx:119`.
  - `formatDuration` in `agents-index.tsx:378`.
- Inline calls: 73 `toLocaleString`, 32 `toLocaleDateString`, 32 `toISOString().slice(…)`/`.replace('T',' ')` (e.g. `orders-index:305`, `manifests-index:99, 103`, `receive-index:176, 179`, `sellers-index:132, 135`, `settings-index:113`).
- Relative time: ui exports `agoLabel` (notification-kind); admin never imports it.

**Numbers and labels:**
- `<Num>` for counts. Most quantities are rendered raw.
- Label helpers: `pretty()` in `adjustments-index:190` and `cycle-counts-index:181`; `actionLabel`, `reasonLabel`, `binTypeLabel` (`bin-note.tsx:5`), `feeLabel`, `ticketTypeLabel`, `categoryLabel`, `remainingLabel` (`rto-item-row:158`).
- Status words come from `@skydrop/ui/status`: `statusLabel`, `topupStatusLabel`, `withdrawalStatusLabel`, `walletDirectionLabel`, `storeWalletDirectionLabel`, `courierLabel`, `freightModeWords`/`freightModeExplainer`.
