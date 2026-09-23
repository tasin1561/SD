# Motion coverage — admin area AA (order operations)

Pages: `/orders`, `/orders/[id]` (every panel, god mode included), `/call-center`,
`/call-center/queue`, `/call-center/agents`, `/delivery-actions`,
`/reattempt-requests`, `/manual-placement`, `/courier-decisions`, `/holds`, `/nsa`.

Shared area pieces: `orders/_components/order-ops-parts.tsx` + `order-ops.css`
(prefix `oo-`: soft section cards, fact lists, notices, `AgeChip`, queue cards,
the god-mode panel). Per-folder CSS: `order-core.css` (`oc-`),
`order-shipping.css` (`os-`), `call-center/_components/call-center.css` (`cc-`),
`courier-decisions/_components/courier-decisions.css` (`oq-`). Tokens only; every
grid uses minmax columns.

## Area-wide n/a

| Pattern | Why not here |
|---|---|
| Van drive-off (create order busy state) | Admin creates no orders. |
| Paper-plane send | No ticket reply in this area. |
| ParachuteProgress | No bulk, import or backfill operation in this area (charges backfill and bulk dequeue live in other areas). |
| SegmentedCode | No six-digit code in this area. |
| Stepper (u34) | No multi-step flow. God mode keeps its own two-stage chrome (edit → typed confirm) by rule. |
| Liquid-bead Tabs | None of these pages had a tab UI. |
| Per-row table animation | Forbidden. Rows get hover only. |

## /orders

| Pattern | Where |
|---|---|
| PageHeader | Breadcrumbs + "N orders" / "Filtered" meta fact |
| FilterBar | Search (form submit on Enter unchanged), status, source, seller, placed from/to |
| DataTable + Pagination | Page size 20; row `onActivate` → `/orders/{id}` unchanged |
| StatusChip | `orderStatusKind` / `statusLabel` via `chipWords` |
| Skeleton / EmptyState / ErrorState | SkeletonRows; EmptyState; ErrorState with retry |
| Toasts, KPI, Timeline, confirms | n/a: no actions and no summary endpoint on the page |

## /orders/[id]

| Pattern | Where |
|---|---|
| Skeleton / ErrorState | Header + row skeletons; ErrorState with retry |
| u17 Timeline | Journey stage list (full history stays on the shared `JourneyTimeline`); consignee change history |
| StatusChip | Order status, shipment status, reseller credit status |
| ConfirmDialog | Cancel order, release reservations, restore stock claim, compute charges (new), retry stock (new), send back to pick (new), NDR re-attempt (new), shipment cost (new), cancel with courier / cancel voided waybill / mark cancelled outside (reason-gated confirm) |
| Dialog | Admin return, god mode (critical, locked while running), correct recipient, e-way bill, manual scan, manual placement place / cancel (critical) |
| AsyncButton (rolling label) | Courier correction, e-way bill, courier cancel confirms, consignee send, manual placement, manual scan |
| Toasts (app `useToast`) | Stuck recovery, return, compute charges, courier ops, consignee, manual placement |
| DataTable | Items, charges, reseller lines, reseller money tables |
| KPI count-up | n/a: no plain counts |

## /call-center (station)

| Pattern | Where |
|---|---|
| AsyncButton (controlled by `isPending`) | Check for a call, Record outcome, Release |
| u17 Timeline | Previous calls on this order and earlier orders |
| EmptyState | Positive when available and nothing is queued |
| Skeleton | Availability, my-call history |
| Toasts | Record / queue-empty / release results |
| StatusChip | Availability |
| Keyboard / flow | Unchanged: no Enter handlers or autoFocus existed; heartbeat, bootstrap gate and timers byte-identical |

## /call-center/queue

| Pattern | Where |
|---|---|
| KpiCard count-up | Open, Pending, Assigned, Agents holding work |
| DataTable + Pagination | Page size 25; row → order unchanged |
| AgeChip | Waiting since (neutral: the queue had no severity rule) |
| StatusChip | Local `queueKind` |
| Dialog | Reschedule, reassign, force outcome (critical) |
| AsyncButton | Reschedule, reassign, record forced outcome |
| EmptyState | Positive "Queue is empty" |

## /call-center/agents

| Pattern | Where |
|---|---|
| KpiCard count-up | Agents, marked available, calls held now |
| DataTable | Roster, outcome metrics |
| AsyncButton | Save capacity |
| Skeleton / EmptyState | List + attempts skeletons; neutral empty |

## Queues: /delivery-actions, /reattempt-requests, /manual-placement, /courier-decisions, /holds, /nsa

| Pattern | Where |
|---|---|
| Prioritised list + AgeChip | Every row. Tones reuse each page's existing thresholds (manual placement 12h/24h, courier decisions 2h/6h, holds ≥3 days open, NSA 2nd/3rd night); delivery actions and reattempts had no rule → neutral |
| StatusChip | Delivery actions (local `statusKind()`), holds (early-review mappers), others where a status existed |
| Layout | Tables for the five dense queues; queue cards (`oo-qcard`, severity bar) for reattempts |
| EmptyState | Positive when a queue is empty; neutral for filtered / "all" views |
| Skeleton / ErrorState | All six |
| KpiCard | Holds (one count-up, two `<Num>` figures), NSA (three count-ups) |
| ConfirmDialog | NSA "Check now" sweep (new) |
| Dialog + AsyncButton | Delivery-action decide, reattempt decide, NSA acknowledge |
| Toasts | NSA acknowledge + sweep (app `useToast`) |
