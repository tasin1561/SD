# Courier status → Solustation `/v1/feedback` (order page v2)

Agreed with the owner, 2026-10-26. This is the table the feedback sweep
reads. It exists as a document because the mapping is a **training
signal**, not a display: a wrong label here teaches their phase-5 model
something false about an address, and nothing downstream would ever show
that it had.

## The mapping

`shipment_status` is ours (`packages/db/prisma/schema.prisma`); the
right-hand column is the only vocabulary `/v1/feedback` accepts.

| Our shipment status | Sent as | Why |
|---|---|---|
| `HANDED_TO_COURIER` | `in_transit` | Picked up. |
| `IN_TRANSIT` | `in_transit` | |
| `AT_HUB` | `in_transit` | Still moving; a hub is not an outcome. |
| `OUT_FOR_DELIVERY` | `in_transit` | Their vocabulary has no out-for-delivery, and it is not an outcome either. |
| `DELIVERY_ATTEMPTED` | `ndr` | The courier's own reason text goes in `ndr_reasons`. |
| `DELIVERED` | `delivered` | |
| `RTO_INITIATED` | `rto` | |
| `RTO_IN_TRANSIT` | `rto` | |
| `RTO_DELIVERED` | `rto` | Three events, same status, different `event_time`. That is correct and wanted — the journey back is part of what the model learns. |
| `LOST` | `lost` | |
| `DAMAGED` | `lost` | Their nearest value; the parcel did not arrive and will not. |
| `CANCELLED` | `cancelled` | Cancelled before pickup. |
| `CREATED`, `AWB_PENDING`, `AWB_GENERATED`, `FAILED_AT_CREATION` | **nothing** | Nothing has happened to the parcel yet. A label printed is not a journey, and sending one would teach the model that an address "went in transit" when no van ever moved. |

## What is deliberately NOT sent

**NSA — "Needs Seller Attention".** A parcel still out for delivery at
the evening cutoff with no courier explanation (`orders.nsa_raised_at`).

It is **our own inference**, drawn from a clock, not a courier scan. The
courier has said nothing; we noticed silence. `/v1/feedback` takes
courier events only, so there is no honest value for it: `ndr` would be
a failed attempt that may not have happened, and `in_transit` says
nothing new.

So the sweep sends **nothing** for NSA, and waits. The real `ndr`,
`delivered` or `rto` scan arrives later and speaks for itself — late,
true, and worth learning from, which an invented label is not.

**And it does not go in `ndr_reasons` either.** That field is for the
courier's own NDR text. Putting "NSA" in it would put our inference
inside a field the model reads as the courier's words, which is the same
false label wearing a different hat.

## Rules the sweep obeys

1. **`event_time` carries a UTC offset**, always. Taken from
   `tracking_events.eventAt` (TRK-3 — the SCAN time, not our intake),
   formatted with an explicit offset rather than a bare local string.
2. **Retries are safe.** A repeat of the same event at the same instant
   comes back `duplicate: true` and is ignored at their end, which is
   why the sweep keeps a watermark rather than a per-event ledger: the
   cost of re-sending one event is nothing, and the cost of a second
   table is permanent.
3. **No names, no phone numbers.** Phone-like numbers in `ndr_reasons`
   are masked at their end; we do not rely on that. The only free text
   sent is the courier's own reason string, and nothing else from the
   order ever reaches this call.
4. **It never blocks a status update.** Feedback is a background sweep
   reading `tracking_events` after the fact. A courier scan is recorded,
   the order transitions, and only then — on its own schedule — does the
   sweep tell Solustation about it.

## Why a sweep and not a hook

The sanctioned post-commit seam (`OrderLifecycleEventBus`) carries
**order** status, not shipment status, and a courier scan that does not
move the order emits nothing at all — the webhook processor has an
`ALREADY_AT_TARGET` branch where the shipment advances and the order
does not. Subscribing to the bus would silently drop exactly the NDR and
in-transit events this table most wants.

A hook inside the tracking ingestion path would catch them, and would
mean editing shared code the OLD order page depends on, which this
project is not allowed to do.

So: a repeatable job reads `tracking_events` for shipments whose order
carries an `address_checks` row, newer than that row's
`feedback_watermark_at`. No change to the ingestion path, every scan
caught including the ones that move no order status, and a lag of one
sweep interval — which for model training is nothing.
