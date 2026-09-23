# Motion coverage — admin area AC (people and configuration)

Routes: `/sellers`, `/sellers/[id]`, `/stores`, `/reseller-stores`,
`/reseller-stores/[storeId]`, `/reseller-stores/analysis`, `/leads`, `/staff`,
`/roles`, `/account`, `/settings`, `/notifications`,
`/notifications/broadcasts`, `/notifications/settings`.

Shared pieces: `(authed)/settings/_components/ac-parts.tsx` + `ac.css`
(page column, section / card, description list, alert, callout, fact pill,
reveal field, `SellerStatusChip`, `phaseOf`). Tokens only.

| Pattern | Where used | n/a (reason) |
|---|---|---|
| Rolling-label AsyncButton | Every async submit: invite seller, reveal bank account, save short code, apply identity correction, place / lift a hold, credit-after-confirmation switch, set override, link account, save weight, open a reseller store, pause a store, show older ledger rows, store add / rename, lead save / send invite / resend, staff invite, role save, account "send a new link", system setting save, broadcast count + send | Plain row actions that only toggle (pause/activate link, make default, close/reopen, mark read, reset override) stay plain buttons — their result is the row changing |
| Liquid-bead Tabs | `/leads` status tabs (replaced the hand-made button row; counts as tab badges) | No other page in the area has tabs |
| Skeletons | Every list and detail loading state (replaced `LoadingState`) | — |
| EmptyState (u27) | All empty lists; **positive** tone for "No store is over a threshold", "No open disputes", empty notification inbox | — |
| Toasts (app `useToast`) | Results across the area | Three components keep the legacy `useToast` because their tests mount only the legacy `<Toaster>`: `seller-courier-links-section`, `bulk-dequeue-panel`, `role-editor` (the shell mounts both, so users see the same toast) |
| KpiCard | Store wallet (balance, manager, negative limit, waiting), reseller analysis (open / settled disputes with count-up; float totals as `<Money>` figures) | Not a dashboard elsewhere in the area |
| Timeline (u17) | Reseller store status history | Terms history stays a table (versions, not a journey) |
| Stepper (u34) | — | No multi-step flow in the area |
| ParachuteProgress | — | No bulk/import/backfill here; bulk dequeue is one request with no progress to report |
| SegmentedCode | — | No six-digit code in the area |
| PaperPlaneSendButton | — | Admin quiet set (APPS-INVENTORY §4): broadcast send keeps the rolling-label button |
| Status chips | Seller status, reseller store status, lead status, invitation status, override source, link state, store open/default, fraud severity, ticket status, broadcast status, setting value type | — |
| DataTable | Every table (the two raw staff tables moved onto it) | Settings and notifications are lists, not tables |
| Pagination (u16) | `/sellers`, `/leads` | Other lists are unpaged or cursor-paged ("Show older", "Older") |
| MotionSwitch | `/account` → "This browser" card | — |
| Switch (u08) | Credit after confirmation; per-topic notification settings | Other booleans are checkboxes where a test or a form expects a checkbox |
| Row hover | Tables and list rows (hover background only, no per-row animation) | — |

Confirm dialogs (ConfirmDialog, restating entity + consequence): suspend /
reapprove seller, delete seller invitation, unlink courier account, close a
seller's call queue, delete role, sign out everywhere (all existed as modals
and moved); **new**: staff role change (the select now opens a confirm
instead of firing the PATCH), deactivate staff member and revoke staff
invitation (were inline Confirm / Cancel buttons), clear all notifications.
Pause store keeps its critical dialog with the reason field (ConfirmDialog
cannot disable its confirm, which the permission gate needs). No
`window.confirm` / `window.prompt` existed in the area.

Reduced motion: handled by the primitives; nothing here animates on its own
except the disclosure chevron (transform, collapsed by the global rule).
