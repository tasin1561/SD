# Motion coverage — admin area AF (couriers, system, tickets, dashboard)

Pattern → where it is used, or n/a with the reason. Shared area pieces live in
`apps/admin/src/app/(authed)/system/_components/af-parts.tsx` + `af.css`
(section, soft card, notice, meta chip, fact list, transform-only meter,
queue card, message bubbles).

| Pattern | Where | n/a reason |
|---|---|---|
| Rolling-label AsyncButton | Escalation: Reconcile, Claim, Mark sent, Give back, Send confirmation code, Confirm (code); Threads: Queue reply, Save their reply; Templates: Make it live, Not worth one; Tickets: Apply (detail); System issues: I'm on it; Delhivery: Run a cycle now, Look up; Shiprocket: Check (reachability); Cost sync: Check bills now; unused ticket courier panel: Start, I have sent this | Buttons whose handler never rejects (register/update pickup, portal login, create/edit account, resolve issue) keep `Button loading` so a refusal is never shown as "done" |
| Liquid-bead Tabs | `courier-escalation/_components/escalation-tabs.tsx` (route tabs, same four hrefs, `aria-current="page"`) | — |
| Skeletons | Every list/table load (tickets, escalation queue/threads/patterns/runs/categories, cost sync, Shiprocket, Delhivery status, capacity, system issues, webhooks, courier accounts, master switches, dashboard tiles) | — |
| EmptyState (positive) | No open tickets, Nothing waiting (send queue), Nothing unmatched (patterns), Nothing needs you (system issues) | Neutral where the empty list is not good news (no conversations, worker has not run, no accounts, no webhook deliveries) |
| Toasts (app `useToast`) | All pages except those below | Legacy `useToast` kept in `admin-ticket-conversation`, `store-dispute-settle`, `templates-index` — their tests mount them under the legacy Toaster only |
| KpiCard count-up | Dashboard attention counts (Odometer), Orders created, Dispatched; tickets Matching / Auto-raised; escalation Today counts; portal Shadow runs / Failed; system issues Open / Nobody on it / Urgent; capacity Orders 30d; Shiprocket Final bills that disagree | Rates, "x / y" coverage and money are passed as `figure` (Money nodes unchanged) and do not roll |
| u17 Timeline | n/a | Ticket history is a status log with free-text notes and no step states; rendered as a ruled list |
| u34 Stepper | n/a | No multi-step flow in this area (mode change is request → code, shown as two states) |
| ParachuteProgress | n/a | No bulk/import progress with a known total (wallet import and runs are single requests) |
| SegmentedCode | Escalation write-mode six-digit confirmation | — |
| PaperPlaneSendButton | Admin ticket reply ("Reply to seller") — the plane flies only after the reply request resolves; a refusal rejects and shows "Not sent" | — |
| ConfirmDialog | Ticket refund on transition; store dispute settle (moved to app dialog); escalation pause/resume; portal Go LIVE; courier master on/off (replaces `window.prompt`, same reason field); account deactivate / make default; waybill pool refill; Delhivery and Shiprocket browser runs (cost sync, wallet sync, invoice check, website access); Notify unannounced; webhook retry | Stopping the portal (back to SHADOW / OFF) stays one click — the off switch must be faster than the thing it stops |
| Hover-only rows | DataTable rows, queue cards, dashboard attention cards (lift on hover) | No per-row entrance animation anywhere |
| Transform-only meters | Dashboard rates, Delhivery rate budget, capacity gauges (`scaleX`) | Capacity "unknown ceiling" is a static hatch |
