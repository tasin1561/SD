# Motion coverage — admin, warehouse records + inventory (area AB2)

Pages: `/warehouse/bins`, `/warehouse/bins/[binId]`, `/warehouse/consignments`,
`/warehouse/consignments/[id]`, `/warehouse/manifests`, `/warehouse/manifests/[id]`,
`/warehouse/pickups`, `/inventory` (redirect), `/inventory/adjustments`,
`/inventory/cycle-counts`, `/inventory/movements`, `/inventory/transfers`,
`/inventory-units`.

Shared kit: `apps/admin/src/app/(authed)/inventory/_components/stock-kit.tsx` +
`stock-kit.css` (`stk-` classes, tokens only). Area CSS: `warehouse/bins/_components/bins.css`,
`warehouse/consignments/[id]/_components/consignment.css`, `inventory-units/_components/units.css`.

| Pattern | Where used | n/a — reason |
|---|---|---|
| Rolling-label AsyncButton | Bins: Add bin, Create zone, tracking Confirm, Move the whole bin, Apply N line(s). Consignment: Print labels, Ask for approval, Send to India, Send on without counting, Cancel and return the goods. Manifest: Close manifest, Confirm handoff, Move shipment. Pickups: Request pickup, Free the day. Adjustments: Raise adjustment, Approve — this moves stock, Confirm reject. Cycle counts: Schedule, Start counting, Complete — …, Record line. Transfers: Transfer stock. | Label-reprint row buttons (Approve / Print these labels) are small row buttons that open a ConfirmDialog, whose own confirm shows the busy state. |
| Liquid-bead Tabs | — | No page in this area had tabs. |
| Skeletons | Every list and detail load (SkeletonRows sized to the table's columns; Skeleton blocks for the unit KPI row). | — |
| u27 EmptyState | Bins overview, bin detail ("This bin is empty"), consignments, manifests, manifest shipments, pickups, adjustments, cycle counts, counted lines, movements, serial units. **Positive tone**: adjustments "Nothing waiting" (PENDING filter), serial units "No serialized stock anywhere". | — |
| Toasts | Pickups, manifests, move shipment, new adjustment: app `useToast`. Bins, bin ops, consignment panel, label reprint requests: **legacy `useToast` kept** — `bin-contents.test.tsx` and `scan-consignment-serials.test.tsx` mount these with only the legacy `<Toaster>` (the shell mounts both). | — |
| KpiCard count-up | Adjustments (rows shown, awaiting approval; value at stake as a `<Money>` figure), cycle counts (counts shown, in progress, discrepancies), serial units (needs attention, sellers affected; report time as a figure). | Bins / consignments / manifests / pickups / movements / transfers have no headline tiles. |
| u17 Timeline | Consignment event history ("Timeline" panel). | Unit trace history stays a dense table (When / Moved / Gate / Parcel / Note) — five columns of ledger data. Movements is a ledger, stays a DataTable. |
| u34 Stepper | Consignment journey: wizard-mode header, `navigable="none"`, current step derived from the journey (announced → BD intake → labelling → dispatch → arrival). The numbered stops below it (`steps.tsx`) carry the same done/current/todo state on their nodes. | Presentation only; no step is clickable. |
| ParachuteProgress | Bulk bin transfer ("Apply N line(s)") while the request runs (indeterminate — the API reports no progress). | — |
| SegmentedCode | — | There is no bin-collapse screen in apps/admin (the emailed six-digit code). `bin-ops-panel.tsx` records it as deliberately not built there; nothing else in this area takes a code. |
| PaperPlaneSendButton | — | No ticket replies in this area (and admin's reply stays quiet). |
| ConfirmDialog | Delete a bin; move whole bin; consignment dispatch (counted and unopened); label reprint approve / reject / print; stock transfer; manifest close / confirm handoff (moved to the app ConfirmDialog). | Label reprint REQUEST ("Ask for approval") — see the report: `scan-consignment-serials.test.tsx` requires the click to POST directly. |
| Hover-only rows | DataTable everywhere; `onActivate` rows (consignments, manifests, manifest shipments, serial triage) keep their navigation / toggle. | No per-row animation. |

Scanner / keyboard fields kept byte-identical in behaviour: unit trace serial (raw `<input>`, Enter
→ trace, placeholder "Scan or type", no id), consignment "Serials to reprint" and "Why" (raw
`<input>`, `aria-label`s unchanged, no Enter handler), consignment "Units of {sku} leaving" (raw
`type=number min=0 max=left`), cycle-count `cc-variant` / `cc-qty` (`type=number min=0`) /
`cc-bin` / `cc-batch` / `cc-notes` (same ids, no Enter handler), bin-ops line inputs (raw, same
`aria-label`s). Only colour/border changes; nothing animates on a scan field.

Print: `label-sheet.tsx`'s `<style>` block and label grid are unchanged; only the on-screen chrome
(title, "Send to printer", "Done") moved to the app Button.
