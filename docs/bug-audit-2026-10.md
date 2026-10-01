# Bug audit — are the bugs filming found actually fixed?

**2026-10-01.** Forty-three product bugs were found by filming the tutorials.
Most were fixed in the session that found them. What was left behind was a
scatter of notes saying "observed and NOT fixed", "left alone", "reported, not
fixed" — and a later batch of fixes landed without those notes being updated.

So the first question is not *what is still broken*, it is **which of those
notes are now describing something that no longer exists.** That is the RBAC-1
failure shape this codebase has already been bitten by: five mutually consistent
documents, all agreeing, all describing a mechanism that had been deleted.
Nothing in this audit is taken from the prose. Every verdict below is a code
check.

**This file exists because `scripts/tutorials/CURRICULUM.md` is owned by the
filming agents and must not be edited concurrently.** The corrections it needs
are listed at the end, ready to fold in.

---

## 1. The scoreboard

| # | Note | Verdict | Action |
|---|---|---|---|
| 1 | `/tickets` modal asks for an order UUID | **STALE** | — |
| 2 | Seller's subscribed-events box is free text | **STALE at the UI**, correctly left alone at the API | — |
| 3 | Five order-event notes name a row by its uuid | **STALE** | — |
| 4 | `AwbGenerationWorker gave up on a job` carries a shipment uuid | **Correctly left alone** | — |
| 5 | Bulk bin moves ask for three uuids | **OPEN** | **FIXED** — `19c62b76` |
| 6 | A putaway bin is required where the warehouse says it is not asked for | **OPEN** | **FIXED** — `fbd609eb` |
| 7 | Bin collapse has no screen | **STALE** | — |
| 8 | Order history labels every one of our events `SKYDROP` | **STALE** | — |

Plus **27 stale entries in `docs/phase-1a-debt.md`** (§4).

---

## 2. The stale notes, with the evidence

### 2.1 `/tickets` asks for an order UUID — STALE

> *"the modal's own order field is a paste box for a UUID whose hint says 'copy
> the ID from the order page', and the order page shows an order NUMBER.
> **Reported, not fixed**"* — CURRICULUM ~1728

It is a remote search picker now.
`apps/seller/src/app/(authed)/tickets/_components/raise-ticket-modal.tsx:13,177-197`
renders `<OrderPicker>`; `apps/seller/src/components/order-picker.tsx` is a
`ComboSelect` in remote mode over `GET /seller/orders?search=`, debounced,
gated on `orders.view`. Pinned by
`apps/seller/src/tests/raise-ticket-order-picker.test.tsx`.

`CreateSellerTicketDto.orderId` is still `@IsUUID()`
(`apps/api/src/modules/ticket/dto/ticket.dto.ts:46-49`) — and that is now
**correct rather than leftover**: the picker supplies the uuid, so nothing is
transcribed by hand, and widening the API to accept an order number would mean
changing the scoped lookup in `TicketService.open` that is the tenant boundary
for five callers. The note's *conclusion* was right; its *premise* is gone.

Admin has no equivalent to fix — admin never creates seller tickets.

### 2.2 The seller's subscribed-events box — STALE at the UI, correctly left alone at the API

> *"A gap left alone, deliberately: the seller's subscribed-events box is free
> text with no vocabulary check… A typo saves cleanly and then matches nothing,
> silently."* — CURRICULUM ~2108

**The box is gone.** `apps/seller/src/app/(authed)/settings/webhooks/_components/event-picker.tsx`
is a checkbox grid built from a new `GET /seller/webhook-endpoints/events`
(`apps/api/src/modules/seller-webhook/seller-webhook.controller.ts:27,61-66`,
serving `WEBHOOK_EVENT_CATALOGUE` — imported, never restated), with a removable
warning chip for any stored code outside the catalogue. A **new** typo is
unrepresentable. Pinned by `apps/seller/src/tests/webhook-events-are-picked.test.tsx`.

The **API** DTOs are still `@IsString({each:true})` with no `assertKnownEvents`
(`create-webhook-endpoint.dto.ts:48-52`, `update-webhook-endpoint.dto.ts:36-41`)
— which is exactly the shape the note itself identified as not-a-bug-fix:
validating on write would make a row holding a pre-existing bad value fail its
next save even for an unrelated edit, punishing the seller for our omission.
**Left alone, and the reasoning stands.** The note's own last sentence
("the better answer is probably the store's checkboxes") turned out to be the
answer that shipped.

### 2.3 Five event notes name a row by its uuid — STALE

> *"RTO finalize on shipment 01a0ef6c-…, and the same shape on pick start, pick
> complete, pack complete and the call attempt… it wants doing deliberately, at
> the five write sites"* — CURRICULUM ~2497

All five were done, at the five write sites, with the number.
`apps/api/src/common/text/parcel-label.ts:47` is the helper (uuid survives only
as a fallback).

| Site | File:line | Now reads |
|---|---|---|
| Pick start | `warehouse-pick/services/pick-execution.service.ts:146` | `Pick started on parcel ${parcel}` |
| Pick complete | `warehouse-pick/services/pick-execution.service.ts:455` | `Pick completed on parcel ${parcel}` |
| Pack complete | `warehouse-pack/services/pack.service.ts:255` | `Pack completed on parcel ${parcelLabel(shipment)}` |
| RTO finalize | `warehouse-rto/services/rto-disposition.service.ts:488` | `Return finalised on parcel ${parcelLabel(shipment)}` |
| Call attempt | `call-center/services/call-attempt.service.ts:453` | `Call ${callNumber} — ${outcome}` — a human ordinal, no uuid at all |

A repo-wide scan for `reason: \`…${…Id}\`` in `apps/api/src` returns nothing,
and there is a coverage spec at
`apps/api/test/unit/order-event-descriptions-name-rows.spec.ts`.

**One half of the note is still true and should be kept**: `order_events` is
append-only (ORD-4), so rows written before the fix keep their uuid for ever. A
demo filmed against old data can still show one. That is a property of the data,
not of the code.

### 2.4 `AwbGenerationWorker gave up on a job` — CORRECTLY LEFT ALONE

> *"that string is `err.message` from the worker's own throw and is genuinely
> engineer-facing."* — CURRICULUM ~2584, ~4638

Confirmed. `system-issue.service.ts:367` builds the title from `workerName`, and
the uuid arrives inside `metadata.error` / the cause text, which is the worker's
own thrown message. Nothing is written for a reader here. **No action.**

### 2.5 Bin collapse has no screen — STALE

> *"`BinCollapseService`'s four endpoints have no caller anywhere outside the
> e2e suite… Not fixed — a request/confirm/snapshot/restore UI is a feature, not
> a filming task"* — CURRICULUM ~4598

The feature was built. `apps/admin/src/app/(authed)/warehouse/collapse/page.tsx`
→ `_components/bin-collapse-index.tsx`, with all four endpoints wired in
`apps/admin/src/lib/bin-collapse-hooks.ts` (`request` L93, `confirm` L112,
`snapshots` L75, `snapshots/:id/restore` L137) and pinned by
`apps/admin/src/tests/bin-collapse-fe2.test.tsx`.

**This also makes the rider stale**: *"It also makes P4 more impractical than its
entry records: there is no read-only 'what a collapse would move' half to film
either."* There is — `bin-collapse-index.tsx` says what would move **before** it
asks anyone to confirm, and a test asserts exactly that.

### 2.6 Everything is labelled SKYDROP — STALE

> *"The field is the two-valued `MilestoneOwner`… Telling the seller apart from
> Skydrop staff would be a third value flowing through both apps"* — CURRICULUM ~4604

`MilestoneOwner` has **four** values:
`apps/api/src/modules/order-journey/services/journey-owner.ts:51` —
`'SKYDROP' | 'SELLER' | 'STORE' | 'COURIER'`, with `ownerForActor` routing
`ActorType.SELLER → SELLER`, `ActorType.STORE → STORE`, and `ActorType.API` by
store kind. Mirrored in `packages/ui/src/status/index.ts:1243` with an
exhaustive `journeyOwnerLabel`, rendered at
`packages/ui/src/components/order-journey.tsx:186,465`. A seller's own
cancellation reads **Seller**.

---

## 3. The two that were genuinely open — and the reasoning

### 3.1 The putaway bin · FIXED in `fbd609eb`

> *"a putaway bin is required even where the warehouse says it is not asked for…
> It is left alone on purpose: the stricter client produces a TRUER record…
> **If anybody does relax it, relax the COPY instead — "can still note one" is
> the sentence that is wrong.**"* — CURRICULUM ~2980

**The note's instruction was backwards, and the code says so.** It is the copy
that is right and the form that is wrong.

`BinPolicyService.resolvePutawayBin` (`bin-policy.service.ts:178-198`) — the ONE
reader of `binTrackingEnabled` (BIN-1):

```
const trackingEnabled = await this.isTrackingEnabled(warehouseId, tx);
if (!trackingEnabled) {
  return { binId: requestedBinId ?? (await this.floorBinId(warehouseId, tx)), trackingEnabled };
}
if (!requestedBinId) throw new BadRequestException({ code: 'BIN_REQUIRED', … });
```

Tracking OFF: a bin is **honoured when given** and **not required when absent**.
Tracking ON: refused by name. That is BIN-1 verbatim, and it is what the J1
tracking panel's copy says ("receiving can still note one, but it is only a
note"). The copy is accurate.

`onRecordAll` refused `qty > 0 && !bin` **unconditionally**, with no reference to
the warehouse. So the bench was **mirroring a server policy — which FE-2 forbids
outright — and mirroring the opposite of it**, in the direction that blocks work.
At a non-tracking warehouse (the default; CCU-01 in the demo data) an operator
could not record a line at all without choosing a bin whose only effect is to be
recorded. Nothing failed loudly: Save simply refused, with a message the operator
could not act on because its premise was false.

So this is not a "stricter client, truer record" trade. A client that refuses
what the server accepts is not strictness, it is an outage with a tooltip.

**The fix decides nothing here.** `buildReceiptLines`
(`apps/admin/src/app/(authed)/warehouse/receive/_components/receive-lines.ts`)
passes a bin through when one was chosen, omits it when it was not, and the
server answers. It is extracted to a pure module because the rule it got wrong is
invisible from a rendered page and obvious from a table of inputs and outputs.
What stays is arithmetic the server cannot do before it has a request at all: a
quantity that is not a number, named by its SKU.

**Why not keep a cosmetic client-side check driven by the mode?** Because it
needs a second place that knows the rule, and the whole class of bug here is a
second place deciding. The server's refusal is already operator-grade prose and
`serverVerdict(e)` already surfaces it verbatim. The cost is that a tracking-ON
refusal no longer names the SKU; the bin `Select` is on every row, and that is a
fair trade for removing the decision.

**Two comments were also corrected** — both describing the opposite of their own
code, the RBAC-1 shape:
- `goods-receipt.service.ts` claimed *"the agent's choice is ignored entirely
  rather than defaulted"* of a callee that honours it, directly contradicting
  BIN-1's "pure upside".
- The empty-dropdown note called the field `REQUIRED`.

Pinned by `apps/admin/src/tests/receive-putaway-bin.test.ts` (8 tests; 4 of them
fail on the old rule — proved red first).

### 3.2 The three uuids · FIXED in `19c62b76`

> *"'Apply a list of moves' asks an operator to type a seller id, a variant id
> and a batch id — three uuids — and no screen in the admin app offers them to
> copy… fixing it is adding three pickers rather than changing one field, which
> is why it is recorded here instead of done."* — CURRICULUM ~2917

**The decomposition is what made it look expensive.** A seller, a variant and a
batch are not three independent questions. They are one stock LINE; it is only
movable if it is already sitting in the bin the move comes FROM; and the server
already serves exactly that list — `GET /admin/bin-contents/:binId`, which the
bin detail page has rendered since it was built.

So it is **one** picker driven by the line's own From bin, not three
(`bin-line-picker.tsx`). The three ids come back together and consistent with one
another, which three boxes could never guarantee. Columns are reordered to the
shape of the act: From · Product · Qty · To.

Three details worth keeping:
- **Changing the From bin clears the product.** The line belonged to the bin it
  was picked from. Carrying it over submits a triple the new source does not
  hold — refused by the server, but only after somebody typed a quantity and
  pressed the button, and silently wrong-looking until then.
- **The query is mounted, not merely disabled.** A hook called with `''` would
  put a request for `/bin-contents/` on the wire per empty draft row.
- **A bin with more lines than one page says so.** "It is not in the list" and
  "the list stopped" are different problems, and only one has an answer on this
  screen.

The server is still the boundary (FE-2) — it re-checks that the line is in the
source bin and that there is enough of it. This only stops an operator from
having to invent an identifier.

Pinned by `apps/admin/src/tests/bin-move-line-picked.test.tsx` (6 tests, **all 6**
red on the old panel).

---

## 4. `docs/phase-1a-debt.md` — 27 stale entries

Same method, same result: the doc has been accumulating entries faster than it
has been pruned. **The two entries most likely to matter are both accurate** —
CUR-6's label-ordering fix really did land (`awb-generation.service.ts`: Phase C
persists `awbNumber` at ~L576, Phase D fetches and uploads the label at ~L648,
in that order), and the AWB persist window is really still open
(`delhivery-waybill-pool.service.ts:51` still says "NOTHING CALLS `claim()` YET",
and nothing does).

Stale entries, by line in that file:

| Line | Claim | Disproved by |
|---|---|---|
| 59-81 | `next`/`sharp`/`multer` upgrades pending | `pnpm-lock.yaml` — next 15.5.25, sharp 0.35.4, multer 2.3.0 |
| 92 | Any staff member can hit `/admin/seller-invitations` | `seller-invitation.controller.ts:40,46,64,76` |
| 144 | RBAC absent on `/admin/sellers/*` | `admin-seller.controller.ts:50,70,85,100,123,148,161,175,196` |
| 594 | No endpoint to create an empty DRAFT manifest | `admin-manifest.controller.ts:79` |
| 613 | No supervisor RTO shipment list | `warehouse-rto.controller.ts:59,69` + admin UI |
| 621 | `audit_logs.severity` lives in `metadata` | `schema.prisma:547` |
| 637 | Barcode/scanner integration deferred | `record-pick-item.dto.ts:26`, `serial-scanner.tsx`, five scan stations |
| 646 | No pack claim/start column | `schema.prisma:3973` `packStartedAt` |
| 652 | Manifests close only on explicit supervisor action | `dispatch-handoff.service.ts:450,479,707` (CUR-4 amended) |
| 658 | `RtoDisposition` is RESTOCK / WRITE_OFF only | `schema.prisma:6104-6128` — four values |
| 665 | Courier hardcoded to `delhivery` | `courier-shiprocket/*`, `courier-distribution`, `courier-choice` |
| 744 | 6 `TODO(delhivery-api)` seams; every real-mode call site throws | none of the four Delhivery services carries one |
| 761 | Nothing calls serviceability on the critical path | `order-serviceability.service.ts:24-36` + seller order form |
| 769 | Carrier selection unwired; `moveShipment` dormant | `CourierChoiceService.decide`; `api-hooks.ts:879` |
| 783 | No Delhivery pickup-request API call | `delhivery-pickup.service.ts:58`, `courier-pickup.service.ts` |
| 788 | Manual-scan admin UI deferred | `manual-scan-panel.tsx:73` |
| 835 | `apps/track` is a placeholder | `apps/track/src/app/[awb]/page.tsx` |
| 847 | NDR → call-center bridge does not exist | `delivery-failed-listener.service.ts:81-93` |
| 859 | Public-tracking rate limit is a static literal | `public-tracking.controller.ts:50` `@ThrottleSetting` |
| 878 | EN+HI copy lives in the deferred `packages/i18n` | `apps/track/src/lib/i18n.ts` + locale switcher |
| 941 | Bus is in-process; single-instance API only | `order-lifecycle-event-bus.service.ts:111,143-170` — Redis |
| 1014 | `packages/ui` extraction deferred | `packages/ui/src/components/` exists |
| 1026 | Warehouse-ops / queue-management admin areas unbuilt | eleven warehouse routes + two call-center routes |
| 1053 | Playwright FE e2e deferred | root `playwright.config.ts` — 5 projects, a CI gate |
| 1064 | Every admin endpoint is `StaffJwtGuard`-only | `require-permissions.decorator.ts:30-35`, used in 90 files |
| 1143 | The write path has never touched the real Delhivery server | 11 real AWBs, 7 live-write audit rows |
| 1154 | Nightly NDR sweep deliberately not built | `courier-ndr-runner/queue/ndr.queue.ts:43` |

**Also stale in its premise** — L489-510 records the qtyOnHand resolution as
Model A (decrement at DISPATCH). The code is Model C (decrement at PACK,
2026-09-03); the `DISPATCH_STOCK` side-effect kept its name deliberately while
the edge moved. L799 inherits the same stale premise, though its conclusion holds.

Everything else in that file is either verified still-true (~30 entries) or a
scope deferral that cannot go stale.

---

## 5. What a filming agent needs to correct

**`scripts/tutorials/CURRICULUM.md`** (line numbers as of `de96c875`; they move):

| ~Line | What to do |
|---|---|
| 1728 | Rewrite: the OrderPicker shipped. `@IsUUID()` is now deliberate, not leftover. |
| 2108 | Rewrite: the free-text box is gone (checkbox grid + `GET /seller/webhook-endpoints/events`). The API asymmetry survives as a conscious back-compat choice. |
| 2497 | Rewrite: all five write sites now use `parcelLabel` / a call ordinal. **Keep the append-only caveat** — rows written before the fix still read as uuids, so a demo on old data can still show one. |
| 2584, 4638 | **Keep as-is.** Verified correct. |
| 2917 | Rewrite: fixed in `19c62b76`. One picker, not three — the three ids were one question. |
| 2980-2988 | Rewrite: fixed in `fbd609eb`, and **the opposite way round from the instruction left there**. The copy was right; the form was a client-side mirror of a server policy (FE-2) pointing the wrong way. |
| 4598-4602 | Rewrite: `/warehouse/collapse` shipped, all four endpoints called. The P4 rider ("no read-only 'what a collapse would move' half to film") is stale too — there is one. |
| 4604-4611 | Rewrite: `MilestoneOwner` has four values; a seller's cancellation reads **Seller**. |

**`docs/phase-1a-debt.md`**: the 27 rows in §4, plus the Model A → Model C
premise at L489-510 / L799.

---

## 6. Found here, recorded nowhere

1. **`goods-receipt.service.ts` documented the opposite of its own callee** —
   "the agent's choice is ignored entirely rather than defaulted" of
   `resolvePutawayBin`, which honours it. Fixed in `fbd609eb`. Worth noting as a
   data point for the RBAC-1 lesson: the comment was not merely stale, it
   contradicted a NON-NEGOTIABLE invariant (BIN-1's "pure upside"), and nothing
   in the gate can see that.
2. **The bulk-move panel put a request on the wire per empty draft row** —
   `/api/admin/bin-contents/` with no bin id. Harmless, and gone with the picker.
3. **`docs/phase-1a-debt.md` has no entry for either bug fixed here**, and had
   no entry for any of the eight curriculum notes. The two documents do not
   cross-reference, so a note parked in one is invisible from the other.
