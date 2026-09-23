<!-- Phase 0 inventory, read from source on 2026-09-23 (branch feat/apps-premium-restyle, base 9fc408fa). Facts only; the plan is in /APPS-INVENTORY.md. -->

All paths below are relative to `/home/talha/projects/SD`. I only read files, nothing was changed.

# A. `apps/reseller` (Next.js 15, port 3005)

## A.0 Shell and cross-cutting facts
- **Root layout** `apps/reseller/src/app/layout.tsx` is a server component.
  - Fonts via `next/font/local`: Geist from `./fonts/geist-latin.woff2` (`--font-geist-sans`) and Geist Mono from `./fonts/geist-mono-latin.woff2` (`--font-geist-mono`).
  - `<html data-theme={pinnedTheme(cookie sd-theme)}>` plus the inline `themeInitScript` from `@skydrop/ui/components`, which carries the `x-nonce`.
- **Globals** `apps/reseller/src/app/globals.css` imports `@skydrop/ui/tokens.css` then `tailwindcss`, and has `@source '../../../../packages/ui/src'`.
  - Its `@theme` maps: color tokens, the 24 `--color-status-*` triples, accent-tint/ring, `--font-sans`/`--font-mono`, `--text-xs…2xl`, `--radius-1..3`.
  - It is byte-identical to admin's apart from comments, and has no seller-theme.
  - **Font mismatch:** tokens.css sets `--font-sans: 'Geist', …` literally, but the layout exposes `--font-geist-sans`. The note in `seller-theme.css` says admin and reseller have therefore been rendering in the system sans all along.
- **`(authed)/layout.tsx`** (server): checks the `__Host-storeRefresh` cookie via `resolveStoreSsrIdentity` and sends you to `/login` if not signed in. It wraps QueryProvider → AuthProvider → AuthedShell → RoleBoundary.
- **`(authed)/_components/authed-shell.tsx`** (client): `<Toaster>` + `AppShell` with subtitle "Reseller", sectionLabel "Reseller portal", `headerAlways=<NotificationBellContainer/>`, and `TermsBanner` above the children.
  - Nav group **Store:** Dashboard, Orders, Unreachable customers (count badge from `useStoreCallReviews`), Customers, Catalogue, Terms, Wallet, Reports, Expenses, Tickets.
  - Nav group **Setup:** Team, Integrations, Store settings.
  - Nav group **You:** Notifications, My account.
  - Items are filtered by `canSeePath`.
- **`role-boundary.tsx`**: when the permission is missing it renders `PageHeader "Not available"` plus an `EmptyState` and a primary Button "Go to the dashboard". Permission map is in `src/lib/page-access.ts`.
- **`terms-banner.tsx`**: a hand-rolled `<p role=status|alert>` using `border-border bg-surface-raised`, with `text-critical` for the unaccepted case and a link to /terms. It calls GET `/api/store/terms`.
- **`(authed)/error.tsx`**: hand-rolled full-screen error. States are "Updating…" (stale chunk, auto-reloads), "Service unavailable" and "This page did not load". The button is raw `bg-accent-fill`, not the Button primitive.
- **`app/page.tsx`**: redirects to `/dashboard`.
- **API proxy** `app/api/[...path]/route.ts`. Middleware is `src/middleware.ts` (CSP nonce).
- **Loading, error and empty states everywhere** use `LoadingState`, `ErrorState` and `EmptyState` from `packages/ui/src/components/page.tsx`:
  - `LoadingState` is a **skeleton**: `role=status`, pulsing bars, N rows. There is no spinner anywhere in reseller.
  - `ErrorState` is a critical-tint box with a "Retry" underline button.
  - Suspense fallbacks also use `LoadingState`. `StoreConsigneePanel` uses `SkeletonRows` and `ErrorNote`. Dashboard tiles and accept-invitation use `Skeleton`.
- **Utility classes with no matching token** (they generate no CSS today):

| Class | Where |
|---|---|
| `text-text-inverse` | authed-shell.tsx:84 (nav badge); notifications-view.tsx:271 (active tab) |
| `border-border-subtle`, `divide-border-subtle` | notifications-view.tsx:156, 214, 235; notification-settings-view.tsx:237, 246, 337 |
| `text-warning` | reports/page.tsx:333; reports/analysis/page.tsx:266; store-consignee-panel.tsx:157; notification-settings-view.tsx:265, 350 |
| `text-danger` | customers/[id]/page.tsx:150 |

## A.1 Routes
Every page is a client component (`'use client'`) except where marked (server). All endpoints below are proxied through `/api/...`.

### Unauthenticated routes
These all wrap `AuthFrame` → `AuthConsoleShell`.

- **`/login`**: `app/login/page.tsx` (server; skips to /dashboard if a session exists) plus `_components/login-form.tsx` (client).
  - Form fields `#email`, `#password`, submitted through `ApiClient.login` (store identity).
  - Errors show as `<p role=alert text-critical>`: "Invalid email or password." (401), a rate-limit message (429), or the server's verdict.
  - Footer link to /password-reset.
- **`/password-reset`**: `app/password-reset/page.tsx`.
  - Form field `#email`, POST `/api/auth/store/password-reset/request`.
  - States: idle, sending, sent (`role=status` text). AuthFrame section="recovery", note="step 1 of 2".
- **`/auth/reset-password`**: server page plus `_components/reset-form.tsx`.
  - Form field `#password`, POST `/api/auth/store/password-reset/confirm` with `{token,newPassword}`.
  - States: missing token, done (link to /login).
- **`/auth/accept-invitation`**: server page plus `_components/accept-form.tsx`.
  - POST `/api/auth/store/invitations/preview`, then shows a DescriptionList (Store / Your role / Email).
  - Form fields `#fullName`, `#password`, POST `/api/auth/store/invitations/accept`.
  - Skeleton while the preview loads; the error is shown as an alert paragraph.
- **`/auth/verify-email`**: server page plus `_components/verify-panel.tsx`.
  - A button "Confirm my email" POSTs `/api/auth/store/email-verification/confirm`.

### Authed routes (`app/(authed)/…`)

**1. `/dashboard`** (`dashboard/page.tsx`)
- Calls GET `/api/store/reports/position`, only with `reports.view`.
- Shows:
  - PageHeader: store name, subtitle "Reselling for …".
  - A paused-store `<p role=status>` notice.
  - `PositionTiles`: 3 `Stat` (Wallet balance, You are owed [good], You owe your seller [warn/neutral]), each showing a `Skeleton` while pending. On error the tiles are hidden (returns null).
  - A shortcut nav grid of 5 hand-rolled `Link` cards.
  - Card "Your store" with a DescriptionList; the status uses `ResellerStoreStatusBadge`.
  - Card "What you can sell".
- No forms or dialogs.

**2. `/orders`** (`orders/page.tsx`, Suspense)
- Calls GET `/api/store/orders?status&search&page&pageSize`. Filter state lives in the URL.
- Header actions: ghost "Upload a CSV" and primary "New order" (with `orders.create`).
- Section toolbar: a search `Input` (w-[260px]) and a status `Select` (w-[200px]) whose options use `statusLabel`.
- Table columns: Order (mono link + "ref"), Customer (name + phone·city·pin), Status (`OrderStatusBadge`), To collect (Money or "Prepaid"), Placed. Rows are clickable (`onActivate`).
- `TablePaginator`. Empty text differs for filtered vs unfiltered.

**3. `/orders/new`** (`orders/new/page.tsx`)
- Calls GET `/api/store/catalogue`, then POST `/api/store/orders`.
- Form sections:
  - **Products:** repeated lines of Product `Select`, Qty, "Sell at (₹ each)" (hint shows the allowed range), and a remove button with the Trash2 icon; plus "Add another product".
  - **Customer:** Name, Phone (+91), Email, PIN code, Address, Landmark.
  - **Payment:** delivery charge, "Cash to collect (₹)", your reference, notes Textarea.
- A duplicate-order acknowledgement checkbox appears when the error contains `DUPLICATE_ORDER_SUSPECTED`.
- `FormActions`: Cancel, "Place order". On success it redirects to /orders/:id.
- States: no catalogue permission (EmptyState), loading, error, empty catalogue.
- No confirm dialog. Payment mode is fixed to COD.

**4. `/orders/import`** (`orders/import/page.tsx`)
- Endpoints, all under `/api/store/order-imports`:
  - GET `?page&pageSize` (polls every 5s while a row is PENDING or PROCESSING)
  - GET `/template` (downloads a CSV)
  - POST `/presign`, then a PUT of the file to the presigned URL
  - POST `/preview`
  - POST `/process`
  - GET `/:id/error-report`
- UI:
  - Button "Download the template".
  - A raw `<input type=file>` plus "Upload and check".
  - A preview box: either missing columns or row-limit exceeded shown as `text-critical`, or an "Import N orders" button.
  - Recent uploads table: File, Status (`UploadStatusBadge`), Orders, Failed, and an "Error report" button. Paginated.
- Toast "Import started…".

**5. `/orders/[id]`** (`orders/[id]/page.tsx`, about 1187 lines)
- Calls GET `/api/store/orders/:id` and GET `/api/store/action-policy`.
- **PageHeader:** mono order number; `OrderStatusBadge` and a ghost button "Cancel order" / "Ask the seller to cancel".
- **Cancel:** a `ConfirmDialog` (destructive) containing a Textarea, POST `/orders/:id/cancel`. Toasts "Order cancelled." or "Sent to Seller staff to approve…".
- **Customer and Money:** two Cards with hand-rolled `<dl>` grids.
- **Products table:** Product (ProductThumb), Qty, Sold at, You pay.
- **Parcel card:** waybill and `ShipmentStatusBadge`.
- **CallCapPanel** (when AWAITING_SELLER_DECISION): calls GET `/store/call-reviews`, then `CallReviewDecision`.
- **OrderActions:**
  - GET `/orders/:id/actions`; buttons RECALL / REATTEMPT / RTO.
  - A `Modal` with a "What happened" Textarea, POST `/orders/:id/actions`.
  - History table: What you asked, When, Where it got to (`DeliveryActionStatusBadge`).
- **AddressCorrection:**
  - GET `/orders/:id/address-changes`; button "Change this order".
  - A `Modal` with 9 fields (`fix-recipientName`, `fix-recipientPhoneE164`, `fix-recipientAltPhoneE164`, `fix-recipientEmail`, `fix-recipientAddressLine1`, `fix-recipientAddressLine2`, `fix-recipientCity`, `fix-recipientStateProvince`, `fix-recipientPostalCode`) plus `fix-reason` when approval is needed. PATCH `/orders/:id/recipient`.
  - History table uses `StoreAddressChangeStatusBadge`.
- **StoreConsigneePanel** (`_components/store-consignee-panel.tsx`):
  - GET `/orders/:id/consignee` and `/consignee/history`.
  - Fields `consignee-name`, `consignee-phone`, `consignee-address`, and a disabled `consignee-routing`.
  - Button "Ask the courier", POST `/orders/:id/consignee`. A refusal is shown as `text-warning` `role=status`.
- **HeldRequests:** GET `/orders/:id/requests`; table uses `StoreOrderRequestStatusBadge`.
- **OrderMoney** (`_components/order-money.tsx`):
  - GET `/orders/:id/money`.
  - A `StatusBadge` with `resellerCreditStatusKind` / `resellerCreditStatusLabel`, and a `<dl>` breakdown using Money with debit/credit direction.
  - A fees table (Skydrop fee, Your share) and a wallet-lines table (When, In your wallet via `storeWalletDirectionLabel`, Amount).
- **RaiseTicketLinks:** links to `/tickets/new?orderId&with=seller|skydrop`.
- **Timeline:** GET `/orders/:id/events`, rendered as a plain `<ol>` of time plus `statusLabel(toStatus)` or description. Empty text: "Nothing has happened…".
- Toasts: "Done.", "Sent to Seller staff…", "Corrected…", "The courier took the change…".

**6. `/orders/call-reviews`** (`orders/call-reviews/page.tsx`)
- Calls GET `/api/store/action-policy`, `/api/store/call-reviews`, and `/api/store/orders?status=AWAITING_SELLER_DECISION&pageSize=100`.
- Two `Stat` tiles: units held (warn/good) and orders waiting.
- A "seller answers" Card state.
- Table: Order, Customer, Units held, Calls made, Waiting, Your answer (`CallReviewDecision` trigger).

**7. `/customers`** (`customers/page.tsx`)
- Calls GET `/api/store/customers?search&page&pageSize=20`.
- Search form (Input w-[240px]).
- Table: Name (link), Phone (mono), Email, Orders (right), Last order. Paginated.

**8. `/customers/[id]`** (`customers/[id]/page.tsx`)
- Calls GET `/api/store/customers/:id` and `/api/store/orders?search=phone&pageSize=50`.
- DescriptionList of 6 items.
- `EditCustomer` Modal (`customers.manage`): fields `cust-name`, `cust-email`, `cust-alt`, PATCH `/api/store/customers/:id`. The error uses `text-danger`.
- Orders table: Order, Status (`OrderStatusBadge`), To collect, Placed.
- Toast "Saved. Your seller has been told…".

**9. `/catalogue`** (`catalogue/page.tsx`)
- Calls GET `/api/store/catalogue`, with client-side search.
- Table: Product (ProductThumb, SKU, description), You pay, Sell between, Suggested, Available (`Num`).

**10. `/terms`** (`terms/page.tsx`)
- Calls GET `/api/store/terms`.
- `CurrentCard`:
  - Version header; a needsRevision alert `<p>`; shares and credit lists.
  - Examples table: Fee, For example, You pay, {seller} pays.
  - "Accept version N" opens a `ConfirmDialog` (primary), POST `/api/store/terms/:versionId/accept`. Toast "Version N accepted."
- History table: Version, Published, Accepted.

**11. `/wallet`** (`wallet/page.tsx` + `_components/withdraw-card.tsx` + `_components/ledger-section.tsx`)
- Calls GET `/api/store/wallet`.
- Stats: Balance (bad if negative), You can withdraw, May go below zero by, Waiting on Skydrop.
- **TopupCard** (Skydrop-managed wallet plus `wallet.topups.manage`):
  - GET `/wallet/bank-accounts`.
  - Fields `tu-account` (Select), `tu-amount`, `tu-ref`, `tu-proof` (file).
  - Submit: POST `/wallet/topups/proof-upload`, then a PUT to the presigned URL, then POST `/wallet/topups` with an idempotencyKey.
  - Toast "Sent to Skydrop…". No confirm dialog.
- **WithdrawCard:**
  - Fields `wd-amount`, `wd-name`, `wd-account`, `wd-ifsc`, `wd-bank`, `wd-note`.
  - Submitting opens a `ConfirmDialog` whose title names the amount and payee. Confirming POSTs `/wallet/withdrawals` with an idempotency key.
- **RequestsSection:**
  - Top-ups table: Told us, Paid into, Amount, Reference, State. State uses a local `TOPUP_WORDS` map, not a badge. "View receipt" calls GET `/wallet/topups/:id/proof` through `openExternalWhenReady`.
  - Withdrawals table: Asked, To, Amount, State (`WithdrawalStatusBadge audience="seller"`).
- **LedgerSection:** GET `/wallet/entries?limit=50&cursor`. Table: When, What (`storeWalletDirectionLabel`), Amount (Money credit/debit via `isStoreWalletCredit`), Balance after. "Show older" button.

**12. `/reports`** (`reports/page.tsx`)
- Calls GET `/api/store/reports/position`, `/reports/pnl/months`, `/reports/pnl/months/:month`, and `/reports/pnl?from&to` (custom range).
- Up to 7 position `Stat`s, then a Period Select (`pnl-month`) plus date inputs (`pnl-from`, `pnl-to`), then 3 Stats (Revenue, Costs, Net good/bad).
- P&L lines are expandable Cards (CardHeader button, `aria-expanded`) with inner tables: Date, Order / item, What, Amount.
- Also: Expenses by category table, "Money in and out" table, and Carry tables (Month, Line, Why, Effect on net). Warnings are shown as `text-warning`.

**13. `/reports/analysis`** (`reports/analysis/page.tsx`)
- Calls GET `/reports/analysis?from&to` and `/reports/cash-flow`.
- Date inputs `from` and `to`.
- 4+4 Stats (rates, ROAS).
- Tables: Profit per product, Returns by pincode, Cash-flow weeks/waiting, Order by order (overdue shown as `text-warning`).
- `EmptyState bare` for empty sections.

**14. `/expenses`** (`expenses/page.tsx`)
- Calls GET `/api/store/expenses?from&to`.
- `RecordExpense` form (`expenses.manage`):
  - Fields `category` (Select), `amount`, `date`, `description`, `reference`.
  - POST `/api/store/expenses` with an idempotencyKey. No confirm.
- Table: Date, Category, What (strikethrough when removed), Amount, and a Remove button.
- `RemoveExpense` Modal with a required `reason` field, POST `/expenses/:id/remove`.
- Toasts "Recorded." and "Removed.".

**15. `/tickets`** (`tickets/page.tsx`)
- Calls GET `/api/store/tickets?stage`.
- Stage Select.
- Table: Ticket, With (`storeTicketKind`), Order, Status (`StatusBadge` with `ticketStatusKind` / `ticketStatusLabel`), Opened.

**16. `/tickets/new`** (`tickets/new/page.tsx` Suspense + `_components/new-ticket-form.tsx`)
- Calls GET `/api/store/action-policy`.
- Form:
  - Audience radios as radio-card labels (seller / skydrop).
  - `ticket-order`.
  - A figure-correction checkbox that reveals `ticket-claim-amount` and `ticket-claim-payer`.
  - `ticket-subject`, `ticket-description`.
- Submit goes to POST `/api/store/tickets` (dispute) or POST `/api/store/issues` (Skydrop). No confirm.

**17. `/tickets/[id]`** (`tickets/[id]/page.tsx`)
- Calls GET `/api/store/tickets/:id` and `/:id/events`.
- Outcome card, Correction section, and the conversation as an `<ol>` of chat-style bubbles (own messages `ml-8 text-right`).
- Reply Textarea, POST `/:id/notes`. Toast "Reply sent.".

**18. `/team`** (`team/page.tsx`)
- Calls GET `/api/store/team`.
- Members table: Name, Email, Role (inline `Select` change → PATCH `/team/members/:id/role`, instant, toast), Last signed in, Actions (destructive "Remove" → ConfirmDialog → DELETE `/team/members/:id`).
- Invitations table: "Withdraw" → ConfirmDialog → POST `/team/invitations/:id/revoke`.
- `InviteModal`: fields `invite-name`, `invite-email`, `invite-role`, POST `/team/invitations`.

**19. `/integrations`** (`integrations/page.tsx` + `_components/webhook-form.tsx`)
- **API keys:**
  - Form `key-name` + `key-expiry`, POST `/api/store/api-keys`, then the `OneTimeSecret` box with a Copy button.
  - Table: Name, Key, Last used, Expires, State, and "Revoke" → ConfirmDialog → DELETE `/api-keys/:id`.
- **Webhooks:**
  - Form `wh-url`, `wh-name`, `wh-description` plus `EventPicker` (a checkbox fieldset fed by GET `/webhook-endpoints/events`), POST `/webhook-endpoints`.
  - Table: Endpoint, Events, Last delivered, On (a `Switch` → PATCH, instant), and Edit / New secret / Remove buttons.
  - `EditWebhookModal`: fields `wh-edit-url`, `wh-edit-name`, `wh-edit-description`, PATCH `/webhook-endpoints/:id`.
  - Rotate secret → ConfirmDialog → POST `/:id/rotate-secret`. Remove → ConfirmDialog → DELETE.

**20. `/settings`** (`settings/page.tsx`)
- Calls GET `/api/store/profile`.
- `ProfileForm`: fields `displayName`, `contactEmail`, `contactPhone`, PATCH `/api/store/profile`. Without manage permission it shows a read-only DescriptionList.
- `LogoCard`: file input `logo-file`, upload via POST `/profile/logo/presign`, PUT to the presigned URL, then POST `/profile/logo/register`. "Remove logo" → ConfirmDialog → DELETE `/profile/logo`.

**21. `/account`** (`account/page.tsx`)
- DescriptionList for the user.
- "Send a confirmation link" calls POST `/api/auth/store/email-verification/request`.
- "Sign out everywhere" → ConfirmDialog (destructive) → POST `/api/auth/store/logout-all`.

**22. `/notifications`** (`notifications/page.tsx` server → `_components/notifications-view.tsx`)
- Endpoints under `/api/store/notifications`: GET the feed with a cursor, POST `/:id/read`, POST `/:id/unread`, POST `/read-all`, DELETE `/:id`, DELETE `/` (clear all). Topics come from `useNotificationTopics`.
- **Hand-rolled tabs:** local `TabButton` with `aria-pressed`, one tab per topic group. There is also a filter input and an "Unread only" checkbox.
- Rows are `<li>` elements with an icon tile tinted `var(--status-${tone}-bg/fg)` via `notificationKindStyle`. The expanded row shows the actions.
- "Mark all read" and "Clear all" have **no confirm**.

**23. `/notifications/settings`** (server → `_components/notification-settings-view.tsx`)
- Endpoints: topics, GET subscriptions, POST `/notifications/subscriptions`, DELETE `/subscriptions/:topic`, and GET/PUT `/api/store/notification-preferences`.
- A **local `Stat` component** (a duplicate of the ui `Stat`) with status tones.
- Cards with `CardHeader tone="accent"`. Every `Switch` toggle takes effect immediately.

## A.2 Status chips used in reseller
Badge components (from `status-badge.tsx`): `OrderStatusBadge`, `ShipmentStatusBadge`, `ResellerStoreStatusBadge`, `DeliveryActionStatusBadge`, `StoreAddressChangeStatusBadge`, `StoreOrderRequestStatusBadge`, `UploadStatusBadge`, `WithdrawalStatusBadge(audience=seller)`.

Plain `StatusBadge` called with a mapper:
- `ticketStatusKind` / `ticketStatusLabel` on tickets and the ticket detail page
- `resellerCreditStatusKind` / `resellerCreditStatusLabel` in order-money

Text or Money-direction helpers: `statusLabel` (order filter, timeline), `storeWalletDirectionLabel`, `isStoreWalletCredit`.

Top-up state is plain text (the local `TOPUP_WORDS` map), not a badge.

## A.3 Money-moving or irreversible actions

| Action | Endpoint | Confirm? |
|---|---|---|
| Withdraw | POST `/api/store/wallet/withdrawals` | **Yes**, ConfirmDialog |
| Top-up claim | POST `/wallet/topups/proof-upload` + PUT + POST `/wallet/topups` | No |
| Place order | POST `/api/store/orders` | No |
| CSV import | POST `/order-imports/process` | Two-step preview then button, no dialog |
| Cancel order | POST `/orders/:id/cancel` | **Yes**, destructive |
| Call-review Release (rejects order, releases stock) | PATCH `/api/store/call-reviews/:id` | Modal with `tone=critical`, consequence text, reason required; no second confirm |
| Delivery actions incl. RTO | POST `/orders/:id/actions` | Modal with reason; no separate confirm |
| Address correction | PATCH `/orders/:id/recipient` | Modal; no confirm |
| Courier consignee change | POST `/orders/:id/consignee` | No |
| Accept terms | POST `/store/terms/:id/accept` | **Yes**, primary |
| Figure-correction dispute (settles wallet money) / Skydrop issue | POST `/store/tickets` / POST `/store/issues` | No |
| Record expense | POST `/store/expenses` | No |
| Remove expense | POST `/expenses/:id/remove` | Modal with reason |
| Remove member | DELETE | **Yes** |
| Revoke invite | POST | **Yes** |
| Role change | PATCH on Select change | No |
| Revoke API key | DELETE | **Yes** |
| Create key | POST | No |
| Rotate webhook secret | POST | **Yes** |
| Delete webhook | DELETE | **Yes** |
| Toggle webhook | PATCH | No |
| Remove logo | DELETE | **Yes** |
| Upload logo | presign + register | No |
| Sign out everywhere | POST | **Yes** |
| Clear all / dismiss notifications | DELETE | No |
| Store notification categories | PUT | No, instant |

## A.4 `apps/reseller/src/components`
- **`auth-frame.tsx`** (`AuthFrame`): the auth page card. It uses AuthConsoleShell and AuthConsoleHeader "store portal", `TiltPanel`, and the `ticks` / `telemetry` / `glow-follow` / `boot-rise` classes. No ui equivalent.
- **`auth-console/console-shell.tsx`** (`AuthConsoleShell`, `AuthConsoleHeader`):
  - `.mc-login` wrapper, the ui `ThemeToggle`, console-grid, `CorridorConsole`, a radial veil and a glow.
  - The Skydrop wordmark and "sys online" status-dot.
  - Its own copy; it differs from admin's and seller's copies.
- **`auth-console/console.css`**: the `.mc-login` token overrides (details in D). It is **byte-identical to admin's**, and a test enforces that.
- **`auth-console/corridor-console.tsx`**: canvas map. Byte-identical across admin, seller and reseller (test-pinned). It differs from track's copy.
- **`auth-console/map-geometry.ts`**: identical across the three apps (test-pinned) and also identical to track's.
- **`call-review-decision.tsx`** (`CallReviewDecision`): trigger Button plus a Modal with radio-card choices, a consequence box and a Textarea. Uses ui primitives; no duplicate.
- **`notification-bell-container.tsx`**: a thin data wrapper around the ui `NotificationBell`.
- **`query-provider.tsx`**: TanStack QueryClient. Not UI.
- **`src/lib/tilt.tsx`** (`TiltPanel`, `Magnetic`): byte-identical to track's `lib/tilt.tsx` and pinned across admin, seller and reseller.

**Local patterns that overlap ui primitives:**
- The local `Stat` in notification-settings-view duplicates ui `Stat`.
- `TabButton` in notifications-view is similar to the ui `FilterChip` (`console.tsx`).
- The hand-rolled "← Customers / Orders / Tickets" back-links are ui `Crumbs`-like.
- Many ad-hoc `<p role=alert className="text-critical text-sm">` overlap ui `ErrorNote`.
- Hand-rolled `<dl>` grids in order detail and order-money overlap `DescriptionList`.
- Hand-rolled notice `<p>`s: terms-banner, paused store, needsRevision.
- The hand-rolled button in `error.tsx`.
- Radio-card labels are repeated in call-review-decision and new-ticket-form.

## A.5 Tests pinned to reseller markup
Playwright (`playwright.config.ts`, root `testDir: '.'`): project `reseller` at baseURL :3005 runs `apps/reseller/e2e/**/*.spec.ts` plus `e2e-shared/**/*.spec.ts`. The same shared specs run for the admin (:3002), seller (:3003), track (:3004) and marketing (:3006) projects.

- **`apps/reseller/e2e/login.spec.ts`**:
  - Text "Skydrop" (exact) and "store portal" (exact).
  - Heading "Sign in".
  - `#email`, `#password`.
  - Button "Sign in".
  - Text "Invalid email or password.".
  - Redirect of /dashboard to /login.
- **`e2e-shared/responsive.spec.ts`**:
  - Reseller routes `/login`, `/password-reset`, plus `/dashboard`, `/team`, `/settings`, `/account` when `E2E_RESELLER_EMAIL`/`PASSWORD` are set.
  - Widths 320/360/414/768.
  - Fails on any horizontal overflow; on a touch target under 30px tall or 20px wide unless it has `.skydrop-hit` or is an inline `<a>`; and on an input/select/textarea whose font is under 16px on coarse pointers.
  - Login uses `input[type=email]`, `input[type=password]`, `button[type=submit]`.
- **`e2e-shared/csp.spec.ts`**: nonce CSP, no violations, the page hydrates.

Vitest (`apps/reseller/vitest.config.ts`, happy-dom):
- **`src/tests/withdraw-card.test.tsx`**: labels `/^Amount/`, `/^Name on the account/`, `/^Account number/`, `/^IFSC/`, `/^Bank$|^Bank\*/`; button "Ask to withdraw"; `role=dialog` whose text contains "Ask Skydrop to pay" and "Kurta Corner · 123456789"; `role=alert`.
- **`src/tests/call-review-decision.test.tsx`**:
  - Buttons "Answer", "Keep trying", "Release the stock and reject the order", "Send to your seller to approve".
  - Radio `/Give up on this order/`; label `/Why you are giving up on it/` on a textarea.
  - Dialog text "held for this order", "and the order is rejected", "cannot be undone".
  - Text `/calling did not restart/` and `/Sent to Seller staff to approve/`; `role=alert`.
- **`src/tests/new-ticket-form-fe2.test.tsx`**: label "What is wrong"; buttons "Raise it with your seller" and "Raise it with Skydrop"; radio `/^Skydrop/`; `role=alert`.
- **`src/tests/page-access.test.ts`**: logic only.
- **`src/tests/pages-are-reachable.test.ts`**: every `(authed)` route string must appear in some other source file.

Cross-app tests:
- **`apps/admin/src/tests/auth-console-copies.test.ts`**:
  - Hashes corridor-console.tsx, map-geometry.ts and lib/tilt.tsx in admin, seller and reseller; they must be identical.
  - Reseller `console.css` must equal admin's.
  - Seller's `console.css` must differ.
- **`apps/admin/src/tests/ui-primitives.test.tsx`** pins shared ui markup:
  - Money renders `.skydrop-tabular`, `.text-[var(--color-credit)]` / `--color-debit`, the "+" and "−" glyphs, and an aria-label with "debit".
  - Num renders `.skydrop-tabular`; Ident renders `.font-mono`.
  - SortableTh sets `aria-sort`.
  - EmptyState with `bare` has no `.border`.
- **`apps/admin/src/tests/ops-status-kinds.test.tsx`** checks that `StatusBadge` renders `[data-status-kind]`.

# B. `apps/track` (track.skydrop.online, port 3004)

- **Package** `apps/track/package.json` depends on `@skydrop/ui`, but the **only** use is `@import '@skydrop/ui/corridor.css'`. No `@skydrop/ui/components` or `/status` imports (0 files).
- **README:** "MISSION CONTROL skin with a bright/dark theme toggle (localStorage `sd-theme`, prefers-color-scheme fallback)".

**Routes**
- **`/`** (`apps/track/src/app/page.tsx`, server):
  - Backdrop: console-grid, then `CorridorConsole` at `opacity: var(--map-veil)`, then a glow.
  - Top-right: `ThemeToggle` and `LocaleSwitcher`.
  - Masthead: logo `<img>`, brand (`font-display`), "sys online" status-dot, tagline. Each line has `data-map-text`, which the canvas uses to cut clear holes behind text.
  - `TiltPanel` wrapping a `div[data-lookup-panel].panel.ticks` that holds the "Parcel lookup" label, h1, subtitle, `SearchForm` and `glow-follow`.
  - Footer telemetry "bd → in corridor · webhook tracking".
- **`/[awb]`** (`apps/track/src/app/[awb]/page.tsx`, server): fetches `${API_ORIGIN}/public/tracking/:awb` with no-store and a 10s timeout. Three outcomes:
  - **not_found** (the "not found" state; there is **no** `not-found.tsx`): `MissShell` with telemetry "no signal" (`text-saffron`), h1 `notFoundTitle`, the AWB in mono, body text, and a "Try another AWB" link styled as a button.
  - **unavailable** (429, 5xx, network): `MissShell` with `[data-tracking-unavailable]` "link degraded", `unavailableTitle` / `unavailableBody`, an `<a>` Retry (full reload) and "Try another".
  - **found**: a `Header` (logo, brand, status-dot, ThemeToggle, LocaleSwitcher, "Track another").
    - Status instrument: `TiltPanel` wrapping `.panel.ticks[data-status-panel]` with `--tone` set inline. Contents: courier name, AWB (`text-sky`), a tone-coloured status dot (`delivered-ring` when delivered), an h1 status label in the tone colour, and "Updated" plus the date.
    - A `<dl>` of: optional `[data-sold-by]` (store logo `<img>` and name), Destination, Estimated delivery (mono).
    - Then the "Timeline" heading rule and `TimelineView`.
  - `STATUS_TONE` maps the 12 public statuses to `--tone-*` variables.
- **Timeline** `apps/track/src/app/[awb]/_components/timeline-view.tsx`:
  - An `<ol class="panel evt-rail">` of `<li class="evt-rise">` with a staggered `animationDelay`.
  - `STATUS_META` gives per-status tone, `terminal` flag, marker (`dot` / `ring` / `alert`) and `strike`.
  - Terminal statuses (delivered, returned, lost, damaged, cancelled) draw an `.evt-cap` bar. Ring nodes use the tone as border with a `--surface-2` fill. `delivery_attempted` gets the alert ring box-shadow. The latest event gets `status-dot` and a drop-shadow glow, and its label is in the tone colour. Cancelled is struck through.
  - Each row: label, `font-mono text-[11px]` timestamp, description, `telemetry` city.
  - Empty state: `.panel` with `noScansYet`.
- **Lookup form** `apps/track/src/app/_components/search-form.tsx` (client):
  - Label `telemetry` "AWB number" for `#awb`, a blinking `>_` prompt (`prompt-blink`).
  - Input: `h-12 rounded-xl`, `bg-[var(--surface-input)]`, `border-[var(--border-control)]`, mono, `text-base sm:text-sm`, focus ring `--focus-ring`.
  - Submit: `bg-sky text-accent-fg hover:bg-sky-deep h-12 rounded-xl`.
  - Pushes `/${encodeURIComponent(awb)}`.

**Locale**
- `apps/track/src/lib/i18n.ts`: `Locale = 'en' | 'hi'`, default `en`; the `Dict` holds about 40 keys (brand, tagline, landing, not-found, unavailable, detail labels, `soldBy`, 12 `s_*` status labels, switch labels); `t(locale, key)` and `statusKey()`.
- `apps/track/src/lib/locale.ts` (server-only): `getActiveLocale()` reads the `lang` cookie.
- `apps/track/src/app/_components/locale-cookie.ts`: `LANG_COOKIE = 'lang'`.
- `apps/track/src/app/_components/locale-switcher.tsx`: two buttons (`aria-pressed`) in `div[data-slot=locale-switcher]`. Active is `bg-sky text-accent-fg`. Clicking writes the cookie and does `location.reload()`.
- The layout sets `<html lang={locale}>`. **Fonts are Latin subsets only**, so Devanagari falls back to system fonts.

**Theme**
- `apps/track/src/lib/theme-init.ts` is its own init script: it applies a stored `sd-theme` to `data-theme` and writes **no** cookie.
- `apps/track/src/app/_components/theme-toggle.tsx` is a local copy (not the ui one). It reads `data-theme` and falls back to `matchMedia('(prefers-color-scheme: light)')`. It writes localStorage only, has `data-slot="theme-toggle"`, and renders an invisible placeholder before mount.
- The root layout does **not** server-render `data-theme`. With no pin, the theme follows the OS via corridor.css.

**Layout and fonts** (`apps/track/src/app/layout.tsx`): `next/font/local` Space Grotesk from `./fonts/space-grotesk-latin.woff2` (`--font-grotesk`), Inter from `./fonts/inter-latin.woff2` (`--font-inter`), JetBrains Mono from `./fonts/jetbrains-mono-latin.woff2` (`--font-jetbrains`). The theme script carries the nonce.

**CSS** (`apps/track/src/app/globals.css`, 453 lines; the only CSS file)
- Imports `@skydrop/ui/corridor.css` then `tailwindcss`.
- `@theme inline` maps: sky, sky-deep, saffron, green, red, surface/-2/-3, fg-strong/body/muted, line/-strong, accent-fg; fonts sans = inter, display = grotesk, mono = jetbrains.
- Utilities `@utility telemetry` and `@utility panel`; classes `.ticks`, `.console-grid`, `.status-dot`, `.prompt-blink`, `.evt-node*`, `.evt-cap`, `.evt-rail`, `.boot-rise*`, `.glow-follow`, `.evt-rise`, `.delivered-ring`, plus scrollbar rules.
- Light-only rules sit under `:root[data-theme='light']`: body gradient, `[data-status-panel]` tone wash via color-mix, `[data-lookup-panel]` shadow, input inset, toggle/switcher surfaces. The body background-image is declared twice; the later linear-gradient wins.
- Transitions and reduced-motion overrides.

**Corridor map** `apps/track/src/app/_components/corridor-console.tsx` (canvas; reads `--map-*` via getComputedStyle; a MutationObserver on `data-theme` repaints it) and `map-geometry.ts` (identical to reseller's).

**Tests for track**
- There is no `apps/track/e2e` directory and no vitest setup.
- `e2e-shared/responsive.spec.ts` covers `/` at 4 widths and `e2e-shared/csp.spec.ts` covers CSP.
- `apps/api/test/unit/track-csp-store-logo.spec.ts` reads `apps/track/src/middleware.ts` (the img-src Spaces allowance).

# C. `packages/ui`

## C.1 Files in `packages/ui/src`
- `index.ts`: re-exports status and tokens.
- `tokens/index.ts`: TS mirrors `SPACING`, `RADII`, `TYPE_SCALE`, `FONT_WEIGHTS`, `FONT_FAMILIES` (Geist) and `STATUS_HEX_DARK`. These are stale versus tokens.css (old sizes and hexes).
- `status/index.ts` (1210 lines): status-kind mappers and labels.
- `tokens.css`: the console tokens (admin, seller, reseller).
- `seller-theme.css`: the seller-only layer.
- `corridor.css`: public-site tokens (track only).
- `components/index.ts`: barrel.
- Components:
  - `app-shell.tsx`: shell.
  - `barcode.tsx`: Code128 SVG.
  - `button.tsx`: button.
  - `card.tsx`: cards.
  - `console.tsx`: seller "console chrome" (crumbs, chips, bands).
  - `data-table.tsx`: table primitives.
  - `feedback.tsx`: skeleton, error note, stat, description list, toolbar.
  - `form.tsx`: form controls.
  - `help-disclosure.tsx`: (i) help hook.
  - `issue-category-line.tsx`: ticket category line.
  - `menu-button.tsx`: hand-rolled nav menu.
  - `message-relay-status.tsx`: SENT/DELIVERED ticket message state.
  - `modal.tsx`: Radix dialog.
  - `money.tsx`: Money, Num, Ident, INR/BDT display context.
  - `notification-bell.tsx`: bell and panel.
  - `notification-kind.ts`: icon and tone per notification group, `agoLabel`, `humaniseTopic`.
  - `open-external.ts`: popup-safe open.
  - `order-journey.tsx`: journey ladder, timeline, parcel facts.
  - `page.tsx`: page header, sections, state panels.
  - `product-thumb.tsx`: image tile.
  - `status-badge.tsx`: status pills.
  - `switch.tsx`: `role=switch` button.
  - `theme-init.ts`: theme script and cookie helpers.
  - `theme-toggle.tsx`: toggle.
  - `ticket-handling-badge.tsx`: AUTO / MANUAL badge.
  - `toast.tsx`: Toaster and `useToast`.

## C.2 Components and props
- **AppShell:**
  - Props `brand`, `logoSrc`, `subtitle`, `sectionLabel`, `navGroups: NavGroup[]` (heading, index, items `{href,label,icon,badge}`), `identityPrimary`/`Secondary`, `identityHref`, `headerActions`, `headerAlways`, `headerCenter`, `drawerActions`, `footerNote`, `statusStrip`, `pathname`, `Link`, `onSignOut`, `signingOut`, `children`.
  - Types `NavItem`, `NavGroup`, `LinkLike`.
- **Barcode128:** `widths`, `heightMm`, `moduleMm`, `className`, `label`.
- **Button:**
  - Variants: primary, secondary, ghost, destructive, override.
  - Sizes: sm (`h-7`), md (`h-9`).
  - Carries the `skydrop-hit` class.
- **Card** (`tone` default | critical), **CardHeader** (`title`, `subtitle`, `action`, `tone` default | critical | accent), **CardBody**.
- **console.tsx:**
  - `Crumbs` (`items`, `Link`)
  - `MetaChip` (`tone` neutral | accent | good | warn | bad, `icon`, `dot`)
  - `SectionBand` (`index`, `title`, `note`, `action`)
  - `BandBody` (`flush`)
  - `FilterChip` (`label`, `count`, `active`, `dotColor`, `onClick`)
  - `StripFact` (`label`, `value`, `tone`)
- **data-table.tsx:**
  - `Table` (`responsive`, `wrapperClassName`; adds the `.sd-table-cards` class and stamps `data-label` on cells)
  - `THead`, `TBody`, `Tr` (`interactive`, `onActivate`), `Th`/`Td` (`align`)
  - `TableEmpty` (`colSpan`), `SortableTh`, `TablePaginator` (`page`, `pageSize`, `total`, `onPageChange`)
- **feedback.tsx:**
  - `Skeleton` (`rounded`), `SkeletonRows` (`rows`, `cols`), `ErrorNote` (`message`, `retry`)
  - `Stat` (`label`, `value`, `unit`, `icon`, `hint`, `foot`, `tone` neutral | warn | bad | good; renders `data-tone` and `data-stat-value`)
  - `DescriptionList` (`items`, `columns` 1 | 2 | 3), `Toolbar` (`actions`)
- **form.tsx:** `FormField` (`label`, `htmlFor`, `hint`, `notice`, `error`, `required`), `Label`, `Input`, `Textarea`, `Select` (all carry `.sd-field`), `FormActions`.
- **help-disclosure.tsx:** `useHelpDisclosure(subject, help, {size})` returns `{trigger, panel, open}`; also `helpSubject`.
- **IssueCategoryLine** (`categoryLabel`, `subcategoryLabel`), **MessageRelayStatus** (`relayedAt`), **TicketHandlingBadge** (`handling`), **ProductThumb** (`src`, `size`, `alt`).
- **MenuButton** (`label`, `items: MenuAction[]`, `Link`, `placement`).
- **Modal** (`open`, `onOpenChange`, `title`, `description`, `tone`, `size` sm | md | lg | xl), **ModalFooter**, **ConfirmDialog** (`confirmLabel`, `cancelLabel`, `confirmVariant` primary | destructive | override, `disabled`, `onConfirm`).
- **money.tsx:** `MoneyDisplayProvider`, `useMoneyDisplay`, `formatInr`, `Money` (`amount`, `direction`, `currency`, `convert`, `decimals`, `size`), `Num` (`value`, `suffix`), `Ident` (`value`).
- **NotificationBell:** `unread`, `items: BellItem[]`, `loading`, `onOpen`, `onMarkRead`, `onMarkAllRead`, `onDismiss`, `groupOf`, `labelOf`, `viewAllHref`, `preferencesHref`, `Link`.
- **notification-kind.ts:** `notificationKindStyle(group)` returns `{Icon, tone}`; `agoLabel`, `humaniseTopic`.
- **order-journey.tsx:** `JourneyLadder`, `ParcelFacts`, `JourneyTimeline`, `OrderJourneyPanels`, plus the view types.
- **page.tsx:** `PageHeader` (`title`, `subtitle`, `breadcrumb`, `meta`, `action`), `Section` (`title`, `subtitle`, `action`), `LoadingState` (`label`, `rows`), `ErrorState` (`message`, `retry`), `EmptyState` (`title`, `description`, `action`, `icon`, `bare`), `HasOverrideBadge`.
- **status-badge.tsx:**
  - `StatusBadge` (`kind`, `label`, `variant='soft'`; renders `data-status-kind`)
  - Typed wrappers: `OrderStatusBadge`, `ShipmentStatusBadge`, `SellerStatusBadge`, `ResellerStoreStatusBadge`, `TicketStatusBadge`, `DeliveryActionStatusBadge`, `StoreAddressChangeStatusBadge`, `StoreOrderRequestStatusBadge`, `FreightStatusBadge`, `WithdrawalStatusBadge` (`audience`), `TopupStatusBadge` (`audience`), `UploadStatusBadge`, `EarlyReviewStatusBadge`, `StockUnitStatusBadge`.
- **Switch** (`checked`, `onChange`, `label`, `disabled`).
- **Toaster** (children) and **`useToast()`** returning `{success, error, info}`, with a 3.5s TTL.
- **ThemeToggle** (`className`); **theme-init** exports: `THEME_STORAGE_KEY`, `THEME_COOKIE_NAME='sd-theme'`, `pinnedTheme`, `themeCookieString`, `writeThemeCookie`, `themeInitScript`.

**Usage** (files importing `@skydrop/ui/components`): admin 192, seller 111, reseller 41, track 0, marketing 0. Files importing `@skydrop/ui/status`: admin 19, seller 15, reseller 8.

Top named imports by file count:
- **Reseller:**
  - Button 26, PageHeader 24, LoadingState 24, Input 22, Section 21, ErrorState 21, FormField 19, EmptyState 18
  - Table/THead/TBody/Tr/Th/Td 17, Card/CardBody 17, useToast 16, Money 15, Select 9, CardHeader 8
  - Textarea 7, ConfirmDialog 7, Modal 6, ModalFooter 6, Stat 5, DescriptionList 5, TablePaginator 3, StatusBadge 3, OrderStatusBadge 3
  - Two files each: Switch, Skeleton, ProductThumb, Num, FormActions, notificationKindStyle, Toaster
  - One file each: AppShell, NotificationBell, ThemeToggle, ErrorNote, SkeletonRows, Ident, the 7 typed badges, openExternalWhenReady, agoLabel, humaniseTopic, theme-init helpers.
  - Reseller uses none of the `console.tsx` primitives, MenuButton, HelpDisclosure or OrderJourney.
- **Seller:** heavy on SectionBand/BandBody 55, Crumbs 46, MetaChip 37, StripFact 10, FilterChip 10, MenuButton 2.
- **Admin:** Button 138, Card 107, …; AppShell 1; none of the console.tsx primitives.

## C.3 `src/status` exports (all return one of 8 kinds)
The kinds are `STATUS_KINDS` = draft, pending, confirmed, in-transit, delivered, rto, failed, cancelled. `kindTokens(kind)` returns the CSS variables `--status-{kind}-bg/fg/ring`.

- **`orderStatusKind`** (OrderStatus):
  - draft: DRAFT
  - pending: PENDING_CONFIRMATION, CALL_*, PENDING_*, AWAITING_SELLER_DECISION, AWAITING_COURIER
  - confirmed: CONFIRMED, PICKED, PACKED
  - in-transit: DISPATCHED, IN_TRANSIT, OUT_FOR_DELIVERY
  - delivered: DELIVERED
  - rto: RTO_* except RTO_DAMAGED
  - failed: OUT_OF_STOCK, REJECTED*, PACK_FAILED, DELIVERY_FAILED, LOST_IN_TRANSIT, RTO_DAMAGED
  - cancelled: CANCELLED*
- **`shipmentStatusKind`** (ShipmentStatus): the same idea across the 16 values.
- **`ticketStatusKind`** / **`ticketStatusLabel`**: Open, "Reviewing", "Closed · refunded / goods back / write-off / not upheld / by the courier".
- **`consignmentStatusKind`**, **`inboundFreightStatusKind`**, **`labelReprintStateKind`**, **`withdrawalStatusKind`** / **`withdrawalStatusLabel`** (`staff` | `seller` audience), **`topupStatusKind`** / **`topupStatusLabel`**, **`uploadStatusKind`** / **`uploadStatusLabel`**.
- **`resellerStoreStatusKind`** / **`Label`**, **`deliveryActionStatusKind`** / **`Label`**, **`storeAddressChangeStatusKind`** / **`Label`**, **`storeOrderRequestStatusKind`** / **`Label`**, **`resellerCreditStatusKind`** / **`Label`** (WAITING, DUE, CREDITED, REVERSED, SKIPPED).
- **`earlyReviewStatusKind`**, **`stockUnitStatusKind`**, **`inviteLeadStatusKind`**.
- **`statusLabel`**: a generic Title Case helper; VOIDED becomes "Withdrawn".
- **`isWalletCredit`** / **`walletDirectionLabel`** (WalletEntryDirection); **`isStoreWalletCredit`** / **`storeWalletDirectionLabel`** (StoreWalletEntryDirection, with the seller name).
- **`courierLabel`**, **`freightModeWords`**, **`freightModeExplainer`**, **`FREIGHT_MODES`**, and the type `FreightAudience`.

## C.4 CSS
**`packages/ui/src/tokens.css`** (dark is the default on `:root`; light is under `[data-theme='light']`; there is **no** `prefers-color-scheme` rule)
- Colour tokens:
  - Neutral: `--color-bg`, `surface`, `surface-raised`, `surface-hover`, `border`, `border-strong`, `text-faint`, `text-muted`, `text-body`, `text-strong`, `text-bright`.
  - Accent: `--color-accent`, `-hover`, `-fill`, `-fill-hover`, `-fg`, `-tint`, `-ring`.
  - Critical: `--color-critical`, `-tint`, `-ring`.
  - Status: `--status-{8 kinds}-{bg,fg,ring}`.
  - Money: `--color-credit`, `--color-debit`.
- Scale tokens:
  - Spacing: `--space-0…16`.
  - Type: `--font-sans`/`--font-mono` (literal 'Geist'), `--text-xs 13 / sm 15 / base 16 / md 17 / lg 19 / xl 24 / 2xl 30`, `--leading-*`, `--weight-*`.
  - Radii: `--radius-1 3 / 2 5 / 3 7 / pill`.
  - Shadows: `--shadow-1..3`.
  - Motion: `--duration-*`, `--easing-out`.
  - Numerics: `--numeric-tabular`.
- Light-only chrome:
  - Navy nav rail on `[data-theme='light'] aside, [data-slot='nav-drawer']`, with `aria-current='page'` painted as a blue pill.
  - Tinted `[data-tone]` stat tiles and `[data-stat-value]`.
- Utility classes: `.skydrop-baseline`, `.skydrop-tabular`, `.skydrop-hit` (44px hit area on coarse pointers), `.sd-table-cards` / `.sd-table-cards-wrap` / `.sd-toolbar-attached` (tables become cards under 768px), `.sd-field` (in `@layer base`).
- Touch floors for input/select/textarea/a/button, `dd` wrapping, hidden-until-hover scrollbars, and reduced motion.

**`packages/ui/src/seller-theme.css`** (imported only by seller, after tokens.css)
- Redefines the same variables for dark (`:root`) and light (`[data-theme='light']`).
- Fonts: `--font-sans: var(--font-plex-sans)`, `--font-mono: var(--font-jetbrains-mono)`. Type scale 12/13/15/16/20/22/28. Radii 2/4/6.
- Adds `--console-rail-*`, `--console-band-bg`, `--console-strip-bg`, `--console-grid`.
- Undoes the navy light rail, then styles `[data-slot=nav-rail|nav-drawer|status-strip]` and the `aria-current` pill and bar.
- `thead th` becomes mono 11px uppercase. Tone tiles are tinted in both themes. `.skydrop-tabular` and `[data-stat-value]` are set in mono.

**`packages/ui/src/corridor.css`** (public sites; now imported by **track only**; marketing's `theme.css` says it stopped)
- Dark on `:root, :root[data-theme='dark']`; light is declared twice: under `@media (prefers-color-scheme: light) { :root:not([data-theme='dark']) }` and under `:root[data-theme='light']`. Sets `color-scheme`.
- Token groups:
  - Brand: `--sky`, `--sky-deep`, `--saffron`, `--green`, `--red`.
  - Surfaces: `--surface`, `--surface-2`, `--surface-3`, `--surface-input`, `--page-top`, `--page-bottom`.
  - Lines and focus: `--line`, `--line-strong`, `--border-control`, `--focus-ring`.
  - Text: `--fg-strong`, `--fg-body`, `--fg-muted`, `--fg-faint`.
  - Base tones (8): `--tone-neutral`, `-neutral-quiet`, `-moving`, `-arriving`, `-done`, `-attention`, `-returning`, `-fault`.
  - Per-status tones (9 aliases): `--tone-processing`, `-cancelled`, `-dispatched`, `-in-transit`, `-out-for-delivery`, `-delivered`, `-attempted`, `-returned`, `-lost`.
  - Map: `--map-land`, `-coast`, `-bd-fill`, `-bd-coast`, `-route`, `-halo`, `-trail`, `-blip`, `-origin`, `-label`, `-sweep`, `-veil`, `-veil-soft`.
  - Other: `--accent-fg`, `--grid`, `--glow`.
- **`--tone-returning` is used in track TSX (`STATUS_TONE`, `STATUS_META`) and is defined as a base tone.** There is no `--tone-return-initiated` or `--tone-returning`-specific alias.

**Which app imports which**

| App | globals.css imports |
|---|---|
| admin | `tokens.css` → `tailwindcss` |
| seller | `tokens.css` → `seller-theme.css` → `tailwindcss` |
| reseller | `tokens.css` → `tailwindcss` |
| track | `corridor.css` → `tailwindcss` |
| marketing | its own `scales.css` + `theme.css` + `tailwindcss` (no ui CSS) |

**Package exports** (`packages/ui/package.json`): `"."`, `"./tokens"`, `"./status"`, `"./components"` (all point to `dist/*.js` and `.d.ts`), plus `"./tokens.css"`, `"./corridor.css"`, `"./seller-theme.css"` (all point to `dist/`).
- The build is `tsc` plus a copy of the 3 CSS files into `dist`. They are currently in sync with `src`.
- Because exports resolve to `dist`, edits to `src` need `pnpm --filter @skydrop/ui build`; turbo has `dependsOn ^build`.
- Tailwind scans `packages/ui/src` through `@source`.

## C.5 ThemeToggle, theme-init, AppShell
- **`theme-init.ts`** has no `'use client'`, so layouts can import it from the server.
  - The script applies a localStorage `sd-theme` value (dark or light) to `<html data-theme>` and syncs the `sd-theme` cookie. Cookie attributes: path=/, 1 year, SameSite=Lax, Secure on https.
  - Layouts render `data-theme={pinnedTheme(cookie)}` server-side. With no pin, the attribute is absent and the CSS default (dark) applies; the OS setting is not followed.
- **`theme-toggle.tsx`** (client):
  - A `role=switch` button, 36px square, showing a Sun or Moon icon. It stays `disabled` and `opacity-0` until mounted.
  - It restores the stored pin, writes localStorage and the cookie, and syncs across tabs through the `storage` event.
  - It is used by AppShell (desktop header and drawer footer) and by the auth-console shells in admin, seller and reseller.
- **`app-shell.tsx`** (client):
  - At `lg` and above: a sticky `aside[data-slot=nav-rail]` sidebar, 236px wide, with the brand block, nav and footerNote.
  - Below `lg`: a Radix Dialog drawer `[data-slot=nav-drawer]` holding drawerActions, the identity, ThemeToggle and SignOut.
  - Sticky header (min 52px, `bg-surface/95 backdrop-blur`) with sectionLabel, headerCenter, headerAlways, headerActions, identity, ThemeToggle and an icon-only SignOut.
  - The active nav item is the longest matching href, marked with `aria-current=page`.
  - `<main>` has responsive padding and a safe-area inset. There is an optional `[data-slot=status-strip]`.

# D. Per-app globals.css, fonts and console.css

| App | globals.css | Layout fonts (`next/font/local`) | console.css |
|---|---|---|---|
| admin | `tokens.css`, `tailwindcss`, `@source` ui | `fonts/geist-latin.woff2` (`--font-geist-sans`), `fonts/geist-mono-latin.woff2` (`--font-geist-mono`) | `apps/admin/src/components/auth-console/console.css` |
| seller | `tokens.css`, `seller-theme.css`, `tailwindcss` | `fonts/ibm-plex-sans-latin.woff2` (`--font-plex-sans`), `fonts/jetbrains-mono-latin.woff2` (`--font-jetbrains-mono`) | `apps/seller/src/components/auth-console/console.css` |
| reseller | `tokens.css`, `tailwindcss` | Geist and Geist Mono, same files as admin | `apps/reseller/src/components/auth-console/console.css` |
| track | `corridor.css`, `tailwindcss` | Space Grotesk `--font-grotesk`, Inter `--font-inter`, JetBrains Mono `--font-jetbrains` | none |

- The admin, seller and reseller layouts all render `data-theme` from the cookie and inline the ui `themeInitScript` with the nonce. Track uses its own script and does not server-render the theme.
- **Admin and reseller `console.css`** (222 lines, identical, test-pinned):
  - `.mc-login` defines raw `--sky` / `--sky-deep` / `--saffron` / `--green` / `--grid` / `--glow` (cyan #38bdf8) and overrides the `--color-*` tokens in a "NIGHT OPS" palette.
  - Light comes from both `@media (prefers-color-scheme: light) :root:not([data-theme='dark']) .mc-login` and `[data-theme='light'] .mc-login`.
  - Chrome classes: `.telemetry` (13px), `.console-grid`, `.ticks`, `.status-dot`, `.boot-rise*`, `.glow-follow`, and reduced motion.
- **Seller `console.css`** (229 lines): the token values match seller-theme.css dark (`--color-bg: #090d16`) and light (`#f8f9ff`), with sky #4b83f0. It must differ from admin's.
  - `apps/seller/src/tests/seller-theme-scope.test.ts` pins that seller-theme loads after tokens, that admin's globals lack it, and that no packages/ui CSS pulls it in.
  - The same test pins seller console.css: it contains `--color-bg: #090d16` and not `#060b16`, has exactly 3 blocks, the two light copies are identical, and the light block contains `--color-bg: #f8f9ff`.
