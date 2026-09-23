# Motion coverage — admin area AE (Money 2: our money and reports)

Pages: `/treasury`, `/bank-accounts`, `/bank-accounts/history`, `/liabilities`,
`/liabilities/instant-pay`, `/pnl`, `/pnl/carry-forward`, `/expenses`,
`/expenses/categories`, `/courier-wallet`, `/margin`, `/pricing`, `/reports`.

Shared area pieces: `treasury/_components/money-parts.tsx` + `money.css`
(prefix `mo-`: soft section cards, fact lists, notices, `AgeChip`, form grids,
radio cards). Per-folder CSS: `treasury.css` (`tr-`), `bank-accounts.css` (`ba-`),
`bank-account-history.css` (`bh-`), `liabilities.css` (`li-`), `pnl.css` (`pl-`),
`expenses.css` (`ex-`), `courier-wallet.css` (`cw-`), `margin.css` (`mg-`),
`pricing.css` (`pr-`), `reports.css` (`rp-`). Tokens only; every grid uses
minmax columns.

## Area-wide n/a

| Pattern | Why not here |
|---|---|
| Van drive-off | No order creation in this area. |
| Paper-plane send | No ticket reply in this area. |
| SegmentedCode | No six-digit code in this area. |
| Stepper (u34) | No multi-step flow; money forms are form → confirm, which ConfirmDialog carries. |
| Timeline (u17) | The only history lists (P&L locked versions, bank-account changes) are dense comparison tables with per-row actions or diff columns; kept as DataTable. |
| Per-row table animation | Forbidden. Rows get hover only. |

## /treasury

| Pattern | Where |
|---|---|
| PageHeader | Title, subtitle, "Move money" primary action (permission-gated as before) |
| KpiCard | Owed to sellers, held for sellers, surplus/shortfall, in courier wallets (links out), total per currency — figure is the existing `<Money>` |
| DataTable | Accounts (expandable holder breakdown), recent movements |
| Skeleton / EmptyState / ErrorState | KPI + row skeletons; bare EmptyState in both tables; ErrorState + retry |
| StatusChip | Opening balance (confirmed), Phase 1B (draft) |
| Notice | Shortfall explanation (bad tone, icon) |
| ConfirmDialog | NEW review step for transfer, owner money, reconcile (same request, same idempotency key) |
| Dialog + AsyncButton | Mark as opening balance (replaces `window.prompt`; same reason, same request) |
| Toasts | n/a: none before; outcomes shown by the dialog closing |

## /bank-accounts

| Pattern | Where |
|---|---|
| PageHeader + section card | Change history link, Add account |
| DataTable | Accounts; account number / IFSC / routing in `sk-ident` |
| StatusChip | Offered / hidden |
| Skeleton / EmptyState / ErrorState | SkeletonRows; EmptyState ("cannot top up at all"); ErrorState + retry |
| Dialog + AsyncButton | Add / edit account form |
| ConfirmDialog | Retire (NEW, destructive) |
| Toasts (app `useToast`) | Added, updated, retired — same messages |

## /bank-accounts/history

| Pattern | Where |
|---|---|
| BackLink + PageHeader, Notice | Back link; "Recording began on 7 September 2026" |
| DataTable, StatusChip | When / What / Changed / By; Added / Edited / Retired |
| Skeleton / EmptyState / ErrorState | yes |
| Confirms, toasts, KPI | n/a: read-only audit list |

## /liabilities

| Pattern | Where |
|---|---|
| PageHeader | Title and subtitle |
| KpiCard | We owe, Owed to us, Net position (`<Money>` figures) |
| Notice | "The two sides do not cancel"; notes under "Sellers in the red" |
| DataTable | We owe / Owed to us lines (instant-pay drill-down kept); sellers in the red |
| StatusChip | Covered by stock / Uncovered |
| Skeleton / ErrorState | yes, with retry |
| Toasts, confirms | n/a: read-only |

## /liabilities/instant-pay

| Pattern | Where |
|---|---|
| PageHeader | Back link "What we owe" as a ghost button |
| KpiCard | COD awaiting courier, cash fronted, credited (`<Money>` figures) |
| FilterBar + Select | Seller, courier account (same state and query params) |
| DataTable + SortableTh | Oldest first, unchanged |
| AgeChip | Age column (neutral: no severity rule existed) |
| Skeleton / ErrorState / TableEmpty | Empty copy + "See courier payouts" unchanged (pinned) |
| Toasts | n/a: read-only; the test mounts it without the app ToastProvider |

## /pnl

| Pattern | Where |
|---|---|
| PageHeader | "Carry-forward P&L" link |
| DateField | From / To (IST window arithmetic untouched) |
| KpiCard | Gross margin, Operating expenses, Net |
| Accordion (u19) | Every P&L line, one open at a time; drill-down mounted and fetched only while open |
| DataTable | Rows behind a line |
| Notice / Skeleton / ErrorState | Warnings; skeletons; ErrorState + retry |
| Toasts, confirms, ParachuteProgress | n/a: read-only |

## /pnl/carry-forward

| Pattern | Where |
|---|---|
| Select, KpiCard, StatusChip | Month picker; own net, carried-in, net incl. carry-forwards; Provisional / Locked permanently |
| Accordion (u19) | Month lines, carried-forward groups (drill-downs mounted only while open) |
| DataTable | Locked versions, frozen/live rows, carried changes, backfill preview/result |
| Dialog (critical, locked while running) + AsyncButton | Close month, lock permanently, god-mode re-lock (justification ≥30, risk checkbox, typed month) |
| ConfirmDialog | Backfill close (entity, month count, consequence) |
| ParachuteProgress | Backfill real close (indeterminate, running/done/failed from the real request) |
| EmptyState | "Nothing carried forward" (neutral), "None yet" (positive) |
| Toasts | n/a: none before |

## /expenses

| Pattern | Where |
|---|---|
| Liquid-bead Tabs | Spending / Investments (replaces local `TabButton`; same values and state) |
| DataTable, StatusChip | Ledger; investments; Uncategorised / Out / Closed |
| Dialog + ConfirmDialog | Record expense / pay forwarder, place capital, record return (form then NEW confirm); attach to consignment (ConfirmDialog with search) |
| Skeleton / EmptyState / ErrorState | yes, with retry |
| Toasts (app `useToast`) | Expense, attribution, capital placed, return, attach |
| KPI | n/a: no summary figures |

## /expenses/categories

| Pattern | Where |
|---|---|
| DataTable, StatusChip, Checkbox | Code in `sk-ident`; Active / Retired; show retired |
| Dialog + AsyncButton | New / edit category |
| ConfirmDialog | Retire (destructive) / restore |
| Toasts | Added, saved, retired, restored |

## /courier-wallet

| Pattern | Where |
|---|---|
| KpiCard | Held at couriers (`<Money>`); count-up on unbooked recharges and paid-never-arrived |
| DataTable, StatusChip | Never-arrived payments, wallets, recharges; match state (same words) |
| Dialog | Record bank side (restates amount/account/date — it is the confirm), explain (critical, 20-char gate) |
| ConfirmDialog | NEW: record a wallet top-up (wallet, amount, paid-from, date, reference; same idempotency key) |
| AsyncButton, toasts | Record payment, record explanation; results toasted |

## /margin

| Pattern | Where |
|---|---|
| KpiCard | Billed, courier charged, margin (`<Money>`); loss-making lanes (count-up) |
| DataTable, StatusChip | Row → order unchanged; "Loss" chip |
| AsyncButton (controlled) | "Quote against the rate card" follows the live query |
| Skeleton / EmptyState / ErrorState | yes |

## /pricing

| Pattern | Where |
|---|---|
| TextField / Select, AsyncButton | Preview form (ids `pp-*` unchanged); Calculate; backfill Preview buttons |
| ConfirmDialog | NEW before "Add the missing charges"; "Charge them" moved to the app ConfirmDialog |
| ParachuteProgress | Both real runs (indeterminate; done/failed from the real result) |
| Toasts, Notice, DataTable | Backfill results; engine fallbacks; the charge |

## /reports

| Pattern | Where |
|---|---|
| DateField | From / To (ids `reports-from`, `reports-to`; same value/onChange) |
| KpiCard | Seven order counts (count-up); rates, averages, wallet `<Money>` figures |
| Skeleton / ErrorState | yes, with retry |
| Toasts, confirms | n/a: read-only |
