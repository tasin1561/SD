# Two-leg consignments (BD → India)

Status: **BUILT 2026-08-19.** Backend complete; screens shipped alongside.
Read with `CLAUDE.md` (INV-*, BIN-*, UNIT-*, FRT-*) and `docs/db-schema.md`.

---

## The change in one sentence

A consignment today is an **event** — one warehouse, one arrival, one count.
It becomes a **journey**: up to two stops, up to two counts, one labelling
station, and a seller watching it move.

---

## Routes

A seller announces a consignment and picks its route:

| Route | Legs | Freight billed by us |
|---|---|---|
| `DIRECT_IN` — seller ships straight to the Indian warehouse | 1 (`IN_FINAL`) | **no** |
| `VIA_BD` — seller ships to our Bangladesh warehouse, we move it | 2 (`BD_INTAKE`, then one or more `IN_FINAL`) | **yes** |

Every consignment's final destination is India. `VIA_BD` may ship to India in
**more than one batch** — a 500-unit intake often moves as two air shipments —
so the India leg is a COLLECTION, not a second row. This was decided up front
precisely because retrofitting it later would rework the freight split.

---

## The load-bearing decisions

### 1. In-transit is a PLACE, not a gap

Goods leave Dhaka on the 3rd and reach Bangalore on the 12th. For nine days
they are in neither building. Booking them to BD makes a BD cycle count find
them missing; booking them to India makes an India count find them missing.

So transit gets a real location — the same move BIN-1 made when it decided
"no bins" was not representable and made OFF a real bin:

- `BinType.TRANSIT`, held in the **destination** warehouse.
- `TRANSIT` joins `NON_PICKABLE_BIN_TYPES`.

That constant is already SHARED by `StockAvailabilityService` and
`StockPickAllocationService`, with a test asserting they share it rather than
match by coincidence. So in-transit stock becomes unsellable in the
availability sum AND in the allocator through **one line**, and the pair that
once disagreed (and cost an order on the warehouse floor) cannot disagree here.

### 2. A warehouse that does not fulfil orders

`Warehouse.fulfilsOrders` (default true; false for BD). ONE reader, the way
`BinPolicyService` is the one reader of `binTrackingEnabled`. Five call sites
each testing `countryCode === 'IN'` is how they come to disagree.

Seller-facing **in transit** is then DERIVED, not a counter anyone maintains:
everything on hand that is not in a pickable bin of a fulfilling warehouse.
Counted-in-Dhaka and mid-flight both land in it, which is what the founder
asked for — until India receives it, it is in transit.

### 3. Two linked receipt legs, not one row with two count columns

Two counts means two putaway bins, two batches, two warehouses. One row cannot
hold that. Two `GoodsReceipt` legs under one `Consignment` parent means the
**existing receive station is invoked twice, unchanged** — no new counting code.

### 4. Batch lineage across the border reuses R6b

`RtoRestockTargetService` already solves "goods belonging to batch Y are now
standing in warehouse X": find-or-create a CHILD batch with a deterministic
code, inheriting `expiresAt` / `manufacturedAt` (FEFO stays correct across the
border — a generic "August air shipment" batch would destroy it), `unitCostInr`
(margin stays honest) and `parentBatchId`.

### 5. Nothing blocks, and variance is SIGNED

A count may be higher or lower than what preceded it, never blocks, and needs
no follow-up action.

Today `complete` routes to `DISCREPANCY` and writes NO stock — a gate that
earns its keep only where stock would become sellable. **In BD nothing becomes
sellable**, so blocking there buys nothing and strands a consignment in a Dhaka
warehouse waiting on an email. And at the India leg, "India is final" means it
completes on what it counted; a shortfall against the BD count is OURS to chase
with the forwarder, and holding the seller's stock unsellable while we do that
is backwards.

**Consequence: the `DISCREPANCY` STATUS dies.** Variance that nobody acts on is
a number on a line, not a state. `hasDiscrepancies` + `discrepancyNotes` already
carry it. What goes: the blocking status value, `resolveDiscrepancy()` and its
`CORRECT` / `FORCE_COMPLETE` branches, its DTO, its admin endpoint, the admin UI
branch, and the `audit-dead-ends` assertion that pins it.

### 6. Labelling happens at ONE station, chosen by ops

`labellingSite: BD | IN | NONE`, set by ops per consignment — not on the
seller's announce form, which gets SIMPLER. Changeable freely until the first
label is printed, then locked: a half-labelled consignment split across two
countries is unrecoverable.

Labelled in BD is the strongest version: `StockUnit` rows exist before the goods
reach India, the transfer MOVES them, and the India count becomes a SCAN — so a
shortfall is a **named list of missing serials**, not a number.

**The one exception to "nothing blocks":** a strict-mode SURPLUS at India (498
labelled, 501 counted) leaves three units on the shelf with no serial, and
UNIT-2 needs exactly `quantity` serials at pick. The answer is to print three
labels where they surfaced — the one-station rule is about where the work
happens, not a prohibition on ever printing elsewhere.

### 7. The freight bill belongs to the CONSIGNMENT

`InboundFreightCharge.goodsReceiptId` is UNIQUE — one bill per receipt. With
two legs neither is right: the bill is for BD→India, known when the forwarder
invoices, and FRT-1 splits it per unit over the lines it covers — which must be
the units that ACTUALLY ARRIVED, or freight is amortised across units that were
lost and will never sell to settle their share.

So `goodsReceiptId UNIQUE` → `consignmentId UNIQUE`, split over the India legs'
final counted lines; FRT-1's attribution walk gains one hop. **Production holds
zero freight charges, so this migration is free now and expensive later.**

It also makes "only VIA_BD is billed" structural rather than a rule in
somebody's head: a `DIRECT_IN` consignment has no BD hop, so there is no bill
to attach and no action to offer.

### 8. Cancel touches stock, and CLOSES at dispatch

Abandoned goods go BACK TO THE SELLER and the consignment ends `CANCELLED`.
Today cancel is `PENDING`-only and moves nothing; now it must remove written
stock with its own reason code, and labelled units need a status that is
neither `WRITTEN_OFF` (not destroyed) nor `LOST` (we know exactly where they
went). Returning goods to a seller is a countable outcome in its own right —
same argument as `RTO_FEE` being its own wallet direction.

**A consignment CANNOT be cancelled once it has left for India.** The window is
`PENDING` through counted-in-BD; dispatch closes it. This is not a policy
preference to be relaxed later — it is what keeps the flow finite. Cancelling
mid-air would mean deciding who eats freight already spent, where goods
standing in a `TRANSIT` bin go back to, and what happens to a parcel that lands
in Bangalore against a consignment that no longer exists. Refusing at dispatch
means none of those states is reachable, so none of them needs an answer.

`DIRECT_IN` has no dispatch step, so its window is `PENDING` through arrival at
the Indian warehouse.

---

## The consignment panel

One admin screen drives the whole journey. Steps ② and ⑤ are the EXISTING
receive station, invoked twice.

```
Consignment CN-2026-08-0042 · Seller X · route VIA_BD · labelling: Bangladesh

 (1) Declared        500 units · 6 SKUs
 (2) BD intake       counted 498   -2 vs declared        [receive station]
 (3) Labelling       498 serials printed · BD            [print labels]
 (4) Dispatch to IN  498 units -> in transit · ETA 12 Aug [dispatch]
 (5) IN receipt      counted 497   -1 lost in transit    [receive station]
 (6) Freight bill    Rs 48,000 over 497 units            [record bill]
```

Step ④ is a paired `TRANSFER_OUT` (BD bin) / `TRANSFER_IN` (India `TRANSIT`
bin) in one transaction — existing `StockTransferService` mechanics, driven
from here rather than from the generic `/inventory/transfers` screen.

Step ⑤ moves stock out of `TRANSIT` into a pickable bin plus a shortfall
adjustment. It is a TRANSFER, **not** a `RECEIVING` movement — the stock
already exists. This is the main new code in the leg.

---

## What is missing outright (no scaffolding today)

- **Label printing.** `generateSerial()` returns a string; nothing renders a
  barcode and nothing produces a printable sheet. The scanner component is
  input-only. Strict mode cannot physically work without this.
- **A seller consignment detail page.** `/inbound` is a list plus an edit
  panel; there is no `/inbound/[id]`, no timeline, no events table.
- **Milestone notifications.** Two templates exist
  (`goods_receipt_completed`, `goods_receipt_discrepancy`).

---

## Build order

| | Scope | Where it landed |
|---|---|---|
| **a** | `BinType.TRANSIT` + `NON_PICKABLE_BIN_TYPES`; `Warehouse.fulfilsOrders` + its single reader | `bin-policy.service.ts`, `warehouse-resolver.service.ts` |
| **b** | `Consignment` + `ConsignmentEvent`; `GoodsReceipt.consignmentId/leg/dispatchedAt`; the announce screen asks the route; the `DISCREPANCY` blocking path retired | `consignment-core/`, `consignment/`, `goods-receipt.service.ts` |
| **c** | Dispatch-to-India transfer, arrival out of `TRANSIT`, `IN_TRANSIT_LOSS`/`_SURPLUS`, multi-shipment India legs | `consignment-dispatch.service.ts`, `transit-arrival.service.ts` |
| **d** | Labelling site + the label sheet; strict units moved by the dispatch; India scan-reconcile; surplus labelled where found | `consignment-label.service.ts` |
| **e** | Freight bill keyed on the consignment; `DIRECT_IN` refused as unbillable | `inbound-freight.service.ts` |
| **f** | `consignment_events` timeline + four milestone email templates | `consignment-event.service.ts`, `seed.ts` |
| **g** | Cancel before dispatch: `RETURNED_TO_SELLER` movement + unit status; refused after | `consignment-cancel.service.ts` |

## Modules

- **`consignment-core`** — the R3 shared primitive, the EIGHTH extraction of
  that shape. `ConsignmentNumberingService` (`CN-YYYY-MM-XXXXXX`),
  `ConsignmentEventService` (append-only), `ConsignmentStatusService` (the
  sole writer of `consignments.status`, which it always DERIVES). Depends
  on Prisma alone, so both `consignment` and `inventory-receipt` import it
  and no cycle exists — `consignment` imports `inventory-receipt`, so the
  reverse call could not.
- **`consignment`** — a LEAF module (nothing imports it, it exports
  nothing). `ConsignmentService` (declare / read / labelling site / the
  cancel guard), `ConsignmentDispatchService`, `ConsignmentLabelService`,
  `ConsignmentCancelService`, plus the seller and admin controllers.
- **`inventory-receipt`** — unchanged as the counting station, called once
  per leg, plus `TransitArrivalService` for a leg that arrives out of
  TRANSIT rather than from a supplier.

## Endpoint map

Seller (`inbound.view`, writes `inbound.manage`):
`POST /seller/consignments`, `GET /seller/consignments`,
`GET /seller/consignments/:id`, `GET /seller/consignments/:id/events`,
`POST /seller/consignments/:id/cancel`.

Admin (`inventory.view`; labelling/print/cancel `inventory.goods_receipts.manage`;
dispatch `inventory.transfers.manage` — moving stock between warehouses is
what it does, whatever the panel calls it):
`GET /admin/consignments`, `GET /admin/consignments/:id`,
`GET /admin/consignments/:id/events`,
`PATCH /admin/consignments/:id/labelling-site`,
`GET /admin/consignments/:id/labels`,
`POST /admin/consignments/:id/labels/print`,
`POST /admin/consignments/:id/dispatch`,
`POST /admin/consignments/:id/cancel`.

## Before VIA_BD can be used in production

`ops.bd_intake_warehouse_id` is seeded EMPTY, deliberately: there is no
Bangladesh building until somebody creates one, and inventing an id would
point a route at a warehouse that does not exist. Until it is set, a
VIA_BD declaration is refused with `BD_WAREHOUSE_NOT_CONFIGURED` — the
honest failure, rather than quietly sending the seller's stock to India
when they said Bangladesh.

The steps: create the warehouse with **fulfils orders OFF**, then set that
setting to its id on `/settings`. The resolver re-checks the flag on every
read and refuses a warehouse that fulfils orders
(`BD_WAREHOUSE_FULFILS_ORDERS`), because an intake site whose stock is
sellable defeats the whole route.

---

## Open

Nothing outstanding. Every question this design raised has an answer above.
