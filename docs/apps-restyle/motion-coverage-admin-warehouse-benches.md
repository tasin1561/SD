# Motion coverage — apps/admin, area AB1 (warehouse benches)

Every motion pattern used on the warehouse hub and the scanner benches —
pick, pack, handover, printing, receive and RTO — after the apps restyle
(Phase 5). Catalogue names are the premium-ui-motion skill's (`u01`–`u35`,
storytelling controls by name).

**The rule that outranks every pattern here: a bench is run by a barcode
gun.** The scan fields (`#pack-scan`, `#handover-scan`, the shared
`SerialScanner`, the RTO AWB field, the receive count fields, the printing
label quantity) keep their element, id, type, focus and refocus effects,
Enter handling, trimming, disabling and the refusal-dialog refocus exactly
as the `scan-*.test.tsx` specs pin them. Their only visual state changes
are colour and opacity (focus ring, disabled fade). A scan result — a line
counting up, a parcel joining the session list, a serial chip — appears
instantly with no entrance animation, so nothing ever delays the next scan.

Shared guardrails: tables animate on hover only (no per-row animation),
nothing re-animates on a refetch, navigation is never delayed, and reduced
motion is handled once by `@skydrop/ui/brand/app.css`.

Not used in this area, and why: **van drive-off** and **label-into-parcel**
(reserved for order creation), **paper-plane** (no ticket replies here),
**odometer / KPI count-up** (no dashboard figures — the counts here are
live worklist sizes that must read instantly), **u34 stepper** (the pick →
pack → handover sequence is spread across separate benches, not one
multi-step form), **parachute progress** (no bulk or backfill operation
on these screens), **segmented code** (no six-digit code), **AsyncButton
rolling label** (see below).

**Why no rolling-label AsyncButton on the benches.** Every bench button
already swaps its label to the real in-flight word ("Finishing…",
"Receiving…", "Shelving…") and back, which the specs read by accessible
name; AsyncButton also mounts its own `role="status"` live region, and the
RTO split spec (`getByRole('status')`) and pack spec (`getByRole('alert')`)
each require exactly one such region on screen. The in-flight label states
are kept on the new `Button` instead.

## /warehouse (hub)

- Page header (plain title and subtitle).
- u21-style tiles: soft card, icon chip that fills with the accent on hover
  or focus, card lifts 2px, chevron steps right (transform only). Links,
  so navigation is immediate.

## /warehouse/pick

- Page header; a standing blue banner pointing at Printing.
- "Pull next", "Start pick", "Record", "Complete pick": new `Button`, label
  swaps to the in-flight word (unchanged strings).
- Line cards: a recorded line turns accent-tinted (colour only) with a
  "Recorded" check. Bin and Batch are u33 floating-label fields (identifier
  face); a STRICT line carries the `SerialScanner` (unchanged behaviour).
- u27 empty state "No pick in progress".
- "Release a stuck pick": section heading + Dialog (scale + fade, focus
  trap and return) with the u33 `fe-shipment` field; server verdict
  verbatim.

## /warehouse/pack

- Page header. Scan panel: the large `#pack-scan` field (colour-only
  states). "Box open on …" meta line with figures in the tabular face.
- The box contents: one row per product, the outstanding count large; a
  satisfied row goes quiet (colour change) with a check — no motion.
- Serial step: `SerialScanner` (`#pack-finish-serials`, autofocus kept).
- Cancel the box / pack without scanning: inline two-step kept (reason
  ≥3 / ≥20 characters as before), now u33 fields.
- The refusal is a critical Dialog ("That scan was refused"), blocking; "I
  have fixed it" returns focus to the field (the spec's fix, kept).
- Pack queue under the bench: u21 list rows (icon chip, AWB in the
  identifier face, status chip "Label printed" / "No label" with icon and
  word, a severity stripe on unlabelled parcels, hover lift only); skeleton
  rows while loading; u27 positive empty state "Nothing waiting to be
  packed"; error state with Retry.
- Camera: `CameraScanButton` (secondary button) opens the camera Dialog.

## /warehouse/handover

- Page header with breadcrumb (Warehouse → Handover).
- Scan-block card: red, icon + words (SCAN-1), no animation.
- `#handover-scan` scan field with the camera button beside it.
- Session list: u21 list rows, newest first, status chip "Dispatched" /
  "Scanned" / "Already gone"; rows appear instantly.
- Waiting-for-a-van queue: u21 list rows, checked rows dimmed (opacity);
  skeleton; u27 positive empty state; error with Retry.
- Refusal: critical Dialog; "Understood" returns focus to the field.

## /warehouse/printing

- Page header with breadcrumb.
- The five views are a segmented bar of real `<button>`s with
  `aria-pressed` and a colour-transition pill — not the liquid-bead Tabs,
  because `scan-printing-quantity.test.tsx` drives "Find a product" by
  `role="button"`, and Tabs would make it `role="tab"`.
- Label / picking / reprint queues: u07 DataTable (hover only), native
  checkboxes (accent-coloured), skeleton rows, in-table empty rows.
- "Did the labels print?" / "Did the picking list print?": Dialogs (the
  existing confirms), failure and shortfall lists in a red callout.
- Abandon a batch (from the print dialog and from Past batches) and Mark
  picked: **new ConfirmDialogs** restating the batch number and what
  happens to its parcels.
- Past batches: u07 table, StatusChip per batch, icon buttons with their
  original accessible names.
- Find a product: u33 search field with icon; u27 empty state "Where is
  it?"; results as soft cards with bin chips. "Labels" still asks the
  quantity with `window.prompt` (pinned by the spec — see the report).
- Recently printed stickers: section heading + u07 table.

## /warehouse/receive

- Page header; filters as native u05 selects in a responsive grid; u07
  table with whole-row activation (unchanged), receipt and consignment
  numbers in the identifier face, status as a neutral StatusChip; skeleton
  rows; u27 empty state; error with Retry; u16 pagination (bubble moves to
  the active page).

## /warehouse/receive/[id]

- Breadcrumb (Warehouse → Receive queue → receipt), title in the
  identifier face, status chip in the meta row.
- Facts as a description grid.
- Product cards: a recorded line turns accent-tinted with a "recorded"
  chip. Received qty / Damaged are u33 number fields (type, min, max,
  inputMode unchanged); Putaway bin is a u05 native select.
- **Complete now asks first**: ConfirmDialog restating the receipt number,
  the seller, how many products carry a count and that stock is written
  and cannot be cancelled afterwards.
- Cancel receipt: critical Dialog with a required-marked "Why" field; the
  ≥10-character gate on the button is unchanged.
- Loading is skeleton rows; the "stock written" line carries a check.

## /warehouse/rto

- Page header. The four views are the liquid-bead Tabs (a real tablist;
  arrow keys move and select); counts appear only when non-zero, "At our
  door" in red when anything is waiting. The Receive panel stays mounted
  while hidden (unchanged), so a half-typed inspection survives a look at
  another tab.
- At our door / Still with the courier / On the bench: u07 tables, waiting
  time as a StatusChip, skeleton while reading the bench.
- Receive: u33 "AWB number" field (Enter still does nothing), camera
  button, "Receive" button (unchanged request).
- Inspection line cards: product thumbnail kept (`ProductThumb`, the
  pinned `bg-surface-raised` placeholder), u05 selects for condition and
  decision with the slip warning as the field's notice, u33 notes; "What
  each choice does" is a native disclosure; split-by-quantity rows keep
  their live `role="status"` arithmetic.
- **Finalize now asks first**: ConfirmDialog restating the shipment number
  and the units going back in stock / kept aside damaged / written off
  (red when anything is written off).
- **Putaway now asks first**: ConfirmDialog restating each SKU → shelf and
  that the units become sellable.

## Shared pieces touched

- `SerialScanner` (`components/ui/serial-scanner.tsx`): tokens-only restyle
  of the box, count, notice and chips; the input element, Enter capture,
  trimming, de-duplication notice, `n / required` count and the
  `text-critical` over-count class are unchanged.
- `BarcodeCamera` / `CameraScanButton` (`components/barcode-camera.tsx`):
  the new Dialog and Button; lazy zxing import, stop-on-read, stop-on-close
  and the hidden-without-camera rule unchanged.
- `WarehouseFormPanel` (rendered on /warehouse/bins): Dialog with u33
  fields (Code and Name required-marked, Name shows its 120 counter), u05
  selects and the u03 checkbox.
